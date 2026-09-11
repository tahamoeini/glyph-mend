import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  RECONSTRUCTABLE_BUNDLE_SCHEMA,
  RECONSTRUCTABLE_BUNDLE_VERSION,
  buildReconstructableBundle,
  validateReconstructableBundle,
} from "./reconstructable-bundle.js";

function fixture() {
  const source = {
    id: "page-2-equation-source",
    page: 2,
    bbox: [10, 20, 110, 70],
    kind: "equation",
    mimeType: "image/png",
    data: Uint8Array.from([137, 80, 78, 71]),
  };
  return {
    markdown: "# Reconstructable\n\n$$x^2 + y^2 = z^2$$",
    docxBytes: Uint8Array.from([80, 75, 3, 4]),
    pdfBytes: Uint8Array.from([37, 80, 68, 70]),
    assets: new Map([
      [source.id, source],
      ["diagram-1", {
        id: "diagram-1",
        page: 3,
        bbox: [1, 2, 300, 180],
        kind: "diagram",
        data: Uint8Array.from([1, 2, 3]),
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><title>Flow</title></svg>',
        mermaid: "flowchart LR\n  n1[\"Start\"]\n  n2[\"End\"]\n  n1 --> n2",
        visualIR: {
          schemaVersion: 1,
          id: "diagram-1",
          kind: "flowchart",
          nodes: [
            { id: "start", label: "Start", shape: "box", geometry: { bbox: [0, 0, 10, 10] } },
            { id: "end", label: "End", shape: "box", geometry: { bbox: [20, 0, 30, 10] } },
          ],
          edges: [{ source: "start", target: "end", directed: true }],
          provenance: { producer: "test", version: "1" },
          confidence: { overall: 0.95 },
          disposition: "accepted",
        },
        disposition: "accepted",
        confidence: { overall: 0.95 },
      }],
      ["chart-1", {
        id: "chart-1",
        kind: "chart",
        page: 4,
        bbox: [10, 20, 200, 140],
        chartIR: {
          schemaVersion: 1,
          id: "chart-1",
          kind: "chart",
          data: {
            fields: [
              { name: "category", type: "string" },
              { name: "value", type: "number" },
            ],
            rows: [{ category: "A", value: 12 }, { category: "B", value: 18 }],
            source: { kind: "table", page: 4, bbox: [10, 20, 200, 140] },
          },
          marks: [{ type: "bar", role: "series" }],
          encoding: {
            x: { field: "category", type: "nominal" },
            y: { field: "value", type: "quantitative" },
          },
          geometry: { bbox: [10, 20, 200, 140] },
          provenance: { producer: "test", version: "1" },
          confidence: { overall: 0.92 },
          disposition: "accepted",
        },
        disposition: "accepted",
        confidence: { overall: 0.92 },
      }],
    ]),
    reviewItems: [{
      id: "equation-1",
      kind: "equation",
      page: 2,
      sourceAsset: source,
      candidate: { latex: "x^2 + y^2 = z^2", provider: "local", version: "1" },
      parsed: { mathir: { schemaVersion: 1, nodes: [{ type: "relation" }] } },
      confidence: { overall: 0.94 },
      disposition: "accepted",
    }],
    qualityReport: { status: "pass", pages: 3 },
  };
}

it("creates a deterministic bundle with source, semantic, and sidecar tiers", async () => {
  const first = await buildReconstructableBundle(fixture());
  const second = await buildReconstructableBundle(fixture());
  expect([...first.bytes]).toEqual([...second.bytes]);

  const files = unzipSync(first.bytes);
  const names = Object.keys(files).sort();
  expect(names).toEqual([
    "assets/originals/diagram-1.png",
    "assets/originals/page-2-equation-source.png",
    "assets/originals/source-document.pdf",
    "assets/reconstructed/diagram-1.visual.json",
    "assets/reconstructed/equation-1.equation.json",
    "assets/reconstructed/chart-1.chart.json",
    "assets/rendered/diagram-1.svg",
    "diagrams/diagram-1.mmd",
    "charts/chart-1.vl.json",
    "charts/chart-1.csv",
    "document.docx",
    "document.md",
    "manifest.json",
    "quality-report.json",
    "equations/equation-1.tex",
  ].sort());
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.schema).toBe(RECONSTRUCTABLE_BUNDLE_SCHEMA);
  expect(manifest.version).toBe(RECONSTRUCTABLE_BUNDLE_VERSION);
  expect(manifest.assets.find((asset) => asset.id === "equation-1").source.assetPath).toBe(
    "assets/originals/page-2-equation-source.png",
  );
  expect(manifest.assets.find((asset) => asset.id === "equation-1").reconstruction.paths).toContain(
    "equations/equation-1.tex",
  );
  expect(manifest.files["document.md"].sha256).toHaveLength(64);
  await expect(validateReconstructableBundle(files)).resolves.toMatchObject({
    schema: RECONSTRUCTABLE_BUNDLE_SCHEMA,
  });
});

it("rejects a tampered bundle file", async () => {
  const built = await buildReconstructableBundle(fixture());
  const files = unzipSync(built.bytes);
  files["document.md"][0] ^= 1;
  await expect(validateReconstructableBundle(files)).rejects.toThrow(/checksum mismatch/i);
});
