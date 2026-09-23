export const MUPDF_RUNTIME_ASSETS = Object.freeze([
  "mupdf.js",
  "mupdf-wasm.js",
  "mupdf-wasm.wasm",
]);

export function missingMupdfRuntimeAssets(presentAssetNames) {
  const present = new Set(presentAssetNames);
  return MUPDF_RUNTIME_ASSETS.filter((asset) => !present.has(asset));
}
