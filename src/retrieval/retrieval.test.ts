import { describe, expect, it, vi } from "vitest";
import type { Evidence, Retriever } from "../types";
import { BM25Index, tokenize } from "./bm25";
import { HybridRetriever } from "./hybrid";
import { VectorCache, VectorIndex } from "./vector";

const blocks: Evidence[] = [
  { id: "e4-1", type: "text", sectionPath: ["4 Results"], page: 4, bbox: [0, 0, 1, 1],
    text: "On ImageNet, ViT-Base reduced the top-1 classification error to 3.2%." },
  { id: "e4-2", type: "caption", sectionPath: ["4 Results", "4.1 Ablation"], page: 4, bbox: [0, 0, 1, 1],
    text: "Figure 3. 数据增强使分类错误率降至 3.8 %。" },
  { id: "e2-1", type: "text", sectionPath: ["2 Method"], page: 2, bbox: [0, 0, 1, 1],
    text: "Random crops and horizontal flips improve generalization under a distribution shift." },
];

describe("BM25", () => {
  it("keeps model names, signed decimals, percentages and Chinese bigrams", () => {
    expect(tokenize("The ViT‑Base, GPT-4 and 3-shot: ImageNet分类, +3.2 %, −.5, 1,024。"))
      .toEqual(["vit-base", "gpt-4", "3-shot", "imagenet", "分类", "+3.2%", "-.5", "1024"]);
    expect(tokenize("数据增强使分类错误率下降")).toContain("增强");
  });

  it("ranks exact terms, uses corpus statistics, and filters by type and section prefix", () => {
    const index = new BM25Index(blocks);
    expect(index.search("ViT-Base 3.2%", 1)[0]?.evidenceId).toBe("e4-1");
    expect(index.search("分类错误率 3.8%", 2)[0]?.evidenceId).toBe("e4-2");
    expect(index.search("3.2% 3.8%", 5, { type: "caption", sectionPath: ["4 Results"] }).map((hit) => hit.evidenceId))
      .toEqual(["e4-2"]);
    expect(index.search("3.8%", 5, { sectionPath: ["4 Results", "4.2 Transfer"] })).toEqual([]);
    expect(index.search("cross-attention", 5)).toEqual([]);
    expect(index.search("ViT-Base", 0)).toEqual([]);
    expect(index.search("ViT-Base", 1)[0]?.score).toBeGreaterThan(0);
    expect(new BM25Index([]).search("ImageNet", 3)).toEqual([]);
  });

  it("applies inverse document frequency and document-length normalization", () => {
    const short = { ...blocks[0]!, text: "Contrastive pretraining" };
    const long = { ...blocks[1]!, text: "Contrastive pretraining improved transfer robustness performance" };
    const hits = new BM25Index([short, long, blocks[2]!]).search("contrastive", 2);
    const averageLength = [short, long, blocks[2]!].reduce((sum, block) => sum + tokenize(block.text).length, 0) / 3;
    const expected = Math.log1p(1.5 / 2.5) * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 2 / averageLength));
    expect(hits.map(({ evidenceId }) => evidenceId)).toEqual([short.id, long.id]);
    expect(hits[0]?.score).toBeCloseTo(expected);
  });
});

describe("vector search", () => {
  it("embeds batches once across concurrent searches and uses cosine similarity", async () => {
    const vectors = new Map(blocks.map(({ text }, i) => [text, [[10, 1], [1, 2], [-5, 0]][i]!]));
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => vectors.get(text) ?? [1, 0]));
    const index = new VectorIndex("pdf-hash", blocks, embed, { batchSize: 2 });
    const [hits, filtered] = await Promise.all([
      index.search("image classification", 3),
      index.search("分类", 1, { type: "caption" }),
    ]);

    expect(embed.mock.calls.slice(0, 2).map(([input]) => input)).toEqual([
      blocks.slice(0, 2).map(({ text }) => text), [blocks[2]!.text],
    ]);
    expect(embed).toHaveBeenCalledTimes(4);
    expect(hits.map(({ evidenceId }) => evidenceId)).toEqual(["e4-1", "e4-2", "e2-1"]);
    expect(hits[0]?.score).toBeCloseTo(10 / Math.sqrt(101));
    expect(hits[2]?.score).toBe(-1);
    expect(filtered[0]?.evidenceId).toBe("e4-2");
  });

  it("restores a serialized cache only for the same paper and source blocks", async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 2]));
    const cache = new VectorCache();
    await new VectorIndex("pdf-a", blocks, embed, { cache }).search("sampling", 2);
    expect(embed).toHaveBeenCalledTimes(2);

    const restored = VectorCache.deserialize(cache.serialize());
    embed.mockClear();
    await new VectorIndex("pdf-a", blocks, embed, { cache: restored }).search("sampling", 2);
    expect(embed.mock.calls).toEqual([[["sampling"]]]);

    embed.mockClear();
    await new VectorIndex("pdf-b", blocks, embed, { cache: restored }).search("sampling", 2);
    expect(embed).toHaveBeenCalledTimes(2);

    embed.mockClear();
    const revised = [{ ...blocks[0]!, text: "ViT-Base reduced the ImageNet classification error." }, ...blocks.slice(1)];
    await new VectorIndex("pdf-a", revised, embed, { cache: restored }).search("sampling", 2);
    expect(embed.mock.calls[0]?.[0]).toEqual(revised.map(({ text }) => text));
    expect(() => VectorCache.deserialize('[["pdf-a",{"source":[{"id":"a","text":"t"}],"vectors":[[null]]}]]')).toThrow();
  });

  it("skips provider calls when there is no candidate or query", async () => {
    const embed = vi.fn(async () => []);
    const index = new VectorIndex("pdf-a", blocks, embed);
    await expect(index.search("ImageNet", 3, { sectionPath: ["5 Limitations"] })).resolves.toEqual([]);
    await expect(index.search(" ", 3)).resolves.toEqual([]);
    await expect(index.search("ImageNet", 0)).resolves.toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("hybrid search", () => {
  it("fuses rank positions with k=60 and applies both filters through Retriever", async () => {
    const embed = async (texts: string[]) => texts.map((text) => {
      if (text === blocks[0]!.text) return [1, 1];
      if (text === blocks[1]!.text) return [-1, 0];
      return [1, 0];
    });
    const retriever: Retriever = new HybridRetriever("pdf-a", blocks, { embed });
    const hits = await retriever.search("ImageNet ViT-Base", 3);
    expect(hits.map(({ evidenceId }) => evidenceId)).toEqual(["e4-1", "e2-1", "e4-2"]);
    expect(hits[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
    const filtered = await retriever.search("ImageNet", 3, { type: "text", sectionPath: ["4 Results"] });
    expect(filtered).toEqual([{ evidenceId: "e4-1", score: 2 / 61 }]);
  });

  it("returns the unmodified BM25 ranking if embedding a batch fails, then retries the index", async () => {
    const cache = new VectorCache();
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))
      .mockRejectedValueOnce(new Error("provider offline"));
    const hybrid = new HybridRetriever("pdf-a", blocks, { embed, cache });
    const filter = { sectionPath: ["4 Results"] };
    const query = "ImageNet 3.8%";
    await expect(hybrid.search(query, 2, filter)).resolves.toEqual(new BM25Index(blocks).search(query, 2, filter));
    expect(hybrid.vectorFallbackReason).toContain("provider offline");
    expect(cache.serialize()).toBe("[]");
    expect(await hybrid.search(query, 2, filter)).toHaveLength(2);
    expect(hybrid.vectorFallbackReason).toBeUndefined();
  });

  it("records missing providers and query vector dimension errors", async () => {
    const query = "ImageNet";
    const lexical = new BM25Index(blocks).search(query, 1);
    const disabled = new HybridRetriever("pdf-a", blocks);
    await expect(disabled.search(query, 1)).resolves.toEqual(lexical);
    expect(disabled.vectorFallbackReason).toContain("未配置");
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))
      .mockResolvedValueOnce([[1, 0], [1, 0], [1, 0]])
      .mockResolvedValueOnce([[1]]);
    const malformed = new HybridRetriever("pdf-a", blocks, { embed });
    await expect(malformed.search(query, 1)).resolves.toEqual(lexical);
    expect(malformed.vectorFallbackReason).toContain("维度");
    await malformed.search(query, 1);
    expect(embed).toHaveBeenCalledTimes(3);
    expect(malformed.vectorFallbackReason).toBeUndefined();
  });
});
