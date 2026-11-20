import { describe, expect, it } from "vitest";
import type { Evidence, Point, Slide } from "../types";
import { LEXICAL_SUPPORT_THRESHOLD, verifyDeck } from "./citation";

function evidence(id: string, text: string, type: Evidence["type"] = "text"): Evidence {
  return { id, text, type, sectionPath: ["4 Results"], page: 4, bbox: [0, 0, 1, 1] };
}

function verify(points: Point[], ...sources: Evidence[]) {
  const slide: Slide = {
    id: "s4", outlineId: "o4", layout: "bullets", slots: { title: "Results", bullets: points },
  };
  return verifyDeck([slide], new Map(sources.map((block) => [block.id, block])));
}

const fact = (text: string, ...evidenceIds: string[]): Point => ({ text, kind: "fact", evidenceIds });

describe("deck citation verification", () => {
  it("supports bilingual claims with numeric notation variants and returns the point location", () => {
    const results = verify([
      fact("On ImageNet, our model achieved a classification error of 3.2%.", "e4-1"),
      fact("在测试集上，本方法的平均准确率为 81.5 ± 0.4%。", "e4-2"),
    ],
    evidence("e4-1", "On ImageNet, our model achieved a classification error of 0.0320."),
    evidence("e4-2", "在测试集上，本方法的平均准确率为 0.815±0.004。"));
    expect(results[0]).toMatchObject({
      slideId: "s4", slot: "bullets", pointIndex: 0, status: "supported", numbers: [{ value: "3.2%", found: true }],
    });
    expect(results[1]).toMatchObject({
      pointIndex: 1, status: "supported", numbers: [{ value: "81.5", found: true }, { value: "± 0.4%", found: true }],
    });
  });

  it("rejects using a baseline number as the paper's number even inside one cited paragraph", () => {
    const [wrong, correct, baseline] = verify([
      fact("On ImageNet, our model attained a top-1 accuracy of 78.4%.", "e4-1"),
      fact("On ImageNet, our model attained a top-1 accuracy of 81.6%.", "e4-1"),
      fact("On ImageNet, the baseline attained a top-1 accuracy of 78.4%.", "e4-1"),
    ], evidence("e4-1", "On ImageNet, the baseline attained a top-1 accuracy of 78.4%, whereas our model attained a top-1 accuracy of 81.6%."));
    expect(wrong).toMatchObject({ status: "unsupported", numbers: [{ value: "78.4%", found: false }] });
    expect(wrong?.reason).toContain("基线");
    expect(correct?.status).toBe("supported");
    expect(baseline?.status).toBe("supported");
  });

  it("rejects baseline numbers in cited tables and as postposed labels", () => {
    const [table, prose, baseline] = verify([
      fact("在中文测试集上，本文模型的准确率为 83.2%。", "e4-1"),
      fact("在中文测试集上，本文模型的准确率为 83.2%。", "e4-2"),
      fact("基线模型的准确率为 83.2%。", "e4-2"),
    ],
    evidence("e4-1", "| 模型 | 准确率 |\n| 基线模型 | 83.2% |\n| 本文模型 | 87.9% |", "table"),
    evidence("e4-2", "测试集上的准确率分别为 83.2%（基线）和 87.9%（本文模型）。"));
    expect(table?.status).toBe("unsupported");
    expect(prose?.status).toBe("unsupported");
    expect(baseline?.numbers).toEqual([{ value: "83.2%", found: true }]);
  });

  it("attributes numbers in explicit parallel comparisons", () => {
    const [incorrect, correct, chinese] = verify([
      fact("Our model achieved 78.4% accuracy.", "e4-1"),
      fact("Our model achieved 81.6% accuracy.", "e4-1"),
      fact("本文的测试准确率为 83.2%。", "e4-2"),
    ],
    evidence("e4-1", "Our model and the baseline achieved accuracies of 81.6% and 78.4%, respectively."),
    evidence("e4-2", "基线模型和本文模型的测试准确率分别为 83.2% 和 87.9%。"));
    expect(incorrect?.status).toBe("unsupported");
    expect(correct?.numbers).toEqual([{ value: "81.6%", found: true }]);
    expect(chinese?.status).toBe("unsupported");
  });

  it("checks only citations and does not accept metadata as a source for a number", () => {
    const [result] = verify(
      [fact("The validation set contained 12 examples (Figure 3, see p. 8).", "e4-1")],
      evidence("e4-1", "Figure 3 on p. 8 illustrates the validation set [12]."),
      evidence("e4-2", "The validation set contained 12 examples."),
    );
    expect(result).toMatchObject({ status: "unsupported", numbers: [{ value: "12", found: false }] });
  });

  it("handles missing and empty references for each point kind and checks opinion numbers", () => {
    const [missing, emptyFact, emptySummary, emptyOpinion, opinion, numericOpinion] = verify([
      fact("We used random crops.", "e4-1", "e4-9", "e4-9"),
      fact("We used random crops."),
      { text: "Data augmentation improved generalization.", kind: "summary", evidenceIds: [] },
      { text: "The approach may be difficult to deploy.", kind: "opinion", evidenceIds: [] },
      { text: "The approach may be difficult to deploy.", kind: "opinion", evidenceIds: ["e4-1"] },
      { text: "The approach may require 48 GPUs.", kind: "opinion", evidenceIds: ["e4-1"] },
    ], evidence("e4-1", "We used random crops."));
    expect(missing).toMatchObject({ status: "unsupported", missingEvidenceIds: ["e4-9"] });
    expect(missing?.reason).toContain("e4-9");
    expect([emptyFact, emptySummary, emptyOpinion, opinion, numericOpinion].map((result) => result?.status))
      .toEqual(["unsupported", "partial", "partial", "supported", "unsupported"]);
    expect(opinion?.matchScore).toBe(0);
    expect(numericOpinion?.numbers).toEqual([{ value: "48", found: false }]);
  });

  it("accepts a contiguous three-token anchor out of five but marks the same scattered recall partial", () => {
    // Three out of five contiguous tokens give 0.60 under both criteria.
    // Scattering those same three words reduces the phrase component to 1/5.
    const [contiguous, scattered] = verify([
      fact("Contrastive pretraining improved transfer robustness.", "e4-1"),
      fact("Contrastive pretraining improved transfer robustness.", "e4-2"),
    ],
    evidence("e4-1", "Contrastive pretraining improved calibration on unseen domains."),
    evidence("e4-2", "Contrastive objectives improved calibration and pretraining cost."));
    expect(contiguous).toMatchObject({ matchScore: LEXICAL_SUPPORT_THRESHOLD, status: "supported" });
    expect(scattered).toMatchObject({ matchScore: 0.48, status: "partial" });
  });

  it("checks all citable slots across slides and accepts an ID-keyed record", () => {
    const slides: Slide[] = [
      { id: "s1", outlineId: "o1", layout: "title", slots: { title: "ImageNet experiment" } },
      { id: "s2", outlineId: "o2", layout: "two_column", slots: {
        left: [fact("数据增强改善了分类性能。", "e4-1")], right: [fact("Batch normalization remained frozen.", "e4-2")],
      } },
    ];
    const source = {
      "e4-1": evidence("e4-1", "本研究发现，数据增强改善了分类性能。"),
      "e4-2": evidence("e4-2", "Batch normalization remained frozen."),
    };
    expect(verifyDeck(slides, source).map(({ slideId, slot, status }) => [slideId, slot, status])).toEqual([
      ["s2", "left", "supported"], ["s2", "right", "supported"],
    ]);
  });
});
