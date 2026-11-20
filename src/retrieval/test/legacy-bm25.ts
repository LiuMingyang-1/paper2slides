import type { Evidence, RetrievalFilter, RetrievalHit } from "../../types";
import { compareHits, limitHits, matchesFilter, tokenize } from "../bm25";

// Pre-migration scoring, kept as the reference for the paper corpus.
const K1 = 1.2;
const B = 0.75;

export class LegacyBM25Index {
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
