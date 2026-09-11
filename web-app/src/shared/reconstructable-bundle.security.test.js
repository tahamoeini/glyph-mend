import { expect, it } from "vitest";
import {
  assertSafeBundlePath,
  buildReconstructableBundle,
} from "./reconstructable-bundle.js";

it("rejects traversal, absolute, Windows, and control-character bundle paths", () => {
  for (const unsafePath of [
    "../escape.txt",
    "assets/../escape.txt",
    "/absolute.txt",
    "C:/windows.txt",
    "assets\\windows.txt",
    "assets//empty.txt",
    "assets/./dot.txt",
    "assets/evil\u0000.txt",
  ]) {
    expect(() => assertSafeBundlePath(unsafePath)).toThrow(/unsafe|empty|too long/i);
  }
  expect(assertSafeBundlePath("assets/reconstructed/diagram-1.visual.json")).toBe(
    "assets/reconstructed/diagram-1.visual.json",
  );
});

it("rejects prototype-pollution keys before bundle serialization", async () => {
  const poisoned = JSON.parse('{"status":"pass","__proto__":{"polluted":true}}');
  await expect(
    buildReconstructableBundle({ markdown: "safe", qualityReport: poisoned }),
  ).rejects.toThrow(/unsafe key/i);
  expect({}.polluted).toBeUndefined();
});

it("enforces aggregate and per-entry resource ceilings with caller-supplied strict limits", async () => {
  const limits = {
    maxEntries: 8,
    maxManifestBytes: 1024,
    maxEntryBytes: 8,
    maxTotalBytes: 12,
    maxPathChars: 128,
    maxStructuredDepth: 8,
    maxStructuredNodes: 64,
  };
  await expect(
    buildReconstructableBundle({
      markdown: "123456789",
      qualityReport: {},
      limits,
    }),
  ).rejects.toThrow(/byte limit/i);
});
