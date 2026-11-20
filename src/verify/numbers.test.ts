import { describe, expect, it } from "vitest";
import { extractNumbers, numbersMatch } from "./numbers";

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
});
