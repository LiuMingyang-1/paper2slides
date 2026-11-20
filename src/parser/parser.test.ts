import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parsePdf } from "./node";
import type { Paper } from "../types";

const cases = [
  {
    name: "bert",
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    pages: 16, body: 9, firstCaptionPage: 3, firstFigurePage: 3, blockRange: [160, 330],
    bibliographyOnly: "Alan Akbik, Duncan Blythe, and Roland Vollgraf",
  },
  {
    name: "visualization",
    title: "Ten simple rules for developing visualization tools in genomics",
    pages: 11, body: 8, firstCaptionPage: 3, firstFigurePage: 3, blockRange: [65, 150],
    bibliographyOnly: "10.4000/histoiremesure.13544",
  },
  {
    name: "deep-learning-review",
    title: "Deep learning: systematic review, models, challenges, and research directions",
    pages: 22, body: 18, firstCaptionPage: 3, firstFigurePage: 4, blockRange: [220, 450],
    bibliographyOnly: "10.3390/smartcities4020029",
  },
];

describe("published PDF fixtures (pdf.js legacy build)", () => {
  for (const fixture of cases) {
    it("parses " + fixture.name, async () => {
      const url = new URL(`../../eval/papers/${fixture.name}`, import.meta.url);
      const pdf = await readFile(new URL(url.href + ".pdf"));
      const paper = await parsePdf(Uint8Array.from(pdf).buffer);
      expect(paper.id).toBe(createHash("sha256").update(pdf).digest("hex"));
      expect(paper.title).toBe(fixture.title);
      expect(paper.authors.length).toBeGreaterThan(0);
      expect(paper.pageCount).toBe(fixture.pages);
      expect(paper.bodyPageCount).toBe(fixture.body);
      expect(paper.warnings.map((warning) => warning.code)).not.toContain("REFERENCES_NOT_FOUND");
      expect(paper.blocks.length).toBeGreaterThan(fixture.blockRange[0]!);
      expect(paper.blocks.length).toBeLessThan(fixture.blockRange[1]!);
      expect(paper.blocks.at(-1)?.page).toBe(fixture.body);
      const text = paper.blocks.map((block) => block.text).join(" ").replace(/\s+/g, " ");
      expect(text).not.toContain(fixture.bibliographyOnly);
      const captions = paper.blocks.filter((block) => block.type === "caption");
      expect(captions[0]?.page).toBe(fixture.firstCaptionPage);
      expect(paper.figures[0]).toMatchObject({
        page: fixture.firstFigurePage, cropOk: false,
        captionEvidenceId: captions.find((caption) => caption.text.startsWith("Figure 1:") ||
          /^Fig\.? 1[ .]/.test(caption.text))?.id,
      });
      const byPage = new Map<number, number>();
      for (const block of paper.blocks) {
        const expected = (byPage.get(block.page) ?? 0) + 1;
        byPage.set(block.page, expected);
        expect(block.id).toBe(`e${block.page}-${expected}`);
        const [x0, y0, x1, y1] = block.bbox;
        expect(block.bbox.every(Number.isFinite)).toBe(true);
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
      }
      const saved: Paper = JSON.parse(await readFile(new URL(url.href + ".parsed.json"), "utf8"));
      expect(paper).toEqual(saved);
    });
  }
});

// An uncompressed synthetic PDF with a standard font and a short text stream per page.
function makePdf(textByPage: string[]): ArrayBuffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${textByPage.length} /Kids [${textByPage.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, text] of textByPage.entries()) {
    const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join("")}trailer\n`;
  pdf += `<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer;
}

describe("PDF input validation", () => {
  const content = "The text layer in this synthetic page is long enough to count as readable.";
  it("distinguishes non-PDF and malformed PDF input", async () => {
    await expect(parsePdf(new TextEncoder().encode("not a PDF").buffer)).rejects.toMatchObject({ code: "NOT_PDF" });
    await expect(parsePdf(new TextEncoder().encode("%PDF-1.4\n").buffer)).rejects.toMatchObject({ code: "CORRUPT" });
  });

  it("rejects over-limit files before reading and leaves the caller's bytes available", async () => {
    const bytes = makePdf([content]);
    const limit = bytes.byteLength;
    await expect(parsePdf(bytes, { maxBytes: limit - 1 })).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(parsePdf(bytes, { maxBytes: limit })).resolves.toMatchObject({ pageCount: 1 });
    expect(bytes.byteLength).toBe(limit);
  });

  it("rejects a majority of low-text pages but warns on a minority", async () => {
    await expect(parsePdf(makePdf(["", content, "1"]))).rejects.toMatchObject({ code: "SCANNED_NO_TEXT" });
    const paper = await parsePdf(makePdf(["", content, content]));
    expect(paper.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "LOW_TEXT_PAGES", pages: [1] }),
    ]));
  });

  it("rejects PDFs with an open password and PDFs with restrictions only", async () => {
    for (const name of ["encrypted", "restricted"]) {
      const pdf = await readFile(new URL(`./testdata/${name}.pdf`, import.meta.url));
      await expect(parsePdf(Uint8Array.from(pdf).buffer)).rejects.toMatchObject({ code: "ENCRYPTED" });
    }
  });
});
