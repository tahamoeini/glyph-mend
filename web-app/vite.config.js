import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  // MuPDF resolves mupdf-wasm.wasm relative to its own ESM module URL. Vite's
  // dev dependency pre-bundler moves mupdf.js into node_modules/.vite/deps,
  // where the sibling WASM file does not exist, so the dev server falls back
  // to index.html and WebAssembly receives "<!do" instead of a WASM binary.
  optimizeDeps: { exclude: ["mupdf"] },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: "node_modules/pdfjs-dist/wasm/*", dest: "wasm" },
        {
          src: "node_modules/mupdf/dist/mupdf-wasm.wasm",
          dest: "assets",
        },
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
        "assets/mupdf-wasm.wasm",
        "tesseract-core/*",
        "tessdata/*",
      ],
      manifest: false,
      workbox: { maximumFileSizeToCacheInBytes: 20 * 1024 * 1024 },
    }),
  ],
  test: { environment: "jsdom", include: ["src/**/*.test.js"] },
});
