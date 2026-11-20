import type { AnnaHost } from "../anna";
import { createPipeline, DEFAULT_UNDERSTAND_MAX_CHARS, type PipelineProgress } from "../pipeline/pipeline";
import { batchBySection, formatEvidence } from "../pipeline/evidence";
import { PROMPTS } from "../prompts/generated";
import { HybridRetriever } from "../retrieval/hybrid";
import { outlineValidator } from "../schema/outline";
import { createCache, sha256 } from "../store/cache";
import type { Deck, Emphasis, LlmCallLog, Outline, Paper, Understanding } from "../types";
import { verifyDeck } from "../verify/citation";
import { base64, button, download, el } from "./dom";
import { renderPreview } from "./preview";
import { exportSlides, PPTX_MIME, resolveOverflow } from "./slides-adapter";
import { failureText, moduleName, strings, warningText, type Language } from "./strings";

const MAX_BYTES = 25 * 1024 * 1024;
type Preview = ReturnType<typeof renderPreview>;
type ProgressLabel = "parsing" | "cropping" | "understand" | "section" | "merge" | "outlining" | "generating" | "compress" | "fitting" | "exporting";
const phases: Record<PipelineProgress["phase"], ProgressLabel> = {
  understand: "understand", section: "section", merge: "merge", outline: "outlining", slides: "generating", compress: "compress",
};

function editedOutlineKey(paper: Paper, language: Language, emphasis: Emphasis) {
  return `${paper.id}:edited:${PROMPTS.understand!.version}:${PROMPTS.outline!.version}:${language}:${emphasis}`;
}

export function mountApp(root: HTMLElement, host: AnnaHost | null) {
  const hostCache = createCache(host?.storage);
  const demoCache = createCache();
  const logs: LlmCallLog[] = [];
  let quota = 0;
  let hasUnknownQuota = false;
  let language: Language = "zh";
  let output: Language = "zh";
  let emphasis: Emphasis = "balanced";
  let draftedFor: Language | undefined;
  let paper: Paper | undefined;
  let bytes: ArrayBuffer | undefined;
  let filename = "";
  let demo = false;
  let busy = false;
  let deck: Deck | undefined;
  let understanding: Understanding | undefined;
  let outline: Outline | undefined;
  let pipeline: ReturnType<typeof createPipeline> | undefined;
  let preview: Preview | undefined;
  let activeSlide = 0;
  let error: unknown;
  let overflow: string[] = [];
  let compressionFailed = false;
  let exportUrl: string | undefined;
  const progressLabel = el("strong");
  const meter = el("progress");
  const progress = el("div", "progress-card", progressLabel, meter);
  progress.setAttribute("aria-live", "polite");
  const quotaLabel = el("span", "usage");
  const t = () => strings[language];
  const cache = () => demo ? demoCache : hostCache;
  const isDirty = () => !!outline && (draftedFor !== output || outline.emphasis !== emphasis);

  function updateQuota() {
    quotaLabel.textContent = `${t().quota}  ${quota}${hasUnknownQuota ? "+" : ""}`;
  }

  function report(label: ProgressLabel, completed?: number, total?: number, cached = false) {
    progressLabel.textContent = `${t()[label]}${total ? ` · ${completed} / ${total}` : ""}${cached ? ` · ${t().cached}` : ""}`;
    if (total) {
      meter.max = total;
      meter.value = completed ?? 0;
    } else meter.removeAttribute("value");
  }

  function message() {
    const code = (error as { code?: keyof typeof failureText } | undefined)?.code;
    if (language === "en" && code && Object.hasOwn(failureText, code)) return failureText[code];
    return error instanceof Error ? error.message : String(error);
  }

  async function run(label: ProgressLabel, action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = undefined;
    report(label);
    render();
    try {
      await action();
    } catch (failure) {
      error = failure;
    } finally {
      busy = false;
      render();
    }
  }

  async function load(file?: File) {
    if (busy) return;
    if (file && file.size > MAX_BYTES) {
      error = new Error(t().large);
      render();
      return;
    }
    if (file && !file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      error = new Error(t().invalid);
      render();
      return;
    }
    if (file && !host) return;
    reset();
    demo = !file;
    filename = file?.name ?? "bert.pdf";
    await run("parsing", async () => {
      let activeHost: AnnaHost;
      if (!file) {
        const fixture = await import("./demo/bert");
        bytes = await fixture.demoPdf();
        paper = fixture.demoPaper();
        activeHost = fixture.demoHost();
      } else {
        activeHost = host!;
        bytes = await file.arrayBuffer();
        const key = `parsed:v1:${await sha256(bytes)}`;
        paper = (await hostCache.get(key)) as Paper | undefined;
        if (!paper) {
          const { parsePdf } = await import("../parser");
          paper = await parsePdf(bytes, {
            maxBytes: MAX_BYTES,
            onProgress: (read, total) => read === total ? report("cropping") : report("parsing", read, total),
          });
          await hostCache.set(key, paper);
        }
      }
      const settings = await cache().get(`${paper.id}:settings`) as { output?: unknown; emphasis?: unknown } | undefined;
      if (settings?.output === "zh" || settings?.output === "en") output = settings.output;
      if (settings?.emphasis === "balanced" || settings?.emphasis === "method" || settings?.emphasis === "experiments") {
        emphasis = settings.emphasis;
      }
      pipeline = createPipeline(paper, {
        host: activeHost,
        // Lexical mode avoids embedding charges before a slide cache hit can be checked.
        retriever: new HybridRetriever(paper.id, paper.blocks),
        cache: cache(),
        onProgress: (event) => report(phases[event.phase], event.completed, event.total, event.cacheHit),
        llm: { onCall(log) {
          logs.push(log);
          quota += log.quotaConsumed ?? 0;
          if (log.quotaConsumed === null) hasUnknownQuota = true;
          updateQuota();
        } },
      });
    });
  }

  function reset() {
    paper = bytes = outline = understanding = pipeline = deck = error = undefined;
    exportUrl = draftedFor = undefined;
    demo = false;
    compressionFailed = false;
    overflow = [];
    activeSlide = 0;
  }

  function draft() {
    return run("understand", async () => {
      const next = await pipeline!.understand(output);
      const generated = await pipeline!.generateOutline(next, emphasis, output);
      const saved = await cache().get(editedOutlineKey(paper!, output, emphasis));
      const figures = new Set(paper!.figures.filter(({ cropOk }) => cropOk).map(({ id }) => id));
      let edited = generated;
      if (saved) {
        try {
          edited = outlineValidator(emphasis, next.modules.map(({ kind }) => kind), figures, true)(saved).value;
        } catch {
          // Incompatible older edits can safely fall back to the generated outline.
        }
      }
      outline = edited;
      understanding = next;
      draftedFor = output;
      await cache().set(`${paper!.id}:settings`, { output, emphasis });
    });
  }

  function generate() {
    if (isDirty() || !outline || outline.items.some(({ title }) => !title.trim())) return;
    return run("generating", async () => {
      await cache().set(editedOutlineKey(paper!, output, emphasis), structuredClone(outline!));
      const slides = await pipeline!.generateSlides(understanding!, outline!, output);
      for (const slide of slides) {
        const item = outline!.items.find(({ id }) => id === slide.outlineId);
        if (item) slide.slots.title = item.title.trim();
      }
      report("fitting");
      const result = await resolveOverflow(slides, paper!, (slide, slots) =>
        pipeline!.compressSlide(slide, slots, output), strings[output].continuation, strings[output].opinion);
      overflow = result.unresolved;
      compressionFailed = result.compressionFailed;
      const evidence = new Map(paper!.blocks.map((item) => [item.id, item]));
      deck = { paperId: paper!.id, slides: result.slides, verifications: verifyDeck(result.slides, evidence), llmCalls: pipeline!.getLlmCalls() };
      activeSlide = 0;
    });
  }

  function exportDeck() {
    return run("exporting", async () => {
      const name = filename.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "_") + ".pptx";
      const blob = await exportSlides(deck!, paper!, strings[output].opinion);
      if (demo) download(blob, name);
      else {
        const result = await host!.upload.inline({ filename: name, mime_type: PPTX_MIME, content_b64: await base64(blob) });
        const url = new URL(result.download_url, location.href);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(t().failed);
        exportUrl = url.href;
      }
    });
  }

  function logsDialog() {
    const modal = el("dialog", "logs-dialog");
    const list = el("pre", "", JSON.stringify(logs, null, 2));
    const save = button(t().saveLogs, () => download(new Blob([list.textContent!], { type: "application/json" }), "paper2slides-calls.json"), "primary");
    const close = button("×", () => modal.close(), "icon");
    close.setAttribute("aria-label", language === "zh" ? "关闭" : "Close");
    modal.append(el("div", "dialog-heading", el("h2", "", t().calls), close),
      el("p", "muted", `${logs.length} ${t().attempts}`), list, save);
    modal.addEventListener("close", () => modal.remove());
    document.body.append(modal);
    modal.showModal();
  }

  function header() {
    updateQuota();
    const langs = el("div", "language-control");
    for (const lang of ["zh", "en"] as const) {
      const toggle = button(lang === "zh" ? "中文" : "EN", () => { language = lang; render(); }, "locale");
      toggle.setAttribute("aria-pressed", String(lang === language));
      langs.append(toggle);
    }
    return el("header", "topbar",
      el("div", "brand", el("span", "brand-icon", "P"), el("div", "", el("strong", "", "Paper2Slides"), el("small", "", t().product))),
      el("div", "top-actions", el("span", "mode", demo ? t().demoMode : host ? t().workspace : t().standalone),
        quotaLabel, button(t().calls, logsDialog, "subtle"), langs));
  }

  function stepper() {
    const stage = deck ? 2 : outline ? 1 : 0;
    return el("ol", "stepper", ...[t().source, t().outline, t().slides].map((label, index) => {
      const item = el("li", index === stage ? "current" : index < stage ? "complete" : "",
        el("span", "step-symbol", index < stage ? "✓" : String(index + 1)), label);
      if (index === stage) item.setAttribute("aria-current", "step");
      return item;
    }));
  }

  function landing() {
    const demoCard = el("section", "demo-card", el("div", "demo-book", el("span", "", "BERT"), el("div", "book-lines")),
      el("div", "", el("h2", "", t().demo), el("p", "", t().demoDetail)),
      button(`${t().demo}  →`, () => { void load(); }, host ? "" : "primary"));
    const intro = el("div", "intro", el("h1", "", t().hero), el("p", "", t().heroDetail));
    if (!host) return el("section", "landing", intro, demoCard);
    const input = el("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.hidden = true;
    input.addEventListener("change", () => { if (input.files?.[0]) void load(input.files[0]); });
    const upload = el("section", "dropzone", input, el("div", "upload-icon", "↑"), el("h2", "", t().drop),
      el("p", "", t().maxSize), button(t().choose, () => input.click(), "primary"));
    upload.addEventListener("dragover", (event) => { event.preventDefault(); upload.classList.add("dragging"); });
    upload.addEventListener("dragleave", () => upload.classList.remove("dragging"));
    upload.addEventListener("drop", (event) => {
      event.preventDefault();
      upload.classList.remove("dragging");
      if (event.dataTransfer?.files[0]) void load(event.dataTransfer.files[0]);
    });
    return el("section", "landing", intro, upload, el("p", "file-hint", t().fileHint), demoCard);
  }

  function controls(onChange: () => void) {
    function select<T extends string>(label: string, selected: T, options: readonly (readonly [T, string])[], change: (value: T) => void) {
      const field = el("select");
      for (const [value, text] of options) {
        const option = el("option", "", text);
        option.value = value;
        field.append(option);
      }
      field.value = selected;
      field.addEventListener("change", () => { change(field.value as T); onChange(); });
      return el("label", "control", label, field);
    }
    return el("div", "settings",
      select<Language>(t().lang, output, [["zh", "简体中文"], ["en", "English"]], (value) => { output = value; }),
      select<Emphasis>(t().emphasis, emphasis, [["balanced", t().balanced], ["method", t().method], ["experiments", t().experiments]],
        (value) => { emphasis = value; }));
  }

  function estimate(label: string, count: string) {
    return el("div", "estimate", el("div", "", label, el("strong", "", `${demo ? 0 : count} ${t().times}`)),
      el("small", "", demo ? t().demoDetail : t().estimateHint));
  }

  function source() {
    const setupCalls = formatEvidence(paper!.blocks).length <= DEFAULT_UNDERSTAND_MAX_CHARS ? 2
      : batchBySection(paper!.blocks, DEFAULT_UNDERSTAND_MAX_CHARS).length + 2;
    return el("section", "source-panel",
      el("div", "document-card", el("span", "document-icon", "PDF"), el("div", "",
        el("p", "muted", t().parsed), el("h1", "", paper!.title), el("p", "authors", paper!.authors.join(" · ")),
        el("p", "document-meta", `${filename}  ·  ${paper!.bodyPageCount} ${t().pages}  ·  ${paper!.blocks.length} ${t().blocks}`))),
      ...(paper!.warnings.length ? [el("ul", "warnings", ...paper!.warnings.map((warning) =>
        el("li", "", language === "zh" ? warning.message : warningText(warning.code), warning.pages?.length ? ` · p. ${warning.pages.join(", ")}` : "")))] : []),
      controls(() => {}),
      estimate(t().setupEstimate, String(setupCalls)),
      ...(demo ? [] : [estimate(t().fullEstimate, `${setupCalls + 5}–${setupCalls + 8}`)]),
      button(t().start, () => { void draft(); }, "primary"));
  }

  function outlineEditor() {
    const current = outline!;
    const editor = el("section", "editor");
    const rows = el("ol", "outline-rows");
    const refresh = button(t().update, () => { void draft(); });
    const submit = button(t().generate, () => { void generate(); }, "primary");
    const stale = el("p", "muted", t().settingsChanged);
    const sync = () => {
      const dirty = isDirty();
      refresh.hidden = stale.hidden = !dirty;
      submit.disabled = busy || dirty || current.items.some(({ title }) => !title.trim());
    };
    const saveEdits = () => {
      if (current.items.every(({ title }) => title.trim())) {
        void cache().set(editedOutlineKey(paper!, draftedFor!, current.emphasis), structuredClone(current));
      }
    };
    const fill = () => {
      rows.replaceChildren(...current.items.map((item, index) => {
        const field = el("input");
        field.value = item.title;
        field.maxLength = 150;
        field.setAttribute("aria-label", `${t().title} ${index + 1}`);
        field.addEventListener("input", () => { item.title = field.value; sync(); });
        field.addEventListener("change", saveEdits);
        const move = (direction: number) => {
          const next = index + direction;
          [current.items[index], current.items[next]] = [current.items[next]!, item];
          saveEdits();
          fill();
        };
        const up = button("↑", () => move(-1), "icon");
        const down = button("↓", () => move(1), "icon");
        const remove = button("×", () => { current.items.splice(index, 1); saveEdits(); fill(); }, "icon remove");
        ([[up, t().up], [down, t().down], [remove, t().remove]] as const).forEach(([control, label]) => {
          control.title = label;
          control.setAttribute("aria-label", `${label} ${index + 1}`);
        });
        up.disabled = index < 2;
        down.disabled = index === 0 || index === current.items.length - 1;
        remove.disabled = index === 0;
        return el("li", "outline-row", el("span", "row-number", String(index + 1).padStart(2, "0")),
          el("div", "row-content", field, el("small", "", item.modules.map((kind) => moduleName(kind, language)).join(" · ") || item.intent)),
          el("div", "row-actions", up, down, remove));
      }));
      amount.replaceChildren(estimate(t().slideEstimate, String(current.items.length)));
      sync();
    };
    const amount = el("div");
    fill();
    const interpretation = el("section", "understanding",
      el("h2", "", t().understanding), el("h3", "", understanding!.title), el("p", "one-liner", understanding!.oneLiner),
      ...understanding!.modules.map((module) => {
        const details = el("details", "module", el("summary", "", moduleName(module.kind, language)),
          el("ul", "", ...module.points.map((point) => el("li", "", point.text))));
        return details;
      }));
    editor.append(el("div", "outline-main", el("h1", "", t().confirm), el("p", "muted", t().outlineHelp),
      controls(sync), stale, refresh, rows, amount, submit), interpretation);
    return editor;
  }

  function render() {
    preview?.dispose();
    preview = undefined;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    const body = el("main", deck ? "main is-preview" : "main");
    if (error) {
      const notice = el("div", "error", `${t().failed} · ${message()}`);
      notice.role = "alert";
      body.append(notice);
    }
    if (busy) body.append(progress);
    if (deck && paper && bytes) {
      const exportButton = button(t().export, () => { void exportDeck(); }, "primary");
      exportButton.disabled = !!overflow.length;
      const actions = el("div", "action-bar", button(`← ${t().back}`, () => {
        deck = exportUrl = undefined;
        render();
      }), el("span", "current-file", filename), exportButton);
      if (exportUrl) {
        const link = el("a", "download-link", t().download);
        link.href = exportUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      }
      body.append(actions);
      if (demo) body.append(el("p", "fixture-note", t().fixtureHint));
      if (compressionFailed) body.append(el("p", "warnings", t().compressError));
      if (overflow.length) body.append(el("p", "error", `${t().overflow} (${overflow.join(", ")})`));
      preview = renderPreview(deck, paper, bytes, language, activeSlide, (index) => { activeSlide = index; });
      body.append(preview.root);
    } else if (outline) {
      body.append(button(`← ${t().newPaper}`, () => { reset(); render(); }, "subtle back"), outlineEditor());
    } else if (paper) {
      body.append(button(`← ${t().newPaper}`, () => { reset(); render(); }, "subtle back"), source());
    } else if (!busy) {
      body.append(landing());
    } else {
      body.append(el("p", "current-file", filename));
    }
    root.replaceChildren(header(), stepper(), body);
    if (busy) {
      root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select")
        .forEach((control) => { control.disabled = true; });
    }
    preview?.mount();
  }

  render();
}
