// Placeholder entry; replaced by the UI task (see docs/TASKS.md, T5).
import { connectAnna } from "./anna";

const root = document.getElementById("app")!;
connectAnna().then((anna) => {
  root.textContent = anna ? "Paper2Slides — connected to Anna host." : "Paper2Slides — standalone preview (no host).";
});
