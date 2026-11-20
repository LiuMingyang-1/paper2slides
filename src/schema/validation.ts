import type { Point } from "../types";

export class SchemaError extends Error {
  constructor(path: string, rule: string) {
    super(`${path}：${rule}`);
    this.name = "SchemaError";
  }
}

export interface Validation<T> {
  value: T;
  missingEvidenceIds: string[];
}

export type Validator<T> = (input: unknown) => Validation<T>;

export function requireValid(condition: unknown, path: string, rule: string): asserts condition {
  if (!condition) throw new SchemaError(path, rule);
}

export function object(input: unknown, path: string): Record<string, unknown> {
  requireValid(input !== null && typeof input === "object" && !Array.isArray(input), path, "应为对象");
  return input as Record<string, unknown>;
}

export function fields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  requireValid(Object.keys(value).every((key) => allowed.includes(key)), path, `仅允许字段 ${allowed.join(", ")}`);
}

export function array(input: unknown, path: string, min: number, max: number): unknown[] {
  requireValid(Array.isArray(input) && input.length >= min && input.length <= max, path, `应为包含 ${min}–${max} 项的数组`);
  return input;
}

/** Unicode code points, including whitespace and punctuation. */
export function countChars(text: string): number {
  return Array.from(text).length;
}

export function string(input: unknown, path: string, maxChars: number): string {
  requireValid(typeof input === "string" && input.trim().length > 0, path, "应为非空字符串");
  requireValid(countChars(input) <= maxChars, path, `最多 ${maxChars} 个字符`);
  return input;
}

export function choice<T extends string>(input: unknown, allowed: readonly T[], path: string): T {
  requireValid(typeof input === "string" && (allowed as readonly string[]).includes(input), path, `应为 ${allowed.join(" / ")} 之一`);
  return input as T;
}

const POINT_KINDS = ["fact", "summary", "opinion"] as const;
const EVIDENCE_ID = /^e[1-9]\d*-\d+$/;

export function point(
  input: unknown,
  path: string,
  maxChars: number,
  evidenceIds: ReadonlySet<string>,
  missing: Set<string>,
): Point {
  const value = object(input, path);
  fields(value, ["text", "kind", "evidenceIds"], path);
  const evidencePath = `${path}.evidenceIds`;
  const citations = array(value.evidenceIds, evidencePath, 1, 4).map((id, index) => {
    requireValid(typeof id === "string" && EVIDENCE_ID.test(id), `${evidencePath}[${index}]`, "应为 e{页码}-{块序号}");
    if (!evidenceIds.has(id)) missing.add(id);
    return id;
  });
  requireValid(new Set(citations).size === citations.length, evidencePath, "证据 ID 不得重复");
  return {
    text: string(value.text, `${path}.text`, maxChars),
    kind: choice(value.kind, POINT_KINDS, `${path}.kind`),
    evidenceIds: citations,
  };
}
