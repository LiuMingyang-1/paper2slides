import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import parsedPaper from "../../eval/papers/bert.parsed.json";
import calls from "../../eval/runs/2026-11-21/run6/calls.json";
import { fakeHost, reply } from "../llm/test-fixtures";
import { createPipeline } from "../pipeline/pipeline";
import { HybridRetriever } from "../retrieval/hybrid";
import type { Outline, Paper } from "../types";
import { verifyDeck } from "./citation";

it("replays the archived run6 responses through the app's generation and verification path", async () => {
  const paper = parsedPaper as unknown as Paper;
  // The CLI parse fixture lacks browser crops. Restore figure availability from
  // the archived outline, which passed the app's crop-aware validation.
  const { items } = JSON.parse(calls.find(({ promptId }) => promptId === "outline")!.rawOutput) as Outline;
  const cropped = new Set(items.map(({ figureId }) => figureId));
  const figures = paper.figures.map((figure) => cropped.has(figure.id)
    ? { ...figure, cropOk: true, imageDataUrl: "data:image/png;base64,AA==" }
    : figure);
  const pending = [...calls];
  const pipeline = createPipeline({ ...paper, figures }, {
    host: fakeHost(async () => {
      const call = pending.shift();
      if (!call?.ok) throw new Error("Expected a successful archived response");
      return { ...reply(call.rawOutput, call.stopReason), _meta: { quotaConsumed: 0, latencyMs: 0 } };
    }),
    llm: { retryDelayMs: 0 },
    retriever: new HybridRetriever(paper.id, paper.blocks),
  });
  const { slides, llmCalls } = await pipeline.run("zh");
  expect(pending).toHaveLength(0);
  expect(llmCalls.map(({ promptId, normalizations }) => [promptId, normalizations])).toEqual(
    calls.map(({ promptId, normalizations }) => [promptId, normalizations]),
  );
  expect(slides.map(({ id }) => id)).toEqual(Array.from({ length: 10 }, (_, i) => `s${i + 1}`));

  const evidence = new Map(paper.blocks.map((block) => [block.id, block]));
  const checks = verifyDeck(slides, evidence);
  const counts = slides.map(({ id }) => (["supported", "partial", "unsupported"] as const)
    .map((status) => checks.filter((check) => check.slideId === id && check.status === status).length));
  if (process.env.VERIFY_AUDIT === "1") {
    console.log("Counts (supported / partial / unsupported):", counts);
    for (const check of checks.filter(({ status }) => status !== "supported")) {
      const slot = slides.find(({ id }) => id === check.slideId)?.slots[check.slot];
      const point = Array.isArray(slot) ? slot[check.pointIndex]! : undefined;
      console.log(JSON.stringify({ ...check, point, evidence: point?.evidenceIds.map((id) => evidence.get(id)?.text) }));
    }
  }

  const preview = readFileSync(new URL("../../eval/runs/2026-11-21/run6/preview.txt", import.meta.url), "utf8");
  const archivedCounts = Array.from(preview.matchAll(/^✅ (\d+)\r?\n⚠️ (\d+)\r?\n❌ (\d+)$/gm))
    .slice(0, slides.length).map(([, supported, partial, unsupported]) => [Number(supported), Number(partial), Number(unsupported)]);
  // The archived thumbnail counts are the baseline. Each delta is documented in verify-audit.md.
  expect(archivedCounts).toHaveLength(slides.length);
  const updatedCounts = new Map([
    ["s2", [3, 3, 0]], ["s4", [5, 0, 0]], ["s5", [5, 0, 0]], ["s6", [4, 0, 0]],
  ]);
  expect(counts).toEqual(slides.map(({ id }, i) => updatedCounts.get(id) ?? archivedCounts[i]));
  expect(checks.filter(({ status }) => status !== "supported")
    .map(({ slideId, slot, pointIndex, status }) => [slideId, slot, pointIndex, status])).toEqual([
    ["s2", "left", 2, "partial"],
    ["s2", "right", 1, "partial"],
    ["s2", "right", 2, "partial"],
    ["s7", "rows", 2, "partial"],
    ["s7", "rows", 3, "partial"],
    ["s7", "rows", 4, "partial"],
    ["s10", "bullets", 2, "partial"],
    ["s10", "takeaway", 0, "partial"],
  ]);
});
