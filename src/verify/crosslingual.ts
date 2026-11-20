import { tokenize } from "../retrieval/bm25";
import type { Point } from "../types";
import { isEnglishNumberWord } from "./number-words";

type Language = "zh" | "en";

export interface LanguageIndex {
  language?: Language;
  latinTerms: Set<string>;
  namedTerms: Set<string>;
  translatedTerms: Set<number>;
}

const LATIN_TERM = /\p{Script=Latin}[\p{Script=Latin}\p{M}\d]*(?:-[\p{Script=Latin}\p{M}\d]+)*/gu;
const DISTINCTIVE_NAME = /\d|\p{Lu}.*\p{Lu}|\p{Ll}.*\p{Lu}/u;
const SENTENCE_BOUNDARY = /[.!?。！？]\s*$/u;

// Match specific technical phrases, allowing the discretionary hyphens left
// by PDF extraction in English evidence.
const TECHNICAL_PHRASES: readonly (readonly [RegExp, RegExp])[] = [
  [/词元级任务/u, /\btoken[- ]level tasks?\b/iu],
  [/问答/u, /\bques-?tion answering\b/iu],
  [/双向上下文/u, /\bcontext from both directions\b|\bbidirectional context\b/iu],
  [/标准条件语言模型/u, /\bstandard conditional language models?\b/iu],
  [/双向条件/u, /\bbidirec-?tional conditioning\b/iu],
  [/看到自身/u, /\bsee itself\b/iu],
  [/输入表示/u, /\binput representations?\b/iu],
  [/词元[、，,]\s*句段与位置三类嵌入/u, /\btoken, segment, and position embeddings\b/iu],
  [/嵌入相加/u, /\bsumming\b[^.!?;]*\bembeddings\b/iu],
  [/除输出层外架构相同/u, /\bapart from output layers, the same architec-?tures\b/iu],
  [/同一预训练参数初始化/u, /\bthe same pre-trained model parameters are used to initialize\b/iu],
  [/不同下游任务/u, /\bdifferent down-?stream tasks\b/iu],
  [/换输入输出/u, /\bswapping out the appropriate inputs and outputs\b/iu],
  [/全部参数一起更新/u, /\ball parameters are fine-tuned\b/iu],
];

export function indexLanguage(text: string): LanguageIndex {
  const normalized = text.normalize("NFKC").replace(/[‐‑−]/g, "-");
  const latinTerms = new Set<string>();
  const namedTerms = new Set<string>();
  let latinWords = 0;
  let previousEnd = 0;
  for (const match of normalized.matchAll(LATIN_TERM)) {
    const term = match[0];
    const key = term.toLowerCase();
    const distinctive = DISTINCTIVE_NAME.test(term);
    const atSentenceStart = latinWords === 0 || SENTENCE_BOUNDARY.test(normalized.slice(previousEnd, match.index));
    latinWords++;
    previousEnd = match.index + term.length;
    // Spelled-out numbers are evidence-side values, never required Latin anchors.
    if (isEnglishNumberWord(key) || (!distinctive && tokenize(key).length === 0)) continue;
    latinTerms.add(key);
    // Acronyms and identifiers are distinctive even at the start of a sentence.
    // Other title case suggests a name only away from ordinary sentence capitalization.
    if (distinctive || (/^\p{Lu}/u.test(term) && !atSentenceStart)) {
      namedTerms.add(key);
    }
  }

  const hanCharacters = [...normalized.matchAll(/\p{Script=Han}/gu)].length;
  // Counting Latin words keeps English model names in a Chinese sentence from
  // outweighing its Han prose while allowing an English sentence to quote a short Han name.
  const language = hanCharacters > 0 && hanCharacters >= latinWords ? "zh" : latinWords > 0 ? "en" : undefined;
  const translatedTerms = new Set<number>();
  if (language) {
    TECHNICAL_PHRASES.forEach((pair, index) => {
      if (pair[language === "zh" ? 0 : 1].test(normalized)) translatedTerms.add(index);
    });
  }
  return { language, latinTerms, namedTerms, translatedTerms };
}

export function crossLanguageTerms(
  claim: LanguageIndex, sources: LanguageIndex[], kind: Point["kind"],
): { matched: number; total: number } | undefined {
  if (!claim.language) return;
  const knownLanguages = sources.filter(({ language }) => language !== undefined);
  // Keep the regular lexical check when there is cited prose in the claim's language.
  if (!knownLanguages.length || knownLanguages.some(({ language }) => language === claim.language)) return;

  if (claim.language === "zh" && kind !== "opinion" && !claim.latinTerms.size && claim.translatedTerms.size >= 2) {
    const cited = new Set(sources.flatMap(({ translatedTerms }) => [...translatedTerms]));
    const matched = [...claim.translatedTerms].filter((term) => cited.has(term)).length;
    return { matched, total: claim.translatedTerms.size };
  }

  const evidenceTerms = new Set(sources.flatMap(({ latinTerms }) => [...latinTerms]));
  const anchors = claim.language === "zh"
    ? claim.latinTerms
    // In English prose, use recognizable names and terms explicitly carried over into the Chinese evidence.
    : new Set([...claim.namedTerms, ...[...claim.latinTerms].filter((term) => evidenceTerms.has(term))]);
  const matched = [...anchors].filter((term) => evidenceTerms.has(term)).length;
  return { matched, total: anchors.size };
}
