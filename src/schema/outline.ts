import { check, literal, optional, pipe } from "valibot";
import type { Emphasis, ModuleKind, Outline } from "../types";
import { choiceRule, listRule, parseRule, recordRule, textRule } from "./rules";
import { requireValid, type Validator } from "./validation";

export function outlineValidator(
  emphasis: Emphasis,
  modules: readonly ModuleKind[],
  figureIds: ReadonlySet<string>,
  /** Allow the user to remove content pages in the confirmation step. */
  edited = false,
): Validator<Outline> {
  const itemRule = recordRule({
    id: textRule(32),
    title: textRule(150),
    intent: textRule(200),
    modules: pipe(
      listRule(choiceRule(modules), 0, modules.length),
      check((items) => new Set(items).size === items.length, "模块不得重复"),
    ),
    figureId: optional(textRule(64)),
  });
  const schema = recordRule({
    emphasis: literal(emphasis, "应与请求参数一致"),
    items: pipe(
      listRule(itemRule, edited ? 1 : 5, 8),
      check((items) => new Set(items.map(({ id }) => id)).size === items.length, "页面 ID 不得重复"),
    ),
  });

  return (input) => {
    const value = parseRule(schema, input, "outline");
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
