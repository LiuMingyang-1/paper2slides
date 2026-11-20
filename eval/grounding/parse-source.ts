import { readFile, writeFile } from "node:fs/promises";
import { parsePdf } from "../../src/parser/node";

const [, , input, output] = process.argv;
if (!input || !output) throw new Error("Usage: vite-node eval/grounding/parse-source.ts INPUT.pdf OUTPUT.json");
const bytes = Uint8Array.from(await readFile(input));
const paper = await parsePdf(bytes.buffer);
await writeFile(output, `${JSON.stringify(paper, null, 2)}\n`);
