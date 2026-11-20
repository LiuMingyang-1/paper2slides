/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Paper } from "../types";
import { parseWithPdfJs, type ParsePdfOptions } from "./parse";
import { BundledCMapReader, BundledStandardFontReader } from "./resources";

export { extractFigures } from "./figures";
export type { ParsePdfOptions } from "./parse";

export function parsePdf(buf: ArrayBuffer, opts?: ParsePdfOptions): Promise<Paper> {
  GlobalWorkerOptions.workerSrc = workerUrl;
  return parseWithPdfJs(buf, (data) => getDocument({
    data, isEvalSupported: false, stopAtErrors: true, fontExtraProperties: true, useWorkerFetch: false,
    CMapReaderFactory: BundledCMapReader, StandardFontDataFactory: BundledStandardFontReader,
  }), opts);
}
