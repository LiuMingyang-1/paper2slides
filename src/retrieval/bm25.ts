import type { Evidence, RetrievalFilter, RetrievalHit } from "../types";

// These standard BM25 values keep repeated terms from dominating and partially
// compensate for length variation between captions and full paragraphs.
const K1 = 1.2;
const B = 0.75;

// Keep negation, comparison words, and domain vocabulary searchable.
const STOP_WORDS = new Set("a an and are as at be by for from in is of on or that the this to was were with".split(" "));
const TOKENS = /\p{Script=Han}+|\d+(?:-\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}]*)+|(?:(?<!\d)[+-])?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:[^\S\r\n]*%)?|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}])+(?:-(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}])+)*/gu;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[‐‑−]/g, "-");
  for (const match of normalized.matchAll(TOKENS)) {
    const token = match[0];
    if (/^\p{Script=Han}/u.test(token)) {
      const chars = [...token];
      if (chars.length === 1) tokens.push(token);
      for (let i = 1; i < chars.length; i++) {
        tokens.push(chars[i - 1]! + chars[i]!);
      }
    } else if (!STOP_WORDS.has(token)) {
      tokens.push(token.replace(/[,\s]/g, ""));
    }
  }
  return tokens;
}

export function matchesFilter(evidence: Evidence, filter?: RetrievalFilter): boolean {
  return (!filter?.type || evidence.type === filter.type)
    && (filter?.sectionPath?.every((section, index) => evidence.sectionPath[index] === section) ?? true);
}

export function compareHits(a: RetrievalHit, b: RetrievalHit): number {
  return b.score - a.score || (a.evidenceId < b.evidenceId ? -1 : a.evidenceId === b.evidenceId ? 0 : 1);
}

export function limitHits(hits: RetrievalHit[], k: number): RetrievalHit[] {
  return hits.slice(0, Math.max(0, Math.trunc(k)));
}

export class BM25Index {
  private readonly documents: { evidence: Evidence; length: number; counts: Map<string, number> }[];
  private readonly idf = new Map<string, number>();
  private readonly averageLength: number;

  constructor(evidence: readonly Evidence[]) {
    const documentFrequency = new Map<string, number>();
    let totalLength = 0;
    this.documents = evidence.map((block) => {
      const tokens = tokenize(block.text);
      const counts = new Map<string, number>();
      for (const term of tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const term of counts.keys()) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
      totalLength += tokens.length;
      return { evidence: block, length: tokens.length, counts };
    });
    this.averageLength = totalLength / evidence.length || 1;
    for (const [term, frequency] of documentFrequency) {
      this.idf.set(term, Math.log1p((evidence.length - frequency + 0.5) / (frequency + 0.5)));
    }
  }

  search(query: string, k: number, filter?: RetrievalFilter): RetrievalHit[] {
    const terms = new Set(tokenize(query));
    const hits: RetrievalHit[] = [];
    for (const document of this.documents) {
      if (!matchesFilter(document.evidence, filter)) continue;
      const lengthPenalty = K1 * (1 - B + B * document.length / this.averageLength);
      let score = 0;
      for (const term of terms) {
        const frequency = document.counts.get(term);
        if (frequency) score += this.idf.get(term)! * frequency * (K1 + 1) / (frequency + lengthPenalty);
      }
      if (score > 0) hits.push({ evidenceId: document.evidence.id, score });
    }
    return limitHits(hits.sort(compareHits), k);
  }
}
