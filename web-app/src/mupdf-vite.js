import { installMuPdfStructuredRecovery } from "./features/extraction/structured-recovery.js";

// Keep MuPDF's browser build outside Vite's dependency optimizer. MuPDF's
// Emscripten glue expects mupdf.js, mupdf-wasm.js, and mupdf-wasm.wasm to stay
// together. When Vite pre-bundles the package, that relationship can be broken
// and the WASM request may resolve to the dev server's HTML fallback instead.
//
// vite-plugin-static-copy serves these files from /mupdf in dev and copies them
// to dist/mupdf for production. Resolve each file directly relative to this
// worker-side adapter. In dev this is /src/../mupdf/*; in production the adapter
// is bundled under /assets, so /assets/../mupdf/* resolves to the same directory.
const mupdfModuleUrl = new URL(
  /* @vite-ignore */ "../mupdf/mupdf.js",
  import.meta.url,
).href;
const mupdfWasmUrl = new URL(
  /* @vite-ignore */ "../mupdf/mupdf-wasm.wasm",
  import.meta.url,
).href;

globalThis.$libmupdf_wasm_Module = {
  ...(globalThis.$libmupdf_wasm_Module || {}),
  locateFile(path) {
    return path.endsWith("mupdf-wasm.wasm") ? mupdfWasmUrl : path;
  },
};

// Vite must not discover/pre-bundle this import at runtime; the copied MuPDF
// browser module imports its sibling mupdf-wasm.js directly, exactly as shipped.
const module = await import(/* @vite-ignore */ mupdfModuleUrl);
const mupdf = installMuPdfStructuredRecovery(module.default ?? module);

export default mupdf;
