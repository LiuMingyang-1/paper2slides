import type { AnnaHost } from "../anna";
import { createLlmClient, type LlmClientOptions } from "../llm/client";
import { PROMPTS } from "../prompts/generated";
import { compressionValidator } from "../schema/compress";
import { LAYOUTS } from "../schema/layouts";
import { outlineValidator } from "../schema/outline";
import { slideValidator } from "../schema/slide";
import { understandingValidator } from "../schema/understanding";
import { requireValid, SchemaError, type Validator } from "../schema/validation";
import type {
  Emphasis, Evidence, LlmCallLog, Outline, OutlineItem, Paper, PaperModule, Retriever, Slide, Understanding,
} from "../types";
import { batchBySection, formatEvidence } from "./evidence";

export type OutputLanguage = "zh" | "en";
export const DEFAULT_UNDERSTAND_MAX_CHARS = 60_000;
const MIN_MERGE_CHARS = 24_000;
const TOP_K = 8;

export interface PipelineCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): unknown;
}

export interface PipelineProgress {
  phase: "section" | "merge" | "understand" | "outline" | "slides" | "compress";
  completed: number;
  total: number;
  cacheHit?: boolean;
  outlineId?: string;
}

export interface PipelineOptions {
  host: AnnaHost;
  retriever: Retriever;
  cache?: PipelineCache;
  onProgress?: (progress: PipelineProgress) => void;
  llm?: LlmClientOptions;
  /** Limit for formatted paper evidence in one understanding request (minimum 256). */
  understandMaxChars?: number;
}

interface Brief {
  modules: PaperModule[];
}

function groupBriefs(briefs: readonly Brief[], limit: number): Brief[][] {
  const groups: Brief[][] = [];
  let group: Brief[] = [];
  let length = 2;
  for (const brief of briefs) {
    const size = JSON.stringify(brief).length + 1;
    if (group.length && length + size > limit) {
      groups.push(group);
      group = [];
      length = 2;
    }
    group.push(brief);
    length += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

function briefIds(briefs: readonly Brief[], paperIds: ReadonlySet<string>): Set<string> {
  return new Set(briefs.flatMap(({ modules }) =>
    modules.flatMap(({ points }) => points.flatMap(({ evidenceIds }) => evidenceIds))).filter((id) => paperIds.has(id)));
}

async function hashInput(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One instance per paper/session. Call understand -> generateOutline, let the user edit,
 * then generateSlides. run() performs the same stages without a confirmation pause.
 */
export function createPipeline(paper: Paper, options: PipelineOptions) {
  const {
    host, retriever, cache, onProgress, llm, understandMaxChars = DEFAULT_UNDERSTAND_MAX_CHARS,
  } = options;
  if (!Number.isSafeInteger(understandMaxChars) || understandMaxChars < 256) {
    throw new RangeError("论文分批字符上限必须是至少 256 的整数。");
  }
  const llmCalls: LlmCallLog[] = [];
  const client = createLlmClient(host, {
    ...llm,
    onCall(log) {
      llmCalls.push(log);
      llm?.onCall?.(log);
    },
  });
  const blocksById = new Map(paper.blocks.map((block) => [block.id, block]));
  const allEvidenceIds = new Set(blocksById.keys());
  const evidenceText = new Map(paper.blocks.map(({ id, text }) => [id, text]));
  const figures = paper.figures.filter((figure) =>
    figure.cropOk && figure.imageDataUrl && blocksById.get(figure.captionEvidenceId)?.type === "caption");
  const figureIds = new Set(figures.map(({ id }) => id));
  const figureMetadata = figures.map(({ id, label, page, captionEvidenceId }) => ({
    id, label, page, captionEvidenceId,
    caption: Array.from(blocksById.get(captionEvidenceId)!.text).slice(0, 200).join(""),
  }));
  const paperMetadata = JSON.stringify({ title: paper.title, authors: paper.authors });
  // One in-flight request per identical step, including when a cache adapter is absent.
  const pending = new Map<string, Promise<{ value: unknown; cacheHit: boolean }>>();

  async function step<T>(
    promptId: "understand" | "outline" | "slide" | "compress",
    vars: Record<string, string>,
    validate: Validator<T>,
    maxTokens?: number,
  ): Promise<{ value: T; cacheHit: boolean }> {
    const compiled = PROMPTS[promptId]!;
    const prompt = maxTokens === undefined ? compiled : { ...compiled, maxTokens };
    const input = JSON.stringify({ vars, maxTokens: prompt.maxTokens, responseFormat: llm?.responseFormat });
    const hash = cache ? await hashInput(input) : input;
    const key = `${paper.id}:${prompt.id}@${prompt.version}:${hash}`;
    const existing = pending.get(key);
    if (existing) {
      const result = await existing;
      return { ...result, value: validate(result.value).value };
    }
    const request = (async () => {
      const cached = await cache?.get(key);
      if (cached != null) {
        try {
          return { value: validate(cached).value, cacheHit: true };
        } catch (error) {
          if (!(error instanceof SchemaError)) throw error;
        }
      }
      const value = await client.complete(prompt, vars, validate);
      await cache?.set(key, value);
      return { value, cacheHit: false };
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  }

  function completed<T>(result: { value: T; cacheHit: boolean }, progress: PipelineProgress): T {
    onProgress?.({ ...progress, cacheHit: result.cacheHit });
    return result.value;
  }

  async function understand(language: OutputLanguage): Promise<Understanding> {
    requireValid(paper.blocks.length > 0, "论文", "没有可供理解的正文证据");
    const source = formatEvidence(paper.blocks);
    const request = (mode: string, input: string, ids: ReadonlySet<string>, brief = false) =>
      step("understand", {
        language, mode, paper_metadata: paperMetadata, evidence_blocks: input, detail: brief ? "brief" : "full",
      }, understandingValidator(ids, brief), brief ? 2048 : undefined);
    onProgress?.({ phase: "understand", completed: 0, total: 1 });
    if (source.length <= understandMaxChars) {
      return completed(await request("full", source, allEvidenceIds), { phase: "understand", completed: 1, total: 1 });
    }

    const batches = batchBySection(paper.blocks, understandMaxChars);
    const briefs: Brief[] = [];
    onProgress?.({ phase: "section", completed: 0, total: batches.length });
    for (const [index, batch] of batches.entries()) {
      const section = completed(await request("section", batch.input, batch.ids, true), {
        phase: "section", completed: index + 1, total: batches.length,
      });
      briefs.push({ modules: section.modules });
    }
    const mergeLimit = Math.max(understandMaxChars, MIN_MERGE_CHARS);
    let groups = groupBriefs(briefs, mergeLimit);
    while (groups.length > 1) {
      const merged: Brief[] = [];
      onProgress?.({ phase: "merge", completed: 0, total: groups.length });
      for (const [index, group] of groups.entries()) {
        const brief = group.length === 1 ? group[0]! : {
          modules: completed(await request("section_summaries", JSON.stringify(group), briefIds(group, allEvidenceIds), true), {
            phase: "merge", completed: index + 1, total: groups.length,
          }).modules,
        };
        if (group.length === 1) onProgress?.({ phase: "merge", completed: index + 1, total: groups.length });
        merged.push(brief);
      }
      const next = groupBriefs(merged, mergeLimit);
      requireValid(next.length < groups.length || merged.length < groups.flat().length,
        "章节摘要", "摘要仍超出合并预算，无法继续压缩");
      groups = next;
    }
    const finalBriefs = groups[0]!;
    return completed(await request("section_summaries", JSON.stringify(finalBriefs), briefIds(finalBriefs, allEvidenceIds)), {
      phase: "understand", completed: 1, total: 1,
    });
  }

  async function generateOutline(
    understanding: Understanding, emphasis: Emphasis, language: OutputLanguage,
  ): Promise<Outline> {
    const kinds = understanding.modules.map(({ kind }) => kind);
    requireValid(kinds.length > 0, "modules", "正文中未识别出可用于汇报的内容模块");
    onProgress?.({ phase: "outline", completed: 0, total: 1 });
    return completed(await step("outline", {
      language, emphasis, understanding: JSON.stringify(understanding), figures: JSON.stringify(figureMetadata),
    }, outlineValidator(emphasis, kinds, figureIds)), { phase: "outline", completed: 1, total: 1 });
  }

  async function selectEvidence(item: OutlineItem, modules: readonly PaperModule[]): Promise<Evidence[]> {
    const hits = await retriever.search(`${item.intent} ${item.title}`, TOP_K);
    const selected = new Set(hits.slice(0, TOP_K).map(({ evidenceId }) => evidenceId));
    for (const module of modules) {
      if (!item.modules.includes(module.kind)) continue;
      for (const point of module.points) {
        for (const id of point.evidenceIds) selected.add(id);
      }
    }
    const preferred = figures.find(({ id }) => id === item.figureId);
    if (preferred) selected.add(preferred.captionEvidenceId);
    return [...selected].flatMap((id) => {
      const block = blocksById.get(id);
      return block ? [block] : [];
    });
  }

  async function generateSlides(understanding: Understanding, outline: Outline, language: OutputLanguage): Promise<Slide[]> {
    const kinds = understanding.modules.map(({ kind }) => kind);
    const { items } = outlineValidator(outline.emphasis, kinds, figureIds, true)(outline).value;
    const slides: Slide[] = [];
    const total = items.length;
    onProgress?.({ phase: "slides", completed: 0, total });
    for (const item of items) {
      const evidence = await selectEvidence(item, understanding.modules);
      const titlePage = item.modules.length === 0;
      requireValid(titlePage || evidence.length > 0, item.id, "没有可用于该页的论文证据");
      const ids = new Set(evidence.map(({ id }) => id));
      const available = titlePage ? [] : figureMetadata.filter(({ captionEvidenceId }) => ids.has(captionEvidenceId));
      const rules = slideValidator({
        outlineId: item.id, titlePage, evidenceIds: ids, evidenceText, figureIds: new Set(available.map(({ id }) => id)),
      });
      const result = await step("slide", {
        language, outline_item: JSON.stringify(item), paper_metadata: paperMetadata,
        figures: JSON.stringify(available), evidence_blocks: formatEvidence(evidence),
        layouts: JSON.stringify(LAYOUTS),
      }, rules);
      const slide = completed(result, { phase: "slides", completed: slides.length + 1, total, outlineId: item.id });
      if (titlePage && language === "zh") {
        const maxChars = LAYOUTS.title.slots.subtitle!.maxChars;
        const chars = Array.from(understanding.oneLiner.trim());
        const subtitle = chars.length <= maxChars ? chars.join("") : chars.slice(0, maxChars - 1).join("").trimEnd() + "…";
        slides.push({ ...slide, slots: { ...slide.slots, subtitle } });
      } else {
        slides.push(slide);
      }
    }
    return slides;
  }

  async function compressSlide(slide: Slide, overflowingSlots: readonly string[], language: OutputLanguage): Promise<Slide> {
    if (overflowingSlots.length === 0) return slide;
    const rules = slideValidator({
      outlineId: slide.outlineId, titlePage: slide.layout === "title", evidenceIds: allEvidenceIds, evidenceText, figureIds,
    });
    const original = rules(slide).value;
    const slots = [...new Set(overflowingSlots)].sort();
    requireValid(slots.every((name) => Object.hasOwn(original.slots, name)), "overflowingSlots", "应为该页已填的槽位");
    onProgress?.({ phase: "compress", completed: 0, total: 1, outlineId: slide.outlineId });
    return completed(await step("compress", {
      language, slide: JSON.stringify(original), overflowing_slots: JSON.stringify(slots),
    }, compressionValidator(original, slots, rules)), {
      phase: "compress", completed: 1, total: 1, outlineId: slide.outlineId,
    });
  }

  async function run(language: OutputLanguage, emphasis: Emphasis = "balanced") {
    const understanding = await understand(language);
    const outline = await generateOutline(understanding, emphasis, language);
    const slides = await generateSlides(understanding, outline, language);
    return { understanding, outline, slides, llmCalls: getLlmCalls() };
  }

  function getLlmCalls(): LlmCallLog[] {
    return [...llmCalls];
  }

  return { understand, generateOutline, generateSlides, compressSlide, run, getLlmCalls };
}
