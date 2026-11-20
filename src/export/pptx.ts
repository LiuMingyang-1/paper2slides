import PptxGenJS from "pptxgenjs";
import { fitSlide, renderSlide, slideReady, type SlideMeasurement } from "../layout";
import type { Deck, Evidence, Paper } from "../types";
import { rectToInches } from "./coordinates";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const INCH_PER_PX = 1 / 128;
const POINTS_PER_PX = 72 * INCH_PER_PX;

interface ExportOptions {
  document?: Document;
  /** Measurements from the current, mounted, fitted preview, in deck order. */
  measurements?: readonly SlideMeasurement[];
}

const px = (value: string) => Number.parseFloat(value);
const styleOf = (el: HTMLElement) => el.ownerDocument.defaultView!.getComputedStyle(el);

function hex(value: string): string {
  const channels = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)?.slice(1, 4);
  return channels?.map((channel) => Number(channel).toString(16).padStart(2, "0")).join("").toUpperCase() ?? "17232D";
}

function textStyle(style: CSSStyleDeclaration, text: string) {
  return {
    fontFace: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? "Microsoft YaHei" : "Arial",
    fontSize: px(style.fontSize) * POINTS_PER_PX,
    bold: style.fontWeight === "bold" || px(style.fontWeight) >= 600,
    color: hex(style.color),
  };
}

function textRuns(el: HTMLElement, style: CSSStyleDeclaration): PptxGenJS.TextProps[] {
  return Array.from(el.childNodes, (node): PptxGenJS.TextProps => {
    const text = node.textContent ?? "";
    const inline = node.nodeType === 1 ? node as HTMLElement : undefined;
    const runStyle = inline ? styleOf(inline) : style;
    return {
      text,
      options: {
        ...textStyle(runStyle, text),
        ...(inline?.classList.contains("p2s-citation") ? {
          superscript: true,
          underline: inline.classList.contains("partial") ? { style: "dotted" } :
            inline.classList.contains("unsupported") ? { style: "sng" } : undefined,
        } : {}),
      },
    };
  });
}

function addTable(slide: PptxGenJS.Slide, table: HTMLTableElement, measurement: SlideMeasurement) {
  const box = (el: HTMLElement) => rectToInches(measurement.boxes.get(el)!, measurement.bounds);
  const rows = [...table.rows];
  const widths = [...rows[0]!.cells].map((cell) => box(cell).w);
  const heights = rows.map((row) => box(row).h);
  const tableRows: PptxGenJS.TableRow[] = rows.map((row) => [...row.cells].map((cell) => {
    const style = styleOf(cell);
    const margin = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
      .map((value) => (px(value) || 0) * INCH_PER_PX) as [number, number, number, number];
    const header = cell.tagName === "TH";
    return {
      text: textRuns(cell, style),
      options: {
        ...textStyle(style, cell.textContent ?? ""),
        margin,
        valign: "top",
        fill: { color: header ? hex(style.backgroundColor) : "FFFFFF" },
        border: [
          { type: "none" }, { type: "none" },
          { type: "solid", pt: POINTS_PER_PX, color: hex(style.borderBottomColor) },
          { type: "none" },
        ],
      },
    };
  }));
  slide.addTable(tableRows, { ...box(table), colW: widths, rowH: heights, autoPage: false, align: "left" });
}

function addObjects(slide: PptxGenJS.Slide, measurement: SlideMeasurement) {
  const { root, bounds, boxes } = measurement;
  for (const el of root.querySelectorAll<HTMLElement>("[data-pptx]")) {
    const position = rectToInches(boxes.get(el)!, bounds);
    switch (el.dataset.pptx) {
      case "text": {
        const style = styleOf(el);
        const bullet = el.dataset.bullet === "true";
        // Include the list gutter in a native bullet box so the text starts at the measured position.
        const gutterPx = bullet ? px(styleOf(el.parentElement!).paddingLeft) : 0;
        const gutter = gutterPx * INCH_PER_PX;
        slide.addText(textRuns(el, style), {
          ...position,
          x: position.x - gutter,
          w: position.w + gutter,
          ...textStyle(style, el.textContent ?? ""),
          align: style.textAlign === "right" || style.textAlign === "center" ? style.textAlign : "left",
          lineSpacing: px(style.lineHeight) * POINTS_PER_PX,
          valign: "top",
          margin: 0,
          isTextBox: true,
          bullet: bullet ? { characterCode: "2022", indent: gutterPx * POINTS_PER_PX } : false,
          wrap: !el.hasAttribute("data-single-line"),
        });
        break;
      }
      case "image": {
        const image = el as HTMLImageElement;
        slide.addImage({ ...position, data: image.src, altText: image.alt });
        break;
      }
      case "shape":
        slide.addShape("rect", {
          ...position,
          fill: { color: hex(styleOf(el).backgroundColor) },
          line: { type: "none" },
        });
        break;
      case "table":
        addTable(slide, el as HTMLTableElement, measurement);
        break;
    }
  }
}

function citationNotes(root: HTMLElement, evidence: ReadonlyMap<string, Evidence>, notes?: string) {
  const lines: string[] = [];
  const quote = (id: string) => {
    const block = evidence.get(id);
    return block ? `${id} (p.${block.page}) ${block.text}` : `${id}（未找到原文）`;
  };
  for (const cite of root.querySelectorAll<HTMLElement>("[data-evidence-ids]")) {
    const ids = cite.dataset.evidenceIds?.split(" ").filter(Boolean) ?? [];
    lines.push(`${cite.textContent} (${cite.dataset.status})\n${ids.length ? ids.map(quote).join("\n") : "未提供引用"}`);
  }
  const figureId = root.dataset.figureEvidenceId;
  if (figureId) lines.push(`原图\n${quote(figureId)}`);
  return [notes, lines.length ? ["引文", ...lines].join("\n\n") : ""].filter(Boolean).join("\n\n");
}

/** Export editable slides. Unfitted content must be resolved by the caller before export. */
export async function exportPptx(deck: Deck, paper: Paper, options: ExportOptions = {}): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = paper.title;
  const evidence = new Map(paper.blocks.map((block) => [block.id, block]));
  const doc = options.document ?? options.measurements?.[0]?.root.ownerDocument ?? document;
  if (options.measurements && options.measurements.length !== deck.slides.length) {
    throw new Error("Preview measurements must match the deck.");
  }
  const stage = doc.createElement("div");
  stage.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
  stage.setAttribute("aria-hidden", "true");
  if (!options.measurements) doc.body.append(stage);
  try {
    for (const [index, source] of deck.slides.entries()) {
      let measurement = options.measurements?.[index];
      if (!measurement) {
        const root = renderSlide(source, { paper, verifications: deck.verifications, document: doc });
        stage.replaceChildren(root);
        await slideReady(root);
        measurement = fitSlide(root);
      }
      if (measurement.root.dataset.slideId !== source.id || !measurement.bounds.width || !measurement.bounds.height) {
        throw new Error(`Slide ${source.id} must have a mounted layout measurement.`);
      }
      if (measurement.overflowingSlots.length) {
        throw new Error(`Slide ${source.id} overflows: ${measurement.overflowingSlots.join(", ")}`);
      }
      const slide = pptx.addSlide();
      slide.background = { color: hex(styleOf(measurement.root).backgroundColor) };
      addObjects(slide, measurement);
      slide.addNotes(citationNotes(measurement.root, evidence, source.notes));
    }
    const bytes = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
    return new Blob([bytes], { type: PPTX_MIME });
  } finally {
    stage.remove();
  }
}
