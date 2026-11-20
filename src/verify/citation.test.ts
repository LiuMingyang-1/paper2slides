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
const wmtResult = evidence("e5-1", "On WMT 2014 English-to-German, our big transformer achieves 28.4 BLEU, outperforming the best previous models by over 2.0 BLEU.");
const crossLanguageReason = "跨语言：仅基于术语与数字锚点核验";

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

  it("checks English WMT evidence against Chinese slides, including decimal equivalence", () => {
    const [score, improvement] = verify([
      fact("Transformer 在 WMT 2014 英德翻译上达到 28.4 BLEU", wmtResult.id),
      fact("比此前最佳模型高出 2 BLEU 以上", wmtResult.id),
    ], wmtResult);
    expect(score).toMatchObject({ status: "supported", matchScore: 1, numbers: [{ value: "28.4", found: true }] });
    expect(improvement).toMatchObject({ status: "supported", matchScore: 1, numbers: [{ value: "2", found: true }] });
    expect(score?.reason).toContain(crossLanguageReason);
    expect(improvement?.reason).toContain(crossLanguageReason);
  });

  it("requires every distinctive anchor and leaves translated prose with no anchors partial", () => {
    const [partial, noAnchors, numericOnly, missingNumber] = verify([
      fact("Transformer 在 WMT 2014 英德翻译上达到 28.4 ROUGE", wmtResult.id),
      fact("在英德翻译上超过此前最佳模型", wmtResult.id),
      fact("相比此前最佳模型高出 2 分以上", wmtResult.id),
      fact("在 WMT 英德翻译上达到 29.4 BLEU", wmtResult.id),
    ], wmtResult);
    expect(partial).toMatchObject({ status: "partial", matchScore: 0.75 });
    expect(noAnchors).toMatchObject({ status: "partial", matchScore: 0, numbers: [] });
    expect(numericOnly).toMatchObject({ status: "supported", matchScore: 1 });
    expect(missingNumber).toMatchObject({ status: "unsupported", numbers: [{ value: "29.4", found: false }] });
    for (const result of [partial, noAnchors, numericOnly, missingNumber]) {
      expect(result?.reason).toContain(crossLanguageReason);
    }
  });

  it("checks distinctive English names against Chinese evidence without counting English prose as anchors", () => {
    const source = evidence("e5-2", "在 WMT 2014 英德翻译任务中，Transformer 达到了 28.4 BLEU。");
    const [supported, partial] = verify([
      fact("The transformer achieved 28.4 BLEU on WMT 2014.", source.id),
      fact("RoBERTa achieved 28.4 BLEU on WMT 2014.", source.id),
    ], source);
    expect(supported).toMatchObject({ status: "supported", matchScore: 1 });
    expect(partial).toMatchObject({ status: "partial", matchScore: 0.75 });
    expect(supported?.reason).toContain(crossLanguageReason);
  });

  it("keeps regular lexical matching when the citations include prose in the point's language", () => {
    const chineseSource = evidence("e5-2", "比此前最佳模型高出 2 BLEU 以上");
    const [result] = verify([
      fact("比此前最佳模型高出 2 BLEU 以上", wmtResult.id, chineseSource.id),
    ], wmtResult, chineseSource);
    expect(result).toMatchObject({ status: "supported", matchScore: 1 });
    expect(result?.reason).not.toContain(crossLanguageReason);
  });

  it("still rejects baseline numbers attributed to the paper across languages", () => {
    const source = evidence("e5-2", "The baseline achieved 24.1 BLEU, whereas our model reached 28.4 BLEU.");
    const [wrong] = verify([fact("本文模型达到 24.1 BLEU", source.id)], source);
    expect(wrong).toMatchObject({ status: "unsupported", numbers: [{ value: "24.1", found: false }] });
    expect(wrong?.reason).toContain(crossLanguageReason);
    expect(wrong?.reason).toContain("基线");
  });

  it("verifies the Chinese BERT slide against the English spelled-out number", () => {
    const source = evidence("e5-1", "BERT obtains new state-of-the-art results on eleven natural language processing tasks.");
    const [result] = verify([fact("BERT 在 11 项任务上取得最优结果", source.id)], source);
    expect(result).toMatchObject({ status: "supported", matchScore: 1, numbers: [{ value: "11", found: true }] });
  });

  it("keeps original wording and normalized number tokens available for same-language matches", () => {
    const source = evidence("e5-1", "Twenty-five datasets.");
    const [digit, written] = verify([
      fact("25 datasets.", source.id),
      fact("Twenty-five datasets.", source.id),
    ], source);
    expect(digit).toMatchObject({ status: "supported", matchScore: 1, numbers: [{ value: "25", found: true }] });
    expect(written).toMatchObject({ status: "supported", matchScore: 1, numbers: [] });
  });

  it("skips claim-side numerals and pronouns even when cross-language anchors are checked", () => {
    const source = evidence("e5-1", "BERT achieved the best accuracy on the benchmark.");
    const [english, chinese, mixed] = verify([
      fact("BERT was one of the best models and was tested on eleven tasks.", source.id),
      fact("BERT 在十一项任务上取得最高准确率。", source.id),
      fact("BERT 在 eleven 项任务上取得最高准确率。", source.id),
    ], source);
    expect(english?.status).not.toBe("unsupported");
    expect(english?.numbers).toEqual([]);
    expect(chinese).toMatchObject({ status: "supported", numbers: [] });
    expect(mixed).toMatchObject({ status: "supported", numbers: [] });
  });

  it("does not use pronouns or ordinals as evidence for a digit", () => {
    const source = evidence("e5-1", "BERT was one of the best models. No one favored the previous baseline. The first and second runs were successful.");
    const [one, two] = verify([
      fact("BERT 评估了 1 项任务。", source.id),
      fact("BERT 评估了 2 项任务。", source.id),
    ], source);
    expect(one).toMatchObject({ status: "unsupported", numbers: [{ value: "1", found: false }] });
    expect(two).toMatchObject({ status: "unsupported", numbers: [{ value: "2", found: false }] });
  });

  it("checks spelled-out counts against the attributed result", () => {
    const source = evidence("e5-1", "基线完成了十一项任务，本文模型完成了二十五项任务。");
    const [wrong, correct] = verify([
      fact("本文模型完成了 11 项任务。", source.id),
      fact("本文模型完成了 25 项任务。", source.id),
    ], source);
    expect(wrong).toMatchObject({ status: "unsupported", numbers: [{ value: "11", found: false }] });
    expect(wrong?.reason).toContain("基线");
    expect(correct).toMatchObject({ status: "supported", numbers: [{ value: "25", found: true }] });
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
