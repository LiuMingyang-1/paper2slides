import { describe, expect, it } from "vitest";
import bert from "../../eval/papers/bert.parsed.json";
import run5 from "../../eval/runs/2026-11-21/run5/calls.json";
import type { Slide } from "../types";
import { normalizeNotes } from "./notes";
import { slideValidator } from "./slide";

const bertEvidence = new Map(bert.blocks.map(({ id, text }) => [id, text]));
const run5Slides: Slide[] = run5.filter(({ promptId, normalizations }) =>
  promptId === "slide" && normalizations?.some((warning) => warning.startsWith("删除 notes")))
  .map(({ rawOutput }) => JSON.parse(rawOutput!));

describe("slide notes grounding", () => {
  it.each(["s2", "s3", "s4"])("preserves the archived BERT notes from run5 slide %s", (id) => {
    const slide = run5Slides.find((slide) => slide.id === id)!;
    const citations = Object.values(slide.slots).flatMap((slot) =>
      Array.isArray(slot) ? slot.flatMap(({ evidenceIds }) => evidenceIds) : []);
    const validate = slideValidator({
      outlineId: id, titlePage: false, evidenceIds: new Set(citations), evidenceText: bertEvidence,
      figureIds: new Set(["fig2"]),
    });
    const warnings: string[] = [];
    expect(validate(slide, warnings).value.notes).toBe(slide.notes);
    expect(warnings).not.toContainEqual(expect.stringContaining("删除 notes"));
  });

  it("uses uncited page evidence while excluding evidence from other pages", () => {
    const validate = slideValidator({
      outlineId: "s1", titlePage: false, evidenceIds: new Set(["e1-1", "e1-2"]), figureIds: new Set(),
      evidenceText: new Map([
        ["e1-1", "Accuracy was 91.5%."],
        ["e1-2", "Evaluated on eleven tasks."],
        ["e2-1", "Accuracy was 93.7%."],
      ]),
    });
    const warnings: string[] = [];
    const { value } = validate({
      id: "s1", outlineId: "s1", layout: "bullets",
      slots: { title: "实验结果", bullets: [{ text: "准确率为 91.5%", kind: "fact", evidenceIds: ["e1-1"] }] },
      notes: "该模型在 11 项任务上接受了评测。准确率为 93.7%。",
    }, warnings);
    expect(value.notes).toBe("该模型在 11 项任务上接受了评测。");
    expect(warnings).toContain("删除 notes 第 2 句：引用证据中缺少数字 93.7%");
  });

  it("checks the threshold for Chinese and English number words", () => {
    const warnings: string[] = [];
    expect(normalizeNotes(
      "先讲两点。We discuss three cases. It ran in ten seconds. 使用了十一层。It saw twelve samples.",
      ["It saw 12 samples."], warnings,
    )).toBe("先讲两点。We discuss three cases. It saw twelve samples.");
    expect(warnings).toEqual([
      "删除 notes 第 3 句：引用证据中缺少数字 ten",
      "删除 notes 第 4 句：引用证据中缺少数字 十一",
    ]);
  });

  it("rejects unsupported slash components and bare numbers with only percentage evidence", () => {
    const warnings: string[] = [];
    expect(normalizeNotes("分配比例是 80/10/11。准确率是 80。先来看结果。", ["80%, 10%, 10%."], warnings))
      .toBe("先来看结果。");
    expect(warnings).toEqual([
      "删除 notes 第 1 句：引用证据中缺少数字 11",
      "删除 notes 第 2 句：引用证据中缺少数字 80",
    ]);
  });
});
