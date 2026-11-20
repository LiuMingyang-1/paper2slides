import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFirstKeyWins } from "./duplicate-keys";
import { understandingValidator } from "../schema/understanding";

describe("parseFirstKeyWins", () => {
  it("keeps the first value of a duplicated key and reports its path", () => {
    const r = parseFirstKeyWins('{"modules":[{"kind":"problem","points":[],"kind":"fact"}]}');
    expect(r.value).toEqual({ modules: [{ kind: "problem", points: [] }] });
    expect(r.duplicates).toEqual(["modules[0].kind"]);
  });

  it("matches JSON.parse on inputs without duplicates", () => {
    const text = '{"a":[1,2.5,-3e2,true,false,null,"x\\"y\\\\z\\u00e9"],"b":{"c":{}},"d":[]}';
    expect(parseFirstKeyWins(text).value).toEqual(JSON.parse(text));
    expect(parseFirstKeyWins(text).duplicates).toEqual([]);
  });

  it("recovers every module from the real mimo-v2.5 BERT output", () => {
    const raw = readFileSync(join(__dirname, "fixtures/understand-bert-mimo-v1.raw.txt"), "utf8");
    const naive = JSON.parse(raw) as { modules: Array<{ kind: string }> };
    expect(naive.modules.every((m) => m.kind === "fact")).toBe(true); // the bug

    const { value, duplicates } = parseFirstKeyWins(raw);
    const kinds = (value as { modules: Array<{ kind: string }> }).modules.map((m) => m.kind);
    expect(kinds).toEqual(["problem", "method", "theory", "experiments", "ablation", "limitations"]);
    expect(duplicates.length).toBe(6);

    const ids = new Set<string>();
    for (const m of (value as { modules: Array<{ points: Array<{ evidenceIds: string[] }> }> }).modules)
      for (const p of m.points) p.evidenceIds.forEach((id) => ids.add(id));
    const result = understandingValidator(ids)(value, []);
    expect(result.value.modules.length).toBe(6);
  });
});
