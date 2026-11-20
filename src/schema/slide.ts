import { check, literal, optional, pipe, string, undefined_, unknown, type GenericSchema } from "valibot";
import type { LayoutId, Point, Slide, SlotValue } from "../types";
import { LAYOUT_IDS, LAYOUTS } from "./layouts";
import { normalizeNotes } from "./notes";
import { normalizePoints, normalizeRecord } from "./normalize";
import { choiceRule, collectMissing, listRule, modelTextRule, parseRule, pointRule, recordRule, textRule } from "./rules";
import { requireValid, type Validator } from "./validation";

export interface SlideConstraints {
  outlineId: string;
  titlePage: boolean;
  evidenceIds: ReadonlySet<string>;
  /** Evidence text for grounding notes. Legacy callers may only have IDs. */
  evidenceText?: ReadonlyMap<string, string>;
  figureIds: ReadonlySet<string>;
  preferredFigureId?: string;
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
    const rule = slot.type === "string"
      ? key === "title" || key === "subtitle" ? textRule(slot.maxChars) : modelTextRule(slot.maxChars)
      : listRule(pointRule(slot.maxChars), slot.minItems, slot.maxItems);
    entries[key] = slot.required ? rule : optional(rule);
  }
  return recordRule(entries);
}

export function slideValidator(constraints: SlideConstraints): Validator<Slide> {
  const { outlineId, titlePage, evidenceIds, evidenceText, figureIds, preferredFigureId } = constraints;
  const idRule = literal(outlineId, "应与大纲项 ID 一致");
  const fields = {
    id: idRule,
    outlineId: idRule,
    layout: pipe(
      choiceRule(LAYOUT_IDS),
      check((layout) => (layout === "title") === titlePage, "首项应使用 title，内容项应使用内容版式"),
    ),
    slots: unknown(),
    figureId: optional(unknown()),
    notes: optional(string("应为字符串")),
  };
  const schema = recordRule(fields);
  const requiredFigure = pipe(textRule(64), check((id) => figureIds.has(id), "应引用本页可用原图"));
  const forbiddenFigure = undefined_("此版式应省略 figureId");

  return (input, warnings = []) => {
    const record = normalizeRecord(input, fields, "", warnings);
    const value = parseRule(schema, record ?? input, "slide");
    const { layout } = value;
    const definitions = LAYOUTS[layout].slots;
    // Observed with mimo-v2.5: figureId written inside slots instead of at the top level.
    const misplaced = (value.slots as Record<string, unknown> | undefined)?.figureId;
    if (value.figureId === undefined && typeof misplaced === "string") {
      value.figureId = misplaced;
      warnings.push("slots.figureId 上移为 figureId");
    }
    const normalizedSlots = normalizeRecord(value.slots, definitions, "slots", warnings);
    if (normalizedSlots) {
      for (const [key, slot] of Object.entries(normalizedSlots)) {
        const definition = definitions[key]!;
        if (definition.type === "points") {
          const path = `slots.${key}`;
          let points = slot;
          if (slot !== null && typeof slot === "object") {
            const prototype = Object.getPrototypeOf(slot);
            if (prototype === Object.prototype || prototype === null) {
              points = [slot];
              warnings.push(`${path} 单对象包装为数组`);
            }
          }
          normalizedSlots[key] = normalizePoints(points, definition.maxItems, path, warnings);
        }
      }
    }
    const rawSlots = parseRule(slotsRule(layout), normalizedSlots ?? value.slots, "slots", "slots");
    if (!titlePage) {
      const title = rawSlots.title as string;
      requireValid((title.match(/\p{Script=Han}/gu)?.length ?? 0) <= 22, "slots.title", "中文标题最多 22 个汉字");
    }
    const slots: Record<string, SlotValue> = {};
    const missing = new Set<string>();
    const cited = new Set<string>();
    for (const [key, slot] of Object.entries(rawSlots)) {
      if (slot === undefined) continue;
      slots[key] = slot;
      if (Array.isArray(slot)) {
        collectMissing(slot, evidenceIds, missing);
        for (const point of slot) {
          for (const id of point.evidenceIds) if (evidenceIds.has(id)) cited.add(id);
        }
      }
    }
    if (!titlePage && evidenceIds.size >= 2 && cited.size < 2) {
      warnings.push(`引用多样性不足：本页仅引用 ${cited.size} 个不同的可用证据 ID`);
    }
    const rawNotes = value.notes?.trim() || undefined;
    const notes = rawNotes !== undefined && evidenceText
      ? normalizeNotes(rawNotes, [...cited].flatMap((id) => evidenceText.get(id) ?? []), warnings)
      : rawNotes;
    if (notes !== undefined) parseRule(textRule(300), notes, "notes");
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
    const { requiresFigure } = LAYOUTS[layout];
    if (requiresFigure && value.figureId === undefined) {
      const fallback = preferredFigureId !== undefined && figureIds.has(preferredFigureId)
        ? preferredFigureId
        : figureIds.size === 1 ? figureIds.values().next().value : undefined;
      if (fallback !== undefined) {
        value.figureId = fallback;
        warnings.push(`figureId 缺失，补全为 ${fallback}`);
      }
    }
    const figureId = parseRule(requiresFigure ? requiredFigure : forbiddenFigure, value.figureId, "figureId");
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
