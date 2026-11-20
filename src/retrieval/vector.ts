import type { Evidence, RetrievalFilter, RetrievalHit } from "../types";
import { compareHits, limitHits, matchesFilter } from "./bm25";

export type Embed = (texts: string[]) => Promise<number[][]>;

export interface VectorOptions {
  batchSize?: number;
  /** Reuse one cache per embedding model/configuration. */
  cache?: VectorCache;
}

// Send enough paragraphs to amortize each call while bounding request size.
// Callers can lower the size to suit their embedding provider's limits.
const DEFAULT_BATCH_SIZE = 32;

interface CacheEntry {
  source: { id: string; text: string }[];
  vectors: number[][];
}

function validateVectors(vectors: number[][], count: number, dimension?: number): void {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw new Error("向量服务返回的条数与输入不一致");
  }
  dimension ??= vectors[0]?.length;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0 || vector.length !== dimension
      || !Array.from(vector).every(Number.isFinite)) {
      throw new Error("向量服务返回了无效的向量或不一致的维度");
    }
  }
}

/** Normalize with scaling first to keep very small or large components finite. */
function unitVector(vector: number[]): number[] {
  let scale = 0;
  for (const value of vector) scale = Math.max(scale, Math.abs(value));
  if (scale === 0) return vector.slice();
  const scaled = vector.map((value) => value / scale);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value ** 2, 0));
  return scaled.map((value) => value / norm);
}

export class VectorCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(paperId: string, evidence: readonly Evidence[]): number[][] | undefined {
    const entry = this.entries.get(paperId);
    if (entry?.source.length === evidence.length && evidence.every((block, i) =>
      block.id === entry.source[i]!.id && block.text === entry.source[i]!.text)) {
      return entry.vectors.map((vector) => vector.slice());
    }
  }

  set(paperId: string, evidence: readonly Pick<Evidence, "id" | "text">[], vectors: number[][]): void {
    validateVectors(vectors, evidence.length);
    this.entries.set(paperId, {
      source: evidence.map(({ id, text }) => ({ id, text })),
      vectors: vectors.map((vector) => vector.slice()),
    });
  }

  serialize(): string {
    return JSON.stringify([...this.entries]);
  }

  static deserialize(serialized: string): VectorCache {
    const entries: unknown = JSON.parse(serialized);
    if (!Array.isArray(entries)) throw new Error("向量缓存格式无效");

    const cache = new VectorCache();
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1]
        || !Array.isArray(entry[1].source) || !entry[1].source.every((block: CacheEntry["source"][number]) =>
          block && typeof block.id === "string" && typeof block.text === "string")) {
        throw new Error("向量缓存条目格式无效");
      }
      cache.set(entry[0], entry[1].source, entry[1].vectors);
    }
    return cache;
  }
}

export class VectorIndex {
  private readonly batchSize: number;
  private readonly cache?: VectorCache;
  private documentVectors?: Promise<number[][]>;

  constructor(
    private readonly paperId: string,
    private readonly evidence: readonly Evidence[],
    private readonly embed: Embed,
    { batchSize = DEFAULT_BATCH_SIZE, cache }: VectorOptions = {},
  ) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("向量批大小必须是正整数");
    this.batchSize = batchSize;
    this.cache = cache;
  }

  private async build(): Promise<number[][]> {
    const cached = this.cache?.get(this.paperId, this.evidence);
    if (cached) return cached.map(unitVector);

    const vectors: number[][] = [];
    for (let start = 0; start < this.evidence.length; start += this.batchSize) {
      const texts = this.evidence.slice(start, start + this.batchSize).map(({ text }) => text);
      const batch = await this.embed(texts);
      validateVectors(batch, texts.length, vectors[0]?.length);
      for (const vector of batch) vectors.push(vector.slice());
    }
    this.cache?.set(this.paperId, this.evidence, vectors);
    return vectors.map(unitVector);
  }

  async search(query: string, k: number, filter?: RetrievalFilter): Promise<RetrievalHit[]> {
    if (!(k >= 1) || !query.trim()) return [];
    const candidates = this.evidence.flatMap((block, index) => matchesFilter(block, filter) ? [index] : []);
    if (!candidates.length) return [];

    this.documentVectors ??= this.build().catch((error: unknown) => {
      this.documentVectors = undefined;
      throw error;
    });
    const vectors = await this.documentVectors;
    const embeddedQuery = await this.embed([query]);
    validateVectors(embeddedQuery, 1, vectors[0]!.length);
    const queryVector = unitVector(embeddedQuery[0]!);
    const hits = candidates.map((index) => {
      const score = vectors[index]!.reduce((sum, value, column) => sum + value * queryVector[column]!, 0);
      return { evidenceId: this.evidence[index]!.id, score: Math.max(-1, Math.min(1, score)) };
    });
    return limitHits(hits.sort(compareHits), k);
  }
}
