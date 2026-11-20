import * as v from "valibot";
import type { Point } from "../types";
import { arrayMessage, choiceRule, collectMissing, objectRule, parseRule, pointRule, SchemaError, textRule } from "./rules";

export { countChars, SchemaError } from "./rules";

export interface Validation<T> {
  value: T;
  missingEvidenceIds: string[];
}

export type Validator<T> = (input: unknown, normalizations?: string[]) => Validation<T>;

export function requireValid(condition: unknown, path: string, rule: string): asserts condition {
  if (!condition) throw new SchemaError(path, rule);
}

export function object(input: unknown, path: string): Record<string, unknown> {
  return parseRule(objectRule, input, path);
}

export function fields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  parseRule(v.pipe(objectRule, v.check(
    (record) => Object.keys(record).every((key) => allowed.includes(key)),
    `仅允许字段 ${allowed.join(", ")}`,
  )), value, path);
}

export function array(input: unknown, path: string, min: number, max: number): unknown[] {
  return parseRule(v.custom<unknown[]>(
    (value) => Array.isArray(value) && value.length >= min && value.length <= max,
    arrayMessage(min, max),
  ), input, path);
}

export function string(input: unknown, path: string, maxChars: number): string {
  return parseRule(textRule(maxChars), input, path);
}

export function choice<T extends string>(input: unknown, allowed: readonly T[], path: string): T {
  return parseRule(choiceRule(allowed), input, path);
}

export function point(
  input: unknown,
  path: string,
  maxChars: number,
  evidenceIds: ReadonlySet<string>,
  missing: Set<string>,
): Point {
  const value = parseRule(pointRule(maxChars), input, path, path);
  collectMissing([value], evidenceIds, missing);
  return value;
}
