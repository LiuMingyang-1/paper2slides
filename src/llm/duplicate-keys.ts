// Real models sometimes emit the same key twice in one object. Observed with
// xiaomi/mimo-v2.5 on the understand prompt (src/llm/fixtures/understand-bert-mimo-v1.raw.txt):
//   {"kind":"problem","points":[ … {"kind":"fact"} … ],"kind":"fact"}
// The trailing "kind" leaks from the nested Point schema. JSON.parse keeps the LAST
// value, which silently turns every module kind into "fact" and the validator then
// drops every module. The first occurrence is the one the model meant, so we keep it.
//
// This scanner re-parses already-valid JSON text with first-wins semantics. It is only
// called after JSON.parse succeeded, so it can assume well-formed input.

export interface DuplicateKeyResult {
  value: unknown;
  /** JSON-path-ish locations of dropped duplicate keys, e.g. "modules[0].kind". */
  duplicates: string[];
}

export function parseFirstKeyWins(text: string): DuplicateKeyResult {
  let i = 0;
  const duplicates: string[] = [];

  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };

  const readString = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") i += 2;
      else if (c === '"') { i++; break; }
      else i++;
    }
    return JSON.parse(text.slice(start, i)) as string;
  };

  const readValue = (path: string): unknown => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      if (text[i] === "}") { i++; return obj; }
      for (;;) {
        ws();
        const key = readString();
        ws();
        i++; // colon
        const childPath = path ? `${path}.${key}` : key;
        const value = readValue(childPath);
        if (Object.hasOwn(obj, key)) duplicates.push(childPath);
        else obj[key] = value;
        ws();
        if (text[i] === ",") { i++; continue; }
        i++; // closing brace
        return obj;
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(readValue(`${path}[${arr.length}]`));
        ws();
        if (text[i] === ",") { i++; continue; }
        i++; // closing bracket
        return arr;
      }
    }
    if (c === '"') return readString();
    const start = i;
    while (i < text.length && !/[\s,\]}]/.test(text[i]!)) i++;
    return JSON.parse(text.slice(start, i));
  };

  const value = readValue("");
  return { value, duplicates };
}
