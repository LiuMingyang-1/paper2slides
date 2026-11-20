import { tokenize } from "../retrieval/bm25";

type Language = "zh" | "en";

export interface LanguageIndex {
  language?: Language;
  latinTerms: Set<string>;
  namedTerms: Set<string>;
}

const LATIN_TERM = /\p{Script=Latin}[\p{Script=Latin}\p{M}\d]*(?:-[\p{Script=Latin}\p{M}\d]+)*/gu;
const DISTINCTIVE_NAME = /\d|\p{Lu}.*\p{Lu}|\p{Ll}.*\p{Lu}/u;
const SENTENCE_BOUNDARY = /[.!?。！？]\s*$/u;

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
    if (!distinctive && tokenize(key).length === 0) continue;
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
  return { language, latinTerms, namedTerms };
}

export function crossLanguageTerms(claim: LanguageIndex, sources: LanguageIndex[]): { matched: number; total: number } | undefined {
  if (!claim.language) return;
  const knownLanguages = sources.filter(({ language }) => language !== undefined);
  // Keep the regular lexical check when there is cited prose in the claim's language.
  if (!knownLanguages.length || knownLanguages.some(({ language }) => language === claim.language)) return;

  const evidenceTerms = new Set(sources.flatMap(({ latinTerms }) => [...latinTerms]));
  const anchors = claim.language === "zh"
    ? claim.latinTerms
    // In English prose, use recognizable names and terms explicitly carried over into the Chinese evidence.
    : new Set([...claim.namedTerms, ...[...claim.latinTerms].filter((term) => evidenceTerms.has(term))]);
  const matched = [...anchors].filter((term) => evidenceTerms.has(term)).length;
  return { matched, total: anchors.size };
}
