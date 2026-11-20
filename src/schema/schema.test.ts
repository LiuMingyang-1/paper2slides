import { describe, expect, it } from "vitest";
import type { LayoutId, Point, Slide } from "../types";
import { compressionValidator } from "./compress";
import { LAYOUT_IDS, LAYOUTS } from "./layouts";
import { outlineValidator } from "./outline";
import { slideValidator } from "./slide";
import { understandingValidator } from "./understanding";

const evidenceIds = new Set(["e1-1", "e2-3"]);
const figureIds = new Set(["fig1"]);
const point = (text: string): Point => ({ text, kind: "fact", evidenceIds: ["e1-1"] });

const fixtures: Record<LayoutId, Slide["slots"]> = {
  title: { title: "Paper", authors: "A. Author" },
  bullets: { title: "Method", bullets: [point("A two-stage method")] },
  bullets_figure: { title: "Framework", bullets: [point("A two-stage method")], caption: [point("Framework overview")] },
  key_numbers: { title: "Result", numbers: [point("8.60% | Error rate on data set A")] },
  table: { title: "Result", headers: "Model | Error", rows: [point("Baseline | 8.60%")] },
  two_column: { title: "Comparison", leftHeading: "Method A", left: [point("CNN")], rightHeading: "Method B", right: [point("RNN")] },
};

function slideFor(layout: LayoutId): Slide {
  return {
    id: "s1", outlineId: "s1", layout, slots: fixtures[layout],
    ...(layout === "bullets_figure" ? { figureId: "fig1" } : {}),
  };
}

function validate(layout: LayoutId) {
  return slideValidator({ outlineId: "s1", titlePage: layout === "title", evidenceIds, figureIds });
}

describe("model output schemas", () => {
  it.each(LAYOUT_IDS)("validates %s using the published slot definitions", (layout) => {
    const slide = slideFor(layout);
    expect(validate(layout)(slide)).toEqual({ value: slide, missingEvidenceIds: [] });
  });

  it("rejects an unknown layout, invalid raw slots, excess characters and unavailable images", () => {
    expect(() => validate("bullets")({ ...slideFor("bullets"), layout: "diagram" })).toThrow("layout");
    const slides = [
      { ...slideFor("bullets"), slots: { ...fixtures.bullets, body: "unknown slot" } },
      { ...slideFor("bullets"), slots: { title: "Method", bullets: [point("论".repeat(LAYOUTS.bullets.slots.bullets!.maxChars + 1))] } },
    ];
    for (const slide of slides) expect(() => validate("bullets")(slide)).toThrow("slots");
    expect(() => validate("bullets_figure")({ ...slideFor("bullets_figure"), figureId: "fig9" })).toThrow("figureId");
    expect(() => validate("table")({
      ...slideFor("table"), slots: { ...fixtures.table, rows: [point("Baseline | 8.60% | N/A")] },
    })).toThrow("rows[0]");
  });

  it("rejects malformed, missing and repeated citations but preserves unknown IDs", () => {
    const schema = understandingValidator(evidenceIds);
    const withIds = (ids: string[]) => ({
      title: "Paper", oneLiner: "About CNN", modules: [{ kind: "method", points: [{ ...point("CNN"), evidenceIds: ids }] }],
    });
    for (const ids of [[], ["Figure 2"], ["e1-1", "e1-1"]]) {
      expect(() => schema(withIds(ids))).toThrow("evidenceIds");
    }
    const value = withIds(["e1-1", "e3-1"]);
    expect(schema(value)).toEqual({ value, missingEvidenceIds: ["e3-1"] });
  });

  it("requires a title page and blocks invented modules in outlines", () => {
    const schema = outlineValidator("balanced", ["method"], figureIds);
    const items = [
      { id: "s1", title: "Paper", modules: [], intent: "Introduce the paper" },
      ...["A", "B", "C", "D"].map((title, index) => ({
        id: `s${index + 2}`, title, modules: ["method"], intent: "Discuss " + title,
      })),
    ];
    expect(schema({ emphasis: "balanced", items }).value.items).toHaveLength(5);
    expect(() => schema({ emphasis: "balanced", items: items.slice(0, 4) })).toThrow("5–8");
    expect(() => schema({ emphasis: "balanced", items: [{ ...items[0], modules: ["method"] }, ...items.slice(1)] })).toThrow("items[0].modules");
    expect(() => schema({ emphasis: "balanced", items: [
      ...items.slice(0, 4), { ...items[4], modules: ["ablation"] },
    ] })).toThrow("items[4].modules");
  });

  it("compression preserves point provenance, numeric spelling and table cell assignment", () => {
    const original = slideFor("table");
    const schema = compressionValidator(original, ["rows"], validate("table"));
    const revised = (text: string, evidenceIds = ["e1-1"]): Slide => ({
      ...original, slots: { ...original.slots, rows: [{ ...point(text), evidenceIds }] },
    });
    expect(schema(revised("Base | 8.60%")).value).toEqual(revised("Base | 8.60%"));
    expect(() => schema(revised("Base | 8.6%"))).toThrow("数字");
    expect(() => schema(revised("8.60% | Base"))).toThrow("数字");
    expect(() => schema(revised("Base | 8.60%", ["e2-3"]))).toThrow("evidenceIds");
    expect(() => schema(original)).toThrow("缩短");
  });
});

describe("validation feedback for model retries", () => {
  it("formats nested citation paths with array indexes and concise Chinese rules", () => {
    const schema = understandingValidator(evidenceIds);
    expect(() => schema({
      title: "Paper",
      oneLiner: "About CNN",
      modules: [{ kind: "method", points: [{ ...point("CNN"), evidenceIds: ["Figure 2"] }] }],
    })).toThrow(/^modules\[0\]\.points\[0\]\.evidenceIds\[0\]：应为 e\{页码\}-\{块序号\}$/);
  });

  it("reports the containing object for unexpected keys without echoing input", () => {
    expect(() => validate("bullets")({
      ...slideFor("bullets"),
      slots: { ...fixtures.bullets, "Untrusted model output": "unexpected contents" },
    })).toThrow(/^slots：含未定义字段$/);
  });

  it("caps feedback at three issues and identifies a missing field", () => {
    expect(() => validate("two_column")({
      ...slideFor("two_column"),
      slots: {},
    })).toThrow(/^slots\.title：应提供此字段；slots\.leftHeading：应提供此字段；slots\.left：应提供此字段$/);
  });

  it("counts Unicode code points in slot length limits", () => {
    const schema = validate("title");
    const chars = LAYOUTS.title.slots.title!.maxChars;
    const slide = { ...slideFor("title"), slots: { title: "𠀀".repeat(chars) } };
    expect(schema(slide).value).toEqual(slide);
    expect(() => schema({ ...slide, slots: { title: slide.slots.title + "𠀀" } }))
      .toThrow(new RegExp(`^slots\\.title：最多 ${chars} 个字符$`));
  });
});
