import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";

const stages = ["parse", "understand", "slides", "export"];
const { values: args } = parseArgs({
  options: {
    pdf: { type: "string" },
    tamper: { type: "string" },
    "quota-limit": { type: "string" },
    "quota-prior": { type: "string", default: "0" },
    out: { type: "string" },
    "stop-after": { type: "string", default: "export" },
    repeat: { type: "string", default: "1" },
    url: { type: "string" },
    demo: { type: "boolean" },
    "replay-run6": { type: "boolean" },
    help: { type: "boolean" },
  },
});

if (args.help) {
  console.log("Usage: node eval/e2e/real.mjs [--demo [--replay-run6]] [--url URL] [--pdf PATH] [--tamper RULES] [--quota-limit N --quota-prior N] [--out DIR] [--stop-after parse|understand|slides|export] [--repeat N]");
  process.exit(0);
}

const stop = stages.indexOf(args["stop-after"]);
const repeat = Number(args.repeat);
if (stop < 0 || !/^\d+$/.test(args.repeat) || !Number.isSafeInteger(repeat) || repeat < 1 || (args.demo && args.pdf)) {
  throw new Error("Use --stop-after parse|understand|slides|export and a positive integer for --repeat. --demo uses the built-in PDF.");
}
if (args["replay-run6"] && !args.demo) throw new Error("--replay-run6 requires --demo");
if (args.tamper && args.demo) throw new Error("--tamper requires a PDF upload");
const quotaPrior = Number(args["quota-prior"]);
const quotaLimit = Number(args["quota-limit"]);
if (args["quota-limit"] !== undefined && (args.demo || !Number.isFinite(quotaLimit)
  || !Number.isFinite(quotaPrior) || quotaPrior < 0 || quotaLimit <= quotaPrior)) {
  throw new Error("--quota-limit requires a real harness and 0 <= --quota-prior < --quota-limit");
}

const pdf = args.pdf ? resolve(args.pdf) : fileURLToPath(new URL("../papers/bert.pdf", import.meta.url));
const url = args.url ?? (args.demo ? "http://127.0.0.1:5173/" : "http://127.0.0.1:5182/");
const chrome = process.env.CHROME_PATH ?? (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "google-chrome");
const defaultOut = fileURLToPath(new URL("../out/", import.meta.url));
if (!args.out) mkdirSync(defaultOut, { recursive: true });
const out = args.out ? resolve(args.out) : mkdtempSync(join(defaultOut, "e2e-"));
mkdirSync(out, { recursive: true });

const progressLog = join(out, "progress.log");
writeFileSync(progressLog, "");
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  appendFileSync(progressLog, `${line}\n`);
  console.log(line);
}

let browser;
let page;
let app;
let artifacts = out;
let phase = "connect";
let downloadDir;
let uploadPdf = pdf;

async function guardQuota() {
  // The local Anna dashboard sends each model call through this JSON endpoint.
  // Reserve one token per prompt byte and maxTokens of output at rounded-up run7 rates.
  await page.evaluateOnNewDocument(({ prior, limit, origin }) => {
    if (window !== window.top || location.origin !== origin) return;
    const originalFetch = window.fetch.bind(window);
    let spent = prior;
    let reserved = 0;
    let unknown = false;
    window.fetch = async (input, init) => {
      if (input !== "/api/session/call" || init?.method !== "POST") return originalFetch(input, init);
      const { ns, method, args } = JSON.parse(init.body);
      if (ns !== "llm") return originalFetch(input, init);
      const bytes = new TextEncoder().encode(JSON.stringify(args)).length;
      const reserve = bytes * 0.000125 + args.maxTokens * 0.00025 + 0.25;
      if (unknown || method !== "complete" || !Number.isFinite(reserve) || spent + reserved + reserve > limit) {
        return Response.json({ ok: false, error: { code: "quota_exceeded",
          message: "Evaluation quota guard stopped this call." } });
      }
      reserved += reserve;
      try {
        const response = await originalFetch(input, init);
        const body = await response.clone().json();
        const quota = body.result?._meta?.quotaConsumed;
        if (typeof quota === "number" && Number.isFinite(quota) && quota >= 0) spent += quota;
        // A call without usage could have billed upstream. Do not send another.
        else unknown = true;
        return response;
      } catch (error) {
        unknown = true;
        throw error;
      } finally {
        reserved -= reserve;
      }
    };
  }, { prior: quotaPrior, limit: quotaLimit, origin: new URL(url).origin });
}

function button(text) {
  return `button::-p-text(${text})`;
}

async function uiState() {
  return app.evaluate(() => ({
    quota: document.querySelector(".usage")?.textContent?.trim(),
    progress: document.querySelector(".progress-card")?.innerText?.trim(),
    error: document.querySelector('[role="alert"].error')?.textContent?.trim(),
  }));
}

function checkError(state) {
  if (state.error) throw new Error(state.error);
}

async function stage(name, action, done, timeout) {
  phase = name;
  const start = Date.now();
  const before = await uiState();
  checkError(before);
  log(`${phase} 开始 · ${before.quota ?? "累计额度 —"}`);
  await action();
  let nextProgress = start + 5000;
  while (Date.now() - start < timeout) {
    const state = await uiState();
    checkError(state);
    if (await done()) {
      const final = await uiState();
      checkError(final);
      log(`${phase} 完成 · ${final.quota ?? "累计额度 —"}`);
      return;
    }
    if (Date.now() >= nextProgress) {
      log(`${phase} ${Math.floor((Date.now() - start) / 1000)}s · ${state.quota ?? "累计额度 —"}${state.progress ? ` · ${state.progress}` : ""}`);
      nextProgress += 5000;
    }
    await sleep(200);
  }
  throw new Error(`${phase} 超时`);
}

async function saveCalls(tag) {
  await app.evaluate(() => {
    const trigger = [...document.querySelectorAll("header button")].find((item) => item.textContent === "调用日志");
    if (!trigger || trigger.disabled) throw new Error("调用日志按钮不可用");
    trigger.click();
  });
  const json = await app.$eval("dialog.logs-dialog[open] pre", (pre) => pre.textContent);
  try {
    const calls = JSON.parse(json);
    writeFileSync(join(artifacts, `calls-${tag}.json`), `${json}\n`);
    return calls.length;
  } finally {
    await app.$eval("dialog.logs-dialog[open]", (dialog) => dialog.close());
  }
}

async function screenshotSlides() {
  phase = "capture";
  const thumbs = await app.$$("nav.strip button.thumb");
  if (!thumbs.length) throw new Error("没有可截图的幻灯片");
  const slides = [];
  for (const [index, thumb] of thumbs.entries()) {
    const pageNumber = String(index + 1).padStart(2, "0");
    await thumb.click();
    const state = await uiState();
    checkError(state);
    const slide = await app.$(".slide-frame");
    await slide.evaluate(async (frame) => {
      await document.fonts.ready;
      await Promise.all([...frame.querySelectorAll("img")].map((img) => img.decode()));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    const verification = await thumb.evaluate((selected, pageNumber) => {
      if (selected.getAttribute("aria-current") !== "true") throw new Error("缩略图未选中");
      const panel = document.querySelector(".verification");
      const counts = [...panel.querySelectorAll(".check-counts .stat")].map((stat) => stat.getAttribute("aria-label"));
      const failures = [...panel.querySelectorAll(".failed-claim")].filter((claim) =>
        claim.querySelector(".counter")?.textContent === `❌ ${Number(pageNumber)}`);
      return [
        selected.getAttribute("aria-label"),
        panel.querySelector("h3").innerText,
        ...counts,
        panel.querySelector("summary").innerText,
        ...failures.map((claim) => `${claim.querySelector("span:nth-child(2)").textContent}\n${claim.querySelector("small").textContent}`),
      ].join("\n");
    }, pageNumber);
    await slide.screenshot({ path: join(artifacts, `slide-${pageNumber}.png`) });
    slides.push(await slide.evaluate((frame) => ({
      text: frame.innerText,
      claims: [...frame.querySelectorAll("[data-point]")].map((claim) => {
        const ref = claim.querySelector(".p2s-citation");
        const copy = claim.cloneNode(true);
        copy.querySelectorAll(".p2s-citation, .p2s-opinion").forEach((node) => node.remove());
        const text = claim.matches("tr") ? [...copy.cells].map((cell) => cell.textContent.trim()).join(" | ")
          : copy.textContent.trim();
        return { slot: claim.dataset.point, text, status: ref.dataset.status,
          evidenceIds: ref.dataset.evidenceIds.split(" ").filter(Boolean),
          flaggedNumbers: [...claim.querySelectorAll(".unverified-number")].map((item) => item.textContent) };
      }),
    })));
    writeFileSync(join(artifacts, `slide-${pageNumber}-verification.txt`), `${verification}\n`);
    log(`已保存第 ${index + 1}/${thumbs.length} 页 · ${state.quota}`);
  }
  writeFileSync(join(artifacts, "slides.json"), `${JSON.stringify(slides, null, 2)}\n`);
}

function saveDeck(bytes) {
  const footer = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (bytes.length < 1024 || bytes.length > 100 * 1024 * 1024
    || bytes.readUInt32LE(0) !== 0x04034b50 || footer < 0 || footer + 22 > bytes.length
    || footer + 22 + bytes.readUInt16LE(footer + 20) !== bytes.length) {
    throw new Error(`PPTX 下载内容无效（${bytes.length} 字节）`);
  }
  const directory = bytes.readUInt32LE(footer + 16);
  const directoryLength = bytes.readUInt32LE(footer + 12);
  if (directory + directoryLength !== footer || directoryLength < 46 || bytes.readUInt32LE(directory) !== 0x02014b50
    || !bytes.subarray(directory, footer).includes(Buffer.from("ppt/presentation.xml"))) {
    throw new Error("PPTX ZIP 目录缺失或无效");
  }
  writeFileSync(join(artifacts, "deck.pptx"), bytes);
  log(`已保存 deck.pptx（${bytes.length} 字节）`);
}

async function exportDeck() {
  const exportButton = button("导出 PPTX");
  if (args.demo) {
    downloadDir = mkdtempSync(join(tmpdir(), "paper2slides-download-"));
    const cdp = await page.createCDPSession();
    try {
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
      let filename;
      await stage("export", () => app.click(exportButton), async () => {
        filename = readdirSync(downloadDir).find((name) => name.endsWith(".pptx"));
        return filename && !(await app.$(".progress-card"));
      }, 120_000);
      saveDeck(readFileSync(join(downloadDir, filename)));
    } finally {
      await cdp.detach();
      rmSync(downloadDir, { recursive: true, force: true });
      downloadDir = undefined;
    }
  } else {
    const link = "a.download-link[href]";
    await stage("export", () => app.click(exportButton), () => app.$(link), 120_000);
    const href = await app.$eval(link, (anchor) => anchor.href);
    const { quota } = await uiState();
    const heartbeat = setInterval(() => log(`正在下载 PPTX · ${quota}`), 5000);
    try {
      const response = await fetch(href, { signal: AbortSignal.timeout(120_000) }).catch(() => {
        throw new Error("无法请求 PPTX 下载链接");
      });
      if (!response.ok) throw new Error(`PPTX 下载失败（HTTP ${response.status}）`);
      saveDeck(Buffer.from(await response.arrayBuffer()));
    } finally {
      clearInterval(heartbeat);
    }
  }
}

async function resetPaper() {
  if (await app.$(".action-bar")) await app.click(button("返回大纲"));
  await app.click(button("更换论文"));
}

async function installRun6Replay() {
  const archive = new URL("../runs/2026-11-21/run6/calls.json", import.meta.url);
  const calls = JSON.parse(readFileSync(archive, "utf8"));
  let slide = 0;
  const replies = Object.fromEntries(calls.map(({ promptId, rawOutput, stopReason }) => {
    const key = promptId === "slide" ? `s${++slide}` : promptId;
    return [key, {
      content: { type: "text", text: rawOutput },
      role: "assistant", model: "run6-replay", stopReason,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      _meta: { quotaConsumed: 0 },
    }];
  }));
  const modulePath = "/src/ui/demo/bert.ts";
  const moduleUrl = new URL(modulePath, url).href;
  let intercepted = false;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url() !== moduleUrl) return request.continue();
    intercepted = true;
    return request.respond({
      contentType: "text/javascript",
      body: `
        import { demoHost as builtInHost, demoPdf } from "${modulePath}?original";
        import { parsePdf } from "/src/parser/index.ts";
        const paper = await parsePdf(await demoPdf());
        export { demoPdf };
        export const demoPaper = () => structuredClone(paper);
        export function demoHost() {
          const host = builtInHost();
          const replies = ${JSON.stringify(replies)};
          return { ...host, llm: { ...host.llm, async complete({ messages }) {
            const prompt = String(messages[0]?.content);
            const item = /^大纲项：(.+)$/m.exec(prompt)?.[1];
            const key = item ? JSON.parse(item).id : /^侧重点：/m.test(prompt) ? "outline" : "understand";
            const reply = replies[key];
            if (!reply || /^原 Slide：/m.test(prompt)) throw new Error("run6 replay has no matching response");
            return reply;
          } } };
        }
      `,
    });
  });
  return () => {
    if (!intercepted) throw new Error("run6 回放需要通过 npm run dev:web 启动的 Vite 服务");
  };
}

try {
  log(`启动 ${args.demo ? "BERT Demo" : "Anna harness"} · 运行 ${repeat} 轮 · 产物目录 ${out}`);
  if (args.tamper) {
    uploadPdf = join(out, "input-tampered.pdf");
    const script = fileURLToPath(new URL("../grounding/tamper-pdf.py", import.meta.url));
    log(execFileSync("python3", [script, pdf, resolve(args.tamper), uploadPdf], { encoding: "utf8" }).trim());
  }
  if (Number.isFinite(quotaLimit)) log(`任务累计额度（运行前） ${quotaPrior} / ${quotaLimit}`);
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: { width: 1440, height: 1000 } });
  page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  if (Number.isFinite(quotaLimit)) await guardQuota();
  const verifyReplay = args["replay-run6"] ? await installRun6Replay() : undefined;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  app = args.demo ? page.mainFrame() : await page.waitForFrame((frame) => new URL(frame.url()).pathname.includes("/dev/"));
  await app.waitForSelector(".topbar");

  let priorCalls = 0;
  for (let run = 1; run <= repeat; run++) {
    artifacts = repeat === 1 ? out : join(out, `run-${String(run).padStart(2, "0")}`);
    mkdirSync(artifacts, { recursive: true });
    log(`第 ${run}/${repeat} 轮`);
    if (run > 1) {
      phase = "reset";
      await resetPaper();
    }
    await stage("parse", async () => {
      if (args.demo) await app.click(button("试用 BERT Demo"));
      else {
        const input = await app.waitForSelector('input[type="file"]');
        await input.uploadFile(uploadPdf);
      }
    }, () => app.$(".source-panel button.primary:enabled"), 120_000);
    verifyReplay?.();

    if (stop >= 1) {
      await stage("understand", () => app.click(button("理解论文并生成大纲")), () => app.$(".outline-main"), 600_000);
      const outline = await app.$eval(".editor", (editor) => [
        editor.innerText, ...[...editor.querySelectorAll(".outline-rows input")].map((input) => input.value),
      ].join("\n"));
      writeFileSync(join(artifacts, "outline.txt"), `${outline}\n`);
    }
    if (stop >= 2) {
      await stage("slides", () => app.click(button("生成幻灯片")), async () => {
        if (await app.$(".progress-card")) return false;
        return app.$(".preview-grid");
      }, 900_000);
      await screenshotSlides();
    }
    if (stop >= 3) await exportDeck();
    const totalCalls = await saveCalls("final");
    const { quota } = await uiState();
    log(`第 ${run} 轮新增 ${totalCalls - priorCalls} 条调用记录 · ${quota}`);
    priorCalls = totalCalls;
  }
} catch (error) {
  log(`FAIL ${phase} · ${error.message}`);
  if (page) await page.screenshot({ path: join(artifacts, `${phase}-fail.png`), timeout: 10_000 })
    .catch((failure) => log(`保存失败截图时出错 · ${failure.message}`));
  if (app) await saveCalls(`${phase}-fail`).catch((failure) => log(`保存调用日志时出错 · ${failure.message}`));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });
}
