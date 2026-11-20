import { createRequire } from "node:module";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureDeck, fixturePaper } from "../layout/fixture";
import { measureSlide, renderSlide } from "../layout";
import { exportPptx } from "./index";

// jsdom supplies DOM and XML parsing. Layout geometry is supplied explicitly.
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new () => { window: Window & typeof globalThis } };
let win: Window & typeof globalThis;

beforeEach(() => {
  win = new JSDOM().window;
  vi.spyOn(win.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("p2s-slide")) return new win.DOMRect(-9000, 10, 1280, 720);
    if (this.matches("th, td")) return new win.DOMRect(-8936, 74, 384, 64);
    return new win.DOMRect(-8936, 74, 576, 64);
  });
  const getStyle = win.getComputedStyle.bind(win);
  vi.spyOn(win, "getComputedStyle").mockImplementation((el) => {
    const style = getStyle(el);
    style.fontSize = "32px";
    style.lineHeight = "40px";
    style.paddingLeft = el instanceof win.HTMLUListElement ? "48px" : "0";
    style.color = "rgb(23, 35, 45)";
    return style;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  win.close();
});

describe("editable PPTX export", () => {
  it("packages six slides, notes and original PNG with valid OOXML colors", async () => {
    const blob = await exportPptx(fixtureDeck, fixturePaper, { document: win.document });
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const readXml = async (path: string) => {
      const xml = new win.DOMParser().parseFromString(await zip.file(path)!.async("string"), "application/xml");
      expect(xml.querySelector("parsererror"), path).toBeNull();
      return xml;
    };
    const parts = Object.keys(zip.files);
    expect(parts.filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))).toHaveLength(6);
    expect(parts.filter((path) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path))).toHaveLength(6);
    expect(parts.filter((path) => /^ppt\/media\/.*\.png$/.test(path))).toHaveLength(1);
    const prefix = { a: "http://schemas.openxmlformats.org/drawingml/2006/main", p: "http://schemas.openxmlformats.org/presentationml/2006/main" };
    const tags = (xml: Document, ns: keyof typeof prefix, name: string) => [...xml.getElementsByTagNameNS(prefix[ns], name)];

    for (const path of parts.filter((part) => /\.(xml|rels)$/.test(part))) {
      const xml = await readXml(path);
      for (const color of tags(xml, "a", "srgbClr")) expect(color.getAttribute("val")).toMatch(/^[\dA-Fa-f]{6}$/);
    }
    const titleNotes = await readXml("ppt/notesSlides/notesSlide1.xml");
    expect(tags(titleNotes, "a", "t")[0]?.textContent).toContain(fixtureDeck.slides[0]!.notes!);
    const bullets = await readXml("ppt/slides/slide2.xml");
    expect(tags(bullets, "a", "buChar")).toHaveLength(3);
    expect(tags(bullets, "p", "cNvSpPr").every((shape) => shape.getAttribute("txBox") === "1")).toBe(true);
    expect(tags(bullets, "a", "bodyPr").every((body) => body.getAttribute("lIns") === "0")).toBe(true);
    expect(tags(bullets, "a", "ea").some((font) => font.getAttribute("typeface") === "Microsoft YaHei")).toBe(true);
    expect(tags(await readXml("ppt/slides/slide3.xml"), "p", "pic")).toHaveLength(1);
    const figureNotes = await readXml("ppt/notesSlides/notesSlide3.xml");
    expect(tags(figureNotes, "a", "t")[0]?.textContent).toContain(`e3-1 (p.3) ${fixturePaper.blocks[2]!.text}`);
    const table = await readXml("ppt/slides/slide5.xml");
    expect(tags(table, "a", "tbl")).toHaveLength(1);
    expect(tags(table, "a", "tr")).toHaveLength(3);
    expect(tags(table, "a", "t").map((tag) => tag.textContent)).toContain("p.4");
    const notes = await readXml("ppt/notesSlides/notesSlide5.xml");
    expect(tags(notes, "a", "t")[0]?.textContent).toContain(`e4-1 (p.4) ${fixturePaper.blocks[3]!.text}`);
    expect(win.document.body.childElementCount).toBe(0);
  });

  it("uses supplied preview geometry without rendering again and refuses unresolved overflow", async () => {
    const deck = { ...fixtureDeck, slides: [fixtureDeck.slides[0]!] };
    const root = renderSlide(deck.slides[0]!, { document: win.document });
    win.document.body.append(root);
    const measurement = measureSlide(root);
    await expect(exportPptx(deck, fixturePaper, { measurements: [{ ...measurement, overflowingSlots: ["title"] }] }))
      .rejects.toThrow("Slide s1 overflows: title");
    vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => { throw new Error("Measured again"); });
    const first = await exportPptx(deck, fixturePaper, { measurements: [measurement] });
    const second = await exportPptx(deck, fixturePaper, { measurements: [measurement] });
    for (const blob of [first, second]) {
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      expect(zip.file(/^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(1);
    }
    expect(win.document.body.firstElementChild).toBe(root);
  });
});
