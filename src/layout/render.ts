import { LAYOUTS } from "../schema/layouts";
import type { Paper, Point, PointVerification, Slide } from "../types";
import { fitSlide } from "./measure";
import "./slide.css";

export interface RenderOptions {
  paper?: Pick<Paper, "blocks" | "figures">;
  verifications?: readonly PointVerification[];
  document?: Document;
}

/** Citation data is consumed by the preview UI and the PPTX notes writer. */
export function renderSlide(slide: Slide, options: RenderOptions = {}): HTMLElement {
  const doc = options.document ?? document;
  const definition = LAYOUTS[slide.layout];
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "") => {
    const el = doc.createElement(tag);
    el.className = className;
    return el;
  };
  const root = make("article", "p2s-slide");
  root.dataset.layout = slide.layout;
  root.dataset.slideId = slide.id;

  const pages = new Set<number>();
  const evidence = new Map(options.paper?.blocks.map((block) => [block.id, block]));
  const checks = new Map(options.verifications?.filter((check) => check.slideId === slide.id)
    .map((check) => [`${check.slot}:${check.pointIndex}`, check]));
  const figure = definition.requiresFigure ? options.paper?.figures.find(({ id }) => id === slide.figureId) : undefined;
  if (figure) {
    pages.add(figure.page);
    root.dataset.figureEvidenceId = figure.captionEvidenceId;
  }

  const text = (name: string) => {
    const value = slide.slots[name];
    return definition.slots[name]?.type === "string" && typeof value === "string" ? value : "";
  };
  const points = (name: string) => {
    const value = slide.slots[name];
    return definition.slots[name]?.type === "points" && Array.isArray(value) ? value : [];
  };
  const mark = <T extends HTMLElement>(el: T, name: string) => {
    el.dataset.slot = name;
    return el;
  };
  const textBox = <K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = "") => {
    const el = make(tag, `p2s-text ${className}`);
    el.dataset.pptx = "text";
    el.textContent = value;
    return el;
  };

  let number = 0;
  const cite = (el: HTMLElement, point: Point, slot: string, index: number) => {
    if (point.kind === "opinion") {
      const label = make("span", "p2s-opinion");
      label.textContent = "解读";
      el.append("\u00a0", label);
    }
    const ids = [...new Set(point.evidenceIds)];
    for (const id of ids) {
      const page = evidence.get(id)?.page;
      if (page !== undefined) pages.add(page);
    }
    const check = checks.get(`${slot}:${index}`);
    const status = check?.status ?? "unsupported";
    const ref = make("sup", `p2s-citation ${status}`);
    ref.textContent = `[${++number}]`;
    ref.dataset.evidenceIds = ids.join(" ");
    ref.dataset.status = status;
    ref.setAttribute("aria-label", `${ref.textContent} ${status}`);
    el.append("\u00a0", ref);
  };

  const list = (slot: string, className = "") => {
    const items = points(slot);
    if (!items.length) return undefined;
    const ul = mark(make("ul", `p2s-list ${className}`), slot);
    items.forEach((point, index) => {
      const li = textBox("li", point.text);
      li.dataset.bullet = "true";
      cite(li, point, slot, index);
      ul.append(li);
    });
    return ul;
  };

  const title = mark(textBox("h1", text("title"), "p2s-title"), "title");
  if (slide.layout === "title") {
    const cover = make("div", "p2s-cover");
    cover.dataset.fitRegion = "";
    cover.append(title);
    const subtitle = text("subtitle");
    if (subtitle) cover.append(mark(textBox("p", subtitle, "p2s-subtitle"), "subtitle"));
    const authors = text("authors");
    if (authors) cover.append(mark(textBox("p", authors, "p2s-authors"), "authors"));
    root.append(cover);
    return root;
  }

  root.append(title);
  title.dataset.fitRegion = "";
  const body = make("div", "p2s-body");
  body.dataset.fitRegion = "";
  root.append(body);
  const bulletContent = () => {
    const content = make("div", "p2s-content");
    const bullets = list("bullets");
    if (bullets) content.append(bullets);
    const takeaway = points("takeaway")[0];
    if (takeaway) {
      const panel = mark(make("aside", "p2s-takeaway"), "takeaway");
      panel.dataset.pptx = "shape";
      const label = textBox("span", "要点", "p2s-takeaway-label");
      const items = make("ul", "p2s-takeaway-list");
      const message = textBox("li", takeaway.text, "p2s-takeaway-text");
      cite(message, takeaway, "takeaway", 0);
      items.append(message);
      panel.append(label, items);
      content.append(panel);
    }
    return content;
  };
  switch (slide.layout) {
    case "bullets": {
      body.append(bulletContent());
      break;
    }
    case "bullets_figure": {
      body.classList.add("p2s-figure-layout");
      body.append(bulletContent());
      const frame = make("figure", "p2s-figure");
      const media = make("div", "p2s-media");
      frame.append(media);
      const fallback = figure ? `见原文 ${figure.label}（p.${figure.page}）` : `见原文 ${slide.figureId ?? "插图"}`;
      const showFallback = () => media.replaceChildren(textBox("p", fallback, "p2s-figure-reference"));
      if (figure?.cropOk && figure.imageDataUrl?.startsWith("data:image/png;base64,")) {
        const img = make("img");
        img.dataset.pptx = "image";
        img.alt = figure.label;
        // The interactive preview can mount and fit before the PNG has decoded.
        const refit = () => { if (root.isConnected) fitSlide(root); };
        img.addEventListener("load", refit, { once: true });
        img.addEventListener("error", () => {
          showFallback();
          refit();
        }, { once: true });
        img.src = figure.imageDataUrl;
        media.append(img);
      } else {
        showFallback();
      }
      const caption = points("caption")[0];
      if (caption) {
        const el = mark(textBox("figcaption", caption.text, "p2s-caption"), "caption");
        cite(el, caption, "caption", 0);
        frame.append(el);
      }
      body.append(frame);
      break;
    }
    case "key_numbers": {
      const content = make("div", "p2s-content");
      const numbers = mark(make("div", "p2s-numbers"), "numbers");
      points("numbers").forEach((point, index) => {
        const [value = "", label = ""] = point.text.split("|", 2).map((part) => part.trim());
        const item = make("div");
        const metric = textBox("p", value, "p2s-metric");
        const description = textBox("p", label);
        cite(description, point, "numbers", index);
        item.append(metric, description);
        numbers.append(item);
      });
      content.append(numbers);
      const context = list("context");
      if (context) content.append(context);
      body.append(content);
      break;
    }
    case "table": {
      const table = make("table", "p2s-table");
      table.dataset.pptx = "table";
      const head = mark(table.createTHead(), "headers").insertRow();
      const headers = text("headers").split("|").map((part) => part.trim());
      headers.forEach((header) => {
        const cell = make("th", "p2s-text");
        cell.scope = "col";
        cell.textContent = header;
        head.append(cell);
      });
      const rows = mark(table.createTBody(), "rows");
      points("rows").forEach((point, index) => {
        const row = rows.insertRow();
        const values = point.text.split("|").map((part) => part.trim());
        headers.forEach((_, column) => {
          const cell = row.insertCell();
          cell.className = "p2s-text";
          cell.textContent = values[column] ?? "";
          if (column === headers.length - 1) cite(cell, point, "rows", index);
        });
      });
      body.append(table);
      break;
    }
    case "two_column": {
      const content = make("div", "p2s-content p2s-columns");
      for (const slot of ["left", "right"]) {
        const column = make("section", "p2s-column");
        const heading = `${slot}Heading`;
        column.append(mark(textBox("h2", text(heading), "p2s-column-heading"), heading));
        const items = list(slot);
        if (items) column.append(items);
        content.append(column);
      }
      body.append(content);
      break;
    }
  }

  if (pages.size) {
    const pageLabel = [...pages].sort((a, b) => a - b).map((page) => `p.${page}`).join(", ");
    root.append(textBox("footer", pageLabel, "p2s-pages"));
  }
  return root;
}

/** Await local figure decoding before taking a measurement for export. */
export async function slideReady(root: HTMLElement): Promise<void> {
  await Promise.all([
    root.ownerDocument.fonts?.ready,
    ...Array.from(root.querySelectorAll("img"), async (image) => {
      if (typeof image.decode !== "function") return;
      try {
        await image.decode();
      } catch {
        if (root.contains(image)) image.dispatchEvent(new root.ownerDocument.defaultView!.Event("error"));
      }
    }),
  ]);
}
