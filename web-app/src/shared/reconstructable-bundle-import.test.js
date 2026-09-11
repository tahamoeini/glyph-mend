import { expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildReconstructableBundle } from "./reconstructable-bundle.js";
import {
  importReconstructableBundle,
  preflightReconstructableZip,
  reconstructableBundleToWorkspace,
} from "./reconstructable-bundle-import.js";

it("round-trips canonical Markdown, source PDF, assets, and equation review evidence", async () => {
  const source = {
    id: "eq-source",
    kind: "equation",
    page: 2,
    bbox: [10, 20, 100, 60],
    mimeType: "image/png",
    data: Uint8Array.from([137, 80, 78, 71]),
  };
  const built = await buildReconstructableBundle({
    baseName: "round-trip",
    markdown: "# Restored\n\n$$x+y$$",
    pdfBytes: Uint8Array.from([37, 80, 68, 70]),
    assets: new Map([[source.id, source]]),
    reviewItems: [{
      id: "eq-1",
      kind: "equation",
      page: 2,
      sourceAsset: source,
      candidate: { latex: "x+y", provider: "test", version: "1" },
      confidence: { overall: 0.95 },
      disposition: "accepted",
    }],
    qualityReport: {
      extractionVersion: 11,
      document: { name: "round-trip.pdf", bytes: 4, pages: 2 },
      options: { preserveVisuals: true },
      warnings: [],
      events: [],
      pageQuality: [{ page: 2, preservedVisuals: 1 }],
    },
  });

  const imported = await importReconstructableBundle(built.bytes);
  expect(imported.preflight.entryCount).toBeGreaterThan(3);
  expect(imported.manifest.import.supported).toBe(true);
  expect(imported.markdown).toContain("# Restored");
  expect([...imported.sourcePdf]).toEqual([37, 80, 68, 70]);
  expect(imported.reviewItems).toHaveLength(1);
  expect(imported.reviewItems[0].candidate.latex).toBe("x+y");

  const workspace = reconstructableBundleToWorkspace(imported);
  expect(workspace.fileName).toBe("round-trip.pdf");
  expect(workspace.pageCount).toBe(2);
  expect(workspace.markdown).toContain("x+y");
  expect(workspace.pages[2].assets.length).toBeGreaterThan(0);
});

it("rejects traversal in ZIP metadata before decompression", () => {
  const archive = zipSync({
    "../escape.txt": strToU8("nope"),
    "manifest.json": strToU8("{}"),
  });
  expect(() => preflightReconstructableZip(archive)).toThrow(/unsafe bundle path/i);
});

it("rejects suspicious compression ratios before decompression", () => {
  const archive = zipSync({
    "manifest.json": strToU8("A".repeat(20_000)),
  }, { level: 9 });
  expect(() => preflightReconstructableZip(archive, { maxCompressionRatio: 2 })).toThrow(/compression-ratio/i);
});

it("sanitizes SVG at the bundle export boundary", async () => {
  const built = await buildReconstructableBundle({
    markdown: "safe",
    assets: new Map([["visual-1", {
      id: "visual-1",
      kind: "diagram",
      page: 1,
      bbox: [0, 0, 20, 20],
      mimeType: "image/svg+xml",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><text>Safe</text><a href="https://evil.invalid"><text>External</text></a><rect id="r" width="10" height="10"/></svg>',
    }]]),
  });
  const entries = unzipSync(built.bytes);
  const sourcePath = Object.keys(entries).find((path) => path.startsWith("assets/originals/visual-1."));
  const renderedPath = Object.keys(entries).find((path) => path === "assets/rendered/visual-1.svg");
  const sourceSvg = strFromU8(entries[sourcePath]);
  const renderedSvg = strFromU8(entries[renderedPath]);
  for (const svg of [sourceSvg, renderedSvg]) {
    expect(svg).toContain("Safe");
    expect(svg).not.toMatch(/<script|onload|https:\/\/evil\.invalid|<a\b/i);
  }
});
