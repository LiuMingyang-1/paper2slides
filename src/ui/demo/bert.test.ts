import { describe, expect, it } from "vitest";
import { createPipeline } from "../../pipeline/pipeline";
import { HybridRetriever } from "../../retrieval/hybrid";
import { createCache } from "../../store/cache";
import { verifyDeck } from "../../verify/citation";
import { demoHost, demoPaper } from "./bert";

describe("offline BERT workflow", () => {
  it("replays validated slides with zero quota and a demonstrable verification failure", async () => {
    const paper = demoPaper();
    const cache = createCache();
    const pipeline = createPipeline(paper, { host: demoHost(), retriever: new HybridRetriever(paper.id, paper.blocks), cache });
    const understanding = await pipeline.understand("en");
    const outline = await pipeline.generateOutline(understanding, "experiments", "en");
    expect(outline.items[1]?.title).toBe("Results on downstream tasks");

    outline.items[1]!.title = "BERT benchmark results";
    const first = await pipeline.generateSlides(understanding, outline, "en");
    expect(first).toHaveLength(5);
    expect(first[1]?.slots.title).toBe("BERT benchmark results");
    const checks = verifyDeck(first, new Map(paper.blocks.map((source) => [source.id, source])));
    expect(checks.find((check) => check.status === "unsupported")?.numbers).toContainEqual({ value: "99.9%", found: false });
    const logs = pipeline.getLlmCalls();
    expect(logs.every((call) => call.ok && call.quotaConsumed === 0)).toBe(true);
    expect(await pipeline.generateSlides(understanding, outline, "en")).toEqual(first);
    expect(pipeline.getLlmCalls()).toEqual(logs);
  });
});
