// Shared contracts between modules. Changing these requires coordinating
// every module that imports them — keep changes additive.

// ---------- Parsing ----------

export type EvidenceType = "text" | "table" | "caption" | "equation";

/** A citable chunk of the paper. id format: "e{page}-{index}", e.g. "e4-12". */
export interface Evidence {
  id: string;
  type: EvidenceType;
  /** e.g. ["4 Experiments", "4.2 Ablation"]; [] when unknown. */
  sectionPath: string[];
  /** 1-based PDF page number. */
  page: number;
  text: string;
  /** PDF user-space bbox on that page: [x0, y0, x1, y1] (origin bottom-left). */
  bbox: [number, number, number, number];
}

export interface Figure {
  id: string; // "fig3"
  label: string; // "Figure 3"
  page: number;
  captionEvidenceId: string;
  /** PNG data URL of the cropped figure region; absent when cropping failed. */
  imageDataUrl?: string;
  cropOk: boolean;
}

export interface Paper {
  /** sha256 hex of the PDF bytes — also the cache key. */
  id: string;
  title: string;
  authors: string[];
  pageCount: number;
  /** Pages processed (body only, references and beyond excluded). */
  bodyPageCount: number;
  blocks: Evidence[];
  figures: Figure[];
  warnings: ParseWarning[];
}

export type ParseWarningCode =
  | "NOT_LIKELY_PAPER"
  | "REFERENCES_NOT_FOUND"
  | "TRUNCATED_LONG_DOC"
  | "LOW_TEXT_PAGES"
  | "FIGURE_CROP_FAILED";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  pages?: number[];
}

export type ParseErrorCode =
  | "NOT_PDF"
  | "ENCRYPTED"
  | "CORRUPT"
  | "SCANNED_NO_TEXT"
  | "TOO_LARGE";

export class ParseError extends Error {
  constructor(public code: ParseErrorCode, message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ---------- Understanding / outline ----------

export type ModuleKind =
  | "problem"
  | "method"
  | "theory"
  | "experiments"
  | "ablation"
  | "taxonomy"
  | "limitations"
  | "future_work";

export type PointKind = "fact" | "summary" | "opinion";

export interface Point {
  text: string;
  kind: PointKind;
  evidenceIds: string[];
}

export interface PaperModule {
  kind: ModuleKind;
  points: Point[];
}

export interface Understanding {
  title: string;
  oneLiner: string;
  modules: PaperModule[];
}

export type Emphasis = "balanced" | "method" | "experiments";

export interface OutlineItem {
  id: string; // "s1"
  title: string;
  /** Which understanding modules this slide draws from. */
  modules: ModuleKind[];
  /** Short intent shown to the user and used as retrieval query. */
  intent: string;
  figureId?: string;
}

export interface Outline {
  emphasis: Emphasis;
  items: OutlineItem[];
}

// ---------- Slides ----------

export type LayoutId =
  | "title"
  | "bullets"
  | "bullets_figure"
  | "key_numbers"
  | "table"
  | "two_column";

/** Slot value: plain string (titles/captions) or citable points. */
export type SlotValue = string | Point[];

export interface Slide {
  id: string;
  outlineId: string;
  layout: LayoutId;
  slots: Record<string, SlotValue>;
  figureId?: string;
  notes?: string;
}

// ---------- Verification ----------

export type VerifyStatus = "supported" | "partial" | "unsupported";

export interface NumberCheck {
  value: string; // as written in the point
  found: boolean;
}

export interface PointVerification {
  slideId: string;
  slot: string;
  pointIndex: number;
  status: VerifyStatus;
  /** 0..1 lexical support score against cited evidence. */
  matchScore: number;
  missingEvidenceIds: string[];
  numbers: NumberCheck[];
  reason: string;
}

// ---------- LLM ----------

export interface LlmCallLog {
  promptId: string;
  promptVersion: number;
  startedAt: string;
  inputTokens: number;
  outputTokens: number;
  quotaConsumed: number | null;
  latencyMs: number;
  stopReason: string | null;
  ok: boolean;
  attempt: number;
  error?: string;
  /** Well-formed references absent from the evidence supplied to this step. */
  missingEvidenceIds?: string[];
}

export interface Deck {
  paperId: string;
  slides: Slide[];
  verifications: PointVerification[];
  llmCalls: LlmCallLog[];
}

// ---------- Retrieval ----------

export interface RetrievalHit {
  evidenceId: string;
  score: number;
}

export interface RetrievalFilter {
  type?: EvidenceType;
  /** An exact prefix of the evidence's section path. */
  sectionPath?: readonly string[];
}

export interface Retriever {
  search(query: string, k: number): Promise<RetrievalHit[]>;
  search(query: string, k: number, filter?: RetrievalFilter): Promise<RetrievalHit[]>;
}
