import { describe, expect, it, vi } from "vitest";
import type { AnnaHost } from "../anna";
import { createEmbeddingCache } from "../store/embeddings";
import type { OutlineItem, Paper } from "../types";
import { createVectorSearch, type EmbeddingCallLog } from "./vector-search";

const paper: Paper = {
  id: "test-paper", title: "Paper", authors: [], pageCount: 1, bodyPageCount: 1, figures: [], warnings: [],
  blocks: Array.from({ length: 65 }, (_, i) => ({
    id: `e1-${i + 1}`, page: 1, type: "text", sectionPath: [], text: `Test block ${i}`, bbox: [0, 0, 1, 1],
  })),
};
const outline: OutlineItem[] = [{ id: "s1", title: "Paper", intent: "Test", modules: [] }];
const query = "Test Paper";

function fakeEmbed() {
  return vi.fn<AnnaHost["llm"]["embed"]>().mockImplementation(async ({ input }) => ({
    model: "mock", data: (Array.isArray(input) ? input : [input]).map((_, index) => ({
      index, embedding: [1, index + 1],
    })).reverse(),
    _meta: { quotaConsumed: 1.25 },
  }));
}

describe("optional vector search", () => {
  it("batches the paper in chunks of at most 64 and reuses batches and queries by paper ID", async () => {
    const embed = fakeEmbed();
    const host = { llm: { embed } } as unknown as AnnaHost;
    const cache = createEmbeddingCache();
    const logs: EmbeddingCallLog[] = [];
    const session = (source = paper) => createVectorSearch(source, host, cache, vi.fn(), (log) => logs.push(log));
    const first = session();
    expect(await first.estimate(outline)).toEqual({ documents: 2, queries: 1 });
    expect(embed).not.toHaveBeenCalled();
    expect(await first.retriever(vi.fn()).search(query, 8)).toHaveLength(8);
    expect(embed.mock.calls.map(([{ input }]) => input.length)).toEqual([64, 1, 1]);
    expect(logs.map((log) => log.quotaConsumed)).toEqual([1.25, 1.25, 1.25]);

    const reopened = session();
    expect(await reopened.estimate(outline)).toEqual({ documents: 0, queries: 0 });
    await reopened.retriever(vi.fn()).search(query, 8);
    expect(embed).toHaveBeenCalledTimes(3);

    const revised = [{ ...outline[0]!, title: "Edited title" }];
    expect(await reopened.estimate(revised)).toEqual({ documents: 0, queries: 1 });
    expect(await session({ ...paper, id: "different-paper" }).estimate(outline)).toEqual({ documents: 2, queries: 1 });
  });

  it("retains successful batches when a later batch fails and falls back for the rest of the run", async () => {
    const embed = fakeEmbed();
    const succeed = embed.getMockImplementation()!;
    embed.mockImplementationOnce(succeed).mockRejectedValueOnce(new Error("Unavailable"));
    const logs: EmbeddingCallLog[] = [];
    const vectors = createVectorSearch(paper, { llm: { embed } } as unknown as AnnaHost,
      createEmbeddingCache(), vi.fn(), (log) => logs.push(log));
    const fallback = vi.fn();
    const current = vectors.retriever(fallback);
    expect(await current.search(query, 8)).not.toHaveLength(0);
    await current.search("block", 8);
    expect(fallback).toHaveBeenCalledOnce();
    expect(embed).toHaveBeenCalledTimes(2);
    expect(logs.map((log) => log.ok)).toEqual([true, false]);
    expect(await vectors.estimate(outline)).toEqual({ documents: 1, queries: 1 });
    await vectors.retriever(fallback).search(query, 8);
    expect(embed.mock.calls.map(([{ input }]) => input.length)).toEqual([64, 1, 1, 1]);
  });
});
