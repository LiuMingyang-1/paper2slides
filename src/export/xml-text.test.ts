import { describe, expect, it } from "vitest";
import { cleanXmlText } from "./xml-text";

describe("XML 1.0 text", () => {
  it("removes all forbidden controls, noncharacters and unpaired surrogates", () => {
    const controls = Array.from({ length: 32 }, (_, code) => code)
      .filter((code) => ![9, 10, 13].includes(code));
    const invalid = String.fromCharCode(...controls, 0xfffe, 0xffff);
    expect(cleanXmlText(`a${invalid}\ud800b\udfffc`)).toBe("abc");
  });

  it("preserves tabs, line breaks, supplementary characters and XML punctuation", () => {
    const valid = "中文\t\n\r & < > \u007f \u0085 \ufffd \u{10000} 😀 \u{10ffff}";
    expect(cleanXmlText(valid)).toBe(valid);
  });
});
