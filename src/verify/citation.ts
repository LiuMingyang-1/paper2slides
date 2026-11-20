import type { Evidence, Point, PointVerification, Slide } from "../types";
import { tokenize } from "../retrieval/bm25";
import { crossLanguageTerms, indexLanguage, type LanguageIndex } from "./crosslingual";
import { type ExtractedNumber, extractFrequencySplits, extractNumbers, extractSlashSplits, extractWrittenNumbers, numbersMatch } from "./numbers";

// With 70% weight on vocabulary recall, a reordered claim can still pass.
// The 30% phrase weight rewards a contiguous anchor. A 0.60 cutoff lets
// a claim sharing 60% of its words in order pass while penalizing scattered overlap.
const TOKEN_WEIGHT = 7;
const PHRASE_WEIGHT = 3;
export const LEXICAL_SUPPORT_THRESHOLD = 0.60;
// Cross-language matching lacks a prose check, so each anchor must be present.
// With no anchors there is no lexical evidence, even when numeric validation is vacuous.
const CROSS_LANGUAGE_THRESHOLD = 1;
const CROSS_LANGUAGE_REASON = "跨语言：仅基于术语与数字锚点核验。";

type ResultOwner = "baseline" | "paper";

interface AttributedNumber extends ExtractedNumber {
  owner?: ResultOwner;
}

interface IndexedEvidence {
  tokens: string[];
  numericTokens?: string[];
  numbers: AttributedNumber[];
  language: LanguageIndex;
}

const BASELINE = /\bbaselines?\b|基线|基准模型|对照组/giu;
const PAPER = /\b(?:we|ours|our\s+(?:[a-z-]+\s+){0,3}(?:method|model|approach|system|framework|architecture|results?)|(?:the\s+)?proposed\s+(?:method|model|approach|system|framework|architecture)|(?:this|the present)\s+(?:paper|study|work))\b|本文|本研究|本方法|本模型|我们|所提(?:出)?(?:的)?(?:方法|模型|框架)/giu;
// Split on clause/line boundaries but keep decimal marks and CSV-style thousands.
const CLAUSE_BOUNDARY = /[;；。！？!?\n]|\.(?!\d)|(?<!\d)[,，]|[,，](?!\d)|\b(?:whereas|while|but|versus|vs)\b\.?|而|相比之下/giu;
const RESPECTIVELY = /\brespectively\b|分别/iu;

interface OwnerMarker {
  index: number;
  owner: ResultOwner;
}

function parallelOwners(text: string, numbers: ExtractedNumber[], owners: OwnerMarker[]): Map<number, ResultOwner> {
  const paired = new Map<number, ResultOwner>();
  if (!RESPECTIVELY.test(text)) return paired;
  // “Our model and the baseline achieved 81.6% and 78.4%, respectively.”
  // Only use order for an explicit two-way comparison with exactly two values.
  let start = 0;
  for (const sentence of text.split(/(?<=\.(?!\d)|[;；。！？!?\n])/u)) {
    const end = start + sentence.length;
    if (RESPECTIVELY.test(sentence)) {
      const values = numbers.filter(({ index, uncertainty }) => !uncertainty && index >= start && index < end);
      const subjects = owners.filter(({ index }) => index >= start && index < (values[0]?.index ?? start));
      if (values.length === 2 && subjects.length === 2 && subjects[0]!.owner !== subjects[1]!.owner) {
        values.forEach(({ index }, i) => paired.set(index, subjects[i]!.owner));
      }
    }
    start = end;
  }
  return paired;
}

function resultNumbers(text: string, values: ExtractedNumber[]): AttributedNumber[] {
  const boundaries = [...text.matchAll(CLAUSE_BOUNDARY)];
  const owners: OwnerMarker[] = [
    ...Array.from(text.matchAll(BASELINE), ({ index }) => ({ index: index!, owner: "baseline" as const })),
    ...Array.from(text.matchAll(PAPER), ({ index }) => ({ index: index!, owner: "paper" as const })),
  ].sort((a, b) => a.index - b.index);
  const paired = parallelOwners(text, values, owners);
  return values.map((number, i) => {
    const centralValue = number.uncertainty ? values[i - 1] : undefined;
    const pairedOwner = paired.get((centralValue?.uncertaintyValue === number.canonical ? centralValue.index : number.index));
    if (pairedOwner) return { ...number, owner: pairedOwner };

    const end = number.index + number.raw.length;
    let clauseStart = -1;
    for (const boundary of boundaries) {
      if (boundary.index! >= number.index) break;
      clauseStart = boundary.index!;
    }
    const clauseEnd = boundaries.find((b) => b.index! >= end)?.index ?? text.length;
    let preceding: ResultOwner | undefined;
    for (const { index, owner } of owners) {
      if (index >= number.index) break;
      if (index >= clauseStart) preceding = owner;
    }
    const trailing = owners.find(({ index }) => index >= end && index < clauseEnd);
    const connector = trailing && text.slice(end, trailing.index);
    // Prefer an explicit postposed owner in “78.4% for the baseline” or “78.4%（基线）”.
    const postposed = connector && /^\s*(?:(?:for|by|with)\s+(?:the\s+)?|[(（])\s*$/iu.test(connector);
    return { ...number, owner: postposed ? trailing?.owner : preceding };
  });
}

function tokenizeWithNumbers(text: string, numbers: ExtractedNumber[]): { tokens: string[]; prose: string } {
  const tokens: string[] = [];
  const prose: string[] = [];
  let start = 0;
  for (const { index, raw, canonical } of numbers) {
    const segment = text.slice(start, index);
    prose.push(segment);
    tokens.push(...tokenize(segment), "number:" + canonical);
    start = index + raw.length;
  }
  const tail = text.slice(start);
  tokens.push(...tokenize(tail));
  prose.push(tail);
  return { tokens, prose: prose.join(" ") };
}

function indexText(text: string, side: "point" | "evidence", sectionPath?: readonly string[]): IndexedEvidence {
  const splits = extractSlashSplits(text);
  const digits = extractNumbers(text).filter(({ index }) =>
    !splits.some((split) => index >= split.index && index < split.index + split.raw.length));
  digits.push(...splits.filter(({ canonical }) => canonical !== "invalid-split" || side === "point"));
  digits.sort((a, b) => a.index - b.index);
  const written = side === "evidence" ? extractWrittenNumbers(text) : [];
  const values = written.length ? [...digits, ...written].sort((a, b) => a.index - b.index) : digits;
  const { tokens, prose } = tokenizeWithNumbers(text, digits);
  const numbers = resultNumbers(text, values);
  if (side === "evidence") {
    const byIndex = new Map(numbers.map(({ index, owner }) => [index, owner]));
    for (const split of extractFrequencySplits(text)) numbers.push({ ...split, owner: byIndex.get(split.index) });
  }
  return {
    tokens,
    // Keep the original words for prose matches and also allow “11 tasks” to
    // share a contiguous numeric phrase with “eleven tasks”.
    numericTokens: written.length ? tokenizeWithNumbers(text, values).tokens : undefined,
    numbers,
    language: indexLanguage(prose, sectionPath),
  };
}

function longestCommonRun(claim: string[], source: string[]): number {
  const lengths = new Array<number>(claim.length + 1).fill(0);
  let longest = 0;
  for (const token of source) {
    for (let i = claim.length; i > 0; i--) {
      lengths[i] = token === claim[i - 1] ? lengths[i - 1]! + 1 : 0;
      longest = Math.max(longest, lengths[i]!);
    }
  }
  return longest;
}

function lexicalSupport(claim: string[], sources: string[][]): number {
  if (!claim.length) return 0;
  const remaining = new Map<string, number>();
  for (const token of claim) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let overlap = 0;
  let longest = 0;
  for (const source of sources) {
    for (const token of source) {
      const count = remaining.get(token) ?? 0;
      if (count > 0) {
        remaining.set(token, count - 1);
        overlap++;
      }
    }
    longest = Math.max(longest, longestCommonRun(claim, source));
  }
  return (TOKEN_WEIGHT * overlap + PHRASE_WEIGHT * longest) / ((TOKEN_WEIGHT + PHRASE_WEIGHT) * claim.length);
}

function sameLanguageSupport(claim: IndexedEvidence, sources: IndexedEvidence[]): number {
  const original = lexicalSupport(claim.tokens, sources.map(({ tokens }) => tokens));
  if (!claim.numbers.length || !sources.some(({ numericTokens }) => numericTokens)) return original;
  const normalized = lexicalSupport(claim.tokens, sources.map(({ tokens, numericTokens }) => numericTokens ?? tokens));
  return Math.max(original, normalized);
}

function verifyPoint(
  point: Point,
  indexed: (id: string) => IndexedEvidence | undefined,
): Omit<PointVerification, "slideId" | "slot" | "pointIndex"> {
  const ids = [...new Set(point.evidenceIds)];
  const missingEvidenceIds: string[] = [];
  const sources: IndexedEvidence[] = [];
  for (const id of ids) {
    const source = indexed(id);
    if (source) sources.push(source);
    else missingEvidenceIds.push(id);
  }

  const evidenceNumbers = sources.flatMap((source) => source.numbers);
  const claim = indexText(point.text, "point");
  const numbers = claim.numbers.map((claim) => {
    const matching = evidenceNumbers.filter((candidate) => numbersMatch(claim, candidate));
    const found = matching.some((candidate) => !claim.owner || !candidate.owner || claim.owner === candidate.owner);
    const wrongOwner = matching.length > 0 && !found;
    return { value: claim.raw, found, wrongOwner };
  });
  const missingNumbers = numbers.filter(({ found }) => !found);
  const crossLanguage = crossLanguageTerms(claim.language, sources.map(({ language }) => language), point.kind);
  const anchorCount = crossLanguage ? crossLanguage.total + numbers.length : 0;
  const matchScore = crossLanguage
    ? (crossLanguage.matched + numbers.length - missingNumbers.length) / Math.max(1, anchorCount)
    : sameLanguageSupport(claim, sources);
  const reasonPrefix = crossLanguage ? CROSS_LANGUAGE_REASON : "";
  const details = { matchScore, missingEvidenceIds, numbers: numbers.map(({ value, found }) => ({ value, found })) };

  if (!ids.length) {
    return point.kind === "fact"
      ? { ...details, status: "unsupported", reason: "事实要点未提供引用。" }
      : { ...details, status: "partial", reason: "概括或解读未提供引用。" };
  }
  if (missingEvidenceIds.length) {
    return { ...details, status: "unsupported", reason: reasonPrefix + "引用不存在：" + missingEvidenceIds.join("、") + "。" };
  }
  if (missingNumbers.length) {
    const reason = missingNumbers.map(({ value, wrongOwner }) =>
      wrongOwner ? value + " 在所引证据中属于另一方（基线或本文方法）" : value + " 未在所引证据中找到");
    return { ...details, status: "unsupported", reason: reasonPrefix + reason.join("。") + "。" };
  }
  if (crossLanguage) {
    if (!anchorCount) {
      return { ...details, status: "partial", reason: CROSS_LANGUAGE_REASON + "要点没有可核对的锚点。" };
    }
    return matchScore >= CROSS_LANGUAGE_THRESHOLD
      ? { ...details, status: "supported", reason: CROSS_LANGUAGE_REASON + "锚点全部命中。" }
      : { ...details, status: "partial", reason: CROSS_LANGUAGE_REASON + "术语锚点未全部命中。" };
  }
  if (point.kind === "opinion") {
    return { ...details, status: "supported", reason: "解读的引用有效，数值核验通过。" };
  }
  return matchScore >= LEXICAL_SUPPORT_THRESHOLD
    ? { ...details, status: "supported", reason: "引用有效，词面支持达标，数值核验通过。" }
    : { ...details, status: "partial", reason: "引用有效，但与所引证据的词面匹配度较低。" };
}

export function verifyDeck(
  slides: readonly Slide[],
  evidenceById: ReadonlyMap<string, Evidence> | Readonly<Record<string, Evidence>>,
): PointVerification[] {
  const cache = new Map<string, IndexedEvidence | undefined>();
  const indexed = (id: string): IndexedEvidence | undefined => {
    if (!cache.has(id)) {
      const evidence = "get" in evidenceById && typeof evidenceById.get === "function"
        ? evidenceById.get(id)
        : Object.hasOwn(evidenceById, id) ? (evidenceById as Readonly<Record<string, Evidence>>)[id] : undefined;
      cache.set(id, evidence && indexText(evidence.text, "evidence", evidence.sectionPath));
    }
    return cache.get(id);
  };
  const results: PointVerification[] = [];
  for (const slide of slides) {
    for (const [slot, value] of Object.entries(slide.slots)) {
      if (typeof value === "string") continue;
      value.forEach((point, pointIndex) => {
        results.push({ slideId: slide.id, slot, pointIndex, ...verifyPoint(point, indexed) });
      });
    }
  }
  return results;
}
