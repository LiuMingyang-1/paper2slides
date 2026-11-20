/// <reference types="vite/client" />
import type { Deck, Evidence, Paper, Point, Slide } from "../types";
import { verifyDeck } from "../verify/citation";
import fixturePng from "./fixture-figure.base64?raw";

const source = (id: string, page: number, text: string, type: Evidence["type"] = "text"): Evidence =>
  ({ id, page, text, type, sectionPath: [], bbox: [0, 0, 1, 1] });
const blocks = [
  source("e2-1", 2, "所有文档按段落切分并保留页码。"),
  source("e2-2", 2, "候选段落先按词面匹配召回，再按语义相似度重排。"),
  source("e3-1", 3, "图 1 展示两种检索方法的 Recall@10。", "caption"),
  source("e4-1", 4, "单路召回 | 72.6% | 68 ms", "table"),
  source("e4-2", 4, "混合召回 | 81.6% | 84 ms", "table"),
  source("e5-1", 5, "评估集包含人工标注的查询与相关段落。"),
];
export const fixturePaper: Paper = {
  id: "fixture", title: "长文档检索的两阶段评估", authors: ["许宁", "周言"], pageCount: 5, bodyPageCount: 5,
  blocks,
  figures: [{ id: "fig1", label: "图 1", page: 3, captionEvidenceId: "e3-1", cropOk: true, imageDataUrl: `data:image/png;base64,${fixturePng.trim()}` }],
  warnings: [],
};

const fact = (text: string, ...evidenceIds: string[]): Point => ({ kind: "fact", text, evidenceIds });
const slides: Slide[] = [
  {
    id: "s1", outlineId: "o1", layout: "title",
    slots: { title: fixturePaper.title, authors: fixturePaper.authors.join(" · ") },
    notes: "演示使用虚构的论文数据。",
  },
  {
    id: "s2", outlineId: "o2", layout: "bullets",
    slots: {
      title: "文档处理与候选召回",
      bullets: [
        fact(blocks[0]!.text, "e2-1"),
        fact(blocks[1]!.text, "e2-2"),
        { kind: "opinion", text: "可以按页回溯候选段落。", evidenceIds: ["e2-1"] },
      ],
    },
  },
  {
    id: "s3", outlineId: "o3", layout: "bullets_figure", figureId: "fig1",
    slots: {
      title: "Recall@10 随检索策略变化",
      bullets: [fact("混合召回的 Recall@10 为 81.6%。", "e4-2"), fact("单路召回的 Recall@10 为 72.6%。", "e4-1")],
      caption: [fact(blocks[2]!.text, "e3-1")],
    },
  },
  {
    id: "s4", outlineId: "o4", layout: "key_numbers",
    slots: {
      title: "混合召回的主要指标",
      numbers: [fact("81.6% | 混合召回的 Recall@10", "e4-2"), fact("84 ms | 混合召回的单次查询时延", "e4-2")],
      context: [fact(blocks[5]!.text, "e5-1")],
    },
  },
  {
    id: "s5", outlineId: "o5", layout: "table",
    slots: {
      title: "召回率与时延",
      headers: "策略 | Recall@10 | 单次查询时延",
      rows: [fact(blocks[3]!.text, "e4-1"), fact(blocks[4]!.text, "e4-2")],
    },
  },
  {
    id: "s6", outlineId: "o6", layout: "two_column",
    slots: {
      title: "评估设置与证据边界",
      leftHeading: "评估数据",
      left: [fact(blocks[5]!.text, "e5-1"), { kind: "summary", text: "人工判断给出了检索任务的参考结果。", evidenceIds: ["e5-1"] }],
      rightHeading: "时延核验",
      right: [fact("单路召回的查询时延为 68 ms。", "e4-1"), fact("混合召回的查询时延为 70 ms。", "e4-2")],
    },
  },
];
export const fixtureDeck: Deck = {
  paperId: fixturePaper.id,
  slides,
  verifications: verifyDeck(slides, new Map(blocks.map((block) => [block.id, block]))),
  llmCalls: [],
};
