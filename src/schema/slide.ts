import type { Point, Slide, SlotValue } from "../types";
import { LAYOUT_IDS, LAYOUTS } from "./layouts";
import { array, choice, fields, object, point, requireValid, string, type Validator } from "./validation";

export interface SlideConstraints {
  outlineId: string;
  titlePage: boolean;
  evidenceIds: ReadonlySet<string>;
  figureIds: ReadonlySet<string>;
}

function requireCells(text: string, path: string, min: number, max: number): number {
  const cells = text.split("|");
  requireValid(cells.length >= min && cells.length <= max && cells.every((cell) => cell.trim()), path,
    `应含 ${min === max ? min : `${min}–${max}`} 个非空单元，用 | 分隔`);
  return cells.length;
}

export function slideValidator(constraints: SlideConstraints): Validator<Slide> {
  const { outlineId, titlePage, evidenceIds, figureIds } = constraints;
  return (input) => {
    const value = object(input, "slide");
    fields(value, ["id", "outlineId", "layout", "slots", "figureId", "notes"], "slide");
    requireValid(value.id === outlineId && value.outlineId === outlineId, "id/outlineId", "均应与大纲项 ID 一致");
    const layout = choice(value.layout, LAYOUT_IDS, "layout");
    requireValid((layout === "title") === titlePage, "layout", "首项应使用 title，内容项应使用内容版式");
    const definition = LAYOUTS[layout];
    const rawSlots = object(value.slots, "slots");
    fields(rawSlots, Object.keys(definition.slots), "slots");
    const slots: Record<string, SlotValue> = {};
    const missing = new Set<string>();
    for (const [key, slot] of Object.entries(definition.slots)) {
      const path = `slots.${key}`;
      if (rawSlots[key] === undefined && !slot.required) continue;
      slots[key] = slot.type === "string"
        ? string(rawSlots[key], path, slot.maxChars)
        : array(rawSlots[key], path, slot.minItems, slot.maxItems).map((entry, index) =>
          point(entry, `${path}[${index}]`, slot.maxChars, evidenceIds, missing));
    }
    if (layout === "table") {
      const columns = requireCells(slots.headers as string, "slots.headers", 2, 4);
      (slots.rows as Point[]).forEach((row, index) =>
        requireCells(row.text, `slots.rows[${index}].text`, columns, columns));
    }
    if (layout === "key_numbers") {
      (slots.numbers as Point[]).forEach((entry, index) => {
        const path = `slots.numbers[${index}].text`;
        requireCells(entry.text, path, 2, 2);
        requireValid(/\p{Nd}/u.test(entry.text.split("|")[0]!), path, "第一个单元应为数值");
      });
    }
    let figureId: string | undefined;
    if (definition.requiresFigure) {
      figureId = string(value.figureId, "figureId", 64);
      requireValid(figureIds.has(figureId), "figureId", "应引用本页可用原图");
    } else {
      requireValid(value.figureId === undefined, "figureId", "此版式应省略 figureId");
    }
    const notes = value.notes === undefined ? undefined : string(value.notes, "notes", 240);
    return {
      value: {
        id: outlineId, outlineId, layout, slots,
        ...(figureId ? { figureId } : {}),
        ...(notes ? { notes } : {}),
      },
      missingEvidenceIds: [...missing],
    };
  };
}
