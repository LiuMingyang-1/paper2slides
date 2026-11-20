import { readFile, writeFile } from "node:fs/promises";
import { parsePdf } from "../../src/parser/node";

for (const name of ["bert", "visualization", "deep-learning-review"]) {
  const base = new URL(`./${name}`, import.meta.url);
  const bytes = await readFile(new URL(base.href + ".pdf"));
  const paper = await parsePdf(Uint8Array.from(bytes).buffer);
  await writeFile(new URL(base.href + ".parsed.json"), JSON.stringify(paper, null, 2) + "\n");
  console.log(JSON.stringify({
    name, title: paper.title, authors: paper.authors, pages: paper.pageCount,
    body: paper.bodyPageCount, blocks: paper.blocks.length,
    captions: paper.blocks.filter((block) => block.type === "caption").length,
    figures: paper.figures.map(({ label, page }) => `${label} p${page}`), warnings: paper.warnings,
  }));
}
