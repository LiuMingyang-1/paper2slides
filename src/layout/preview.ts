import { exportPptx } from "../export";
import { fixtureDeck, fixturePaper } from "./fixture";
import { fitSlide, measureSlide, renderSlide, slideReady } from "./index";
import "./preview.css";

const previews = document.querySelector<HTMLElement>("#previews")!;
const status = document.querySelector<HTMLElement>("#status")!;
const download = document.querySelector<HTMLButtonElement>("#download")!;
const resize = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    (target as HTMLElement).style.setProperty("--preview-scale", String(contentRect.width / 1280));
  }
});

const names = {
  title: "标题页",
  bullets: "纯文字要点",
  bullets_figure: "要点配图",
  key_numbers: "关键数字",
  table: "结果表格",
  two_column: "双栏对比",
};

const roots = fixtureDeck.slides.map((slide) => {
  const label = document.createElement("h2");
  label.className = "preview-label";
  label.textContent = names[slide.layout];
  const frame = document.createElement("div");
  frame.className = "preview-frame";
  const root = renderSlide(slide, { paper: fixturePaper, verifications: fixtureDeck.verifications });
  frame.append(root);
  previews.append(label, frame);
  resize.observe(frame);
  return root;
});

void Promise.all(roots.map(slideReady)).then(() => {
  const overflows = roots.flatMap((root) => fitSlide(root).overflowingSlots);
  if (overflows.length) status.textContent = `溢出槽位：${overflows.join("、")}`;
  download.disabled = overflows.length > 0;
});

download.addEventListener("click", async () => {
  download.disabled = true;
  status.textContent = "";
  try {
    const blob = await exportPptx(fixtureDeck, fixturePaper, { measurements: roots.map(measureSlide) });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "paper2slides-fixture.pptx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    status.textContent = String(error);
  } finally {
    download.disabled = false;
  }
});
