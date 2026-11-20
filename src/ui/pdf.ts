/// <reference types="vite/client" />
import { AnnotationEditorType, AnnotationMode, getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { BundledCMapReader, BundledStandardFontReader } from "../parser/resources";
import type { Evidence } from "../types";
import { el } from "./dom";

export async function openPdf(container: HTMLDivElement, bytes: ArrayBuffer, onPage: (page: number, total: number) => void) {
  // The viewer reads globalThis.pdfjsLib, populated by the runtime import above.
  const { PDFViewer, EventBus, PDFLinkService } = await import("pdfjs-dist/web/pdf_viewer.mjs");
  GlobalWorkerOptions.workerSrc = workerUrl;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const surface = el("div", "pdfViewer");
  container.replaceChildren(surface);
  const listeners = new AbortController();
  const viewer = new PDFViewer({
    container, viewer: surface, eventBus, linkService, annotationMode: AnnotationMode.DISABLE,
    abortSignal: listeners.signal, annotationEditorMode: AnnotationEditorType.DISABLE, maxCanvasPixels: 8_000_000,
  });
  linkService.setViewer(viewer);
  const task = getDocument({
    data: new Uint8Array(bytes.slice(0)), isEvalSupported: false, useWorkerFetch: false, disableAutoFetch: true,
    CMapReaderFactory: BundledCMapReader, StandardFontDataFactory: BundledStandardFontReader,
  });
  let active: Evidence | undefined;
  let highlight: HTMLElement | undefined;
  let initialized = false;
  const fitWidth = () => {
    if (initialized && container.clientWidth) viewer.currentScaleValue = "page-width";
  };
  const resize = new ResizeObserver(fitWidth);
  function paint() {
    highlight?.remove();
    if (!active) return;
    const view = viewer.getPageView(active.page - 1);
    if (!view?.pdfPage) return;
    const [x0, y0, x1, y1] = view.viewport.convertToViewportRectangle(active.bbox) as [number, number, number, number];
    highlight = el("div", "evidence-highlight");
    highlight.setAttribute("aria-hidden", "true");
    Object.assign(highlight.style, {
      left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`,
      width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`,
    });
    view.div.append(highlight);
  }
  function jump() {
    if (!active || !initialized) return;
    const view = viewer.getPageView(active.page - 1);
    const viewport = view?.viewport;
    const scrollableHeight = (viewport?.height ?? 0) - container.clientHeight;
    if (viewport && scrollableHeight > 0) {
      const box = viewport.convertToViewportRectangle(active.bbox);
      const top = Math.min(scrollableHeight, Math.max(0, Math.min(box[1], box[3]) - 18));
      const [x, y] = viewport.convertToPdfPoint(0, top);
      viewer.scrollPageIntoView({
        pageNumber: active.page, destArray: [null, { name: "XYZ" }, x, y, null], ignoreDestinationZoom: true,
      });
    } else viewer.scrollPageIntoView({ pageNumber: active.page });
    paint();
  }
  eventBus.on("pagesinit", () => {
    initialized = true;
    fitWidth();
    onPage(viewer.currentPageNumber, viewer.pagesCount);
    jump();
  });
  eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => onPage(pageNumber, viewer.pagesCount));
  eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
    if (pageNumber === active?.page) paint();
  });
  async function destroy() {
    resize.disconnect();
    listeners.abort();
    viewer.setDocument(null);
    await Promise.all([task.destroy(), viewer.l10n.destroy()]);
  }
  try {
    const pdf = await task.promise;
    // PDF.js schedules these requests without a cancellation handler in setDocument.
    await Promise.all([pdf.getMetadata(), pdf.getPage(1), pdf.getOptionalContentConfig({ intent: "display" })]);
    linkService.setDocument(pdf);
    viewer.setDocument(pdf);
    resize.observe(container);
  } catch (error) {
    await destroy();
    throw error;
  }
  return {
    reveal(evidence: Evidence) {
      active = evidence;
      jump();
    },
    move(delta: number) {
      if (!initialized) return;
      const pageNumber = Math.max(1, Math.min(viewer.pagesCount, viewer.currentPageNumber + delta));
      viewer.scrollPageIntoView({ pageNumber });
    },
    destroy,
  };
}
