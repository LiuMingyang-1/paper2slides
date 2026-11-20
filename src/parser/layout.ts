import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { Evidence } from "../types";

export type Box = Evidence["bbox"];

interface Span {
  text: string;
  box: Box;
  baseline: number;
  size: number;
  bold: boolean;
  leadingSpace?: boolean;
  trailingSpace?: boolean;
}

export interface Line extends Span {
  column: "left" | "right" | "full";
  cells: number;
}

export interface PageLayout {
  page: number;
  view: Box;
  lines: Line[];
  gutter?: number;
  textBounds?: [number, number];
}

export const width = (box: Box) => box[2] - box[0];
export const height = (box: Box) => box[3] - box[1];

export function median(values: number[], fallback: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? fallback;
}

export function union(boxes: Box[]): Box {
  return boxes.reduce<Box>((result, box) => [
    Math.min(result[0], box[0]),
    Math.min(result[1], box[1]),
    Math.max(result[2], box[2]),
    Math.max(result[3], box[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

function horizontalSpans(content: TextContent): Span[] {
  return content.items.flatMap((item) => {
    if (!("str" in item)) return [];
    const text = item.str.normalize("NFC").trim();
    const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform;
    const style: (TextContent["styles"][string] & { fontSubstitution?: string }) | undefined = content.styles[item.fontName];
    if (!text || style?.vertical || Math.abs(b) > Math.abs(a) * 0.25 || a <= 0) return [];
    const size = Math.hypot(c, d) || item.height || Math.abs(a);
    if (![size, x, y, item.width].every(Number.isFinite) || size <= 0) return [];
    return [{
      text, size, baseline: y,
      leadingSpace: /^\s/u.test(item.str), trailingSpace: /\s$/u.test(item.str),
      box: [x, y + size * (style?.descent ?? -0.2), x + Math.max(item.width, size * 0.1),
        y + size * (style?.ascent ?? 0.8)],
      bold: /bold|black|heavy/i.test(`${style?.fontFamily ?? ""} ${style?.fontSubstitution ?? ""}`),
    }];
  });
}

function combine(spans: Span[], column: Line["column"]): Line {
  const first = spans[0]!;
  let text = first.text;
  let cells = 1;
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i]!;
    const previous = spans[i - 1]!;
    const gap = span.box[0] - previous.box[2];
    const size = Math.min(span.size, previous.size);
    if (gap > size * 1.45) cells++;
    const addSpace = gap > size * 0.16 && !(/\p{Script=Han}$/u.test(text) &&
      /^\p{Script=Han}/u.test(span.text));
    const separator = gap > size * 1.45 ? "  " :
      addSpace || span.leadingSpace || previous.trailingSpace ? " " : "";
    text += separator + span.text;
  }
  return {
    text, box: union(spans.map((s) => s.box)), baseline: first.baseline,
    size: Math.max(...spans.map((s) => s.size)),
    bold: spans.filter((s) => s.bold).reduce((sum, s) => sum + s.text.length, 0) >= text.length * 0.6,
    column, cells,
  };
}

function lineRows(spans: Span[]): Span[][] {
  const rows: Span[][] = [];
  const sorted = spans.sort((a, b) => b.baseline - a.baseline || a.box[0] - b.box[0]);
  for (const span of sorted) {
    const row = rows.at(-1);
    const anchor = row?.[0];
    if (row && anchor && anchor.baseline - span.baseline <=
      Math.max(0.8, Math.min(anchor.size, span.size) * 0.3)) row.push(span);
    else rows.push([span]);
  }
  return rows.map((row) => row.sort((a, b) => a.box[0] - b.box[0]));
}

function splitAtGaps(row: Span[], minGap: number): Span[][] {
  const groups: Span[][] = [];
  let end = -Infinity;
  for (const span of row) {
    if (!groups.length || span.box[0] - end >= minGap) groups.push([]);
    groups.at(-1)!.push(span);
    end = Math.max(end, span.box[2]);
  }
  return groups;
}

function findGutter(rows: Span[][], view: Box): number | undefined {
  const pageWidth = width(view);
  const candidates = rows.flatMap((row) =>
    splitAtGaps(row, Math.max(12, pageWidth * 0.024))
      .map((group) => combine(group, "full"))
      .filter((line) => width(line.box) >= pageWidth * 0.21 &&
        width(line.box) <= pageWidth * 0.52 && /\p{L}{4}/u.test(line.text)));
  const left = candidates.filter((line) => line.box[0] < view[0] + pageWidth * 0.29);
  const right = candidates.filter((line) => line.box[0] > view[0] + pageWidth * 0.43 &&
    line.box[0] < view[0] + pageWidth * 0.67);
  if (left.length < 4 || right.length < 4) return;
  const rightStarts = right.map((line) => line.box[0]);
  for (const start of rightStarts) {
    const rightCluster = right.filter((line) => Math.abs(line.box[0] - start) < pageWidth * 0.025);
    const leftCluster = left.filter((line) => line.box[2] <= start - pageWidth * 0.008);
    if (rightCluster.length < 4 || leftCluster.length < 4) continue;
    const overlaps = rightCluster.filter((r) =>
      leftCluster.some((l) => Math.abs(l.baseline - r.baseline) < pageWidth * 0.05));
    if (overlaps.length >= 3) {
      const leftEnd = Math.max(...leftCluster.map((line) => line.box[2]));
      return (leftEnd + median(rightCluster.map((line) => line.box[0]), start)) / 2;
    }
  }
}

function readingOrder(lines: Line[]): Line[] {
  const ordered: Line[] = [];
  let left: Line[] = [];
  let right: Line[] = [];
  for (const line of lines) {
    if (line.column === "left") left.push(line);
    else if (line.column === "right") right.push(line);
    else {
      ordered.push(...left, ...right, line);
      left = [];
      right = [];
    }
  }
  return ordered.concat(left, right);
}

export function layoutPage(page: number, view: Box, content: TextContent): PageLayout {
  const rows = lineRows(horizontalSpans(content));
  const gutter = findGutter(rows, view);
  const lines = rows.flatMap((row) => {
    if (gutter === undefined) return [combine(row, "full")];
    const maxLeft = gutter - 2;
    const minRight = gutter + 2;
    if (row.some((span) => span.box[0] < minRight && span.box[2] > maxLeft)) {
      return [combine(row, "full")];
    }
    const left = row.filter((span) => span.box[2] <= maxLeft);
    const right = row.filter((span) => span.box[0] >= minRight);
    return [
      ...(left.length ? [combine(left, "left")] : []),
      ...(right.length ? [combine(right, "right")] : []),
    ];
  });
  // Use text margins rather than the physical page edges for figure crops.
  const longLines = lines.filter((line) => width(line.box) > width(view) * 0.2);
  const bounds = longLines.length ? union(longLines.map((line) => line.box)) : undefined;
  return {
    page, view, gutter, lines: readingOrder(lines),
    textBounds: bounds && [Math.max(view[0], bounds[0]), Math.min(view[2], bounds[2])],
  };
}
