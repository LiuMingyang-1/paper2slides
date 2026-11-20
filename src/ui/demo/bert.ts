import type { AnnaHost, LlmCompleteArgs } from "../../anna";
import type { Emphasis, Outline, OutlineItem, Paper, PaperModule, Point, Slide } from "../../types";
import type { OutputLanguage } from "../../pipeline/pipeline";
import bert from "../../../eval/papers/bert.parsed.json";
import pdfUrl from "../../../eval/papers/bert.pdf?url";

export function demoPaper(): Paper {
  return structuredClone(bert) as unknown as Paper;
}

export async function demoPdf(): Promise<ArrayBuffer> {
  const response = await fetch(pdfUrl);
  if (!response.ok) throw new Error(`BERT PDF (${response.status})`);
  return response.arrayBuffer();
}

const bilingual = (zh: string, en: string) => ({ zh, en });

const topics = {
  problem: {
    title: bilingual("为什么需要双向预训练？", "Why bidirectional pre-training?"),
    intent: "limitations of unidirectional language model pre-training",
    points: [
      ["e1-5", "单向语言模型限制了预训练表示可以利用的上下文。", "Unidirectional language models restrict the power of pre-trained representations."],
    ],
  },
  method: {
    title: bilingual("BERT 如何预训练？", "How BERT is pre-trained"),
    intent: "masked language model and next sentence prediction",
    points: [
      ["e4-14", "随机遮盖输入 token，再预测被遮盖的 token，以学习双向表示。", "Mask input tokens at random and predict the masked tokens to train a deep bidirectional representation."],
      ["e2-1", "掩码语言模型（MLM）融合左右上下文。", "The MLM objective enables the representation to fuse the left and the right context."],
      ["e4-16", "下一句预测（NSP）学习两个句子之间的关系。", "Next Sentence Prediction (NSP) addresses the relationship between two sentences."],
    ],
  },
  experiments: {
    title: bilingual("下游任务表现", "Results on downstream tasks"),
    intent: "BERT GLUE score and downstream benchmarks",
    points: [
      ["e1-2", "BERT 的 GLUE 分数为 80.5%。", "BERT pushes the GLUE score to 80.5%."],
      ["e1-2", "BERT 的 GLUE 分数为 99.9%。", "BERT pushes the GLUE score to 99.9%."],
    ],
  },
  ablation: {
    title: bilingual("消融实验如何设置？", "How the ablation is set up"),
    intent: "ablation No NSP and left-to-right language model",
    points: [
      ["e8-5", "消融实验使用 BERTBASE 架构，对比移除 NSP 等预训练任务设置。", "Ablation over the pre-training tasks uses the BERTBASE architecture."],
      ["e8-9", "LTR & No NSP 使用左侧上下文。", "LTR & No NSP is a left-context-only model."],
    ],
  },
} as const;

type Topic = keyof typeof topics;
const topicOrder: Record<Emphasis, Topic[]> = {
  balanced: ["problem", "method", "experiments", "ablation"],
  method: ["method", "problem", "ablation", "experiments"],
  experiments: ["experiments", "ablation", "method", "problem"],
};
const cover = bilingual("BERT 论文导读", "A closer look at BERT");
const thesis = bilingual("BERT 通过双向预训练获得可微调的语言表示。", "BERT learns deep bidirectional language representations for downstream fine-tuning.");

function moduleFor(kind: Topic, language: OutputLanguage, includeExample = false): PaperModule {
  const entries = topics[kind].points;
  // Keep the deliberately incorrect value out of the understanding response.
  const points: Point[] = entries.filter((_, i) => includeExample || kind !== "experiments" || i === 0)
    .map(([id, zh, en]) => ({ text: language === "zh" ? zh : en, kind: "fact", evidenceIds: [id] }));
  return { kind, points };
}

function reply(args: LlmCompleteArgs): unknown {
  const prompt = String(args.messages[0]?.content);
  const language: OutputLanguage = /(?:由|用) `en`/.test(prompt) ? "en" : "zh";
  const field = (name: string) => new RegExp(`^${name}：(.+)$`, "m").exec(prompt)?.[1];
  const itemJson = field("大纲项");
  if (itemJson) {
    const item = JSON.parse(itemJson) as OutlineItem;
    const base = { id: item.id, outlineId: item.id };
    if (!item.modules.length) {
      return { ...base, layout: "title", slots: { title: item.title, authors: bert.authors.join(" · ") } } satisfies Slide;
    }
    const kind = item.modules[0] as Topic;
    const points = moduleFor(kind, language, true).points;
    if (kind === "experiments") {
      const label = bilingual("BERT 的 GLUE 分数", "BERT GLUE score")[language];
      return {
        ...base, layout: "key_numbers",
        slots: { title: item.title, numbers: [
          { ...points[0]!, text: `80.5% | ${label}` },
          { ...points[1]!, text: `99.9% | ${label}` },
        ] },
      } satisfies Slide;
    }
    if (kind === "ablation") {
      return {
        ...base, layout: "two_column",
        slots: {
          title: item.title,
          leftHeading: bilingual("移除 NSP", "Removing NSP")[language],
          left: [points[0]!],
          rightHeading: bilingual("单向上下文", "Left-to-right context")[language],
          right: [points[1]!],
        },
      } satisfies Slide;
    }
    return { ...base, layout: "bullets", slots: { title: item.title, bullets: points } } satisfies Slide;
  }
  const emphasis = field("侧重点") as Emphasis | undefined;
  if (emphasis && Object.hasOwn(topicOrder, emphasis)) {
    const items: OutlineItem[] = [{ id: "s1", title: cover[language], intent: cover[language], modules: [] }];
    for (const kind of topicOrder[emphasis]) {
      const topic = topics[kind];
      items.push({ id: `s${items.length + 1}`, title: topic.title[language], intent: topic.intent, modules: [kind] });
    }
    return { items, emphasis } satisfies Outline;
  }
  const slideJson = field("原 Slide");
  if (slideJson) return JSON.parse(slideJson);
  const evidence = /<evidence>\s*([\s\S]*?)<\/evidence>/.exec(prompt)?.[1] ?? "";
  const modules = topicOrder.balanced.map((kind) => moduleFor(kind, language))
    .map(({ kind, points }) => ({ kind, points: points.filter(({ evidenceIds }) =>
      evidence.includes(`[${evidenceIds[0]}]`) || evidence.includes(`"${evidenceIds[0]}"`)) }))
    .filter(({ points }) => points.length);
  return { title: bert.title, oneLiner: thesis[language], modules };
}

export function demoHost(): AnnaHost {
  const values = new Map<string, unknown>();
  return {
    llm: {
      async complete(args) {
        await new Promise((resolve) => setTimeout(resolve, 170));
        return {
          role: "assistant", content: { type: "text", text: JSON.stringify(reply(args)) },
          stopReason: "endTurn", model: "bert-fixture", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          _meta: { quotaConsumed: 0 },
        };
      },
      async embed() { throw new Error("Demo embeddings unavailable"); },
    },
    storage: {
      async get({ key }) { return { value: values.get(key) }; },
      async set({ key, value }) { values.set(key, value); },
    },
    upload: { async inline() { throw new Error("Demo uses local downloads"); } },
    window: { async set_title() {} },
  };
}
