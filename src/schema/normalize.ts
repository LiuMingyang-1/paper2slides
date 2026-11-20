import { MAX_EVIDENCE_IDS, POINT_KINDS } from "./rules";

type RecordValue = Record<string, unknown>;

export function normalizeRecord(
  input: unknown,
  fields: object,
  path: string,
  warnings: string[],
  aliases: Readonly<Record<string, string>> = {},
): RecordValue | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;

  const record = Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(fields, key)));
  for (const [key, value] of Object.entries(input)) {
    if (Object.hasOwn(fields, key)) continue;
    const field = path ? `${path}.${key}` : key;
    const canonical = Object.hasOwn(aliases, key) ? aliases[key] : undefined;
    if (canonical && !Object.hasOwn(record, canonical)) {
      record[canonical] = value;
      warnings.push(`字段 ${field} 映射为 ${canonical}`);
    } else {
      warnings.push(`丢弃字段 ${field}`);
    }
  }
  return record;
}

export function trimList<T>(items: T[], max: number, path: string, warnings: string[]): T[] {
  if (items.length <= max) return items;
  warnings.push(`截断 ${path}：${items.length} 项保留前 ${max} 项`);
  return items.slice(0, max);
}

function restoreCitationSeparator(id: string, evidenceIds: ReadonlySet<string>): string {
  if (!/^e[1-9]\d+$/u.test(id)) return id;
  let match: string | undefined;
  for (let split = 2; split < id.length; split++) {
    const candidate = `${id.slice(0, split)}-${id.slice(split)}`;
    if (!evidenceIds.has(candidate)) continue;
    if (match) return id;
    match = candidate;
  }
  return match ?? id;
}

function normalizePoint(input: unknown, path: string, warnings: string[], evidenceIds: ReadonlySet<string>): unknown {
  const record = normalizeRecord(input, { text: true, kind: true, evidenceIds: true }, path, warnings, {
    type: "kind", evidence_ids: "evidenceIds", evidence: "evidenceIds", ids: "evidenceIds", evidenceId: "evidenceIds",
  });
  if (!record) return input;

  if (!POINT_KINDS.some((kind) => kind === record.kind)) {
    record.kind = "summary";
    warnings.push(`${path}.kind 默认为 summary`);
  }
  if (typeof record.evidenceIds === "string") {
    record.evidenceIds = [record.evidenceIds];
    warnings.push(`${path}.evidenceIds 转为数组`);
  }
  if (Array.isArray(record.evidenceIds)) {
    record.evidenceIds = trimList(record.evidenceIds, MAX_EVIDENCE_IDS, `${path}.evidenceIds`, warnings).map((id, index) => {
      if (typeof id !== "string") return id;
      const restored = restoreCitationSeparator(id, evidenceIds);
      if (restored !== id) warnings.push(`${path}.evidenceIds[${index}] 补全连字符为 ${restored}`);
      return restored;
    });
  }
  return record;
}

export function normalizePoints(
  input: unknown, max: number, path: string, warnings: string[], evidenceIds: ReadonlySet<string>,
): unknown {
  if (!Array.isArray(input)) return input;
  return trimList(input, max, path, warnings)
    .map((point, index) => normalizePoint(point, `${path}[${index}]`, warnings, evidenceIds));
}
