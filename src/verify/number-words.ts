const SMALL_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const EN_SCALES = new Map([["thousand", 1e3], ["million", 1e6], ["billion", 1e9]]);
const EN_VALUES = new Map([...SMALL_NUMBERS.map((word, value) => [word, value] as const),
  ...TENS.map((word, index) => [word, (index + 2) * 10] as const)]);
const HAN_DIGITS = new Map([..."零一二三四五六七八九"].map((char, value) => [char, value] as const));
HAN_DIGITS.set("〇", 0).set("两", 2).set("兩", 2);
const HAN_PLACES = new Map([["十", 10], ["百", 100], ["千", 1e3]]);
const HAN_SCALES = new Map([["万", 1e4], ["萬", 1e4], ["亿", 1e8], ["億", 1e8]]);

const SPACE = String.raw`[^\S\r\n]+`;
const JOIN = `${SPACE}(?:and${SPACE})?`;
const NONZERO_DIGIT = `(?:${SMALL_NUMBERS.slice(1, 10).join("|")})`;
const BELOW_HUNDRED = `(?:(?:${TENS.join("|")})(?:(?:-|${SPACE})${NONZERO_DIGIT})?|${SMALL_NUMBERS.join("|")})`;
const BELOW_THOUSAND = `(?:(?:(?:${NONZERO_DIGIT}|a)${SPACE})?hundred(?:${JOIN}${BELOW_HUNDRED}(?!${SPACE}hundred\\b))?|${BELOW_HUNDRED})`;
const SCALED = `(?:(?:${BELOW_THOUSAND}|a)${SPACE})?(?:${[...EN_SCALES.keys()].join("|")})`;
// At most one group per large scale. The parser also checks scale ordering.
const EN_NUMBER = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${SCALED}(?:${JOIN}${SCALED}){0,2}(?:${JOIN}${BELOW_THOUSAND})?|${BELOW_THOUSAND})(?![\\p{L}\\p{N}_-])`, "giu");
const HAN_NUMBER = /(?:百分之\s*)?([零〇一二两兩三四五六七八九十百千万萬亿億]+)/gu;
const EN_LOCATOR = /\b(?:fig(?:ure)?s?|tables?|sec(?:tion)?s?|ch(?:apter)?s?|pages?|pp?)\.?[^\S\r\n]*(?:(?:no\.|number)[^\S\r\n]*)?$/iu;
const EN_PRONOUN_PREFIX = /\b(?:no|the|this|that|which|another|any|each|every|some)\s+$/iu;
const EN_PRONOUN_SUFFIX = /^\s+(?:of|who|that|which|another|can|could|may|might|must|should|would|will|does|has|is)\b/iu;
const EN_ONE_COUNT_PREFIX = /(?:\b(?:exactly|only)|[=<>≤≥≈])\s*$/iu;
const HAN_LOCATOR = /(?:第|图|圖|表|§|章节|頁碼|页码)\s*$/u;
const HAN_CLASSIFIER = /^\s*(?:个|個|项|項|种|種|次|张|張|名|例|篇|条|條|组|組|轮|輪|步|倍|层|層|毫秒|秒|个字|字|词|詞|天|小时|小時|年|月|人|份|台)/u;

interface NumberWord {
  index: number;
  raw: string;
  value: number;
  percent: boolean;
}

export function isEnglishNumberWord(term: string): boolean {
  return term.split("-").every((word) => EN_VALUES.has(word) || EN_SCALES.has(word) || word === "hundred");
}

function englishValue(raw: string): number | undefined {
  let total = 0;
  let group: number | undefined;
  let lastScale = Infinity;
  for (const word of raw.toLowerCase().split(/[-\s]+/u)) {
    const scale = EN_SCALES.get(word);
    const digit = EN_VALUES.get(word);
    if (scale !== undefined) {
      if (scale >= lastScale) return;
      total += (group ?? 1) * scale;
      group = undefined;
      lastScale = scale;
    } else if (word === "hundred") {
      group = (group ?? 1) * 100;
    } else if (digit !== undefined) {
      group = (group ?? 0) + digit;
    }
  }
  return total + (group ?? 0);
}

function chineseValue(raw: string): number | undefined {
  let total = 0;
  let group = 0;
  let digit: number | undefined;
  let explicitZero = false;
  let lastPlace = 1e4;
  let lastScale = Infinity;
  for (const char of raw) {
    const nextDigit = HAN_DIGITS.get(char);
    const place = HAN_PLACES.get(char);
    const scale = HAN_SCALES.get(char);
    if (nextDigit !== undefined) {
      if (digit !== undefined && digit !== 0) return;
      explicitZero = digit === 0;
      digit = nextDigit;
    } else if (place !== undefined) {
      // Only ten can omit a leading one, as in 十一.
      const coefficient = digit === undefined && place === 10 && lastPlace === 1e4 ? 1 : digit;
      if (!coefficient || place >= lastPlace) return;
      group += coefficient * place;
      digit = undefined;
      explicitZero = false;
      lastPlace = place;
    } else if (scale !== undefined) {
      if (digit && group && lastPlace > 10 && !explicitZero) return;
      const coefficient = group + (digit ?? 0);
      if (!coefficient || scale >= lastScale) return;
      total += coefficient * scale;
      group = 0;
      digit = undefined;
      explicitZero = false;
      lastPlace = 1e4;
      lastScale = scale;
    }
  }
  // Avoid giving colloquial forms such as 一百三 a false exact value of 103.
  if (digit && (group || total) && lastPlace > 10 && !explicitZero) return;
  return total + group + (digit ?? 0);
}

export function extractNumberWords(text: string): NumberWord[] {
  const words: NumberWord[] = [];
  // These PDF hyphen variants each occupy one UTF-16 code unit, preserving spans.
  const normalized = text.replace(/[‐‑－]/gu, "-");
  for (const match of normalized.matchAll(EN_NUMBER)) {
    const [raw] = match;
    const index = match.index!;
    const before = normalized.slice(0, index);
    const after = normalized.slice(index + raw.length);
    const value = englishValue(raw);
    if (value === undefined || EN_LOCATOR.test(before)) continue;
    if (value === 1) {
      const standalone = !before.trim() && !after.trim();
      const withQuantityCue = /^\s+\p{L}|^\s*%/u.test(after) || EN_ONE_COUNT_PREFIX.test(before);
      if (EN_PRONOUN_PREFIX.test(before) || EN_PRONOUN_SUFFIX.test(after) || (!standalone && !withQuantityCue)) continue;
    }
    // Keep fractional, ordinal, and mixed digit/word fragments out of the cardinal index.
    if (/(?:\b(?:point|minus|negative)|[-±])\s*$/iu.test(before)
      || /^\s+(?:point|hundredth|thousandth|millionth|billionth)\b/iu.test(after)
      || (value >= 100 && /\d\s+$/u.test(before))) continue;
    const percent = /^[^\S\r\n]*(?:%|percent\b|per cent\b)/iu.exec(after);
    words.push({ index, raw: text.slice(index, index + raw.length + (percent?.[0].length ?? 0)), value, percent: Boolean(percent) });
  }

  for (const match of text.matchAll(HAN_NUMBER)) {
    const [raw, numeral] = match;
    const index = match.index!;
    const before = text.slice(0, index);
    const after = text.slice(index + raw.length);
    const percent = raw.startsWith("百分之");
    if (HAN_LOCATOR.test(before) || /(?:分之|负|負|[-−±])\s*$/u.test(before) || /^\s*分之/u.test(after)) continue;
    // Single characters also occur in ordinary words (一致, 统一), so require a quantity cue.
    if (!percent && numeral!.length === 1 && !HAN_CLASSIFIER.test(after) && !/[=＝:：<>≤≥≈]\s*$/u.test(before)) continue;
    const value = chineseValue(numeral!);
    if (value !== undefined) words.push({ index, raw, value, percent });
  }
  return words;
}
