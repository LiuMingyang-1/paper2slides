// Regression tests built from failed calls to the platform model xiaomi/mimo-v2.5.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import visualization from "../../eval/papers/visualization.parsed.json";
import type { AnnaHost } from "../anna";
import { PROMPTS } from "../prompts/generated";
import { slideValidator, type SlideConstraints } from "../schema/slide";
import { understandingValidator } from "../schema/understanding";
import type { LlmCallLog } from "../types";
import { createLlmClient } from "./client";
import { fakeHost, reply } from "./test-fixtures";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const vars = { language: "zh", outline_item: "s", paper_metadata: "BERT", figures: "fig2", layouts: "…", evidence_blocks: "…" };
const ids = new Set([
  "e3-31", "e3-44", "e4-14", "e4-15", "e4-16", "e5-21", "e4-9", "e4-2", "e5-23", "e5-26",
  "e3-1", "e3-19", "e4-4",
]);

function run(raw: string, outlineId: string, figures?: Pick<SlideConstraints, "figureIds" | "preferredFigureId">) {
  const complete = vi.fn<AnnaHost["llm"]["complete"]>().mockResolvedValue(reply(raw));
  const logs: LlmCallLog[] = [];
  const client = createLlmClient(fakeHost(complete), { onCall: (log) => logs.push(log) });
  const validator = slideValidator({ outlineId, titlePage: false, evidenceIds: ids, figureIds: new Set(["fig2"]), ...figures });
  return { result: client.complete(PROMPTS.slide!, vars, validator), complete, logs };
}

describe("real model output regressions", () => {
  it.each([
    ["understand-visualization-mimo-compact-ids.raw.txt", ["e3-1", "e3-35"]],
    ["understand-visualization-mimo-compact-ids-retry.raw.txt", ["e3-1", "e3-3", "e3-5", "e3-6"]],
  ])("restores uniquely identifiable citation separators in %s", async (name, expectedIds) => {
    const available = new Set(visualization.blocks.map(({ id }) => id));
    const complete = vi.fn<AnnaHost["llm"]["complete"]>().mockResolvedValue(reply(fixture(name)));
    const logs: LlmCallLog[] = [];
    const client = createLlmClient(fakeHost(complete), { onCall: (log) => logs.push(log) });
    const result = await client.complete(PROMPTS.understand!, {
      language: "zh", mode: "full", detail: "full", paper_metadata: visualization.title, evidence_blocks: "…",
    }, understandingValidator(available));
    expect(result.modules[2]?.points[0]?.evidenceIds).toEqual(expectedIds);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs[0]?.normalizations).toContainEqual(expect.stringContaining("补全连字符为 e3-1"));
  });

  it("does not guess a separator when it cannot identify exactly one cited block", () => {
    const schema = understandingValidator(new Set(["e3-11", "e31-1"]));
    for (const id of ["e311", "e999"]) {
      expect(() => schema({
        title: "Paper", oneLiner: "Summary",
        modules: [{ kind: "method", points: [{ text: "Method", kind: "fact", evidenceIds: [id] }] }],
      })).toThrow("应为 e{页码}-{块序号}");
    }
  });

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

  it("wraps the s4 takeaway from run5 in a one-element array", async () => {
    const raw = fixture("slide-bert-mimo-run5-s4-attempt1.raw.txt");
    const original = JSON.parse(raw);
    const { result, complete, logs } = run(raw, "s4");
    await expect(result).resolves.toMatchObject({
      id: "s4", layout: "bullets", slots: { takeaway: [original.slots.takeaway] },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs[0]!.normalizations).toEqual(["slots.takeaway 单对象包装为数组"]);
  });

  it("wraps the s5 takeaway and caption from run5 and hoists the explicit figure", async () => {
    const raw = fixture("slide-bert-mimo-run5-s5-attempt1.raw.txt");
    const original = JSON.parse(raw);
    const { result, complete, logs } = run(raw, "s5", {
      figureIds: new Set(["fig1", "fig2"]), preferredFigureId: "fig1",
    });
    await expect(result).resolves.toMatchObject({
      id: "s5", layout: "bullets_figure", figureId: "fig2",
      slots: { takeaway: [original.slots.takeaway], caption: [original.slots.caption] },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs[0]!.normalizations).toEqual([
      "slots.figureId 上移为 figureId", "丢弃字段 slots.figureId", "截断 slots.bullets：4 项保留前 3 项",
      "slots.takeaway 单对象包装为数组", "slots.caption 单对象包装为数组",
    ]);
  });

  it("fills the missing figureId in the s5 retry from run5 using the outline preference", async () => {
    const raw = fixture("slide-bert-mimo-run5-s5-attempt2.raw.txt");
    const { result, complete, logs } = run(raw, "s5", {
      figureIds: new Set(["fig1", "fig2"]), preferredFigureId: "fig2",
    });
    await expect(result).resolves.toMatchObject({ id: "s5", layout: "bullets_figure", figureId: "fig2" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(logs[0]!.normalizations).toEqual(["figureId 缺失，补全为 fig2"]);
  });

  it("does not 'complete' JSON that was cut inside a number", async () => {
    const cut = '{"id":"s4","outlineId":"s4","layout":"bullets","slots":{"title":"t","bullets":[{"text":"GLUE 80.';
    const complete = vi.fn<AnnaHost["llm"]["complete"]>().mockResolvedValue(reply(cut));
    const client = createLlmClient(fakeHost(complete), { retryDelayMs: 0 });
    const validator = slideValidator({ outlineId: "s4", titlePage: false, evidenceIds: ids, figureIds: new Set() });
    await expect(client.complete(PROMPTS.slide!, vars, validator)).rejects.toThrow();
  });
});

describe("cover title length", () => {
  it("accepts the full 80-char BERT title on the cover but keeps 60 for content slides", () => {
    const bert = "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding";
    const cover = slideValidator({ outlineId: "s1", titlePage: true, evidenceIds: ids, figureIds: new Set() });
    expect(cover({ id: "s1", outlineId: "s1", layout: "title", slots: { title: bert } }, []).value.slots.title).toBe(bert);
    const content = slideValidator({ outlineId: "s2", titlePage: false, evidenceIds: ids, figureIds: new Set() });
    const point = { text: "MLM masks 15% of tokens", kind: "fact", evidenceIds: ["e4-14"] };
    expect(() => content({ id: "s2", outlineId: "s2", layout: "bullets",
      slots: { title: "x".repeat(130), bullets: [point] } }, [])).toThrow();
  });
});
