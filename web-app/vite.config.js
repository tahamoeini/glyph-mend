import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  // Route only the bare `mupdf` import used by the extraction worker through a
  // browser/Vite adapter. Deep imports inside the adapter are intentionally not
  // aliased, so it can load the real MuPDF module after configuring Emscripten.
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
      includeAssets: ["icon.svg", "wasm/*", "tesseract-core/*", "tessdata/*"],
      manifest: false,
      workbox: { maximumFileSizeToCacheInBytes: 20 * 1024 * 1024 },
    }),
  ],
  test: { environment: "jsdom", include: ["src/**/*.test.js"] },
});
