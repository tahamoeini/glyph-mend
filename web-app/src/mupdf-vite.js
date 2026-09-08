// MuPDF's Emscripten loader normally resolves mupdf-wasm.wasm relative to the
// JavaScript module URL. Vite may pre-bundle/hash that module, so the inferred
// sibling URL can point at HTML instead of the WASM binary in dev.
//
// Import the WASM as a first-class Vite asset and install MuPDF's supported
// locateFile hook before dynamically importing the library. Relative node_modules
// paths intentionally bypass MuPDF 1.28's package export map while still letting
// Vite fingerprint and serve the assets in both dev and production.
//
// The dynamic import is intentional: ESM static imports run before this module
// body, which would be too late to configure the Emscripten loader.
import mupdfWasmUrl from "../node_modules/mupdf/dist/mupdf-wasm.wasm?url";

globalThis.$libmupdf_wasm_Module = {
  ...(globalThis.$libmupdf_wasm_Module || {}),
  locateFile(path) {
    return path.endsWith("mupdf-wasm.wasm") ? mupdfWasmUrl : path;
  },
};

const module = await import("../node_modules/mupdf/dist/mupdf.js");
const mupdf = module.default ?? module;

export default mupdf;
