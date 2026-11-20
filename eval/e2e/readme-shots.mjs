// Capture README workbench screenshots from the run6 replay (zero quota).
// Usage: npm run dev:web  (another terminal), then: node eval/e2e/readme-shots.mjs
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const url = process.env.P2S_URL ?? "http://[::1]:5173/";
const outDir = new URL("../../docs/images/", import.meta.url).pathname;
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const calls = JSON.parse(readFileSync(new URL("../runs/2026-11-21/run6/calls.json", import.meta.url), "utf8"));
let n = 0;
const replies = Object.fromEntries(calls.map(({ promptId, rawOutput, stopReason }) => [
  promptId === "slide" ? `s${++n}` : promptId,
  { content: { type: "text", text: rawOutput }, role: "assistant", model: "run6-replay", stopReason,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, _meta: { quotaConsumed: 0 } },
]));

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  const modulePath = "/src/ui/demo/bert.ts";
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url() !== new URL(modulePath, url).href) return request.continue();
    return request.respond({ contentType: "text/javascript", body: `
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
          if (!replies[key]) throw new Error("no replay for " + key);
          return replies[key];
        } } };
      }` });
  });
  const button = (text) => `button::-p-text(${text})`;
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.click(button("试用 BERT Demo"));
  await page.waitForSelector(".source-panel button.primary:enabled", { timeout: 120_000 });
  await page.click(button("理解论文并生成大纲"));
  await page.waitForSelector(".outline-main", { timeout: 120_000 });
  await page.screenshot({ path: `${outDir}workbench-outline.png` });
  await page.click(button("生成幻灯片"));
  await page.waitForSelector(".preview-grid", { timeout: 120_000 });
  await page.waitForFunction(() => !document.querySelector(".progress-card"), { timeout: 120_000 });

  const thumbs = await page.$$("nav.strip button.thumb");
  const settle = async () => { await page.evaluate(() => document.fonts.ready); await sleep(800); };

  // 1) Citation popover on the MLM slide (index 2 → slide 3).
  await thumbs[2].click(); await settle();
  const cite = await page.$(".slide-frame .p2s-citation");
  await cite.hover(); await sleep(600);
  await page.screenshot({ path: `${outDir}workbench-citation.png` });
  await page.mouse.move(5, 5); await sleep(300);

  // 2) Verification panel: pick the slide with most warnings/failures, expand details.
  const target = await page.$$eval("nav.strip button.thumb", (items) => {
    let best = 0, score = -1;
    items.forEach((item, i) => {
      const nums = [...item.querySelectorAll("span, b, i")].map((x) => Number(x.textContent)).filter(Number.isFinite);
      const s = (item.innerText.match(/\d+/g) || []).slice(-2).reduce((a, b) => a + Number(b), 0);
      if (s > score) { score = s; best = i; }
    });
    return best;
  });
  await thumbs[target].click(); await settle();
  await page.evaluate(() => document.querySelector(".verification details")?.setAttribute("open", ""));
  await sleep(300);
  await page.screenshot({ path: `${outDir}workbench-verification.png` });
  console.log("saved; verification slide index", target);
} finally {
  await browser.close();
}
