import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Paper } from "../types";
import { parseWithPdfJs, type ParsePdfOptions } from "./parse";

const assets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

/** Node entry point for fixture generation and tests. */
export function parsePdf(buf: ArrayBuffer, opts?: ParsePdfOptions): Promise<Paper> {
  return parseWithPdfJs(buf, (data) => getDocument({
    data,
    isEvalSupported: false,
    stopAtErrors: true,
    fontExtraProperties: true,
    cMapUrl: join(assets, "cmaps") + sep,
    standardFontDataUrl: join(assets, "standard_fonts") + sep,
  }), { ...opts, cropFigures: false });
}
