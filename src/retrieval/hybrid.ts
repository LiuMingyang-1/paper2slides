import type { Evidence, RetrievalFilter, Retriever, RetrievalHit } from "../types";
import { BM25Index, compareHits, limitHits } from "./bm25";
import { type Embed, VectorIndex, type VectorOptions } from "./vector";

// Standard RRF rank constant. It tempers differences among the first few
// places so agreement between the two rankings can outweigh one high rank.
export const RRF_K = 60;

export interface HybridOptions extends VectorOptions {
  embed?: Embed;
}

export class HybridRetriever implements Retriever {
  private readonly lexical: BM25Index;
  private readonly vector?: VectorIndex;
  private readonly evidenceCount: number;
  private fallbackReason?: string;

  constructor(paperId: string, evidence: readonly Evidence[], { embed, ...vectorOptions }: HybridOptions = {}) {
    this.lexical = new BM25Index(evidence);
    this.evidenceCount = evidence.length;
    if (embed) this.vector = new VectorIndex(paperId, evidence, embed, vectorOptions);
    else this.fallbackReason = "未配置向量服务，使用 BM25";
  }

  /** Latest vector failure, cleared after a successful vector lookup. */
  get vectorFallbackReason(): string | undefined {
    return this.fallbackReason;
  }

  async search(query: string, k: number, filter?: RetrievalFilter): Promise<RetrievalHit[]> {
    if (!(k >= 1) || !query.trim()) return [];
    if (!this.vector) return this.lexical.search(query, k, filter);

    const lexical = this.lexical.search(query, this.evidenceCount, filter);
    let semantic: RetrievalHit[];
    try {
      semantic = await this.vector.search(query, this.evidenceCount, filter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fallbackReason = `向量检索失败，使用 BM25（${message}）`;
      return limitHits(lexical, k);
    }
    if (!semantic.length) return limitHits(lexical, k);
    this.fallbackReason = undefined;

    const scores = new Map<string, number>();
    for (const ranking of [lexical, semantic]) {
      ranking.forEach(({ evidenceId }, index) => {
        scores.set(evidenceId, (scores.get(evidenceId) ?? 0) + 1 / (RRF_K + index + 1));
      });
    }
    const hits = Array.from(scores, ([evidenceId, score]) => ({ evidenceId, score }));
    return limitHits(hits.sort(compareHits), k);
  }
}
