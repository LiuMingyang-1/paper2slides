// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fixtureDeck, fixturePaper } from "../layout/fixture";
import type { PointVerification } from "../types";
import { renderSlide } from "./slides-adapter";

describe("T4 slide adapter", () => {
  it("preserves the native figure and every point's landing target across all layouts", () => {
    for (const slide of fixtureDeck.slides) {
      const view = renderSlide(slide, fixturePaper, fixtureDeck.verifications, "Interpretation");
      expect(view.dataset.layout).toBe(slide.layout);
      for (const check of fixtureDeck.verifications.filter(({ slideId }) => slideId === slide.id)) {
        const target = view.querySelector(`[data-point="${check.slot}:${check.pointIndex}"]`);
        expect(target?.querySelector("[data-evidence-ids]")?.getAttribute("role")).toBe("button");
      }
    }
    const figure = renderSlide(fixtureDeck.slides[2]!, fixturePaper, fixtureDeck.verifications, "Interpretation");
    expect(figure.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(figure.querySelector("figcaption")?.dataset.point).toBe("caption:0");
  });

  it("marks a failed number within a table cell and keeps the native row intact", () => {
    const slide = fixtureDeck.slides[4]!;
    const failed: PointVerification = {
      slideId: slide.id, slot: "rows", pointIndex: 1, status: "unsupported", reason: "Wrong value",
      numbers: [{ value: "81.6%", found: false }], matchScore: 0, missingEvidenceIds: [],
    };
    const view = renderSlide(slide, fixturePaper, [failed], "Interpretation");
    const row = view.querySelector('tr[data-point="rows:1"]');
    expect(row?.querySelector("mark")?.textContent).toBe("81.6%");
    expect(row?.querySelectorAll("td")).toHaveLength(3);
  });

  it("activates keyboard citations and keeps the thumbnail presentation out of tab order", () => {
    const slide = fixtureDeck.slides[1]!;
    const view = renderSlide(slide, fixturePaper, fixtureDeck.verifications, "Interpretation");
    const ref = view.querySelector<HTMLElement>("[data-evidence-ids]")!;
    const onClick = vi.fn();
    ref.addEventListener("click", onClick);
    ref.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(view.querySelector(".p2s-opinion")?.textContent).toBe("Interpretation");

    const thumbnail = renderSlide(slide, fixturePaper, fixtureDeck.verifications, "Interpretation", false);
    expect(thumbnail.querySelector("[tabindex], [role=button]")).toBeNull();
  });
});
