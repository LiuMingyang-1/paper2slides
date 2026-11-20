// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_IDS, LAYOUTS } from "../schema/layouts";
import { fixtureDeck, fixturePaper } from "./fixture";
import { fitSlide, measureSlide, renderSlide } from "./index";

const render = (index: number) =>
  renderSlide(fixtureDeck.slides[index]!, { paper: fixturePaper, verifications: fixtureDeck.verifications });

afterEach(() => vi.restoreAllMocks());

describe("slide templates", () => {
  it("renders the shared slots for all six layouts and numbers citations in DOM order", () => {
    expect([...new Set(fixtureDeck.slides.map((slide) => slide.layout))]).toEqual(LAYOUT_IDS);
    fixtureDeck.slides.forEach((slide, index) => {
      const root = render(index);
      expect(root.dataset.layout).toBe(slide.layout);
      expect(root.querySelector("h1")?.textContent).toBe(slide.slots.title);
      expect([...root.querySelectorAll<HTMLElement>("[data-slot]")].map((el) => el.dataset.slot))
        .toEqual(Object.keys(LAYOUTS[slide.layout].slots).filter((name) => name in slide.slots));

      const refs = [...root.querySelectorAll("sup")];
      const points = Object.keys(LAYOUTS[slide.layout].slots).flatMap((name) => {
        const value = slide.slots[name];
        return Array.isArray(value) ? value.map((point, pointIndex) => ({ point, pointIndex, name })) : [];
      });
      expect(refs).toHaveLength(points.length);
      points.forEach(({ point, name, pointIndex }, i) => {
        const ref = refs[i]!;
        const check = fixtureDeck.verifications.find((entry) =>
          entry.slideId === slide.id && entry.slot === name && entry.pointIndex === pointIndex);
        expect(ref.textContent).toBe(`[${i + 1}]`);
        expect(ref.dataset.evidenceIds).toBe(point.evidenceIds.join(" "));
        expect(ref.classList.contains(check!.status)).toBe(true);
      });
    });
  });

  it("keeps optional content absent and renders structural elements", () => {
    const title = fixtureDeck.slides[0]!;
    expect(renderSlide({ ...title, slots: { title: title.slots.title! } }).querySelector("p")).toBeNull();
    expect(render(0).querySelector(".p2s-subtitle")?.textContent).toBe(title.slots.subtitle);
    expect(render(1).querySelector(".p2s-takeaway-label")?.textContent).toBe("要点");
    expect(render(6).querySelector(".p2s-takeaway")).toBeNull();
    expect(render(1).querySelector(".p2s-opinion")?.textContent).toBe("解读");
    const figure = render(2);
    expect(figure.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(figure.querySelector("figcaption sup")?.textContent).toBe("[4]");
    expect(figure.querySelector("footer")?.textContent).toBe("p.3, p.4");
    expect(render(3).querySelector(".p2s-metric")?.textContent).toBe("81.6%");
    expect([...render(4).querySelectorAll("thead th")].map((el) => el.textContent))
      .toEqual(["策略", "Recall@10", "单次查询时延"]);
    expect(render(4).querySelector<HTMLElement>("tbody tr:nth-child(2) td:last-child sup")?.dataset.evidenceIds).toBe("e4-2");
    expect(render(5).querySelectorAll(".p2s-column")).toHaveLength(2);
  });

  it("falls back to a figure reference for failed crops and undecodable PNGs", () => {
    const paper = { ...fixturePaper, figures: fixturePaper.figures.map((figure) => ({ ...figure, cropOk: false })) };
    const fallback = renderSlide(fixtureDeck.slides[2]!, { paper });
    const decodeError = render(2);
    decodeError.querySelector("img")!.dispatchEvent(new Event("error"));
    for (const root of [fallback, decodeError]) {
      expect(root.querySelector("img")).toBeNull();
      expect(root.querySelector(".p2s-figure-reference")?.textContent).toBe("见原文 图 1（p.3）");
    }
  });
});

describe("overflow measurement", () => {
  it("enlarges sparse content until it reaches the target and resets when refitting", () => {
    const root = render(6);
    const body = root.querySelector<HTMLElement>(".p2s-body")!;
    const content = root.querySelector<HTMLElement>(".p2s-content")!;
    vi.spyOn(body, "clientHeight", "get").mockReturnValue(500);
    let regularHeight = 240;
    vi.spyOn(content, "offsetHeight", "get").mockImplementation(() =>
      regularHeight - 10 * Number.parseInt(root.style.getPropertyValue("--p2s-reduction"), 10));
    expect(fitSlide(root).overflowingSlots).toEqual([]);
    expect(root.style.getPropertyValue("--p2s-reduction")).toBe("-8px");
    regularHeight = 380;
    expect(fitSlide(root).overflowingSlots).toEqual([]);
    expect(root.style.getPropertyValue("--p2s-reduction")).toBe("0px");
  });

  it("reduces fonts in steps and reports slots that still overflow at the floors", () => {
    const root = render(1);
    const title = root.querySelector<HTMLElement>("[data-slot=title]")!;
    const bullets = root.querySelector<HTMLElement>("[data-slot=bullets]")!;
    let alwaysOverflow = false;
    vi.spyOn(bullets, "scrollHeight", "get").mockImplementation(() =>
      alwaysOverflow || (Number.parseInt(root.style.getPropertyValue("--p2s-reduction"), 10) || 0) < 8 ? 101 : 100);
    vi.spyOn(bullets, "clientHeight", "get").mockReturnValue(100);
    vi.spyOn(title, "clientHeight", "get").mockReturnValue(50);
    vi.spyOn(title, "scrollHeight", "get").mockReturnValue(50);
    expect(measureSlide(root).overflowingSlots).toEqual(["bullets"]);
    expect(fitSlide(root).overflowingSlots).toEqual([]);
    expect(root.style.getPropertyValue("--p2s-reduction")).toBe("8px");
    alwaysOverflow = true;
    expect(fitSlide(root).overflowingSlots).toEqual(["bullets"]);
    expect(root.style.getPropertyValue("--p2s-reduction")).toBe("22px");
  });

  it("detects a natural-height table body clipped by its enclosing region", () => {
    const root = render(4);
    vi.spyOn(root.querySelector<HTMLElement>(".p2s-body")!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(64, 150, 1152, 500));
    vi.spyOn(root.querySelector("thead")!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(64, 150, 1152, 70));
    vi.spyOn(root.querySelector("tbody")!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(64, 220, 1152, 450));
    expect(measureSlide(root).overflowingSlots).toEqual(["rows"]);
  });
});
