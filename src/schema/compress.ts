import type { Slide, SlotValue } from "../types";
import { countChars, requireValid, type Validator } from "./validation";

function texts(slot: SlotValue): string[] {
  return typeof slot === "string" ? [slot] : slot.map((point) => point.text);
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, i) => entry === right[i]);
}

const QUANTITY = String.raw`[+−-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+−-]?\d+)?(?:\s*[%％]|[kMB])?`;
const NUMBER_PATTERN = new RegExp(String.raw`${QUANTITY}(?:\s*±\s*${QUANTITY})?`, "g");

function numbers(text: string): string[] {
  return text.match(NUMBER_PATTERN) ?? [];
}

/** Compression edits text only. Preserve each point's provenance and the per-cell numeric spellings. */
export function compressionValidator(
  original: Slide,
  overflowing: readonly string[],
  validateSlide: Validator<Slide>,
): Validator<Slide> {
  return (input, warnings) => {
    const result = validateSlide(input, warnings);
    const slide = result.value;
    requireValid(slide.layout === original.layout && slide.figureId === original.figureId && slide.notes === original.notes,
      "slide", "应保留版式、原图和备注");
    requireValid(sameSequence(Object.keys(slide.slots).sort(), Object.keys(original.slots).sort()),
      "slots", "应保留槽位集合");
    for (const [key, prior] of Object.entries(original.slots)) {
      const path = `slots.${key}`;
      const next = slide.slots[key]!;
      if (!overflowing.includes(key)) {
        requireValid(JSON.stringify(prior) === JSON.stringify(next), path, "未超限的槽位应保持原样");
        continue;
      }
      if (typeof prior !== "string" && typeof next !== "string") {
        requireValid(prior.length === next.length, path, "应保留要点数量和顺序");
        prior.forEach((point, i) => {
          const revised = next[i]!;
          requireValid(point.kind === revised.kind && sameSequence(point.evidenceIds, revised.evidenceIds),
            `${path}[${i}]`, "应保留 kind 和 evidenceIds");
        });
      }
      const oldTexts = texts(prior);
      const newTexts = texts(next);
      let shortened = false;
      oldTexts.forEach((before, i) => {
        const after = newTexts[i]!;
        const structured = (original.layout === "table" && (key === "headers" || key === "rows"))
          || (original.layout === "key_numbers" && key === "numbers");
        const beforeCells = structured ? before.split("|") : [before];
        const afterCells = structured ? after.split("|") : [after];
        requireValid(beforeCells.length === afterCells.length && beforeCells.every((cell, j) =>
          sameSequence(numbers(cell), numbers(afterCells[j]!))), `${path}[${i}]`, "应原样保留对应位置的数字");
        requireValid(countChars(after) <= countChars(before), `${path}[${i}]`, "文字不得增长");
        shortened ||= countChars(after) < countChars(before);
      });
      requireValid(shortened, path, "超限槽位应缩短");
    }
    return result;
  };
}
