import { describe, expect, it } from "vitest";
import { extractNumbers, extractWrittenNumbers, numbersMatch } from "./numbers";

const firstNumber = (text: string) => extractNumbers(text)[0]!;

describe("academic number extraction", () => {
  it.each([
    ["The error rate was 3.2%.", "错误率为 3.200 %。"],
    ["验证错误率为０．０３２。", "Validation error was 3.2 %."],
    ["The corpus contains 1,024 samples.", "语料库包含 1024.00 个样本。"],
    ["初始化学习率为 3 × 10⁻⁵。", "The initial learning rate was 3e-5."],
    ["A pressure of 2.4 × 10^3 Pa was applied.", "施加 2.4k Pa 的压力。"],
    ["We trained on 1.5 M images.", "训练集共有 1,500,000 张图像。"],
    ["The encoder has 1.2B parameters.", "编码器有 1,200M 参数。"],
    ["The mean difference was −0.50.", "平均差异为 -5e-1。"],
    ["The validation set contained 2024 samples.", "验证集包含 2,024 个样本。"],
  ])("normalizes %s and %s", (a, b) => {
    expect(numbersMatch(firstNumber(a), firstNumber(b))).toBe(true);
  });

  it("preserves plus/minus pairing and inherits percentage units", () => {
    const a = extractNumbers("在五次重复实验中，准确率为 81.5 ± 0.4%。");
    const b = extractNumbers("Across five runs, mean accuracy was 0.815±0.004.");
    expect(a.map(({ raw, uncertainty }) => [raw, uncertainty])).toEqual([["81.5", false], ["± 0.4%", true]]);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(numbersMatch(a[0]!, b[0]!)).toBe(true);
    expect(numbersMatch(a[1]!, b[1]!)).toBe(true);
    expect(numbersMatch(a[0]!, firstNumber("Accuracy was 81.5±0.5%."))).toBe(false);
    expect(numbersMatch(a[1]!, firstNumber("Accuracy was 0.4%."))).toBe(false);
    expect(firstNumber("The calibration tolerance is ±0.05.").uncertainty).toBe(true);
    expect(numbersMatch(firstNumber("The particle count was 1.5M ± 0.1."),
      firstNumber("粒子数为 1,500,000 ± 100,000。"))).toBe(true);
    expect(firstNumber("The particle count was 1.5M ± 3%.").canonical)
      .toBe(firstNumber("The particle count was 1.5M.").canonical);
  });

  it("distinguishes fractions and percentages, signed values, and values beyond IEEE-754 precision", () => {
    expect(numbersMatch(firstNumber("Error was 3.2%."), firstNumber("Error was 3.2."))).toBe(false);
    expect(numbersMatch(firstNumber("平均差值为 -0.15。"), firstNumber("平均差值为 0.15。"))).toBe(false);
    expect(numbersMatch(firstNumber("Hash value was 9007199254740993."), firstNumber("Hash value was 9007199254740992."))).toBe(false);
  });

  it("excludes years, bracket citations, section and page references, and list labels", () => {
    const text = [
      "4.2 Ablation",
      "1. Following Devlin et al. (2019) [12, 14–16], see Figures 3(a) and 4, Table 5, Section 2.1 and pp. 8–10.",
      "2、如图 7、表 4、§ 3.2 和第 11 页所示，ResNet-50 在 2020–2022 年间的错误率为 3.2%。",
    ].join("\n");
    expect(extractNumbers(text).map(({ raw }) => raw)).toEqual(["3.2%"]);
  });

  it("retains numbers in leading measurements and ranges", () => {
    expect(extractNumbers("2.1 倍的提速使延迟降至 4-6 ms。训练集大小为2024张图像。")
      .map(({ raw }) => raw)).toEqual(["2.1", "4", "6", "2024"]);
  });

  it("keeps a measurement immediately after a compact figure reference", () => {
    expect(extractNumbers("Fig.3: 在图4中，3.2% 的样本被误分类。").map(({ raw }) => raw)).toEqual(["3.2%"]);
  });

  it.each([
    ["The evaluation spans eleven natural language processing tasks.", "11 tasks", "eleven"],
    ["We annotated twenty‑five datasets.", "25 datasets", "twenty‑five"],
    ["We recruited two hundred participants.", "200 participants", "two hundred"],
    ["共有十一项任务。", "11 项任务", "十一"],
    ["共招募了两百名受试者。", "200 名受试者", "两百"],
    ["The index contains one billion records.", "1B records", "one billion"],
    ["The corpus includes two million three hundred thousand documents.", "2,300,000 documents", "two million three hundred thousand"],
    ["The final set contained two hundred and sixty-four samples.", "264 samples", "two hundred and sixty-four"],
    ["There were zero failures.", "0 failures", "zero"],
    ["错误率为百分之十一。", "11%", "百分之十一"],
    ["共收集一千零八条记录。", "1008 records", "一千零八"],
  ])("reads evidence-side cardinals in %s", (text, digits, spelling) => {
    const written = extractWrittenNumbers(text);
    expect(written.map(({ raw }) => raw)).toEqual([spelling]);
    expect(written[0]?.index).toBe(text.indexOf(spelling));
    expect(numbersMatch(firstNumber(digits), written[0]!)).toBe(true);
  });

  it("ignores pronouns, ordinals, and numeric document references in evidence", () => {
    const text = "One of the best models was selected. No one disagreed. One can see why in Figure eleven. "
      + "The first and second runs were logged on page seven. The twenty-first run used the best one.";
    expect(extractWrittenNumbers(text)).toEqual([]);
    expect(extractWrittenNumbers("图十一和§二十二介绍了第二项实验。")).toEqual([]);
    expect(extractWrittenNumbers("Only one model was retrained.").map(({ raw }) => raw)).toEqual(["one"]);
  });

  it("keeps evidence-side spellings out of normal digit extraction", () => {
    expect(extractNumbers("BERT was one of the best models on eleven tasks.")).toEqual([]);
    expect(extractNumbers("模型在十一项任务上进行了评估。")).toEqual([]);
  });
});
