declare module "pdfjs-dist/web/pdf_viewer.mjs" {
  import type { PDFDocumentProxy } from "pdfjs-dist";
  import { PDFViewer as BaseViewer } from "pdfjs-dist/types/web/pdf_viewer.component";

  export { EventBus, PDFLinkService } from "pdfjs-dist/types/web/pdf_viewer.component";

  // The built viewer supports these at runtime, but the generated types omit them.
  export class PDFViewer extends BaseViewer {
    constructor(options: ConstructorParameters<typeof BaseViewer>[0] & { abortSignal?: AbortSignal });
    setDocument(pdf: PDFDocumentProxy | null): void;
    l10n: NonNullable<BaseViewer["l10n"]> & { destroy(): Promise<void> };
  }
}
