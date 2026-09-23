import { expect, it } from "vitest";
import { missingMupdfRuntimeAssets, MUPDF_RUNTIME_ASSETS } from "./mupdf-assets.js";

it("requires each copied MuPDF runtime asset", () => {
  expect(missingMupdfRuntimeAssets(MUPDF_RUNTIME_ASSETS)).toEqual([]);
  expect(missingMupdfRuntimeAssets(["mupdf.js", "mupdf-wasm.js"])).toEqual(["mupdf-wasm.wasm"]);
});
