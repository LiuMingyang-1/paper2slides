import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Evidence, VerifyStatus } from "../types";
import { el } from "./dom";
import { strings, type Language } from "./strings";

export function bindCitations(
  slide: HTMLElement, evidence: ReadonlyMap<string, Evidence>, language: Language, reveal: (source: Evidence) => void,
) {
  const t = strings[language];
  const events = new AbortController();
  const options = { signal: events.signal };
  let tooltip: HTMLElement | undefined;
  let anchor: HTMLElement | undefined;
  let stop: (() => void) | undefined;
  function hide() {
    anchor?.removeAttribute("aria-describedby");
    tooltip?.remove();
    stop?.();
    tooltip = anchor = stop = undefined;
  }
  for (const ref of slide.querySelectorAll<HTMLElement>("[data-evidence-ids]")) {
    const sources = (ref.dataset.evidenceIds ?? "").split(/\s+/).flatMap((id) => {
      const source = evidence.get(id);
      return source ? [source] : [];
    });
    const status = (ref.dataset.status ?? "partial") as VerifyStatus;
    ref.setAttribute("aria-label", `${t.citations} ${ref.textContent} · ${t[status]}`);
    function show() {
      if (anchor === ref) return;
      hide();
      anchor = ref;
      const bubble = el("div", "citation-bubble", el("strong", `stat ${status}`, t[status]));
      bubble.id = "citation-tooltip";
      bubble.role = "tooltip";
      for (const source of sources) {
        bubble.append(el("div", "source-id", `p. ${source.page} · ${source.id}`), el("p", "", source.text.slice(0, 320) + (source.text.length > 320 ? "…" : "")));
      }
      if (!sources.length) bubble.append(el("p", "", t.noSource));
      tooltip = bubble;
      document.body.append(bubble);
      ref.setAttribute("aria-describedby", bubble.id);
      stop = autoUpdate(ref, bubble, () => {
        void computePosition(ref, bubble, {
          strategy: "fixed", placement: "top", middleware: [offset(8), flip(), shift({ padding: 12 })],
        }).then(({ x, y, placement }) => {
          if (tooltip !== bubble) return;
          const bounds = ref.getBoundingClientRect();
          const origin = Math.max(0, Math.min(bubble.offsetWidth, bounds.left + bounds.width / 2 - x));
          Object.assign(bubble.style, { left: `${x}px`, top: `${y}px` });
          bubble.style.setProperty("--anchor-x", `${origin}px`);
          bubble.style.setProperty("--anchor-y", placement === "top" ? "bottom" : "top");
          bubble.classList.add("is-positioned");
        });
      });
    }
    ref.addEventListener("pointerenter", show, options);
    ref.addEventListener("focus", show, options);
    ref.addEventListener("pointerleave", () => { if (document.activeElement !== ref) hide(); }, options);
    ref.addEventListener("blur", hide, options);
    ref.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); }, options);
    ref.addEventListener("click", () => {
      if (sources[0]) {
        reveal(sources[0]);
        hide();
      } else show();
    }, options);
  }
  return () => {
    events.abort();
    hide();
  };
}
