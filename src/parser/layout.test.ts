import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import type { Evidence } from "../types";
import { buildPaper } from "./blocks";
import { figureRegion, imageRows } from "./figures";
import { layoutPage, type Box } from "./layout";

const view: Box = [0, 0, 600, 800];
const glyph = (str: string, x: number, y: number, w: number, size = 10, bold = false) => ({
  str, dir: "ltr", width: w, height: size, fontName: bold ? "heading" : "body",
  transform: [size, 0, 0, size, x, y], hasEOL: true,
});

function page(number: number, items: TextContent["items"]) {
  return layoutPage(number, view, {
    items,
    styles: {
      body: { fontFamily: "serif", ascent: 0.8, descent: -0.2, vertical: false },
      heading: { fontFamily: "serif bold", ascent: 0.8, descent: -0.2, vertical: false },
    },
    lang: null,
  });
}

describe("coordinate-based parsing", () => {
  it("reads left to right within each region around a spanning line", () => {
    const input = [glyph("Full width heading", 50, 740, 480),
      glyph("Spanning float caption", 50, 550, 460)];
    for (const top of [710, 520]) {
      for (let i = 0; i < 5; i++) {
        input.push(
          glyph("Right column " + i, 312, top - i * 14, 230),
          glyph("Left column " + i, 50, top - i * 14, 232),
        );
      }
    }
    const layout = page(1, input);
    expect(layout.gutter).toBeCloseTo(297);
    const markers = layout.lines.filter((line) => !line.text.match(/column [1-3]/u))
      .map((line) => [line.text, line.column]);
    expect(markers).toEqual([
      ["Full width heading", "full"], ["Left column 0", "left"], ["Left column 4", "left"],
      ["Right column 0", "right"], ["Right column 4", "right"],
      ["Spanning float caption", "full"], ["Left column 0", "left"], ["Left column 4", "left"],
      ["Right column 0", "right"], ["Right column 4", "right"],
    ]);
  });

  it("builds paragraph, caption, table and equation blocks with section paths and PDF boxes", () => {
    const first = page(1, [
      glyph("Journal header 1", 50, 783, 90),
      glyph("Sample Article Title", 75, 720, 250, 20),
      glyph("Ada Lovelace", 75, 690, 80),
      glyph("Abstract", 50, 674, 80, 12, true),
      glyph("An abstract has enough text to represent the full paragraph.", 50, 650, 300),
      glyph("1 Results", 50, 613, 70, 13, true),
      glyph("1.1 Measurements", 50, 585, 90, 10, true),
      glyph("The measurements continue into a second line at the same indent.", 50, 565, 328),
      glyph("Those lines form one paragraph.", 50, 552, 180),
      glyph("E = mc² (1)", 190, 526, 90),
      glyph("图 １：测量数据", 50, 491, 105),
      glyph("表 2：速度和精度", 50, 454, 103),
      glyph("Variant A", 50, 430, 34), glyph("12.3", 165, 430, 20), glyph("98%", 215, 430, 22),
      glyph("1", 290, 30, 5),
    ]);
    const second = page(2, [
      glyph("Journal header 2", 50, 783, 90),
      glyph("Acknowledgements", 50, 716, 100, 13, true),
      glyph("The funding acknowledgement belongs outside the evidence.", 50, 690, 310),
      glyph("2 Discussion", 50, 650, 100, 13, true),
      glyph("The discussion remains in the body.", 50, 627, 190),
      glyph("参考文献", 50, 580, 55, 13, true),
      glyph("This bibliography entry should be excluded.", 50, 553, 260),
      glyph("2", 290, 30, 5),
    ]);
    const paper = buildPaper("id", 2, [first, second], {}, []);
    expect(paper.title).toBe("Sample Article Title");
    expect(paper.authors).toEqual(["Ada Lovelace"]);
    expect(paper.warnings).toEqual([]);
    expect(paper.blocks.map((block) => block.type)).toEqual(["text", "text", "equation", "caption", "caption", "table", "text"]);
    expect(paper.blocks[1]).toMatchObject({
      id: "e1-2", sectionPath: ["1 Results", "1.1 Measurements"],
      bbox: [50, 550, 378, 573],
    });
    expect(paper.figures).toEqual([
      { id: "fig1", label: "图 1", page: 1, captionEvidenceId: "e1-4", cropOk: false },
    ]);
    expect(paper.blocks.at(-1)).toMatchObject({ sectionPath: ["2 Discussion"], text: "The discussion remains in the body." });
  });

  it("splits a long paragraph at sentence boundaries with the corresponding line boxes", () => {
    const sentence = "The measured values reflect the behavior of the system across the range of conditions.";
    const source = page(1, [
      glyph("Synthetic Paper", 50, 750, 200, 20),
      glyph("Abstract", 50, 710, 80, 12, true),
      ...Array.from({ length: 20 }, (_, i) => glyph(sentence, 50, 687 - i * 13, 445)),
    ]);
    const paper = buildPaper("id", 1, [source], {}, []);
    expect(paper.blocks.length).toBeGreaterThan(1);
    expect(paper.blocks.every((block) => block.text.length <= 900 && block.text.endsWith("."))).toBe(true);
    expect(paper.blocks[0]!.bbox[1]).toBeGreaterThan(paper.blocks.at(-1)!.bbox[3] - 15);
    expect(paper.warnings.map(({ code }) => code)).toEqual(["REFERENCES_NOT_FOUND"]);
  });

  it("truncates long body pages and allows references to start on page 41", () => {
    const pages = Array.from({ length: 41 }, (_, i) => page(i + 1, [
      glyph("A synthetic body page with enough words to represent evidence.", 50, 685, 320),
    ]));
    const long = buildPaper("id", 42, pages, {}, []);
    expect(long.bodyPageCount).toBe(40);
    expect(long.blocks.at(-1)?.page).toBe(40);
    expect(long.warnings.map(({ code }) => code)).toEqual(
      ["REFERENCES_NOT_FOUND", "TRUNCATED_LONG_DOC", "NOT_LIKELY_PAPER"],
    );
    pages[40] = page(41, [glyph("Bibliography", 50, 740, 100, 12, true)]);
    expect(buildPaper("id", 42, pages, {}, []).warnings).toEqual([]);
  });
});

describe("figure crop geometry", () => {
  it("excludes a running rule and rejects an unrelated region separated from the caption", () => {
    const width = 100;
    const height = 180;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    pixels.fill(0, width * 12 * 4, width * 13 * 4);
    for (let y = 37; y < 87; y++) pixels.fill(100, (width * y + 10) * 4, (width * y + 70) * 4);
    expect(imageRows(pixels, width, height)).toBeUndefined();
    for (let y = 87; y < 161; y++) pixels.fill(100, (width * y + 10) * 4, (width * y + 70) * 4);
    expect(imageRows(pixels, width, height)).toEqual([33, 165]);
  });

  const caption: Evidence = {
    id: "e2-1", page: 2, bbox: [52, 286, 212, 300],
    sectionPath: [], text: "Figure 1: Architecture", type: "caption",
  };
  const layout = { page: 2, view, gutter: 301, textBounds: [50, 550] as [number, number], lines: [] };
  const preceding: Evidence = {
    ...caption, id: "e2-2", bbox: [50, 480, 290, 510],
    text: "Prior prose in the same column gives the reader sufficient context to interpret the figure.",
    type: "text",
  };

  it("uses column bounds and ignores diagram labels and the opposite column", () => {
    expect(figureRegion(layout, caption, [
      preceding,
      { ...preceding, id: "e2-3", bbox: [320, 365, 540, 400] },
      { ...preceding, id: "e2-4", bbox: [100, 375, 150, 385], text: "Input layer" },
    ])).toEqual([50, 302, 301, 478]);
  });

  it("widens to the full text area for a spanning caption and rejects very short crops", () => {
    expect(figureRegion(layout, { ...caption, bbox: [52, 286, 540, 300] }, [preceding]))
      .toEqual([50, 302, 550, 478]);
    expect(figureRegion(layout, caption, [preceding])).toEqual([50, 302, 550, 478]);
    expect(figureRegion(layout, caption, [{ ...preceding, bbox: [50, 315, 290, 340] }])).toBeUndefined();
  });
});
