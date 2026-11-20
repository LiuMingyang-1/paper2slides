/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// The Anna App bundle is a static SPA served from bundle/ (manifest ui.bundle).
// Source lives in src/ + index.html; `vite build` emits into bundle/.
// base "./" keeps every asset path relative (bundle is served under /anna-apps/<slug>/...).
export default defineConfig({
  base: "./",
  build: {
    outDir: "bundle",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      // Host-served SDK; never bundled.
      external: ["/static/anna-apps/_sdk/latest/index.js"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
