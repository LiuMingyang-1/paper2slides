import { check, literal, optional, pipe, undefined_, unknown, type GenericSchema } from "valibot";
import type { LayoutId, Point, Slide, SlotValue } from "../types";
import { LAYOUT_IDS, LAYOUTS } from "./layouts";
import { choiceRule, collectMissing, listRule, parseRule, pointRule, recordRule, textRule } from "./rules";
import { requireValid, type Validator } from "./validation";

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

function slotsRule(layout: LayoutId) {
  const entries: Record<string, GenericSchema<unknown, SlotValue | undefined>> = {};
  for (const [key, slot] of Object.entries(LAYOUTS[layout].slots)) {
    const rule = slot.type === "string" ? textRule(slot.maxChars)
      : listRule(pointRule(slot.maxChars), slot.minItems, slot.maxItems);
    entries[key] = slot.required ? rule : optional(rule);
  }
  return recordRule(entries);
}

export function slideValidator(constraints: SlideConstraints): Validator<Slide> {
  const { outlineId, titlePage, evidenceIds, figureIds } = constraints;
  const idRule = literal(outlineId, "应与大纲项 ID 一致");
  const schema = recordRule({
    id: idRule,
    outlineId: idRule,
    layout: pipe(
      choiceRule(LAYOUT_IDS),
      check((layout) => (layout === "title") === titlePage, "首项应使用 title，内容项应使用内容版式"),
    ),
    slots: unknown(),
    figureId: optional(unknown()),
    notes: optional(textRule(240)),
  });
  const requiredFigure = pipe(textRule(64), check((id) => figureIds.has(id), "应引用本页可用原图"));
  const forbiddenFigure = undefined_("此版式应省略 figureId");

  return (input) => {
    const value = parseRule(schema, input, "slide");
    const { layout, notes } = value;
    const rawSlots = parseRule(slotsRule(layout), value.slots, "slots", "slots");
    const slots: Record<string, SlotValue> = {};
    const missing = new Set<string>();
    for (const [key, slot] of Object.entries(rawSlots)) {
      if (slot === undefined) continue;
      slots[key] = slot;
      if (Array.isArray(slot)) collectMissing(slot, evidenceIds, missing);
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
    const figureId = parseRule(LAYOUTS[layout].requiresFigure ? requiredFigure : forbiddenFigure, value.figureId, "figureId");
    return {
      value: {
        id: outlineId, outlineId, layout, slots,
        ...(figureId !== undefined ? { figureId } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      missingEvidenceIds: [...missing],
    };
  };
}
