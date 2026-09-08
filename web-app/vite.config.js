import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  // Route only the extraction worker's bare `mupdf` import through a small
  // adapter. The adapter loads MuPDF's browser runtime from raw sibling assets,
  // keeping it out of Vite's dependency optimizer and preserving Emscripten's
  // JS/WASM layout.
  resolve: {
    alias: [
      {
        find: /^mupdf$/,
        replacement: fileURLToPath(
          new URL("./src/mupdf-vite.js", import.meta.url),
        ),
      },
    ],
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: "node_modules/pdfjs-dist/wasm/*", dest: "wasm" },
        { src: "node_modules/mupdf/dist/mupdf.js", dest: "mupdf" },
        { src: "node_modules/mupdf/dist/mupdf-wasm.js", dest: "mupdf" },
        { src: "node_modules/mupdf/dist/mupdf-wasm.wasm", dest: "mupdf" },
        {
          src: "node_modules/tesseract.js-core/*.wasm.js",
          dest: "tesseract-core",
        },
        {
          src: "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
          dest: "tessdata",
        },
      ],
    }),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icon.svg",
        "wasm/*",
        "mupdf/*",
        "tesseract-core/*",
        "tessdata/*",
      ],
      manifest: false,
      workbox: { maximumFileSizeToCacheInBytes: 20 * 1024 * 1024 },
    }),
  ],
  test: { environment: "jsdom", include: ["src/**/*.test.js"] },
});
