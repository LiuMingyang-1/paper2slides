// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { Deck, Paper } from "../types";
import { renderPreview } from "./preview";

vi.mock("./pdf", () => ({ openPdf: vi.fn() }));

it("distinguishes an empty cover from failures elsewhere in the deck", () => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  const paper: Paper = {
    id: "paper", title: "Example", authors: [], pageCount: 1, bodyPageCount: 1, blocks: [], figures: [], warnings: [],
  };
  const deck: Deck = {
    paperId: paper.id, llmCalls: [],
    slides: [
      { id: "s1", outlineId: "s1", layout: "title", slots: { title: paper.title } },
      { id: "s2", outlineId: "s2", layout: "bullets", slots: {
        title: "Results", bullets: [{ text: "99 answers.", kind: "fact", evidenceIds: [] }],
      } },
    ],
    verifications: [{
      slideId: "s2", slot: "bullets", pointIndex: 0,
      status: "unsupported", reason: "事实要点未提供引用。", matchScore: 0,
      missingEvidenceIds: [], numbers: [{ value: "99", found: false }],
    }],
  };
  const preview = renderPreview(deck, paper, new ArrayBuffer(0), "zh", 0, vi.fn());
  try {
    preview.mount();
    const stats = preview.root.querySelector(".check-counts")!;
    const failures = preview.root.querySelector(".failures summary")!;
    expect(stats.textContent).toBe("本页无待核验要点");
    expect(failures.textContent).toBe("全稿未通过的要点 · 1");

    preview.root.querySelectorAll<HTMLButtonElement>(".thumb")[1]!.click();
    expect(stats.querySelector(".unsupported")?.textContent).toBe("❌ 1");
    expect(failures.textContent).toBe("全稿未通过的要点 · 1");
  } finally {
    preview.dispose();
    vi.unstubAllGlobals();
  }
});
