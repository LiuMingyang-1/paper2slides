import { describe, expect, it, vi } from "vitest";
import type { AnnaHost, LlmCompleteArgs } from "../anna";
import { fakeHost, reply } from "../llm/test-fixtures";
import type { Emphasis, Evidence, Outline, OutlineItem, Paper, Slide, Understanding } from "../types";
import { MODULE_KINDS } from "../schema/understanding";
import { batchBySection } from "./evidence";
import { createPipeline, type PipelineProgress } from "./pipeline";

function block(id: string, text: string, section: string, type: Evidence["type"] = "text"): Evidence {
  return { id, page: Number(id.slice(1).split("-")[0]), text, sectionPath: [section], bbox: [0, 0, 10, 10], type };
}

const paper: Paper = {
  id: "paper-hash", title: "Example paper", authors: ["A. Author"], pageCount: 4, bodyPageCount: 3, warnings: [],
  blocks: [
    block("e1-0", "We investigate an estimation problem.", "1 Introduction"),
    block("e2-0", "The estimator uses cached measurements.", "2 Method"),
    block("e2-1", "Figure 1. The proposed estimator.", "2 Method", "caption"),
    block("e2-2", "Figure 2. Comparison setup.", "2 Method", "caption"),
    block("e3-0", "The evaluation used 8.60% as the target error rate.", "3 Results"),
  ],
  figures: [
    { id: "fig1", label: "Figure 1", page: 2, captionEvidenceId: "e2-1", cropOk: true, imageDataUrl: "data:image/png;base64,AA==" },
    { id: "fig2", label: "Figure 2", page: 2, captionEvidenceId: "e2-2", cropOk: false },
  ],
};

const understanding: Understanding = {
  title: paper.title, oneLiner: "A paper about an estimator.",
  modules: [{ kind: "method", points: [{ text: "The estimator uses cached measurements.", kind: "fact", evidenceIds: ["e2-0"] }] }],
};
const outline: Outline = {
  emphasis: "method",
  items: [
    { id: "s1", title: paper.title, modules: [], intent: "Introduce the paper" },
    { id: "s2", title: "Estimator", modules: ["method"], intent: "Describe cached measurements", figureId: "fig1" },
    { id: "s3", title: "Inputs", modules: ["method"], intent: "Discuss the inputs" },
    { id: "s4", title: "Workflow", modules: ["method"], intent: "Discuss the steps" },
    { id: "s5", title: "Conditions", modules: ["method"], intent: "Discuss setup" },
  ],
};

function fixtureSlide(item: OutlineItem): Slide {
  const ids = { id: item.id, outlineId: item.id };
  if (item.modules.length === 0) return { ...ids, layout: "title", slots: { title: item.title } };
  return {
    ...ids, layout: item.figureId ? "bullets_figure" : "bullets",
    slots: { title: item.title, bullets: understanding.modules[0]!.points },
    ...(item.figureId ? { figureId: item.figureId } : {}),
  };
}

function promptText(args: LlmCompleteArgs): string {
  return String(args.messages[0]!.content);
}

function inputField<T>(prompt: string, field: string): T {
  return JSON.parse(prompt.split(`\n${field}：`)[1]!.split("\n")[0]!);
}

function setup(failAt?: string) {
  const complete = vi.fn<AnnaHost["llm"]["complete"]>(async (args) => {
    const prompt = promptText(args);
    if (prompt.includes("模式：")) return reply(JSON.stringify(understanding));
    if (prompt.includes("侧重点：")) {
      const emphasis = /侧重点：(\w+)/.exec(prompt)?.[1] as Emphasis;
      return reply(JSON.stringify({ ...outline, emphasis }));
    }
    if (prompt.includes("溢出的槽位名：")) {
      const slide = inputField<Slide>(prompt, "原 Slide");
      slide.slots.bullets = [{ text: "Uses cached measurements.", kind: "fact", evidenceIds: ["e2-0"] }];
      return reply(JSON.stringify(slide));
    }
    const item = inputField<OutlineItem>(prompt, "大纲项");
    if (item.id === failAt) throw Object.assign(new Error("quota exhausted"), { code: "quota_exceeded" });
    return reply(JSON.stringify(fixtureSlide(item)));
  });
  const search = vi.fn(async (_query: string, _k: number) => [{ evidenceId: "e3-0", score: 1 }]);
  const cache = new Map<string, unknown>();
  const progress: PipelineProgress[] = [];
  const options = {
    host: fakeHost(complete), retriever: { search }, cache, onProgress: (unit: PipelineProgress) => progress.push(unit),
  };
  return { pipeline: createPipeline(paper, options), options, complete, search, cache, progress };
}

describe("paper generation", () => {
  it("runs the full pipe, pins module evidence and the planned figure caption, and reuses cache across instances", async () => {
    const { pipeline, options, complete, search, cache, progress } = setup();
    const result = await pipeline.run("en", "method");
    expect(result).toMatchObject({ understanding, outline, slides: outline.items.map(fixtureSlide) });
    expect(result.llmCalls).toHaveLength(7);
    expect(cache.size).toBe(7);
    expect([...cache.keys()].every((key) => /^paper-hash:(understand|outline|slide)@\d+:[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(promptText(complete.mock.calls[0]![0])).toContain("[e2-0] (p.2, §2 Method) The estimator");
    expect(promptText(complete.mock.calls[0]![0])).toContain("语言由 `en`");
    expect(search).toHaveBeenNthCalledWith(2, "Describe cached measurements Estimator", 8);
    const figureSlide = promptText(complete.mock.calls[3]![0]);
    expect(figureSlide).toContain("[e2-0]");
    expect(figureSlide).toContain("[e2-1]");
    expect(figureSlide).toContain("[e3-0]");
    expect(figureSlide).not.toContain('"fig2"');
    expect(figureSlide).not.toContain("data:image");
    expect(progress.at(-1)).toEqual({ phase: "slides", completed: 5, total: 5, outlineId: "s5", cacheHit: false });

    await expect(createPipeline(paper, options).run("en", "method")).resolves.toMatchObject({ llmCalls: [] });
    expect(complete).toHaveBeenCalledTimes(7);
    expect(progress.at(-1)?.cacheHit).toBe(true);
    await pipeline.generateOutline(understanding, "balanced", "en");
    expect(complete).toHaveBeenCalledTimes(8);
  });

  it("resumes at the incomplete page after quota exhaustion", async () => {
    const first = setup("s3");
    await expect(first.pipeline.run("en", "method")).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(first.pipeline.getLlmCalls()).toHaveLength(5);
    expect(first.cache.size).toBe(4);
    const second = setup();
    const resumed = createPipeline(paper, { ...second.options, cache: first.cache });
    await expect(resumed.run("en", "method")).resolves.toMatchObject({ slides: outline.items.map(fixtureSlide) });
    expect(second.complete).toHaveBeenCalledTimes(3);
    expect(inputField<OutlineItem>(promptText(second.complete.mock.calls[0]![0]), "大纲项").id).toBe("s3");
  });

  it("accepts an edited outline and caches compression separately", async () => {
    const { pipeline, complete } = setup();
    const items = [outline.items[0]!, { ...outline.items[2]!, title: "Edited title" }, outline.items[1]!];
    const slides = await pipeline.generateSlides(understanding, { ...outline, items }, "en");
    expect(slides.map(({ id }) => id)).toEqual(["s1", "s3", "s2"]);
    expect(slides[1]?.slots.title).toBe("Edited title");
    const compressed = await pipeline.compressSlide(slides[1]!, ["bullets"], "en");
    expect(compressed.slots.bullets).toMatchObject([{ text: "Uses cached measurements.", evidenceIds: ["e2-0"] }]);
    await expect(pipeline.compressSlide(slides[1]!, ["bullets"], "en")).resolves.toEqual(compressed);
    expect(complete).toHaveBeenCalledTimes(4);
  });

  it("deduplicates simultaneous steps and replaces an invalid cached value", async () => {
    const { pipeline, complete, cache } = setup();
    await Promise.all([pipeline.understand("en"), pipeline.understand("en")]);
    expect(complete).toHaveBeenCalledTimes(1);
    cache.set([...cache.keys()][0]!, { title: "broken" });
    await expect(pipeline.understand("en")).resolves.toEqual(understanding);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("summarizes long papers by section and passes original evidence IDs through final understanding", async () => {
    const long = {
      ...paper,
      blocks: [
        block("e1-0", "研究问题。".repeat(22), "1 Introduction"),
        block("e2-0", "缓存测量。".repeat(45), "2 Method"),
      ],
      figures: [],
    };
    const complete = vi.fn<AnnaHost["llm"]["complete"]>(async (args) => {
      const prompt = promptText(args);
      const id = prompt.includes("[e1-0]") ? "e1-0" : "e2-0";
      const modules = [{ kind: "method", points: [{ text: "简短摘要。", kind: "summary", evidenceIds: [id] }] }];
      return reply(JSON.stringify({ ...understanding, modules }));
    });
    const progress: PipelineProgress[] = [];
    const pipeline = createPipeline(long, {
      host: fakeHost(complete), retriever: { search: async () => [] }, understandMaxChars: 300,
      onProgress: (step) => progress.push(step),
    });
    await expect(pipeline.understand("zh")).resolves.toMatchObject({
      modules: [{ kind: "method", points: [{ evidenceIds: ["e2-0"] }] }],
    });
    expect(complete).toHaveBeenCalledTimes(3);
    const prompts = complete.mock.calls.map(([args]) => promptText(args));
    expect(prompts[0]).toContain("模式：section\n");
    expect(prompts[0]).not.toContain("[e2-0]");
    expect(prompts[1]).not.toContain("[e1-0]");
    expect(prompts[2]).toContain("模式：section_summaries");
    expect(prompts[2]).toContain('"evidenceIds":["e1-0"]');
    expect(prompts[2]).toContain('"evidenceIds":["e2-0"]');
    expect(progress.filter(({ phase }) => phase === "section").map(({ completed }) => completed)).toEqual([0, 1, 2]);
  });

  it("reduces section summaries in groups when the final understanding budget would overflow", async () => {
    const long = {
      ...paper,
      blocks: Array.from({ length: 18 }, (_, i) =>
        block(`e${i + 1}-0`, "A separate long section. ".repeat(5), `${i + 1} Section`)),
      figures: [],
    };
    const complete = vi.fn<AnnaHost["llm"]["complete"]>(async (args) => {
      const prompt = promptText(args);
      if (!prompt.includes("模式：section\n")) return reply(JSON.stringify(understanding));
      const id = /\[(e\d+-0)\]/.exec(prompt)![1]!;
      const point: Understanding["modules"][number]["points"][number] = {
        text: "Long summary. ".repeat(9), kind: "summary", evidenceIds: [id],
      };
      return reply(JSON.stringify({
        ...understanding, modules: MODULE_KINDS.map((kind) => ({ kind, points: [point, point] })),
      }));
    });
    const pipeline = createPipeline(long, {
      host: fakeHost(complete), retriever: { search: async () => [] }, understandMaxChars: 256,
    });
    await expect(pipeline.understand("en")).resolves.toEqual(understanding);
    const merges = complete.mock.calls.filter(([args]) => promptText(args).includes("模式：section_summaries"));
    expect(merges.length).toBeGreaterThan(1);
    expect(merges[0]![0].maxTokens).toBe(2048);
    expect(merges.at(-1)![0].maxTokens).toBe(4096);
    for (const [args] of merges) {
      const evidence = /<evidence>\n([\s\S]*?)\n<\/evidence>/.exec(promptText(args))![1]!;
      expect(evidence.length).toBeLessThanOrEqual(24_000);
    }
  });

  it("splits an oversized evidence block without losing its ID or Unicode text", () => {
    const text = "甲🔬乙".repeat(200);
    const batches = batchBySection([block("e1-0", text, "1")], 256);
    expect(batches.length).toBeGreaterThan(1);
    const contents = batches.map(({ input, ids }) => {
      expect(input.length).toBeLessThanOrEqual(256);
      expect(ids).toEqual(new Set(["e1-0"]));
      const fragment = input.slice("[e1-0] (p.1, §1) ".length);
      expect(fragment).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      return fragment;
    });
    expect(contents.join("")).toBe(text);
  });
});
