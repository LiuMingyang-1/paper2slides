// Regression tests built from raw outputs captured on the first real end-to-end run
// (BERT, platform model xiaomi/mimo-v2.5, 2026-11-20). Each fixture made a step fail.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AnnaHost } from "../anna";
import { PROMPTS } from "../prompts/generated";
import { slideValidator } from "../schema/slide";
import type { LlmCallLog } from "../types";
import { createLlmClient } from "./client";
import { fakeHost, reply } from "./test-fixtures";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const vars = { language: "zh", outline_item: "s", paper_metadata: "BERT", figures: "fig2", layouts: "…", evidence_blocks: "…" };
const ids = new Set(["e3-31", "e3-44", "e4-14", "e4-15", "e4-16", "e5-21", "e4-9", "e4-2", "e5-23", "e5-26"]);

function run(raw: string, outlineId: string) {
  const complete = vi.fn<AnnaHost["llm"]["complete"]>().mockResolvedValue(reply(raw));
  const logs: LlmCallLog[] = [];
  const client = createLlmClient(fakeHost(complete), { onCall: (log) => logs.push(log) });
  const validator = slideValidator({ outlineId, titlePage: false, evidenceIds: ids, figureIds: new Set(["fig2"]) });
  return { result: client.complete(PROMPTS.slide!, vars, validator), complete, logs };
}

describe("real model output regressions", () => {
  it("accepts a slide whose final closing brace is missing, without a retry", async () => {
    const raw = fixture("slide-bert-mimo-missing-brace.raw.txt");
    expect(() => JSON.parse(raw)).toThrow();
    const { result, complete, logs } = run(raw, "s4");
    await expect(result).resolves.toMatchObject({ id: "s4", layout: "bullets_figure", figureId: "fig2" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs[0]!.normalizations).toContainEqual(expect.stringContaining("补全缺失的闭合符号"));
  });

  it("hoists a figureId the model placed inside slots, without a retry", async () => {
    const { result, complete, logs } = run(fixture("slide-bert-mimo-figure-in-slots.raw.txt"), "s3");
    await expect(result).resolves.toMatchObject({ id: "s3", layout: "bullets_figure", figureId: "fig2" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs[0]!.normalizations).toContain("slots.figureId 上移为 figureId");
  });

  it("does not 'complete' JSON that was cut inside a number", async () => {
    const cut = '{"id":"s4","outlineId":"s4","layout":"bullets","slots":{"title":"t","bullets":[{"text":"GLUE 80.';
    const complete = vi.fn<AnnaHost["llm"]["complete"]>().mockResolvedValue(reply(cut));
    const client = createLlmClient(fakeHost(complete), { retryDelayMs: 0 });
    const validator = slideValidator({ outlineId: "s4", titlePage: false, evidenceIds: ids, figureIds: new Set() });
    await expect(client.complete(PROMPTS.slide!, vars, validator)).rejects.toThrow();
  });
});
