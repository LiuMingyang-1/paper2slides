export interface SlideMeasurement {
  readonly root: HTMLElement;
  readonly bounds: DOMRectReadOnly;
  readonly boxes: ReadonlyMap<HTMLElement, DOMRectReadOnly>;
  readonly overflowingSlots: readonly string[];
}

const ENLARGEMENTS = [-4, -8, -13] as const;
const REDUCTIONS = [4, 8, 12, 16, 21, 22] as const;

/** Measure a mounted slide at any uniform preview scale. */
export function measureSlide(root: HTMLElement): SlideMeasurement {
  const bounds = root.getBoundingClientRect();
  const boxes = new Map<HTMLElement, DOMRectReadOnly>();
  const box = (el: HTMLElement) => {
    const measured = boxes.get(el) ?? el.getBoundingClientRect();
    boxes.set(el, measured);
    return measured;
  };
  const overflowing = new Set<string>();
  for (const slot of root.querySelectorAll<HTMLElement>("[data-slot]")) {
    const region = slot.closest<HTMLElement>("[data-fit-region]");
    const rect = box(slot);
    const limit = region ? box(region) : bounds;
    const inlineOverflow = rect.left < limit.left - 0.5 || rect.right > limit.right + 0.5;
    const blockOverflow = rect.top < limit.top - 0.5 || rect.bottom > limit.bottom + 0.5;
    if (inlineOverflow || blockOverflow || slot.scrollHeight > slot.clientHeight || slot.scrollWidth > slot.clientWidth) {
      overflowing.add(slot.dataset.slot!);
    }
  }
  root.querySelectorAll<HTMLElement>("[data-pptx], tr, th, td").forEach(box);
  return { root, bounds, boxes, overflowingSlots: [...overflowing] };
}

function fitTitle(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>(".p2s-title");
  if (!title) return;
  const style = root.ownerDocument.defaultView!.getComputedStyle(root);
  const min = Number.parseInt(style.getPropertyValue("--p2s-title-min"), 10);
  const max = Number.parseInt(style.getPropertyValue("--p2s-title-max"), 10);
  title.dataset.singleLine = "";
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  const setSize = (size: number) => title.style.setProperty("--p2s-title-size", `${size}px`);
  setSize(max);
  if (title.scrollWidth <= title.clientWidth) return;
  setSize(min);
  if (title.scrollWidth > title.clientWidth) {
    delete title.dataset.singleLine;
    return;
  }
  let low = min;
  let high = max - 1;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    setSize(candidate);
    if (title.scrollWidth <= title.clientWidth) low = candidate;
    else high = candidate - 1;
  }
  setSize(low);
}

function fitFigure(body: HTMLElement) {
  const figure = body.querySelector<HTMLElement>(".p2s-figure");
  const image = figure?.querySelector("img");
  if (!figure || !image?.naturalHeight) return;
  const caption = figure.querySelector("figcaption");
  const gap = Number.parseFloat(body.ownerDocument.defaultView!.getComputedStyle(figure).rowGap);
  const availableHeight = body.clientHeight - (caption ? caption.offsetHeight + gap : 0);
  const width = Math.max(0, availableHeight) * image.naturalWidth / image.naturalHeight;
  // CSS caps the width at the column width. Keep the image's actual box for PPTX export.
  image.style.setProperty("--p2s-image-width", `${width}px`);
}

/** Expand sparse content within the density band, or shrink overflowing content to the font floors. */
export function fitSlide(root: HTMLElement): SlideMeasurement {
  fitTitle(root);
  const body = root.querySelector<HTMLElement>(".p2s-body");
  const content = body?.firstElementChild as HTMLElement | null | undefined;
  const measureAt = (reduction: number) => {
    root.style.setProperty("--p2s-reduction", `${reduction}px`);
    if (body?.classList.contains("p2s-figure-layout")) fitFigure(body);
    return measureSlide(root);
  };
  const density = () => content && body?.clientHeight ? content.offsetHeight / body.clientHeight : 1;
  let measurement = measureAt(0);
  if (!measurement.overflowingSlots.length) {
    let accepted = 0;
    for (const enlargement of ENLARGEMENTS) {
      if (density() >= 0.6) break;
      const expanded = measureAt(enlargement);
      if (expanded.overflowingSlots.length || density() > 0.85) return measureAt(accepted);
      measurement = expanded;
      accepted = enlargement;
    }
    return measurement;
  }
  for (const reduction of REDUCTIONS) {
    measurement = measureAt(reduction);
    if (!measurement.overflowingSlots.length) return measurement;
  }
  return measurement;
}
