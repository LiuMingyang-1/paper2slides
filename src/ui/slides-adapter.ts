import { fitSlide, renderSlide as renderLayout, slideReady } from "../layout";
import type { Deck, Paper, PointVerification, Slide } from "../types";
import { verifyDeck } from "../verify/citation";
import { el } from "./dom";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function markNumbers(claim: HTMLElement, check: PointVerification | undefined) {
  const numbers = check?.numbers.filter(({ found }) => !found).map(({ value }) => value) ?? [];
  if (!numbers.length) return;
  const alternatives = [...new Set(numbers)].sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\d.])(?:${alternatives.join("|")})(?!\\d|\\.\\d)`, "gu");
  const walker = document.createTreeWalker(claim, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest(".p2s-citation, .p2s-opinion") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const matches = [...node.data.matchAll(pattern)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(offset, match.index), el("mark", "unverified-number", match[0]));
      offset = match.index + match[0].length;
    }
    fragment.append(node.data.slice(offset));
    node.replaceWith(fragment);
  }
}

export function renderSlide(
  slide: Slide, paper: Paper, checks: readonly PointVerification[], opinionLabel: string, interactive = true,
) {
  const page = renderLayout(slide, { paper, verifications: checks });
  const pointChecks = new Map(checks.filter(({ slideId }) => slideId === slide.id)
    .map((check) => [`${check.slot}:${check.pointIndex}`, check]));
  for (const label of page.querySelectorAll(".p2s-opinion")) label.textContent = opinionLabel;
  for (const slot of page.querySelectorAll<HTMLElement>("[data-slot]")) {
    const name = slot.dataset.slot!;
    if (!Array.isArray(slide.slots[name])) continue;
    slot.querySelectorAll<HTMLElement>("[data-evidence-ids]").forEach((ref, index) => {
      // A table citation lives in the final cell. A metric citation lives in its label.
      const claim = name === "numbers" ? ref.parentElement?.parentElement : ref.closest<HTMLElement>("li, tr, figcaption");
      if (!claim) return;
      const key = `${name}:${index}`;
      markNumbers(claim, pointChecks.get(key));
      if (interactive) {
        claim.dataset.point = key;
        claim.tabIndex = -1;
        ref.setAttribute("role", "button");
        ref.tabIndex = 0;
        ref.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          ref.click();
        });
      }
    });
  }
  return page;
}

export function scaleSlide(frame: HTMLElement, slide: HTMLElement) {
  slide.style.transformOrigin = "top left";
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

function split(slide: Slide): Slide[] {
  const first: Slide["slots"] = {};
  const second: Slide["slots"] = {};
  let hasContinuation = false;
  for (const [slot, value] of Object.entries(slide.slots)) {
    if (typeof value === "string") {
      first[slot] = second[slot] = value;
    } else {
      const middle = Math.ceil(value.length / 2);
      first[slot] = value.slice(0, middle);
      if (middle < value.length) {
        second[slot] = value.slice(middle);
        hasContinuation = true;
      }
    }
  }
  return hasContinuation ? [{ ...slide, slots: first }, { ...slide, slots: second }] : [];
}

function measurementStage() {
  const stage = el("div", "slide-measurement");
  stage.setAttribute("aria-hidden", "true");
  document.body.append(stage);
  return stage;
}

export async function resolveOverflow(
  slides: readonly Slide[], paper: Paper, compress: (slide: Slide, slots: string[]) => Promise<Slide>,
  continuation: string, opinionLabel: string,
) {
  const stage = measurementStage();
  const evidence = new Map(paper.blocks.map((block) => [block.id, block]));
  const measure = async (slide: Slide) => {
    const page = renderSlide(slide, paper, verifyDeck([slide], evidence), opinionLabel, false);
    stage.replaceChildren(page);
    await slideReady(page);
    return [...fitSlide(page).overflowingSlots];
  };
  const fitted: Slide[] = [];
  const unresolved: string[] = [];
  let compressionFailed = false;
  try {
    for (let slide of slides) {
      let overflow = await measure(slide);
      if (overflow.length) {
        try {
          slide = await compress(slide, overflow);
        } catch {
          compressionFailed = true;
        }
        overflow = await measure(slide);
      }
      if (!overflow.length) {
        fitted.push(slide);
        continue;
      }

      const title = String(slide.slots.title ?? "");
      let pageNumber = 0;
      const queue = [slide];
      while (queue.length) {
        const part = queue.shift()!;
        const candidate = pageNumber === 0 ? part : {
          ...part, id: `${slide.id}-${pageNumber + 1}`, slots: { ...part.slots, title: `${title} ${continuation}` },
        };
        const slots = await measure(candidate);
        // If the remaining overflow is in repeated labels, splitting the rows cannot resolve it.
        const parts = slots.some((slot) => Array.isArray(part.slots[slot])) ? split(part) : [];
        if (parts.length) {
          queue.unshift(...parts);
          continue;
        }
        if (slots.length) unresolved.push(candidate.id);
        fitted.push(candidate);
        pageNumber++;
      }
    }
  } finally {
    stage.remove();
  }
  return { slides: fitted, unresolved, compressionFailed };
}

export function fitPreview(page: HTMLElement) {
  const transform = page.style.transform;
  page.style.transform = "";
  fitSlide(page);
  page.style.transform = transform;
}

export async function exportSlides(deck: Deck, paper: Paper, opinionLabel: string): Promise<Blob> {
  const { exportPptx } = await import("../export");
  const stage = measurementStage();
  try {
    const roots = deck.slides.map((slide) => renderSlide(slide, paper, deck.verifications, opinionLabel, false));
    stage.append(...roots);
    await Promise.all(roots.map(slideReady));
    return await exportPptx(deck, paper, { measurements: roots.map(fitSlide) });
  } finally {
    stage.remove();
  }
}
