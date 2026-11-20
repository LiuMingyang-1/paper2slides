import type { ModuleKind, ParseWarningCode, VerifyStatus } from "../types";

export const strings = {
  zh: {
    product: "论文汇报工作台", workspace: "Anna 工作区", demoMode: "离线 Demo", standalone: "独立预览",
    source: "论文 PDF", outline: "确认大纲", slides: "预览与导出", prepare: "准备论文",
    hero: "从论文到组会幻灯片", heroDetail: "上传论文 PDF，编辑汇报大纲，再逐条检查幻灯片的证据和数字。",
    choose: "选择 PDF", drop: "将 PDF 拖到这里", maxSize: "带文字层的 PDF，最大 25 MiB",
    demo: "试用 BERT Demo", demoDetail: "用内置论文走完整个流程，消耗额度为 0。",
    file: "源文件", newPaper: "更换论文", parsing: "正在读取 PDF", cropping: "正在整理证据与截取图表",
    parsed: "论文已解析", pages: "正文页", blocks: "证据块", start: "理解论文并生成大纲",
    lang: "输出语言", emphasis: "汇报侧重点", balanced: "均衡", method: "方法优先", experiments: "实验优先",
    quota: "累计额度", calls: "调用日志", saveLogs: "下载 JSON", attempts: "次调用记录",
    setupEstimate: "预计理解与大纲调用", fullEstimate: "预计完整流程调用", slideEstimate: "预计逐页生成调用",
    estimateHint: "按无缓存估算。重试、长文合并和压缩可能增加调用。",
    times: "次", understand: "理解论文", section: "提炼章节", merge: "合并摘要",
    outlining: "生成大纲", generating: "逐页生成", compress: "压缩溢出页", fitting: "检查排版",
    cached: "读取缓存", understanding: "论文理解", confirm: "编辑汇报大纲", outlineHelp: "可编辑标题、调整内容页顺序或删除内容页。标题页固定在首页。",
    title: "页面标题", up: "上移", down: "下移", remove: "删除",
    update: "应用设置并刷新大纲", settingsChanged: "应用新设置后即可生成幻灯片。",
    generate: "生成幻灯片", back: "返回大纲", thumbnails: "幻灯片", preview: "幻灯片预览",
    pdf: "原文 PDF", previous: "上一页", next: "下一页", loading: "正在加载原文…", pdfError: "原文加载失败。",
    checks: "引用核验", failures: "全部未通过", allClear: "没有未通过的要点。", oneSlide: "本页",
    supported: "已支持", partial: "部分支持", unsupported: "未通过",
    noSource: "没有可定位的原文。", citations: "原文出处", opinion: "解读", continuation: "（续）",
    export: "导出 PPTX", exporting: "正在导出 PPTX", download: "下载 PPTX",
    overflow: "以下页面仍有内容溢出。请返回大纲调整标题或删去相关页面。",
    compressError: "部分页面未能通过压缩修复，已尝试拆页。",
    large: "PDF 文件超过 25 MiB。", invalid: "请选择有效的 PDF 文件。", failed: "操作失败",
    demoError: "演示加载失败。", processing: "处理中…",
    fileHint: "继续以前的工作时，请重新选择同一 PDF。",
    fixtureHint: "演示包含一条刻意写错的实验数字，用于查看核验结果。",
  },
  en: {
    product: "Research presentation workspace", workspace: "Anna workspace", demoMode: "Offline demo", standalone: "Standalone",
    source: "Source PDF", outline: "Review outline", slides: "Preview & export", prepare: "Prepare your paper",
    hero: "From paper to lab meeting", heroDetail: "Upload a paper, edit the presentation outline, and check the evidence and numbers behind each slide.",
    choose: "Choose PDF", drop: "Drop a PDF here", maxSize: "Searchable PDF, up to 25 MiB",
    demo: "Try the BERT demo", demoDetail: "Use the bundled paper to try the complete workflow with zero quota usage.",
    file: "Source file", newPaper: "Change paper", parsing: "Reading PDF", cropping: "Organizing evidence and cropping figures",
    parsed: "Paper parsed", pages: "body pages", blocks: "evidence blocks", start: "Analyze paper and draft outline",
    lang: "Output language", emphasis: "Presentation focus", balanced: "Balanced", method: "Methods first", experiments: "Experiments first",
    quota: "Quota used", calls: "Call logs", saveLogs: "Download JSON", attempts: "call records",
    setupEstimate: "Estimated analysis and outline calls", fullEstimate: "Estimated calls for the full workflow", slideEstimate: "Estimated slide generation calls",
    estimateHint: "Estimates assume a cold cache. Retries, long-paper merges, and compression can increase call counts.",
    times: "calls", understand: "Analyzing paper", section: "Summarizing sections", merge: "Merging summaries",
    outlining: "Drafting outline", generating: "Generating slides", compress: "Compressing overflowing slide", fitting: "Checking layout",
    cached: "Cache hit", understanding: "Paper analysis", confirm: "Edit presentation outline",
    outlineHelp: "Edit titles, reorder content slides, or remove them. The cover stays first.",
    title: "Slide title", up: "Move up", down: "Move down", remove: "Remove",
    update: "Apply settings and refresh outline", settingsChanged: "Apply the new settings before generating slides.",
    generate: "Generate slides", back: "Back to outline", thumbnails: "Slides", preview: "Slide preview",
    pdf: "Source PDF", previous: "Previous page", next: "Next page", loading: "Loading source…", pdfError: "Failed to load the source PDF.",
    checks: "Citation verification", failures: "All failed claims", allClear: "No failed claims.", oneSlide: "On this slide",
    supported: "Supported", partial: "Partially supported", unsupported: "Unsupported",
    noSource: "No source location available.", citations: "Source evidence", opinion: "Interpretation", continuation: "(continued)",
    export: "Export PPTX", exporting: "Exporting PPTX", download: "Download PPTX",
    overflow: "These slides still overflow. Return to the outline to shorten the titles or remove the affected slides.",
    compressError: "Compression failed on some slides. The app attempted to split them.",
    large: "The PDF exceeds 25 MiB.", invalid: "Choose a valid PDF file.", failed: "Operation failed",
    demoError: "The demo could not load.", processing: "Working…",
    fileHint: "Choose the same PDF to resume earlier work.",
    fixtureHint: "The demo includes one intentionally incorrect result to illustrate verification.",
  },
} as const;

export type Language = keyof typeof strings;

const modules: Record<ModuleKind, [string, string]> = {
  problem: ["研究问题", "Research problem"], method: ["方法", "Methods"], theory: ["理论", "Theory"],
  experiments: ["实验", "Experiments"], ablation: ["消融", "Ablation"], taxonomy: ["分类框架", "Taxonomy"],
  limitations: ["局限", "Limitations"], future_work: ["未来工作", "Future work"],
};

export function moduleName(kind: ModuleKind, language: Language) {
  return modules[kind][language === "zh" ? 0 : 1];
}

const warnings: Record<ParseWarningCode, string> = {
  NOT_LIKELY_PAPER: "This document may not be a research paper.",
  REFERENCES_NOT_FOUND: "No references heading was detected.",
  TRUNCATED_LONG_DOC: "Only the first 40 body pages were analyzed.",
  LOW_TEXT_PAGES: "Some pages contain very little readable text.",
  FIGURE_CROP_FAILED: "Some figures could not be cropped. Their captions remain citable.",
};

export function warningText(code: ParseWarningCode) {
  return warnings[code];
}

export const glyph: Record<VerifyStatus, string> = { supported: "✅", partial: "⚠️", unsupported: "❌" };

export const failureText = {
  NOT_PDF: "This file is not a PDF.",
  ENCRYPTED: "Upload an unencrypted copy of this PDF.",
  CORRUPT: "The PDF is damaged or unreadable.",
  SCANNED_NO_TEXT: "Most pages lack a searchable text layer.",
  TOO_LARGE: "The PDF exceeds 25 MiB.",
  quota_exceeded: "Anna quota is exhausted. Cached steps are available when quota resets.",
  invalid_output: "The model returned invalid output.",
  truncated: "The model response exceeded the output limit.",
  timeout: "Anna timed out.",
  network: "Could not connect to Anna.",
  host: "The Anna request failed.",
};
