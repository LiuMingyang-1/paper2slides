import type { Deck, Paper, Point, PointVerification, Slide } from "../types";
import { el } from "./dom";

export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// After T4 lands, delegate render/fit/export to src/layout and src/export here.
export function renderSlide(slide: Slide, paper: Paper, checks: readonly PointVerification[], opinionLabel: string) {
  const page = el("article", "draft-slide");
  page.dataset.layout = slide.layout;
  const content = el("div", "draft-inner");
  const sourceById = new Map(paper.blocks.map((source) => [source.id, source]));
  let citation = 0;
  for (const [slot, value] of Object.entries({ title: slide.slots.title ?? "", ...slide.slots })) {
    const group = el("div", "draft-slot");
    group.dataset.slot = slot;
    content.append(group);
    if (typeof value === "string") {
      group.append(el(slot === "title" ? "h2" : "p", "", value.replaceAll("|", " · ")));
      continue;
    }
    const list = el("ul");
    value.forEach((point, index) => {
      const check = checks.find((item) => item.slideId === slide.id && item.slot === slot && item.pointIndex === index);
      const claim = el("li", "claim");
      claim.dataset.point = `${slot}:${index}`;
      claim.tabIndex = -1;
      if (point.kind === "opinion") claim.append(el("small", "opinion", opinionLabel), " ");
      const missing = check?.numbers.filter(({ found }) => !found).map(({ value }) => value) ?? [];
      // Keep the verifier's exact source spelling when marking a number.
      let remaining = point.text.replaceAll("|", " · ");
      for (const value of remaining.match(/\S+/g) ?? []) {
        if (!missing.some((number) => value.includes(number))) continue;
        const index = remaining.indexOf(value);
        claim.append(remaining.slice(0, index), el("mark", "unverified-number", value));
        remaining = remaining.slice(index + value.length);
      }
      claim.append(remaining);
      const ref = el("button", `citation ${check?.status ?? "partial"}`, `[${++citation}]`);
      ref.type = "button";
      ref.dataset.evidenceIds = point.evidenceIds.join(" ");
      ref.dataset.status = check?.status ?? "partial";
      claim.append(" ", ref);
      list.append(claim);
    });
    group.append(list);
  }
  const figure = paper.figures.find(({ id }) => id === slide.figureId);
  if (figure) {
    const source = sourceById.get(figure.captionEvidenceId);
    const label = el("button", "figure-citation citation supported", `${figure.label} · p.${figure.page}`);
    label.type = "button";
    label.dataset.evidenceIds = figure.captionEvidenceId;
    label.dataset.status = "supported";
    content.append(label);
    if (source) label.title = source.text;
  }
  page.append(content);
  return page;
}

function fitSlide(page: HTMLElement): string[] {
  const content = page.firstElementChild as HTMLElement;
  for (const factor of [1, 0.94, 0.87, 0.8]) {
    page.style.setProperty("--draft-factor", String(factor));
    if (content.scrollHeight <= content.clientHeight) return [];
  }
  const bottom = content.getBoundingClientRect().bottom;
  return [...content.querySelectorAll<HTMLElement>("[data-slot]")]
    .filter((slot) => slot.getBoundingClientRect().bottom > bottom + 0.5)
    .map((slot) => slot.dataset.slot!);
}

export function scaleSlide(frame: HTMLElement, slide: HTMLElement) {
  const size = () => {
    const scale = frame.clientWidth / SLIDE_WIDTH;
    frame.style.height = `${SLIDE_HEIGHT * scale}px`;
    slide.style.transform = `scale(${scale})`;
  };
  frame.replaceChildren(slide);
  size();
  const resize = new ResizeObserver(size);
  resize.observe(frame);
  return () => resize.disconnect();
}

function split(slide: Slide, continuation: string): Slide[] {
  const points = Object.values(slide.slots).flatMap((value) => typeof value === "string" ? [] : value);
  if (points.length < 2) return [];
  const title = String(slide.slots.title ?? "");
  const headers = typeof slide.slots.headers === "string" ? slide.slots.headers.split("|").map((s) => s.trim()) : undefined;
  const asBullet = (point: Point): Point => ({
    ...point,
    text: headers ? point.text.split("|").map((cell, i) => `${headers[i]} ${cell.trim()}`).join(" · ") : point.text.replaceAll("|", " · "),
  });
  // A dense slide has at most a few points. Each continuation retains the original citations and notes.
  return points.map((point, index) => ({
    id: index === 0 ? slide.id : `${slide.id}-${index + 1}`,
    outlineId: slide.outlineId, layout: "bullets", notes: slide.notes,
    slots: { title: index === 0 ? title : `${title} ${continuation}`, bullets: [asBullet(point)] },
  }));
}

export async function resolveOverflow(
  slides: readonly Slide[], paper: Paper, compress: (slide: Slide, slots: string[]) => Promise<Slide>, continuation: string,
) {
  const sandbox = el("div", "slide-measurement");
  sandbox.setAttribute("aria-hidden", "true");
  document.body.append(sandbox);
  const measure = (slide: Slide) => {
    const page = renderSlide(slide, paper, [], "");
    sandbox.replaceChildren(page);
    return fitSlide(page);
  };
  const fitted: Slide[] = [];
  const unresolved: string[] = [];
  let compressionFailed = false;
  try {
    await document.fonts.ready;
    for (let slide of slides) {
      let overflow = measure(slide);
      if (overflow.length) {
        try {
          slide = await compress(slide, overflow);
        } catch {
          compressionFailed = true;
        }
        overflow = measure(slide);
      }
      const parts = overflow.length ? split(slide, continuation) : [];
      for (const part of parts.length ? parts : [slide]) {
        if (measure(part).length) unresolved.push(part.id);
        fitted.push(part);
      }
    }
  } finally {
    sandbox.remove();
  }
  return { slides: fitted, unresolved, compressionFailed };
}

export function fitPreview(page: HTMLElement) {
  fitSlide(page);
}

/** Temporary editable text export for the Demo and Anna download flow. */
export async function exportSlides(deck: Deck, paper: Paper): Promise<Blob> {
  const { default: PowerPoint } = await import("pptxgenjs");
  const pptx = new PowerPoint();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = paper.title;
  const sources = new Map(paper.blocks.map((block) => [block.id, block]));
  for (const slide of deck.slides) {
    const page = pptx.addSlide();
    const { title, ...slots } = slide.slots;
    page.addText(String(title ?? ""), { x: 0.5, y: 0.6, w: 9, h: 1.2, fontSize: 31, bold: true, color: "172D25", fit: "shrink" });
    const content: string[] = [];
    const evidence = new Set<string>();
    for (const value of Object.values(slots)) {
      if (typeof value === "string") content.push(value.replaceAll("|", " · "));
      else for (const point of value) {
        content.push("• " + point.text.replaceAll("|", " · "));
        point.evidenceIds.forEach((id) => evidence.add(id));
      }
    }
    const figure = paper.figures.find(({ id }) => id === slide.figureId);
    if (figure) {
      content.push(`${figure.label} (p.${figure.page})`);
      evidence.add(figure.captionEvidenceId);
    }
    if (content.length) page.addText(content.join("\n"), { x: 0.5, y: 2, w: 9, h: 3, fontSize: 20, breakLine: false, fit: "shrink" });
    const refs = [...evidence].flatMap((id) => {
      const source = sources.get(id);
      return source ? [source] : [];
    });
    const pages = [...new Set(refs.map(({ page }) => page))];
    if (pages.length) page.addText(pages.map((page) => `p.${page}`).join(", "), {
      x: 6, y: 5.12, w: 3.5, h: 0.25, fontSize: 10, align: "right", color: "52695F",
    });
    const notes = [slide.notes, ...refs.map(({ page, text, id }) => `[${id}] p.${page} · ${text}`)].filter(Boolean);
    if (notes.length) page.addNotes(notes.join("\n\n"));
  }
  const result = await pptx.write({ outputType: "blob" });
  return new Blob([result as Blob], { type: PPTX_MIME });
}
