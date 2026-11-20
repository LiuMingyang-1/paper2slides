import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { ParseError, type Paper } from "../types";
import { BODY_PAGE_LIMIT, buildPaper } from "./blocks";
import { extractFigures } from "./figures";
import { layoutPage, type Box, type PageLayout } from "./layout";

export interface ParsePdfOptions {
  /** Defaults to 25 MiB. */
  maxBytes?: number;
  /** Defaults to true in the browser. */
  cropFigures?: boolean;
  /** Called after each PDF page's text has been read. */
  onProgress?: (pagesRead: number, totalPages: number) => void;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const MIN_PAGE_CHARS = 25;

function hasPdfHeader(bytes: Uint8Array): boolean {
  // PDF readers allow a transport prefix before the header, but only near the beginning.
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return /%PDF-\d\.\d/.test(header);
}

export async function parseWithPdfJs(
  buf: ArrayBuffer,
  load: (bytes: Uint8Array) => PDFDocumentLoadingTask,
  options: ParsePdfOptions = {},
): Promise<Paper> {
  if (buf.byteLength > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
    throw new ParseError("TOO_LARGE", "PDF 文件超过大小上限。");
  }
  if (!hasPdfHeader(new Uint8Array(buf))) throw new ParseError("NOT_PDF", "该文件不是 PDF。");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  let task: PDFDocumentLoadingTask | undefined;
  try {
    task = load(new Uint8Array(buf.slice(0)));
    const pdf = await task.promise;
    if (await pdf.getPermissions() !== null) {
      throw new ParseError("ENCRYPTED", "PDF 已加密，请上传解密后的版本。");
    }
    const metadata = await pdf.getMetadata().catch(() => undefined);
    const pages: PageLayout[] = [];
    const lowTextPages: number[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const chars = content.items.reduce((sum, item) =>
        sum + ("str" in item ? item.str.replace(/[^\p{L}\p{N}]/gu, "").length : 0), 0);
      if (chars < MIN_PAGE_CHARS) lowTextPages.push(number);
      if (number <= BODY_PAGE_LIMIT + 1) pages.push(layoutPage(number, page.view as Box, content));
      page.cleanup();
      options.onProgress?.(number, pdf.numPages);
      if (lowTextPages.length > pdf.numPages / 2) {
        throw new ParseError("SCANNED_NO_TEXT", "多数页面缺少可提取的文字，可能是扫描版 PDF。");
      }
    }
    const paper = buildPaper(id, pdf.numPages, pages, (metadata?.info ?? {}) as Record<string, unknown>, lowTextPages);
    if (options.cropFigures !== false && typeof document !== "undefined") {
      await extractFigures(pdf, paper, pages);
    }
    return paper;
  } catch (error) {
    if (error instanceof ParseError) throw error;
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ParseError("ENCRYPTED", "PDF 已加密，请上传解密后的版本。");
    }
    const failure = new ParseError("CORRUPT", "PDF 损坏或无法读取。");
    failure.cause = error;
    throw failure;
  } finally {
    await task?.destroy().catch(() => {});
  }
}
