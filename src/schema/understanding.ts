import { check, pipe } from "valibot";
import type { ModuleKind, Understanding } from "../types";
import { choiceRule, collectMissing, listRule, parseRule, pointRule, recordRule, textRule } from "./rules";
import { type Validator } from "./validation";

export const MODULE_KINDS = [
  "problem", "method", "theory", "experiments", "ablation", "taxonomy", "limitations", "future_work",
] as const satisfies readonly ModuleKind[];

export function understandingValidator(evidenceIds: ReadonlySet<string>, brief = false): Validator<Understanding> {
  const moduleRule = recordRule({
    kind: choiceRule(MODULE_KINDS),
    points: listRule(pointRule(brief ? 140 : 240), 1, brief ? 2 : 4),
  });
  const schema = recordRule({
    title: textRule(180),
    oneLiner: textRule(280),
    modules: pipe(
      listRule(moduleRule, 0, MODULE_KINDS.length),
      check((modules) => new Set(modules.map(({ kind }) => kind)).size === modules.length, "模块不得重复"),
    ),
  });

  return (input) => {
    const value = parseRule(schema, input, "understanding");
    const missing = new Set<string>();
    for (const { points } of value.modules) collectMissing(points, evidenceIds, missing);
    return { value, missingEvidenceIds: [...missing] };
  };
}
