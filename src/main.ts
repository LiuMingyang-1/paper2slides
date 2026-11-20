import { connectAnna } from "./anna";
import { mountApp } from "./ui/app";
import "./ui/style.css";

const root = document.getElementById("app")!;
if (window.parent === window) mountApp(root, null);
else void connectAnna().then((host) => mountApp(root, host));
