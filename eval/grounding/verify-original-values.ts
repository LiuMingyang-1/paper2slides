import { readFile } from "node:fs/promises";
import type { Paper, Slide } from "../../src/types";
import { verifyDeck } from "../../src/verify/citation";

const input = process.argv[2];
if (!input) throw new Error("Usage: vite-node eval/grounding/verify-original-values.ts PARSED.json");
const paper = JSON.parse(await readFile(input, "utf8")) as Paper;
const evidence = new Map(paper.blocks.map((block) => [block.id, block]));
const cases = [
  ["Mask 15% of all WordPiece tokens.", ["e4-14"]],
  ["80/10/10 的比例分别用于 [MASK]、随机词、保留原词。", ["e4-15"]],
  ["The GLUE score was 80.5% (7.7 percentage points of absolute improvement).", ["e1-2", "e6-13"]],
  ["MultiNLI accuracy was 86.7%.", ["e1-2", "e6-2"]],
  ["SQuAD v1.1 Test F1 was 93.2.", ["e1-2", "e7-11"]],
  ["BERTLARGE uses L=24 and H=1024.", ["e3-41", "e3-42", "e9-7"]],
  ["Next Sentence Prediction (NSP) predicts whether B is the actual next sentence that follows A.", ["e4-16"]],
  ["MultiNLI accuracy was 86.7%.", ["e1-2", "e8-4"]],
  ["SQuAD v1.1 Test F1 was 93.2.", ["e1-2", "e6-4"]],
] as const;

const slide: Slide = { id: "original-values", outlineId: "original-values", layout: "bullets", slots: {
  bullets: cases.map(([text, ids]) => ({ text, kind: "fact", evidenceIds: [...ids] })),
} };
for (const { pointIndex, status, numbers } of verifyDeck([slide], evidence)) {
  const [text, ids] = cases[pointIndex]!;
  console.log(JSON.stringify({ text, ids, status, numbers }));
}
