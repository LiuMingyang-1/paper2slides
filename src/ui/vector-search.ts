import type { AnnaHost } from "../anna";
import { HybridRetriever } from "../retrieval/hybrid";
import { sha256 } from "../store/cache";
import type { EmbeddingCache } from "../store/embeddings";
import type { OutlineItem, Paper, RetrievalFilter, Retriever } from "../types";

const BATCH_SIZE = 64;

export interface EmbeddingCallLog {
  operation: "embed";
  startedAt: string;
  inputCount: number;
  quotaConsumed: number | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

function readVectors(result: Awaited<ReturnType<AnnaHost["llm"]["embed"]>>, count: number) {
  const sorted = result.data.slice().sort((a, b) => a.index - b.index);
  const dimension = sorted[0]?.embedding?.length;
  if (!dimension || sorted.length !== count || sorted.some(({ index, embedding }, i) =>
    index !== i || !Array.isArray(embedding) || embedding.length !== dimension || Array.from(embedding).some((value) => !Number.isFinite(value)))) {
    throw new Error("Invalid embedding response");
  }
  return sorted.map(({ embedding }) => embedding);
}

export function createVectorSearch(
  paper: Paper, host: AnnaHost, cache: EmbeddingCache, onStart: () => void, onCall: (log: EmbeddingCallLog) => void,
) {
  const prefix = `${paper.id}:anna-managed:v1:`;
  const keys = new Map<string, Promise<string>>();
  const pending = new Map<string, Promise<number[][]>>();
  function keyFor(input: string[]) {
    const serialized = JSON.stringify(input);
    let key = keys.get(serialized);
    if (!key) {
      key = sha256(new TextEncoder().encode(serialized).buffer).then((hash) => prefix + hash);
      keys.set(serialized, key);
    }
    return key;
  }
  const documentBatches: string[][] = [];
  for (let i = 0; i < paper.blocks.length; i += BATCH_SIZE) {
    documentBatches.push(paper.blocks.slice(i, i + BATCH_SIZE).map(({ text }) => text));
  }

  async function embed(input: string[]) {
    const key = await keyFor(input);
    const current = pending.get(key);
    if (current) return current;
    const fetch = async () => {
      const cached = await cache.get(key);
      if (cached) return cached;
      onStart();
      const started = Date.now();
      let quotaConsumed: number | null = null;
      let failure: string | undefined;
      try {
        const result = await host.llm.embed({ input });
        quotaConsumed = result._meta?.quotaConsumed ?? null;
        const vectors = readVectors(result, input.length);
        await cache.set(key, vectors);
        return vectors;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        onCall({
          operation: "embed", startedAt: new Date(started).toISOString(), inputCount: input.length,
          quotaConsumed, latencyMs: Date.now() - started, ok: failure === undefined,
          ...(failure === undefined ? {} : { error: failure }),
        });
      }
    };
    const request = (async () => {
      let locked = false;
      try {
        if (globalThis.navigator?.locks) {
          return await navigator.locks.request(`paper2slides:${key}`, () => {
            locked = true;
            return fetch();
          });
        }
      } catch (error) {
        if (locked) throw error;
        // Some iframe storage policies deny Web Locks while still allowing in-memory reuse.
      }
      return fetch();
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  }

  return {
    async estimate(items: readonly OutlineItem[]) {
      const documentKeys = new Set(await Promise.all(documentBatches.map(keyFor)));
      const queryKeys = new Set(await Promise.all(items.map(({ intent, title }) => keyFor([`${intent} ${title}`]))));
      [...documentKeys].forEach((key) => queryKeys.delete(key));
      async function missing(batch: Set<string>) {
        return (await Promise.all([...batch].map((key) => cache.has(key)))).filter((found) => !found).length;
      }
      const [documents, queries] = await Promise.all([missing(documentKeys), missing(queryKeys)]);
      return { documents, queries };
    },
    retriever(onFallback: () => void): Retriever {
      const hybrid = new HybridRetriever(paper.id, paper.blocks, { embed, batchSize: BATCH_SIZE });
      let lexical: HybridRetriever | undefined;
      return {
        async search(query: string, k: number, filter?: RetrievalFilter) {
          if (lexical) return lexical.search(query, k, filter);
          const hits = await hybrid.search(query, k, filter);
          if (hybrid.vectorFallbackReason) {
            // Stop making paid attempts for the rest of this generation.
            lexical = new HybridRetriever(paper.id, paper.blocks);
            onFallback();
          }
          return hits;
        },
      };
    },
  };
}
