import {
  extractNumbers, extractWrittenNumbers, extractWrittenNumbersAtLeast, numbersMatch, type ExtractedNumber,
} from "../verify/numbers";
import { trimList } from "./normalize";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const bareNumber = /^[0-9０-９]+(?:[.．][0-9０-９]+)?$/u;

function joinedBySlash(text: string, left?: ExtractedNumber, right?: ExtractedNumber): boolean {
  return left !== undefined && right !== undefined
    && bareNumber.test(left.raw) && bareNumber.test(right.raw)
    && /^\s*[/／]\s*$/u.test(text.slice(left.index + left.raw.length, right.index));
}

export function normalizeNotes(
  notes: string, citedText: readonly string[], warnings: string[],
): string | undefined {
  const candidates = citedText.flatMap((text) => [...extractNumbers(text), ...extractWrittenNumbers(text)]);
  const hasSupport = (number: ExtractedNumber) => candidates.some((candidate) => numbersMatch(number, candidate));
  const supported = [...sentences.segment(notes)].filter(({ segment }, index) => {
    const numbers = extractNumbers(segment);
    const missing = numbers.filter((number, i) => {
      if (hasSupport(number)) return false;
      // Spoken splits like 80/10/10 can omit the percent signs.
      const slashComponent = joinedBySlash(segment, numbers[i - 1], number)
        || joinedBySlash(segment, number, numbers[i + 1]);
      return !slashComponent || !extractNumbers(`${number.raw}%`).some(hasSupport);
    });
    missing.push(...extractWrittenNumbersAtLeast(segment, 10).filter((number) => !hasSupport(number)));
    if (!missing.length) return true;
    warnings.push(`删除 notes 第 ${index + 1} 句：引用证据中缺少数字 ${missing.map(({ raw }) => raw).join("、")}`);
    return false;
  });
  return trimList(supported, 4, "notes", warnings).map(({ segment }) => segment).join("").trim() || undefined;
}
