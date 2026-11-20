import type { Deck, Evidence, Paper, PointVerification, VerifyStatus } from "../types";
import { bindCitations } from "./citations";
import { button, el } from "./dom";
import type { openPdf } from "./pdf";
import { fitPreview, renderSlide, scaleSlide } from "./slides-adapter";
import { glyph, strings, type Language } from "./strings";

function counts(checks: readonly PointVerification[]) {
  const totals = { supported: 0, partial: 0, unsupported: 0 };
  for (const check of checks) totals[check.status]++;
  return totals;
}

export function renderPreview(
  deck: Deck, paper: Paper, bytes: ArrayBuffer, language: Language, initial: number, onSelect: (index: number) => void,
) {
  const t = strings[language];
  const evidence = new Map(paper.blocks.map((item) => [item.id, item]));
  const strip = el("nav", "strip");
  strip.setAttribute("aria-label", t.thumbnails);
  const frame = el("div", "slide-frame");
  const counter = el("span", "counter");
  const stats = el("div", "check-counts");
  const failed = el("details", "failures");
  const numberOfFailures = deck.verifications.filter(({ status }) => status === "unsupported").length;
  failed.append(el("summary", "", `${t.failures} · ${numberOfFailures}`));
  const canvas = el("section", "center-pane",
    el("div", "pane-heading", el("h2", "", t.preview), counter),
    el("div", "stage", frame),
    el("section", "verification",
      el("div", "verification-heading", el("h3", "", t.checks), stats), failed));
  const pdf = el("div", "pdf-scroll");
  pdf.tabIndex = 0;
  pdf.setAttribute("aria-label", t.pdf);
  let viewer: Awaited<ReturnType<typeof openPdf>> | undefined;
  let disposed = false;
  let pending: Evidence | undefined;
  function reveal(source: Evidence) {
    pending = source;
    viewer?.reveal(source);
  }
  const prev = button("←", () => viewer?.move(-1), "icon");
  const next = button("→", () => viewer?.move(1), "icon");
  prev.title = t.previous;
  prev.setAttribute("aria-label", t.previous);
  next.title = t.next;
  next.setAttribute("aria-label", t.next);
  prev.disabled = next.disabled = true;
  const pageNumber = el("span", "counter", "—");
  const message = el("div", "pdf-message", t.loading);
  const right = el("section", "pdf-pane",
    el("div", "pane-heading", el("h2", "", t.pdf), el("div", "pdf-controls", prev, pageNumber, next)),
    el("div", "pdf-wrap", pdf, message));
  let unbind = () => {};
  let unscale = () => {};
  const unscaleThumbs: (() => void)[] = [];
  const statuses = Object.keys(glyph) as VerifyStatus[];
  const marks = (checks: readonly PointVerification[]) => {
    const totals = counts(checks);
    return statuses.map((status) => {
      const item = el("span", `stat ${status}`, `${glyph[status]} ${totals[status]}`);
      item.title = t[status];
      item.setAttribute("aria-label", `${t[status]} ${totals[status]}`);
      return item;
    });
  };
  const slideChecks = new Map(deck.slides.map((slide) => [slide.id, deck.verifications.filter((check) => check.slideId === slide.id)]));
  const heading = el("h2", "", t.thumbnails);
  const miniatures: HTMLElement[] = [];
  const thumbnails = deck.slides.map((slide, index) => {
    const thumb = el("div", "mini-slide");
    thumb.setAttribute("aria-hidden", "true");
    const mini = renderSlide(slide, paper, slideChecks.get(slide.id)!, t.opinion, false);
    miniatures.push(mini);
    const thumbButton = button("", () => select(index), "thumb");
    thumbButton.setAttribute("aria-label", `${index + 1}. ${slide.slots.title}`);
    thumbButton.append(thumb,
      el("span", "thumb-meta", el("span", "counter", String(index + 1).padStart(2, "0")), ...marks(slideChecks.get(slide.id)!)));
    strip.append(thumbButton);
    unscaleThumbs.push(scaleSlide(thumb, mini));
    return thumbButton;
  });
  const root = el("div", "preview-grid", el("aside", "left-pane", el("div", "pane-heading", heading), strip), canvas, right);
  function select(index: number) {
    const slide = deck.slides[index];
    if (!slide) return;
    unbind();
    unscale();
    onSelect(index);
    thumbnails.forEach((thumb, i) => thumb.setAttribute("aria-current", String(i === index)));
    const checks = slideChecks.get(slide.id)!;
    const view = renderSlide(slide, paper, checks, t.opinion);
    unscale = scaleSlide(frame, view);
    fitPreview(view);
    unbind = bindCitations(view, evidence, language, reveal);
    counter.textContent = `${String(index + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}`;
    stats.replaceChildren(el("span", "", t.oneSlide),
      ...(checks.length ? marks(checks) : [el("span", "", t.noChecks)]));
  }
  if (!numberOfFailures) failed.append(el("p", "empty", t.allClear));
  for (const check of deck.verifications.filter(({ status }) => status === "unsupported")) {
    const index = deck.slides.findIndex(({ id }) => id === check.slideId);
    const slide = deck.slides[index]!;
    const slot = slide.slots[check.slot];
    if (!Array.isArray(slot)) continue;
    const point = slot[check.pointIndex]!;
    const reason = language === "zh" ? check.reason : [
      ...check.missingEvidenceIds.map((id) => `Missing citation ${id}`),
      ...check.numbers.filter(({ found }) => !found).map(({ value }) => `${value} lacks support in the cited evidence`),
    ].join(" · ") || t.noSource;
    const item = button("", () => {
      select(index);
      const claim = frame.querySelector<HTMLElement>(`[data-point="${CSS.escape(`${check.slot}:${check.pointIndex}`)}"]`);
      claim?.focus({ preventScroll: true });
      const source = point.evidenceIds.map((id) => evidence.get(id)).find(Boolean);
      if (source) reveal(source);
    }, "failed-claim");
    item.append(el("span", "counter unsupported", `❌ ${index + 1}`), el("span", "", point.text), el("small", "", reason));
    failed.append(item);
  }
  return {
    root,
    mount() {
      miniatures.forEach(fitPreview);
      select(initial);
      void import("./pdf").then(({ openPdf }) => {
        if (disposed) return;
        return openPdf(pdf, bytes, (page, total) => {
          pageNumber.textContent = `${page} / ${total}`;
          prev.disabled = page <= 1;
          next.disabled = page >= total;
        });
      }).then((opened) => {
        if (!opened) return;
        if (disposed) return opened.destroy();
        viewer = opened;
        message.remove();
        if (pending) viewer.reveal(pending);
      }).catch(() => { message.textContent = t.pdfError; });
    },
    dispose() {
      disposed = true;
      unbind();
      unscale();
      unscaleThumbs.forEach((cleanup) => cleanup());
      void viewer?.destroy().catch(() => {});
    },
  };
}
