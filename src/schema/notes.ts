import { extractNumbers, extractWrittenNumbers, numbersMatch } from "../verify/numbers";
import { trimList } from "./normalize";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

export function normalizeNotes(
  notes: string, citedText: readonly string[], warnings: string[],
): string | undefined {
  const candidates = citedText.flatMap((text) => [...extractNumbers(text), ...extractWrittenNumbers(text)]);
  const supported = [...sentences.segment(notes)].filter(({ segment }, index) => {
    const missing = [...extractNumbers(segment), ...extractWrittenNumbers(segment)]
      .filter((number) => !candidates.some((candidate) => numbersMatch(number, candidate)));
    if (!missing.length) return true;
    warnings.push(`删除 notes 第 ${index + 1} 句：引用证据中缺少数字 ${missing.map(({ raw }) => raw).join("、")}`);
    return false;
  });
  return trimList(supported, 4, "notes", warnings).map(({ segment }) => segment).join("").trim() || undefined;
}
