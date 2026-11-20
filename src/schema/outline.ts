import type { Emphasis, ModuleKind, Outline } from "../types";
import { array, choice, fields, object, requireValid, string, type Validator } from "./validation";

export function outlineValidator(
  emphasis: Emphasis,
  modules: readonly ModuleKind[],
  figureIds: ReadonlySet<string>,
  /** Allow the user to remove content pages in the confirmation step. */
  edited = false,
): Validator<Outline> {
  return (input) => {
    const value = object(input, "outline");
    fields(value, ["emphasis", "items"], "outline");
    requireValid(value.emphasis === emphasis, "emphasis", "应与请求参数一致");
    const items = array(value.items, "items", edited ? 1 : 5, 8).map((entry, index) => {
      const path = `items[${index}]`;
      const item = object(entry, path);
      fields(item, ["id", "title", "modules", "intent", "figureId"], path);
      const id = string(item.id, `${path}.id`, 32);
      requireValid(edited ? /^s[1-9]\d*$/.test(id) : id === `s${index + 1}`, `${path}.id`, "应为有效的页面编号");
      const kinds = array(item.modules, `${path}.modules`, index === 0 ? 0 : 1, index === 0 ? 0 : modules.length)
        .map((entry, i) => choice(entry, modules, `${path}.modules[${i}]`));
      requireValid(new Set(kinds).size === kinds.length, `${path}.modules`, "模块不得重复");
      let figureId: string | undefined;
      if (item.figureId !== undefined) {
        figureId = string(item.figureId, `${path}.figureId`, 64);
        requireValid(index > 0 && figureIds.has(figureId), `${path}.figureId`, "只允许内容页引用可用原图");
      }
      return {
        id,
        title: string(item.title, `${path}.title`, 150),
        intent: string(item.intent, `${path}.intent`, 200),
        modules: kinds,
        ...(figureId ? { figureId } : {}),
      };
    });
    requireValid(new Set(items.map((item) => item.id)).size === items.length, "items", "页面 ID 不得重复");
    return { value: { emphasis, items }, missingEvidenceIds: [] };
  };
}
