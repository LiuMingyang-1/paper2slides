import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Evidence, Paper } from "../types";
import { height, layoutPage, width, type Box, type PageLayout } from "./layout";

const SCALE = 2;
const MAX_CROP_PIXELS = 4_000_000;

function isProse(block: Evidence): boolean {
  return block.type === "text" && (
    block.text.length >= 75 && block.text.split(/\s+/u).length >= 9 ||
    /\p{Script=Han}{25}/u.test(block.text)
  );
}

function overlapsX(box: Box, left: number, right: number): boolean {
  return Math.min(right, box[2]) - Math.max(left, box[0]) > 5;
}

export function figureRegion(layout: PageLayout, caption: Evidence, blocks: Evidence[]): Box | undefined {
  const [x0, y0, x1, y1] = layout.view;
  const [left, right] = layout.textBounds ?? [x0, x1];
  const gutter = layout.gutter;
  const center = (caption.bbox[0] + caption.bbox[2]) / 2;
  const bottom = Math.max(y0, caption.bbox[3] + 2);
  const nearby = blocks.filter((block) => block.page === caption.page && block.id !== caption.id);
  const above = nearby.filter((block) => block.bbox[1] >= bottom - 2 &&
    (block.type === "caption" || isProse(block)));
  const upperBound = (from: number, to: number) => above.reduce((top, block) =>
    overlapsX(block.bbox, from, to) ? Math.min(top, block.bbox[1] - 2) : top, y1 - 12);
  let cropLeft = left;
  let cropRight = right;
  if (gutter !== undefined &&
    (caption.bbox[2] <= gutter || caption.bbox[0] >= gutter) &&
    Math.abs(center - gutter) > width(layout.view) * 0.035) {
    const inLeftColumn = center < gutter;
    const mainTop = inLeftColumn ? upperBound(left, gutter) : upperBound(gutter, right);
    const oppositeLeft = inLeftColumn ? gutter : left;
    const oppositeRight = inLeftColumn ? right : gutter;
    // Left-aligned captions can be narrower than a full-width image. Use the other
    // column only when doing so does not include a meaningful strip of its prose.
    const hasOppositeBody = nearby.some((block) =>
      (isProse(block) || block.type === "caption") && overlapsX(block.bbox, oppositeLeft, oppositeRight) &&
      Math.min(mainTop, block.bbox[3]) - Math.max(bottom, block.bbox[1]) > 12);
    if (hasOppositeBody) {
      if (inLeftColumn) cropRight = gutter;
      else cropLeft = gutter;
    }
  }
  const box: Box = [cropLeft, bottom, cropRight, upperBound(cropLeft, cropRight)];
  return width(box) >= 45 && height(box) >= 32 && height(box) <= height(layout.view) * 0.84 ? box : undefined;
}

export function imageRows(pixels: Uint8ClampedArray, w: number, h: number): [number, number] | undefined {
  const ink = new Uint32Array(h);
  const rules = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const darkest = Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
      if (darkest < 225) ink[y]!++;
      if (darkest < 218 && Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) - darkest < 12) {
        rules[y]!++;
      }
    }
  }
  let start = 0;
  for (let y = 0; y < h / 2; y++) {
    // Running headers and tables are often separated from the image by a page rule and white space.
    if (rules[y]! > w * 0.8 && ink.slice(y + 3, y + 9).every((count) => count < w * 0.02)) start = y + 3;
  }
  let first = -1;
  let last = -1;
  let count = 0;
  for (let y = start; y < h; y++) {
    if (ink[y]! < 3) continue;
    if (first < 0) first = y;
    last = y;
    count += ink[y]!;
  }
  // A wide blank gap before the caption often means the crop caught an unrelated element above it.
  if (first < 0 || last - first < 45 || h - 1 - last > 30 * SCALE ||
      count < Math.max(250, w * (last - first) * 0.003)) return;
  return [Math.max(start, first - 4), Math.min(h, last + 5)];
}

async function renderRegion(page: PDFPageProxy, box: Box): Promise<string | undefined> {
  const viewport = page.getViewport({ scale: SCALE });
  const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(box);
  const x = Math.floor(Math.min(x0!, x1!));
  const y = Math.floor(Math.min(y0!, y1!));
  const w = Math.ceil(Math.max(x0!, x1!)) - x;
  const h = Math.ceil(Math.max(y0!, y1!)) - y;
  if (w <= 0 || h <= 0 || w * h > MAX_CROP_PIXELS) return;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -x, -y],
      background: "#fff" }).promise;
    const pixels = context.getImageData(0, 0, w, h);
    const rows = imageRows(pixels.data, w, h);
    if (!rows) return;
    const [first, end] = rows;
    canvas.height = end - first;
    context.putImageData(pixels, 0, -first);
    const png = canvas.toDataURL("image/png");
    return png.startsWith("data:image/png;") ? png : undefined;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Update figure crops and warnings in place. Call before destroying the document. */
export async function extractFigures(pdfDoc: PDFDocumentProxy, paper: Paper,
  layouts: readonly PageLayout[] = []): Promise<Paper> {
  if (typeof document === "undefined") return paper;
  paper.warnings = paper.warnings.filter((warning) => warning.code !== "FIGURE_CROP_FAILED");
  const evidence = new Map(paper.blocks.map((block) => [block.id, block]));
  const pages = new Map<number, Promise<{ page: PDFPageProxy; layout: PageLayout }>>();
  for (const figure of paper.figures) {
    figure.cropOk = false;
    delete figure.imageDataUrl;
    try {
      const caption = evidence.get(figure.captionEvidenceId);
      if (!caption) throw new Error("Missing caption");
      let source = pages.get(figure.page);
      if (!source) {
        source = pdfDoc.getPage(figure.page).then(async (page) => ({
          page,
          layout: layouts.find((layout) => layout.page === figure.page) ??
            layoutPage(figure.page, page.view as Box, await page.getTextContent()),
        }));
        pages.set(figure.page, source);
      }
      const { page, layout } = await source;
      const box = figureRegion(layout, caption, paper.blocks);
      const png = box && await renderRegion(page, box);
      if (png) {
        figure.imageDataUrl = png;
        figure.cropOk = true;
      }
    } catch {
      // A rendering error affects this figure only; the caption stays citable.
    }
    if (!figure.cropOk) paper.warnings.push({
      code: "FIGURE_CROP_FAILED", pages: [figure.page],
      message: `${figure.label} 截取失败，请参见原文第 ${figure.page} 页。`,
    });
  }
  return paper;
}
