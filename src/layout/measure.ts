export interface SlideMeasurement {
  readonly root: HTMLElement;
  readonly bounds: DOMRectReadOnly;
  readonly boxes: ReadonlyMap<HTMLElement, DOMRectReadOnly>;
  readonly overflowingSlots: readonly string[];
}

const REDUCTIONS = [0, 4, 8, 12, 16, 21, 22] as const;

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

/** Fit by font size alone; the caller owns compression and pagination. */
export function fitSlide(root: HTMLElement): SlideMeasurement {
  let measurement: SlideMeasurement;
  for (const reduction of REDUCTIONS) {
    root.style.setProperty("--p2s-reduction", `${reduction}px`);
    measurement = measureSlide(root);
    if (!measurement.overflowingSlots.length) return measurement;
  }
  return measurement!;
}
