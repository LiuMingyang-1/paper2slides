/** Remove XML 1.0 forbidden characters, preserving whitespace and valid surrogate pairs. */
export function cleanXmlText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "");
}
