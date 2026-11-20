import MiniSearch from "minisearch";
import type { Evidence, RetrievalFilter, RetrievalHit } from "../types";

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
  private readonly index: MiniSearch<{ indexId: number; text: string }>;
  private readonly documents: Evidence[];

  constructor(evidence: readonly Evidence[]) {
    this.documents = [...evidence];
    this.index = new MiniSearch({
      idField: "indexId",
      fields: ["text"],
      // MiniSearch measures length before processTerm, using distinct tokens.
      // Tag each occurrence there, then index it under the original term.
      tokenize: (text) => tokenize(text).map((term, i) => `${term} ${i}`),
      processTerm: (term) => term.slice(0, term.indexOf(" ")),
      searchOptions: {
        tokenize: (query) => [...new Set(tokenize(query))],
        processTerm: (term) => term,
        fuzzy: false,
        prefix: false,
        bm25: { k: 1.2, b: 0.75, d: 0 },
      },
    });
    this.index.addAll(evidence.map(({ text }, indexId) => ({ indexId, text })));
  }

  search(query: string, k: number, filter?: RetrievalFilter): RetrievalHit[] {
    if (!(k >= 1)) return [];
    const hits = this.index.search(query, {
      filter: ({ id }) => matchesFilter(this.documents[id as number]!, filter),
    }).map(({ id, score, queryTerms }) => ({
      evidenceId: this.documents[id as number]!.id,
      // Undo MiniSearch's matched-query-term multiplier to retain additive BM25.
      score: score / queryTerms.length,
    }));
    return limitHits(hits.sort(compareHits), k);
  }
}
