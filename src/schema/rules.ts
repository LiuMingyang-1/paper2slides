import * as v from "valibot";
import type { Point } from "../types";

export class SchemaError extends Error {
  constructor(path: string, rule: string) {
    super(`${path}：${rule}`);
    this.name = "SchemaError";
  }
}

/** Unicode code points, including whitespace and punctuation. */
export function countChars(text: string): number {
  return Array.from(text).length;
}

export const objectRule = v.custom<Record<string, unknown>>(
  (input) => input !== null && typeof input === "object" && !Array.isArray(input),
  "应为对象",
);

export function arrayMessage(min: number, max: number): string {
  return `应为包含 ${min}–${max} 项的数组`;
}

export function parseRule<T>(rule: v.GenericSchema<unknown, T>, input: unknown, root: string, parent = ""): T {
  const result = v.safeParse(rule, input);
  if (result.success) return result.output;

  const errors = result.issues.slice(0, 3).map((issue) => {
    const parts = issue.path ?? [];
    const extra = issue.type === "strict_object" && issue.expected === "never" && parts.at(-1)?.origin === "key";
    const path = (extra ? parts.slice(0, -1) : parts).reduce(
      (prefix, { type, key }) => type === "array" ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : String(key),
      parent,
    );
    const missing = issue.type === "strict_object" && parts.at(-1)?.origin === "key";
    return {
      path: path || root,
      rule: extra ? "含未定义字段" : missing ? "应提供此字段" : issue.message,
    };
  });
  const [first, ...rest] = errors;
  throw new SchemaError(first!.path, [first!.rule, ...rest.map(({ path, rule }) => `${path}：${rule}`)].join("；"));
}

export function recordRule<const T extends v.ObjectEntries>(entries: T) {
  return v.pipe(objectRule, v.strictObject(entries, "应为对象"));
}

export function textRule(maxChars: number) {
  return v.pipe(
    v.string("应为非空字符串"),
    v.check((text) => text.trim().length > 0, "应为非空字符串"),
    v.check((text) => countChars(text) <= maxChars, `最多 ${maxChars} 个字符`),
  );
}

export function modelTextRule(maxChars: number) {
  return textRule(maxChars * 2);
}

export function listRule<T extends v.GenericSchema>(item: T, min: number, max: number) {
  const message = arrayMessage(min, max);
  return v.pipe(v.array(item, message), v.minLength(min, message), v.maxLength(max, message));
}

export function choiceRule<T extends string>(allowed: readonly T[]) {
  return v.picklist(allowed, `应为 ${allowed.join(" / ")} 之一`);
}

export const POINT_KINDS = ["fact", "summary", "opinion"] as const;
export const MAX_EVIDENCE_IDS = 4;
const EVIDENCE_ID = /^e[1-9]\d*-\d+$/;
const EVIDENCE_RULE = "应为 e{页码}-{块序号}";
const citationsRule = v.pipe(
  listRule(v.pipe(v.string(EVIDENCE_RULE), v.regex(EVIDENCE_ID, EVIDENCE_RULE)), 1, MAX_EVIDENCE_IDS),
  v.check((ids) => new Set(ids).size === ids.length, "证据 ID 不得重复"),
);

export function pointRule(maxChars: number) {
  return recordRule({
    text: modelTextRule(maxChars),
    kind: choiceRule(POINT_KINDS),
    evidenceIds: citationsRule,
  });
}

export function collectMissing(points: readonly Point[], evidenceIds: ReadonlySet<string>, missing: Set<string>): void {
  for (const point of points) {
    for (const id of point.evidenceIds) {
      if (!evidenceIds.has(id)) missing.add(id);
    }
  }
}
