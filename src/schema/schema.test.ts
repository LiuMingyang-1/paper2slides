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
      { ...slideFor("bullets"), slots: [] },
      { ...slideFor("bullets"), slots: { title: "Method", bullets: [point("论".repeat(LAYOUTS.bullets.slots.bullets!.maxChars * 2 + 1))] } },
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
      ...["A", "B", "C", "D", "E"].map((title, index) => ({
        id: `s${index + 2}`, title, modules: ["method"], intent: "Discuss " + title,
      })),
    ];
    expect(schema({ emphasis: "balanced", items }).value.items).toHaveLength(6);
    expect(() => schema({ emphasis: "balanced", items: items.slice(0, 4) })).toThrow("5–10");
    expect(() => schema({ emphasis: "balanced", items: [{ ...items[0], modules: ["method"] }, ...items.slice(1)] })).toThrow("items[0].modules");
    expect(() => schema({ emphasis: "balanced", items: [
      ...items.slice(0, 4), { ...items[4], modules: ["ablation"] }, items[5],
    ] })).toThrow("items[4].modules");
    expect(() => schema({ emphasis: "balanced", items: [
      ...items.slice(0, 5), { ...items[5], title: " ａ " },
    ] })).toThrow("items[5].title：标题不得重复");
    const normalizations: string[] = [];
    expect(schema({ emphasis: "balanced", items: items.slice(0, 5) }, normalizations).value.items).toHaveLength(5);
    expect(normalizations).toEqual([expect.stringContaining("低于 6 页目标")]);
  });

  it("rejects content titles above 22 Han characters or 60 total characters", () => {
    const schema = validate("bullets");
    const slide = (title: string) => ({ ...slideFor("bullets"), slots: { ...fixtures.bullets, title } });
    for (const title of ["BERT " + "论".repeat(22), "a".repeat(60)]) {
      expect(schema(slide(title)).value.slots.title).toBe(title);
    }
    expect(() => schema(slide("论".repeat(23)))).toThrow("中文标题最多 22 个汉字");
    expect(() => schema(slide("a".repeat(61)))).toThrow("最多 60 个字符");
  });

  it("warns about one valid citation with more evidence available but never invents another citation", () => {
    const base = slideFor("bullets");
    const slide = { ...base, slots: { ...base.slots, bullets: [
      point("First point"), { ...point("Second point"), evidenceIds: ["e1-1", "e3-1"] },
    ] } };
    const warnings: string[] = [];
    expect(validate("bullets")(slide, warnings)).toEqual({ value: slide, missingEvidenceIds: ["e3-1"] });
    expect(warnings).toEqual([expect.stringContaining("仅引用 1 个")]);
    const scarce = slideValidator({ outlineId: "s1", titlePage: false, evidenceIds: new Set(["e1-1"]), figureIds });
    const scarceWarnings: string[] = [];
    expect(scarce(base, scarceWarnings).value).toEqual(base);
    expect(scarceWarnings).toEqual([]);
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

  it("drops unexpected keys and warns without echoing their values", () => {
    const warnings: string[] = [];
    expect(validate("bullets")({
      ...slideFor("bullets"),
      slots: { ...fixtures.bullets, "Untrusted model output": "unexpected contents" },
    }, warnings).value).toEqual(slideFor("bullets"));
    expect(warnings).toContain("丢弃字段 slots.Untrusted model output");
    expect(warnings.join("\n")).not.toContain("unexpected contents");
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

describe("normalization of model output", () => {
  it("merges duplicate modules before clipping and handles realistic model drift", () => {
    const warnings: string[] = [];
    const value = understandingValidator(evidenceIds)({
      title: "BERT",
      oneLiner: "Bidirectional Transformer pre-training",
      modules: [
        { type: "method", summary: "Pre-training", points: [
          { text: "Masked language modeling", type: "fact", evidence_ids: "e1-1", importance: 1 },
          { text: "Next sentence prediction", kind: "main", evidence: ["e2-3"] },
        ] },
        { kind: "method", title: "Architecture", points: [
          { text: "Transformer", kind: "fact", ids: ["e1-1"] },
          { text: "Bidirectional", kind: "fact", evidenceId: "e1-1" },
          ...Array.from({ length: 4 }, (_, i) => point(`Extra ${i}`)),
        ] },
        { kind: "limitations", points: [] },
        { kind: "architecture", points: [point("Unknown module")] },
      ],
    }, warnings).value;
    expect(value.modules).toEqual([{ kind: "method", points: [
      point("Masked language modeling"),
      { text: "Next sentence prediction", kind: "summary", evidenceIds: ["e2-3"] },
      point("Transformer"),
      point("Bidirectional"),
    ] }]);
    expect(warnings).toHaveLength(16);
    expect(warnings).toEqual(expect.arrayContaining([
      "丢弃字段 modules[0].summary", "丢弃字段 modules[1].title",
      "丢弃字段 modules[0].points[0].importance", "合并模块 modules[1] 至 method",
      "截断 modules[0].points：8 项保留前 4 项",
      "丢弃模块 modules[2]：points 为空", "丢弃模块 modules[3]：kind 无效",
    ]));
  });

  it("still requires a title and an array of modules", () => {
    const schema = understandingValidator(evidenceIds);
    expect(() => schema({ oneLiner: "BERT", modules: [] })).toThrow("title");
    expect(() => schema({ title: "BERT", oneLiner: "BERT", modules: {} })).toThrow("modules");
    expect(() => schema({
      title: "BERT", oneLiner: "BERT",
      modules: [{ kind: "method", points: [{ text: "BERT", type: "fact", evidence_ids: "Figure 2" }] }],
    })).toThrow("modules[0].points[0].evidenceIds[0]");
  });

  it("clamps outline arrays and drops extras, preserving title text through confirmation", () => {
    const warnings: string[] = [];
    const title = "论文".repeat(100);
    const items = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i + 1}`, title: `${title}${i}`, intent: "介绍论文", importance: i,
      modules: i === 0 ? [] : i === 1 ? ["method", "problem"] : ["method"],
    }));
    const schema = outlineValidator("balanced", ["method"], figureIds);
    const { value } = schema({ emphasis: "balanced", items }, warnings);
    expect(value.items).toHaveLength(10);
    expect(value.items[1]).toEqual({ id: "s2", title: `${title}1`, intent: "介绍论文", modules: ["method"] });
    expect(warnings).toContain("截断 items：11 项保留前 10 项");
    expect(warnings).toContain("截断 items[1].modules：2 项保留前 1 项");
    expect(outlineValidator("balanced", ["method"], figureIds, true)(value).value).toEqual(value);
  });

  it("passes overflowing text through unchanged and forwards compression warnings", () => {
    const text = "论".repeat(LAYOUTS.bullets.slots.bullets!.maxChars + 1);
    const schema = validate("bullets");
    const warnings: string[] = [];
    const { value } = schema({
      ...slideFor("bullets"),
      slots: { ...fixtures.bullets, bullets: [
        { text, type: "fact", evidenceIds: ["e1-1", "e2-3", "e3-1", "e4-1", "e5-1"] },
        ...Array.from({ length: 5 }, (_, i) => point(`Point ${i}`)),
      ] },
    }, warnings);
    expect(value.slots.bullets).toEqual([
      { ...point(text), evidenceIds: ["e1-1", "e2-3", "e3-1", "e4-1"] },
      point("Point 0"), point("Point 1"), point("Point 2"), point("Point 3"),
    ]);
    expect(warnings).toContain("截断 slots.bullets：6 项保留前 5 项");
    expect(warnings).toContain("截断 slots.bullets[0].evidenceIds：5 项保留前 4 项");
    const compressed = compressionValidator(value, ["bullets"], schema);
    const compressionWarnings: string[] = [];
    const [first, ...other] = value.slots.bullets as Point[];
    const { value: shortened } = compressed({
      ...value,
      slots: { ...value.slots, bullets: [{ ...first, text: "短句", importance: 1 }, ...other] },
    }, compressionWarnings);
    expect(shortened.slots.bullets).toEqual([{ ...first, text: "短句" }, ...other]);
    expect(compressionWarnings).toEqual(["丢弃字段 slots.bullets[0].importance"]);
  });
});
