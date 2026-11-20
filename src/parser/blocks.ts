import type { Evidence, Figure, Paper, ParseWarning } from "../types";
import { height, median, union, width, type Line, type PageLayout } from "./layout";

export const BODY_PAGE_LIMIT = 40;
const MAX_BLOCK_LENGTH = 900;
const captionPattern = /^(Figure|Fig\.?|Table|图|表)\s*([0-9０-９]+[a-z]?)(?=$|[\s:：.、—–(（])/iu;
const inlineFigureReference = /^(?:\s*(?:illustrates?|shows?|presents?|indicates?|summari[sz]es?|reports?|contains?|lists?|compares?)\b|[.]\s+In this (?:table|figure)\b)/iu;
const ackPattern = /^acknowledg(?:e)?ments?\b|^致谢/u;
const referencesPattern = /^(?:references|bibliography|参考文献)\s*[:：.]?$/iu;
const ordinalPrefix = /^(?:\d+(?:\.\d+)*|[IVX]+)[.)]?\s+/u;
const abstractPattern = /^abstract\b|^摘要/u;
const knownHeading = /^(?:abstract|introduction|background|(?:related|prior) work|methods?|results?|discussion|conclusions?|limitations?|appendix|摘要|引言|绪论|背景|相关工作|方法|结果|讨论|结论|附录)[.:：]?$/iu;

export function captionLabel(text: string): { label: string; figureId?: string } | undefined {
  const match = captionPattern.exec(text);
  if (!match) return;
  const kind = match[1]!.toLowerCase();
  const number = match[2]!.normalize("NFKC").toLowerCase();
  if (kind === "表" || kind === "table") return { label: kind === "表" ? `表 ${number}` : `Table ${number}` };
  return { label: kind === "图" ? `图 ${number}` : `Figure ${number}`, figureId: `fig${number}` };
}

function runningMarks(pages: PageLayout[]): Set<string> {
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines) {
      const mark = marginMark(line, page);
      if (!mark || line.text.length > 180) continue;
      const seen = counts.get(mark) ?? new Set<number>();
      seen.add(page.page);
      counts.set(mark, seen);
    }
  }
  return new Set([...counts].filter(([, seen]) => seen.size >= 2).map(([mark]) => mark));
}

function marginMark(line: Line, page: PageLayout): string | undefined {
  const relativeY = (line.baseline - page.view[1]) / height(page.view);
  const edge = relativeY > 0.9 ? "top" : relativeY < 0.1 ? "bottom" : undefined;
  return edge && `${edge}:${line.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ")}`;
}

function cleanLines(page: PageLayout, marks: Set<string>): Line[] {
  return page.lines.filter((line) => {
    const mark = marginMark(line, page);
    return !mark || referencesPattern.test(line.text.replace(ordinalPrefix, "")) || (!marks.has(mark) && !/^(?:page\s+)?[-–—]?\s*(?:[0-9]+|[ivxlcdm]+)\s*[-–—]?$/i.test(line.text));
  });
}

function frontMatter(lines: Line[], page: PageLayout, metadata: Record<string, unknown>) {
  const top = lines.filter((line) => line.baseline >= page.view[1] + height(page.view) * 0.55);
  const likelyTitle = top.filter((line) => /\p{L}/u.test(line.text) &&
    !/^(?:arXiv:|preprint\b|©)/i.test(line.text));
  const largest = likelyTitle.reduce<Line | undefined>(
    (best, line) => !best || line.size > best.size + 0.1 ? line : best, undefined);
  const titleLines = largest ? likelyTitle.filter((line) =>
    Math.abs(line.size - largest.size) < largest.size * 0.12 &&
    Math.abs(line.baseline - largest.baseline) <= largest.size * 2.5) : [];
  titleLines.sort((a, b) => b.baseline - a.baseline || a.box[0] - b.box[0]);
  const title = joinLines(titleLines) || (typeof metadata.Title === "string" && metadata.Title.trim()) || "未识别标题";

  const lastTitle = titleLines.at(-1);
  const afterTitle = lastTitle ? lines.indexOf(lastTitle) + 1 : 0;
  const bodyStart = lines.findIndex((line, index) => index >= afterTitle &&
    (abstractPattern.test(line.text.toLowerCase()) || /^(?:1[.\s]+)?(?:Introduction\b|Introduction(?=AU\s*:)|引言|绪论)/iu.test(line.text)));
  const authorLines = lastTitle ? lines.slice(afterTitle, bodyStart < 0 ? undefined : bodyStart)
    .filter((line) => lastTitle.baseline - line.baseline < 112) : [];
  const authorText = typeof metadata.Author === "string" ? metadata.Author.trim() : "";
  const visibleAuthors = authorLines.flatMap((line) =>
      line.text.split(/\s{2,}|[,*†‡&;•]|\band\b/i)
        .map((name) => name.trim().replace(/\d+$/u, "").trim())
        .filter((name) => !/university|research|college|laboratory|institute|google|department|corporation/i.test(name) &&
          /^(?:\p{Lu}[\p{L}'’-]+\s+(?:\p{Lu}\.\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?|\p{Script=Han}{2,4})$/u.test(name)));
  const metadataAuthors = authorText.split(/\s*(?:;|,(?=\s)|\band\b)\s*/i).filter(Boolean);
  const authors = metadataAuthors.length > 1 ? metadataAuthors : [...new Set([
    ...metadataAuthors, ...visibleAuthors.filter((name) =>
      !metadataAuthors.some((author) => author.toLowerCase() === name.toLowerCase())),
  ])];
  return { title, authors, start: bodyStart >= 0 ? bodyStart : afterTitle };
}

function joinLines(lines: Line[]): string {
  let text = "";
  for (const line of lines) {
    if (!text) text = line.text;
    else if (text.endsWith("\u00ad")) text = text.slice(0, -1) + line.text;
    else if ((/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line.text)) ||
      (/\p{Script=Han}$/u.test(text) && /^\p{Script=Han}/u.test(line.text))) {
      text += line.text;
    } else text += " " + line.text;
  }
  return text;
}

function sectionLevel(line: Line, normalSize: number): number | undefined {
  const text = line.text.trim();
  if (knownHeading.test(text)) return 1;
  if (text.length > 112 || /[。.!?;]$/.test(text)) return;
  const ordinal = /^(\d+(?:\.\d+)*|[IVX]+)[.)]?\s+\p{L}/u.exec(text);
  if (ordinal && (line.bold || line.size >= normalSize * 1.04)) return ordinal[1]!.split(".").length;
  if (/^第[一二三四五六七八九十\d]+[章节]/u.test(text) && line.size >= normalSize * 1.04) return 1;
  if ((line.bold || line.size >= normalSize * 1.12) && text.length <= 70 &&
    /^(?:\p{Lu}|\p{Script=Han})/u.test(text)) return 1;
}

function isEquation(line: Line): boolean {
  const symbols = line.text.match(/[=±∑∏∫√≈≡≤≥≠∂∈∞∇×÷−]/g)?.length ?? 0;
  return symbols > 0 && line.text.length < 220 &&
    (/[=≈≤≥≡]\s*\S.*\(\d+\)\s*$/.test(line.text) ||
      !/(?:\p{L}{4,} ){2,}\p{L}{4,}|\p{Script=Han}{5}/u.test(line.text));
}

function isTableRow(line: Line): boolean {
  return line.cells >= 3 && (line.text.match(/(?:^|\s)[+−-]?\d+(?:[.,]\d+)?/g)?.length ?? 0) >= 2;
}

function flowsFrom(previous: Line, line: Line, type: Evidence["type"]): boolean {
  const step = previous.baseline - line.baseline;
  const size = Math.max(previous.size, line.size);
  const indent = line.box[0] - previous.box[0];
  const aligned = previous.column === line.column ||
    type === "caption" && previous.column === "full" && line.column === "left";
  return aligned && step > 0 && step <= size * 1.53 &&
    Math.abs(previous.size - line.size) < size * 0.2 &&
    (type === "table" || (indent < size * 0.9 && indent > -size * 3.5) ||
      (type === "caption" && Math.abs(indent) < size * 3));
}

function splitParagraph(lines: Line[]): Array<{ text: string; lines: Line[] }> {
  const text = joinLines(lines);
  if (text.length <= MAX_BLOCK_LENGTH) return [{ text, lines }];
  const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text);
  // Offsets include the separator inserted by joinLines; map each sentence group back to its lines.
  let offset = 0;
  const positions = lines.map((line) => {
    const start = text.indexOf(line.text.replace(/\u00ad$/, ""), offset);
    offset = start + line.text.replace(/\u00ad$/, "").length;
    return { start, end: offset, line };
  });
  const chunks: Array<{ text: string; lines: Line[] }> = [];
  let start = 0;
  let end = 0;
  function push() {
    chunks.push({
      text: text.slice(start, end).trim(),
      lines: positions.filter((item) => item.start < end && item.end > start).map((item) => item.line),
    });
  }
  for (const sentence of sentences) {
    const next = sentence.index + sentence.segment.length;
    if (end > start && next - start > MAX_BLOCK_LENGTH) {
      push();
      start = end;
    }
    end = next;
  }
  if (end > start) push();
  return chunks;
}

export function buildPaper(id: string, pageCount: number, pages: PageLayout[],
  metadata: Record<string, unknown>, lowTextPages: number[]): Paper {
  const blocks: Evidence[] = [];
  const figures: Figure[] = [];
  const warnings: ParseWarning[] = [];
  const marks = runningMarks(pages);
  const first = pages[0]!;
  const { title, authors, start } = frontMatter(cleanLines(first, marks), first, metadata);
  let sectionPath: string[] = [];
  let acknowledgements = false;
  let hasAbstract = false;
  let references = false;
  let truncated = false;
  let bodyPageCount = 0;

  for (const page of pages) {
    const lines = cleanLines(page, marks).slice(page.page === 1 ? start : 0)
      .filter((line) => !/^(?:a1{8,}|\d+\s*\/\s*\d+)$/u.test(line.text));
    const normalSize = median(lines.filter((line) => line.text.length > 35).map((line) => line.size), 10);
    let pending: Line[] = [];
    let type: Evidence["type"] = "text";
    let index = 0;
    function flush() {
      if (!pending.length) return;
      const chunks = type === "text" ? splitParagraph(pending) : [{ text: joinLines(pending), lines: pending }];
      for (const chunk of chunks) {
        const block: Evidence = {
          id: `e${page.page}-${++index}`, page: page.page, sectionPath: [...sectionPath], type,
          text: chunk.text, bbox: union(chunk.lines.length ? chunk.lines.map((line) => line.box) : pending.map((line) => line.box)),
        };
        blocks.push(block);
        const caption = type === "caption" ? captionLabel(block.text) : undefined;
        if (caption?.figureId) {
          const repeated = figures.some((figure) => figure.id === caption.figureId);
          figures.push({
            id: repeated ? `${caption.figureId}-${block.id}` : caption.figureId,
            label: caption.label, page: block.page, captionEvidenceId: block.id, cropOk: false,
          });
        }
      }
      pending = [];
    }

    for (const line of lines) {
      const text = line.text.trim().replace(/(?<=\p{L})AU\s*:.*$/u, "");
      const headingText = text.replace(ordinalPrefix, "").toLowerCase();
      if (referencesPattern.test(headingText)) {
        flush();
        references = true;
        break;
      }
      if (page.page > BODY_PAGE_LIMIT) {
        truncated = true;
        continue;
      }
      if (ackPattern.test(headingText)) {
        flush();
        acknowledgements = true;
        continue;
      }
      const caption = captionLabel(text);
      const captionSuffix = text.slice(captionPattern.exec(text)?.[0].length ?? text.length);
      const isCaption = caption && !inlineFigureReference.test(captionSuffix) &&
        !/^\s*,/u.test(captionSuffix) &&
        !(line.size >= normalSize * 0.98 && /^fig\.\s*\d+[a-z]\./iu.test(text));
      const level = isCaption ? undefined : sectionLevel(line, normalSize);
      if (abstractPattern.test(headingText) && (!hasAbstract || level !== undefined)) {
        flush();
        hasAbstract = true;
        sectionPath = [/^摘要/u.test(headingText) ? "摘要" : "Abstract"];
        if (level === undefined) pending.push(line);
        type = "text";
        continue;
      }
      if (level !== undefined) {
        if (acknowledgements && level !== 1) continue;
        flush();
        acknowledgements = false;
        sectionPath = [...sectionPath.slice(0, level - 1), text];
        continue;
      }
      if (acknowledgements) continue;
      const previous = pending.at(-1);
      let nextType: Evidence["type"] = "text";
      if (isCaption) nextType = "caption";
      else if (type === "caption" && previous && flowsFrom(previous, line, type)) nextType = "caption";
      else if (isTableRow(line)) nextType = "table";
      else if (isEquation(line)) nextType = "equation";
      if (previous && (isCaption || type !== nextType || !flowsFrom(previous, line, type))) flush();
      type = nextType;
      pending.push(line);
    }
    flush();
    if (page.page <= BODY_PAGE_LIMIT && (!references || index > 0)) bodyPageCount = page.page;
    if (references) break;
  }

  if (!references) warnings.push({ code: "REFERENCES_NOT_FOUND", message: "未找到参考文献标题。" });
  if (truncated || !references && pageCount > BODY_PAGE_LIMIT) {
    warnings.push({ code: "TRUNCATED_LONG_DOC", message: `仅保留前 ${BODY_PAGE_LIMIT} 页正文。` });
  }
  if (!hasAbstract && !references) warnings.push({ code: "NOT_LIKELY_PAPER", message: "未识别到摘要或参考文献。" });
  if (lowTextPages.length) warnings.push({
    code: "LOW_TEXT_PAGES", message: "部分页面的文字层内容很少。", pages: lowTextPages,
  });
  return { id, title, authors, pageCount, bodyPageCount, blocks, figures, warnings };
}
