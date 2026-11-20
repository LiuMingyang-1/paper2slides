import type { LayoutId } from "../types";

export type SlotDefinition = Readonly<{
  required: boolean;
  /** Unicode code points, including punctuation and spaces. For points, applies to each Point.text. */
  maxChars: number;
} & ({ type: "string" } | { type: "points"; minItems: number; maxItems: number })>;

export interface LayoutDefinition {
  readonly description: string;
  /** True iff Slide.figureId is required. Resolve it against Paper.figures. */
  readonly requiresFigure: boolean;
  readonly slots: Readonly<Record<string, SlotDefinition>>;
}

const title = { type: "string", required: true, maxChars: 60 } as const;
const bullets = { type: "points", required: true, maxChars: 180, minItems: 1, maxItems: 5 } as const;
const takeaway = { type: "points", required: false, maxChars: 80, minItems: 1, maxItems: 1 } as const;
const column = { type: "points", required: true, maxChars: 100, minItems: 1, maxItems: 3 } as const;

/**
 * Shared T3/T4 contract. Keys are Slide.slots names; optional slots are omitted when empty.
 * String slots are labels or bibliographic metadata. Render Point[] in order and attach
 * each point's evidence/verification to the displayed item, including table rows.
 * For tables, split headers and each row's text on "|" and trim cells (2–4 columns);
 * for key numbers, split at the single "|" to style the value separately from its label.
 * maxChars/maxItems constrain model output. T4 still measures actual pixel overflow.
 */
export const LAYOUTS: Readonly<Record<LayoutId, LayoutDefinition>> = {
  title: {
    description: "标题页",
    requiresFigure: false,
    slots: {
      // Cover keeps the full paper title (often > 60 chars, e.g. BERT's is 80);
      // the 60-char conclusion-title limit applies to content slides only.
      title: { ...title, maxChars: 180 },
      subtitle: { type: "string", required: false, maxChars: 120 },
      authors: { type: "string", required: false, maxChars: 160 },
    },
  },
  bullets: {
    description: "纯文字要点，适于图截取失败或没有合适原图",
    requiresFigure: false,
    slots: { title, bullets, takeaway },
  },
  bullets_figure: {
    description: "要点配论文原图，也用于论文的框架图",
    requiresFigure: true,
    slots: {
      title,
      bullets: { ...bullets, maxItems: 3, maxChars: 140 },
      takeaway,
      caption: { type: "points", required: false, maxChars: 105, minItems: 1, maxItems: 1 },
    },
  },
  key_numbers: {
    description: "关键数字，numbers 的每条 text 为「数值 | 指标及条件」",
    requiresFigure: false,
    slots: {
      title,
      numbers: { type: "points", required: true, maxChars: 115, minItems: 1, maxItems: 3 },
      context: { type: "points", required: false, maxChars: 120, minItems: 1, maxItems: 2 },
    },
  },
  table: {
    description: "结果表，headers 和每行 text 都用 | 分隔 2–4 列，每行单独引用",
    requiresFigure: false,
    slots: {
      title,
      headers: { type: "string", required: true, maxChars: 100 },
      rows: { type: "points", required: true, maxChars: 125, minItems: 1, maxItems: 5 },
    },
  },
  two_column: {
    description: "同维度对比或有明确分组的框架",
    requiresFigure: false,
    slots: {
      title,
      leftHeading: { type: "string", required: true, maxChars: 55 },
      left: column,
      rightHeading: { type: "string", required: true, maxChars: 55 },
      right: column,
    },
  },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];
