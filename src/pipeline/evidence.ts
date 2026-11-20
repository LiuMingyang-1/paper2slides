import type { Evidence } from "../types";

function label(block: Evidence): string {
  const section = block.sectionPath.length ? `, §${block.sectionPath.join(" > ").slice(0, 140)}` : "";
  const type = block.type === "text" ? "" : ` [${block.type}]`;
  return `[${block.id}] (p.${block.page}${section})${type} `;
}

export function formatEvidence(blocks: readonly Evidence[]): string {
  return blocks.map((block) => label(block) + block.text).join("\n");
}

export interface EvidenceBatch {
  input: string;
  ids: Set<string>;
}

/** Consecutive top-level sections stay separate. Oversize blocks keep their original ID. */
export function batchBySection(blocks: readonly Evidence[], limit: number): EvidenceBatch[] {
  const batches: EvidenceBatch[] = [];
  let section: string | undefined;
  let current: EvidenceBatch = { input: "", ids: new Set() };
  const flush = () => {
    if (current.input) batches.push(current);
    current = { input: "", ids: new Set() };
  };
  for (const block of blocks) {
    if (section !== block.sectionPath[0]) {
      flush();
      section = block.sectionPath[0];
    }
    const prefix = label(block);
    const textLimit = limit - prefix.length;
    let start = 0;
    do {
      let end = Math.min(start + textLimit, block.text.length);
      if (end < block.text.length && /[\uD800-\uDBFF]/.test(block.text[end - 1]!)) end--;
      const line = prefix + block.text.slice(start, end);
      if (current.input.length + line.length + 1 > limit) flush();
      current.input += (current.input ? "\n" : "") + line;
      current.ids.add(block.id);
      start = end;
    } while (start < block.text.length);
  }
  flush();
  return batches;
}
