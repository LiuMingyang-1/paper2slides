import { check, literal, optional, pipe } from "valibot";
import type { Emphasis, ModuleKind, Outline } from "../types";
import { normalizeRecord, trimList } from "./normalize";
import { choiceRule, listRule, modelTextRule, parseRule, recordRule, textRule } from "./rules";
import { requireValid, type Validator } from "./validation";

export function outlineValidator(
  emphasis: Emphasis,
  modules: readonly ModuleKind[],
  figureIds: ReadonlySet<string>,
  /** Allow the user to remove content pages in the confirmation step. */
  edited = false,
): Validator<Outline> {
  const maxItems = 8;
  const itemFields = {
    id: textRule(32),
    title: modelTextRule(150),
    intent: modelTextRule(200),
    modules: pipe(
      listRule(choiceRule(modules), 0, modules.length),
      check((items) => new Set(items).size === items.length, "模块不得重复"),
    ),
    figureId: optional(textRule(64)),
  };
  const fields = {
    emphasis: literal(emphasis, "应与请求参数一致"),
    items: pipe(
      listRule(recordRule(itemFields), edited ? 1 : 5, maxItems),
      check((items) => new Set(items.map(({ id }) => id)).size === items.length, "页面 ID 不得重复"),
    ),
  };
  const schema = recordRule(fields);

  return (input, warnings = []) => {
    const record = edited ? undefined : normalizeRecord(input, fields, "", warnings);
    if (record && Array.isArray(record.items)) {
      record.items = trimList(record.items, maxItems, "items", warnings).map((entry, index) => {
        const path = `items[${index}]`;
        const item = normalizeRecord(entry, itemFields, path, warnings);
        if (item && Array.isArray(item.modules)) {
          item.modules = trimList(item.modules, modules.length, `${path}.modules`, warnings);
        }
        return item ?? entry;
      });
    }
    const value = parseRule(schema, record ?? input, "outline");
    const items = value.items.map(({ figureId, ...item }, index) => {
      const path = `items[${index}]`;
      requireValid(edited ? /^s[1-9]\d*$/.test(item.id) : item.id === `s${index + 1}`,
        `${path}.id`, "应为有效的页面编号");
      requireValid(index === 0 ? item.modules.length === 0 : item.modules.length > 0,
        `${path}.modules`, `应为包含 ${index === 0 ? "0–0" : `1–${modules.length}`} 项的数组`);
      if (figureId !== undefined) {
        requireValid(index > 0 && figureIds.has(figureId), `${path}.figureId`, "只允许内容页引用可用原图");
      }
      return { ...item, ...(figureId !== undefined ? { figureId } : {}) };
    });
    return { value: { emphasis, items }, missingEvidenceIds: [] };
  };
}
