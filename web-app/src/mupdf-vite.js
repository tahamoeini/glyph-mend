// Keep MuPDF's browser build outside Vite's dependency optimizer. MuPDF's
// Emscripten glue expects mupdf.js, mupdf-wasm.js, and mupdf-wasm.wasm to stay
// together. When Vite pre-bundles the package, that relationship can be broken
// and the WASM request may resolve to the dev server's HTML fallback instead.
//
// vite-plugin-static-copy serves these files from /mupdf in dev and copies them
// to dist/mupdf for production. The runtime URL remains correct for sub-path
// deployments because it is resolved relative to the worker module itself.
const mupdfBaseUrl = new URL("../mupdf/", import.meta.url);
const mupdfModuleUrl = new URL("mupdf.js", mupdfBaseUrl).href;
const mupdfWasmUrl = new URL("mupdf-wasm.wasm", mupdfBaseUrl).href;

globalThis.$libmupdf_wasm_Module = {
  ...(globalThis.$libmupdf_wasm_Module || {}),
  locateFile(path) {
    return path.endsWith("mupdf-wasm.wasm") ? mupdfWasmUrl : path;
  },
};

// Vite must not discover/pre-bundle this import at runtime; the copied MuPDF
// browser module imports its sibling mupdf-wasm.js directly, exactly as shipped.
const module = await import(/* @vite-ignore */ mupdfModuleUrl);
const mupdf = module.default ?? module;

export default mupdf;
