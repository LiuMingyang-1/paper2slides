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

  it.each([
    ["对问答这类词元级任务，缺少双向上下文可能非常有害。",
      "For token-level tasks such as Ques-tion Answering, both directions matter.",
      "For token-level tasks such as Ques-tion Answering, incorporate context from both directions."],
    ["标准条件语言模型只能单向训练，因双向条件会让词间接看到自身。",
      "Standard conditional language models cannot use bidirec-tional conditioning.",
      "Standard conditional language models cannot use bidirec-tional conditioning, which lets each word see itself."],
    ["每个词元的输入表示由词元、句段与位置三类嵌入相加得到。",
      "The input representation is formed by summing token, segment, and time embeddings.",
      "The input representation is formed by summing token, segment, and position embeddings."],
    ["预训练与微调除输出层外架构相同，用同一预训练参数初始化不同下游任务。",
      "Apart from output layers, the same architec-tures are used. We train from scratch on different down-stream tasks.",
      "Apart from output layers, the same architec-tures are used. The same pre-trained model parameters are used to initialize models for different down-stream tasks."],
    ["统一架构使微调只需换输入输出，全部参数一起更新。",
      "Fine-tuning is done by swapping out the appropriate inputs and outputs. Only the classifier is fine-tuned.",
      "Fine-tuning is done by swapping out the appropriate inputs and outputs. All parameters are fine-tuned."],
  ])("requires all translated anchors for %s", (claim, incomplete, complete) => {
    const [supported, missingConcept, missingTerm, missingNumber] = verify([
      fact(claim, "e4-1"),
      fact(claim, "e4-2"),
      fact(`RoBERTa：${claim}`, "e4-1"),
      fact(`${claim}共 99 次。`, "e4-1"),
    ], evidence("e4-1", complete), evidence("e4-2", incomplete));
    expect([supported, missingConcept, missingTerm, missingNumber].map((result) => result?.status))
      .toEqual(["supported", "partial", "partial", "unsupported"]);
    expect(missingNumber?.numbers).toEqual([{ value: "99", found: false }]);
  });

  it("accepts QA as a term anchor for question answering", () => {
    const claim = "单向预训练削弱双向上下文，对 QA 等词元级任务危害尤大。";
    const [full, missing] = verify([
      fact(claim, "e4-1"), fact(claim, "e4-2"),
    ], evidence("e4-1", "Unidirectional pre-training hurts token-level tasks such as ques-tion answering."),
      evidence("e4-2", "Unidirectional pre-training hurts token-level tasks such as named entity recognition."));
    expect([full?.status, missing?.status]).toEqual(["supported", "partial"]);
  });

  it("uses a section name to identify a subject when the same cited body has a matching term", () => {
    const source = {
      ...evidence("e4-1", "We replace 15% of the SubwordLex tokens at random."),
      sectionPath: ["3 ROBERTA"],
    };
    const [full, wrongName, headingOnly, wrongNumber] = verify([
      fact("RoBERTa 随机替换 15% 的 SubwordLex 词元。", source.id),
      fact("DeBERTa 随机替换 15% 的 SubwordLex 词元。", source.id),
      fact("RoBERTa 可用于问答。", source.id),
      fact("RoBERTa 随机替换 17% 的 SubwordLex 词元。", source.id),
    ], source);
    expect([full?.status, wrongName?.status, headingOnly?.status, wrongNumber?.status])
      .toEqual(["supported", "partial", "partial", "unsupported"]);
  });

  it("matches an underscored model variant with its flattened PDF spelling", () => {
    const source = evidence("e4-1", "For NETLARGE we ran random restarts and selected the best model on the Dev set.");
    const [full, wrongVariant, wrongCount] = verify([
      fact("NET_LARGE 多次随机重启，并在 Dev 集选最优模型。", source.id),
      fact("NET_BASE 多次随机重启，并在 Dev 集选最优模型。", source.id),
      fact("NET_LARGE 随机重启 17 次，并在 Dev 集选最优模型。", source.id),
    ], source);
    expect([full?.status, wrongVariant?.status, wrongCount?.status]).toEqual(["supported", "partial", "unsupported"]);
  });

  it("recognizes equivalent summaries of architecture and parameter reuse", () => {
    const claim = "除输出层外，预训练与微调复用同一架构与预训练参数，微调时全部参数参与训练。";
    const common = "Apart from output layers, the same architec-tures are used in pre-training and fine-tuning. "
      + "The same pre-trained model parameters are used to initialize downstream models.";
    const [full, missing] = verify([
      { ...fact(claim, "e4-1"), kind: "summary" }, { ...fact(claim, "e4-2"), kind: "summary" },
    ], evidence("e4-1", common + " All parameters are fine-tuned."),
      evidence("e4-2", common + " Only the classification head is fine-tuned."));
    expect([full?.status, missing?.status]).toEqual(["supported", "partial"]);
  });

  it("checks percentage-point differences against the same value and unit", () => {
    const points = evidence("e4-1", "Accuracy reached 80.5% (7.7% point absolute improvement).");
    const percent = evidence("e4-2", "Accuracy reached 80.5% (7.7% relative improvement).");
    const [full, wrongValue, wrongUnit] = verify([
      fact("准确率为 80.5%，提升 7.7 个百分点。", points.id),
      fact("准确率为 80.5%，提升 7.9 个百分点。", points.id),
      fact("准确率为 80.5%，提升 7.7 个百分点。", percent.id),
    ], points, percent);
    expect(full).toMatchObject({ status: "supported", numbers: [
      { value: "80.5%", found: true }, { value: "7.7 个百分点", found: true },
    ] });
    expect([wrongValue?.status, wrongUnit?.status]).toEqual(["unsupported", "unsupported"]);
  });

  it("checks improvement values separately from dotted version identifiers", () => {
    const named = evidence("e4-1", "On NewBench v2.0 we observe a +5.1 F1 improvement.");
    const unnamed = evidence("e4-2", "We observe a +5.1 F1 improvement.");
    const [full, missingName, wrongVersion, wrongScore, metadataAsScore] = verify([
      fact("在 NewBench v2.0 上提升 +5.1 F1。", named.id),
      fact("在 NewBench v2.0 上提升 +5.1 F1。", unnamed.id),
      fact("在 NewBench v2.1 上提升 +5.1 F1。", named.id),
      fact("在 NewBench v2.0 上提升 +5.3 F1。", named.id),
      fact("在 NewBench v2.0 上提升 0 F1。", named.id),
    ], named, unnamed);
    expect(full).toMatchObject({ status: "supported", numbers: [{ value: "+5.1", found: true }] });
    expect([missingName?.status, wrongVersion?.status, wrongScore?.status, metadataAsScore?.status])
      .toEqual(["partial", "partial", "unsupported", "unsupported"]);
  });

  it("keeps translated opinions partial even with recognized phrases", () => {
    const source = evidence("e4-1", "The input representation is formed by summing token, segment, and position embeddings.");
    const [check] = verify([
      { ...fact("每个词元的输入表示由词元、句段与位置三类嵌入相加得到。", source.id), kind: "opinion" },
    ], source);
    expect(check?.status).toBe("partial");
  });

  it("matches ordered percentage splits without reusing a single percentage or raw counts", () => {
    const paired = evidence("e4-1", "NSP selects an actual next sentence 60% of the time, and a random sentence 40% of the time.");
    const lone = evidence("e4-2", "NSP selects an actual next sentence 50% of the time.");
    const counts = evidence("e4-3", "NSP sampled 60 positive and 40 negative examples.");
    const [correct, swapped, invented, repeated, plainCounts, withUnknownTerm] = verify([
      fact("NSP 以 60/40 构造正负句对。", paired.id),
      fact("NSP 以 40/60 构造正负句对。", paired.id),
      fact("NSP 以 65/35 构造正负句对。", paired.id),
      fact("NSP 以 50/50 构造正负句对。", lone.id),
      fact("NSP 以 60/40 构造正负句对。", counts.id),
      fact("NSP 用 RoBERTa 按 60/40 比例构造正负句对。", paired.id),
    ], paired, lone, counts);
    expect(correct).toMatchObject({ status: "supported", numbers: [{ value: "60/40", found: true }] });
    expect([swapped, invented, repeated, plainCounts].map((result) => result?.status))
      .toEqual(Array(4).fill("unsupported"));
    expect(withUnknownTerm?.status).toBe("partial");
  });

  it("requires each ordered share in an expanded multiway split", () => {
    const full = evidence("e4-1", "We use (1) [MASK] 80% of the time (2) a random token 10% of the time (3) the original token 10% of the time.");
    const incomplete = evidence("e4-2", "We use [MASK] 80% of the time and a random token 10% of the time.");
    const separate = evidence("e4-3", "We use [MASK] 80% of the time. Elsewhere, we use a random token 10% of the time and the original token 10% of the time.");
    const expansion = " 掩码分配：80% 换成 [MASK]、10% 换随机词、10% 保留原词。";
    const [correct, invented, swapped, missing, disconnected] = verify([
      fact("80/10/10" + expansion, full.id),
      fact("70/20/10" + expansion, full.id),
      fact("10/80/10" + expansion, full.id),
      fact("80/10/10" + expansion, incomplete.id),
      fact("80/10/10" + expansion, separate.id),
    ], full, incomplete, separate);
    expect(correct).toMatchObject({ status: "supported", numbers: [
      { value: "80/10/10", found: true }, { value: "80%", found: true },
      { value: "10%", found: true }, { value: "10%", found: true },
    ] });
    for (const check of [invented, swapped, missing, disconnected]) {
      expect(check?.status).toBe("unsupported");
      expect(check?.numbers[0]?.found).toBe(false);
    }
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
