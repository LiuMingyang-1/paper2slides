export interface ExtractedNumber {
  /** Original spelling, suitable for the verification UI. */
  raw: string;
  /** Exact decimal value expressed as an integer coefficient and power of ten. */
  canonical: string;
  index: number;
  uncertainty: boolean;
  /** Present for the central value of an explicit plus/minus pair. */
  uncertaintyValue?: string;
}

interface ParsedNumber extends ExtractedNumber {
  end: number;
  suffix: string;
}

const EXPONENTS: Readonly<Record<string, number>> = { k: 3, K: 3, M: 6, B: 9, "%": -2 };
const NUMBER = /((?<![\dA-Za-z_])[+-][^\S\r\n]*|±[^\S\r\n]*)?(?<![\dA-Za-z_])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:[eE][^\S\r\n]*([+-]?\d+)(?![A-Za-z0-9])|[^\S\r\n]*[×x][^\S\r\n]*10[^\S\r\n]*(?:\^[^\S\r\n]*([+-]?\d+)|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)))?([^\S\r\n]*(?:%|[kKMB](?![A-Za-z0-9])))?/gu;
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const INDEX = String.raw`\d+(?:\.\d+)*(?:\s*\([a-z]\)|[a-z](?![a-z]))?(?!\d|\.\d|[^\S\r\n]*%)`;
const INDEX_RANGE = String.raw`${INDEX}(?:\s*(?:[-–—,，]|and\b|、|至)\s*${INDEX})*`;
const METADATA = [
  // Numeric bracket citations, including grouped citations and ranges.
  /\[\s*[1-9]\d*(?:\s*[,;，；–—-]\s*[1-9]\d*)*\s*\]/gu,
  new RegExp(String.raw`(?:\b(?:(?:fig(?:ure)?s?|tables?|sec(?:tion)?s?|ch(?:apter)?s?|pages?)(?:\.\s*|\s+)|pp?\.\s*)|[§图表]\s*|章节\s*|页码\s*)(?:no\.\s*)?${INDEX_RANGE}`, "giu"),
  new RegExp(String.raw`第\s*${INDEX_RANGE}\s*[章节页]`, "gu"),
  // Recognize common section-heading words without dropping prose such as “2.1 倍”.
  /^[ \t]*\d+(?:\.\d+)*[ \t]+(?=(?:(?:introduction|background|related work|methods?|results?|experiments?|ablation|discussion|limitations?|conclusions?)\b|引言|背景|相关工作|方法|结果|实验|消融|讨论|局限|结论))/gimu,
  /^[ \t]*(?:\(?\d+\)|\d+[.、])[ \t]*(?![\s\d%])/gmu,
  /\b\d+(?:st|nd|rd|th)\b/giu,
  /第\s*\d+\s*(?:个|项|名|位|条)/gu,
  // Preserve offsets while excluding model labels such as ResNet-50.
  /\b[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*-\d+(?:\.\d+)?(?:-[A-Za-z0-9_]+)*\b/gu,
];
const MEASUREMENT_AFTER_YEAR = /^[^\S\r\n]*(?:(?:samples?|examples?|images?|participants?|patients?|subjects?|tokens?|parameters?|records?|instances?|observations?|documents?|cases?|papers?|words?|nodes?|bytes?|milliseconds?|seconds?|ms|s|GB|MB|kB|Hz)(?![a-z])|个|张|名|位|条|例|字节|秒|毫秒|赫兹|篇|次|份|万|亿)/iu;
const MEASUREMENT_BEFORE_YEAR = /(?:[=<>≤≥≈]|(?:n|count)\s*[:=]|\b(?:collected|included|contained|total(?: of)?)\s*)\s*$/iu;

function normalizeText(text: string): string {
  // Use width and minus normalization that preserves UTF-16 offsets into the source.
  const substitutions: Record<string, string> = { "％": "%", "．": ".", "，": ",", "＋": "+", "－": "-", "−": "-", "［": "[", "］": "]", "　": " ", "Ｅ": "E", "ｅ": "e" };
  return text.replace(/[０-９％．，＋－−［］　Ｅｅ]/gu, (char) =>
    substitutions[char] ?? String(char.charCodeAt(0) - "０".charCodeAt(0)));
}

function canonicalNumber(sign: string, mantissa: string, exponent: number): string {
  const [integer, fraction = ""] = mantissa.replace(/,/g, "").split(".");
  const digits = (integer! + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const coefficient = digits.replace(/0+$/, "");
  return (sign.trim().startsWith("-") ? "-" : "") + coefficient + "e"
    + (exponent - fraction.length + digits.length - coefficient.length);
}

function applySuffix(number: string, suffix: string): string {
  if (number === "0") return number;
  const [coefficient, exponent] = number.split("e");
  return coefficient + "e" + (Number(exponent) + EXPONENTS[suffix]!);
}

function isYear(match: RegExpMatchArray, text: string): boolean {
  const [raw, sign, mantissa, exponent, caretExponent, superscript, suffix] = match;
  if (sign || exponent || caretExponent || superscript || suffix || !/^(?:18|19|20)\d{2}$/.test(mantissa!)) return false;
  const start = match.index!;
  // A plain four-digit year is suppressed unless adjacent wording gives it a measurement role.
  return !MEASUREMENT_AFTER_YEAR.test(text.slice(start + raw.length))
    && !MEASUREMENT_BEFORE_YEAR.test(text.slice(0, start));
}

export function extractNumbers(text: string): ExtractedNumber[] {
  let normalized = normalizeText(text);
  for (const pattern of METADATA) {
    normalized = normalized.replace(pattern, (match) => match.replace(/[^\r\n]/g, " "));
  }

  const numbers: ParsedNumber[] = [];
  for (const match of normalized.matchAll(NUMBER)) {
    if (isYear(match, normalized)) continue;
    const [raw, sign = "", mantissa, exponent, caretExponent, superscript, suffix = ""] = match;
    const index = match.index!;
    const end = index + raw.length;
    const previous = numbers.at(-1);
    const beginsWithPlusMinus = sign.startsWith("±");
    const gap = previous ? normalized.slice(previous.end, index) : "";
    const paired = previous && beginsWithPlusMinus && /^[^\S\r\n]*$/.test(gap);
    const uncertainty = beginsWithPlusMinus;
    const exp = Number(exponent ?? caretExponent ?? superscript?.replace(/[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (char) =>
      char === "⁻" ? "-" : char === "⁺" ? "+" : String(SUPERSCRIPTS.indexOf(char))) ?? 0);
    // Leave room for the mantissa length and suffix when adjusting the exponent.
    if (!Number.isSafeInteger(exp) || !Number.isSafeInteger(Math.abs(exp) + raw.length + 9)) continue;
    const unit = suffix.trim();
    const canonical = canonicalNumber(sign, mantissa!, exp + (EXPONENTS[unit] ?? 0));
    const number: ParsedNumber = { raw: text.slice(index, end), canonical, index, end, uncertainty, suffix: unit };
    if (paired && previous) {
      // Both terms share a written suffix in "81.5 ± 0.4%" or "1.5M ± 0.1".
      if (unit && !previous.suffix) previous.canonical = applySuffix(previous.canonical, unit);
      if (!unit && previous.suffix) number.canonical = applySuffix(number.canonical, previous.suffix);
      previous.uncertaintyValue = number.canonical;
    }
    numbers.push(number);
  }
  return numbers.map(({ raw, canonical, index, uncertainty, uncertaintyValue }) => ({
    raw, canonical, index, uncertainty, ...(uncertaintyValue === undefined ? {} : { uncertaintyValue }),
  }));
}

export function numbersMatch(claim: ExtractedNumber, evidence: ExtractedNumber): boolean {
  return claim.canonical === evidence.canonical
    && claim.uncertainty === evidence.uncertainty
    && (claim.uncertaintyValue === undefined || claim.uncertaintyValue === evidence.uncertaintyValue);
}
