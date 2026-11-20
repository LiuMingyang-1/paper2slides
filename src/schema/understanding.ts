import { check, pipe } from "valibot";
import type { ModuleKind, Understanding } from "../types";
import { normalizePoints, normalizeRecord, trimList } from "./normalize";
import { choiceRule, collectMissing, listRule, modelTextRule, parseRule, pointRule, recordRule } from "./rules";
import { type Validator } from "./validation";

export const MODULE_KINDS = [
  "problem", "method", "theory", "experiments", "ablation", "taxonomy", "limitations", "future_work",
] as const satisfies readonly ModuleKind[];

export function understandingValidator(evidenceIds: ReadonlySet<string>, brief = false): Validator<Understanding> {
  const maxPoints = brief ? 2 : 4;
  const moduleFields = {
    kind: choiceRule(MODULE_KINDS),
    points: listRule(pointRule(brief ? 140 : 240), 1, maxPoints),
  };
  const fields = {
    title: modelTextRule(180),
    oneLiner: modelTextRule(280),
    modules: pipe(
      listRule(recordRule(moduleFields), 0, MODULE_KINDS.length),
      check((modules) => new Set(modules.map(({ kind }) => kind)).size === modules.length, "模块不得重复"),
    ),
  };
  const schema = recordRule(fields);

  return (input, warnings = []) => {
    const record = normalizeRecord(input, fields, "", warnings);
    if (record && Array.isArray(record.modules)) {
      const merged = new Map<ModuleKind, unknown[]>();
      const modules: unknown[] = [];
      record.modules.forEach((entry, index) => {
        const path = `modules[${index}]`;
        const module = normalizeRecord(entry, moduleFields, path, warnings, { type: "kind" });
        if (!module) {
          modules.push(entry);
          return;
        }
        const kind = MODULE_KINDS.find((kind) => kind === module.kind);
        if (!kind) {
          warnings.push(`丢弃模块 ${path}：kind 无效`);
          return;
        }
        if (!Array.isArray(module.points)) {
          modules.push(module);
          return;
        }
        if (module.points.length === 0) {
          warnings.push(`丢弃模块 ${path}：points 为空`);
          return;
        }
        const points = merged.get(kind);
        if (points) {
          for (const point of module.points) points.push(point);
          warnings.push(`合并模块 ${path} 至 ${kind}`);
        } else {
          const points = [...module.points];
          merged.set(kind, points);
          modules.push({ kind, points });
        }
      });
      record.modules = trimList(modules, MODULE_KINDS.length, "modules", warnings).map((entry, index) => {
        if (entry === null || typeof entry !== "object" || !Object.hasOwn(entry, "points")) return entry;
        const module = entry as Record<string, unknown>;
        return { ...module, points: normalizePoints(module.points, maxPoints, `modules[${index}].points`, warnings) };
      });
    }
    const value = parseRule(schema, record ?? input, "understanding");
    const missing = new Set<string>();
    for (const { points } of value.modules) collectMissing(points, evidenceIds, missing);
    return { value, missingEvidenceIds: [...missing] };
  };
}
