import type { ModuleKind, Understanding } from "../types";
import { array, choice, fields, object, point, requireValid, string, type Validator } from "./validation";

export const MODULE_KINDS = [
  "problem", "method", "theory", "experiments", "ablation", "taxonomy", "limitations", "future_work",
] as const satisfies readonly ModuleKind[];

export function understandingValidator(evidenceIds: ReadonlySet<string>, brief = false): Validator<Understanding> {
  return (input) => {
    const value = object(input, "understanding");
    fields(value, ["title", "oneLiner", "modules"], "understanding");
    const missing = new Set<string>();
    const modules = array(value.modules, "modules", 0, MODULE_KINDS.length).map((entry, index) => {
      const path = `modules[${index}]`;
      const module = object(entry, path);
      fields(module, ["kind", "points"], path);
      return {
        kind: choice(module.kind, MODULE_KINDS, `${path}.kind`),
        points: array(module.points, `${path}.points`, 1, brief ? 2 : 4).map((entry, i) =>
          point(entry, `${path}.points[${i}]`, brief ? 140 : 240, evidenceIds, missing)),
      };
    });
    requireValid(new Set(modules.map((module) => module.kind)).size === modules.length, "modules", "模块不得重复");
    return {
      value: {
        title: string(value.title, "title", 180),
        oneLiner: string(value.oneLiner, "oneLiner", 280),
        modules,
      },
      missingEvidenceIds: [...missing],
    };
  };
}
