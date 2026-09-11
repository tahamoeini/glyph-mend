import { expect, it } from "vitest";
import {
  CHART_IR_SCHEMA_VERSION,
  MATH_IR_SCHEMA_VERSION,
  RECONSTRUCTED_ASSET_SCHEMA_VERSION,
  VISUAL_IR_SCHEMA_VERSION,
  deserializeChartIR,
  deserializeMathIR,
  deserializeReconstructedAsset,
  deserializeVisualIR,
  parseChartIR,
  parseMathIR,
  parseReconstructedAsset,
  parseVisualIR,
  serializeChartIR,
  serializeMathIR,
  serializeReconstructedAsset,
  serializeVisualIR,
} from "./semantic-ir.js";

it("round-trips reconstructed assets with deterministic serialization", () => {
  const asset = {
    schemaVersion: RECONSTRUCTED_ASSET_SCHEMA_VERSION,
    id: "asset-1",
    page: 2,
    bbox: [10, 20, 30, 40],
    kind: "equation",
    sourceType: "vector",
    sourceAsset: {
      id: "source-1",
      kind: "page-crop",
      href: "page-2",
      extra: { nested: true },
    },
    reconstruction: {
      format: "semantic-ir",
      source: {
        kind: "deterministic",
        version: "1.0.0",
        engine: "local",
        detail: { preserve: "source evidence" },
      },
    },
    confidence: {
      structural: 0.91,
      semantic: 0.87,
      overall: 0.89,
    },
    provenance: {
      producer: "extract-worker",
      version: "10",
      algorithmVersion: "2026-09-11",
    },
    disposition: "review",
    warnings: ["needs reviewer attention"],
    extra: { nested: [3, 2, 1] },
  };

  const serializedA = serializeReconstructedAsset(asset);
  const serializedB = serializeReconstructedAsset({ ...asset, kind: "equation", page: 2 });
  expect(serializedA).toBe(serializedB);

  const parsed = deserializeReconstructedAsset(serializedA);
  expect(parsed.schemaVersion).toBe(RECONSTRUCTED_ASSET_SCHEMA_VERSION);
  expect(parsed.sourceAsset.extra.nested).toBe(true);
  expect(parsed.reconstruction.source.detail.preserve).toBe("source evidence");
  expect(parsed.extra.nested).toEqual([3, 2, 1]);
});

it("rejects invalid reconstructed assets", () => {
  expect(() =>
    parseReconstructedAsset({
      schemaVersion: RECONSTRUCTED_ASSET_SCHEMA_VERSION,
      id: "asset-1",
      page: 1,
      bbox: [0, 0, 1, 1],
      kind: "unsupported",
      sourceType: "vector",
      sourceAsset: { id: "source-1" },
      reconstruction: { format: "semantic-ir", source: { kind: "deterministic" } },
      confidence: { overall: 1 },
      provenance: { producer: "extract-worker" },
      disposition: "accepted",
    }),
  ).toThrow(/ReconstructedAsset.kind/);
});

it("accepts unknown forward-compatible fields in MathIR", () => {
  const value = parseMathIR({
    schemaVersion: MATH_IR_SCHEMA_VERSION,
    id: "math-1",
    kind: "equation",
    rootId: "n1",
    nodes: [
      { id: "n1", type: "sequence", children: ["n2"], note: "root" },
      { id: "n2", type: "identifier", text: "x", future: { order: 1 } },
    ],
    provenance: { producer: "extract-worker", version: "10" },
    confidence: { overall: 0.95 },
    disposition: "accepted",
    futureField: { keep: true },
  });

  expect(value.futureField.keep).toBe(true);
  expect(deserializeMathIR(serializeMathIR(value)).futureField.keep).toBe(true);
});

it("rejects invalid MathIR nodes", () => {
  expect(() =>
    parseMathIR({
      schemaVersion: MATH_IR_SCHEMA_VERSION,
      id: "math-1",
      kind: "equation",
      rootId: "missing",
      nodes: [{ id: "n1", type: "sequence" }],
      provenance: { producer: "extract-worker", version: "10" },
      confidence: { overall: 0.9 },
      disposition: "accepted",
    }),
  ).toThrow(/MathIR.rootId/);
});

it("round-trips VisualIR without depending on Mermaid or SVG emitters", () => {
  const visual = {
    schemaVersion: VISUAL_IR_SCHEMA_VERSION,
    id: "visual-1",
    kind: "flowchart",
    nodes: [
      { id: "a", label: "Start", shape: "rect", geometry: { bbox: [0, 0, 10, 10] } },
      { id: "b", label: "End", shape: "rect", geometry: { bbox: [20, 0, 30, 10] } },
    ],
    edges: [{ source: "a", target: "b", directed: true, label: "next" }],
    labels: [{ text: "Start", nodeId: "a" }],
    geometry: { bbox: [0, 0, 30, 10], direction: "LR" },
    shapes: [{ type: "rect", geometry: { bbox: [0, 0, 10, 10] } }],
    styles: { node: { fill: "#fff" }, edge: { strokeWidth: 2 } },
    provenance: { producer: "extract-worker", version: "10" },
    confidence: { overall: 0.8 },
    disposition: "preserved",
    note: "keep source evidence",
  };

  const serialized = serializeVisualIR(visual);
  expect(serialized).toBe(serializeVisualIR({ ...visual, note: "keep source evidence" }));
  const parsed = deserializeVisualIR(serialized);
  expect(parsed.nodes[0].geometry.bbox).toEqual([0, 0, 10, 10]);
  expect(parsed.note).toBe("keep source evidence");
});

it("rejects invalid VisualIR edges", () => {
  expect(() =>
    parseVisualIR({
      schemaVersion: VISUAL_IR_SCHEMA_VERSION,
      id: "visual-1",
      kind: "diagram",
      nodes: [{ id: "a" }],
      edges: [{ source: "a" }],
      provenance: { producer: "extract-worker", version: "10" },
      confidence: { overall: 0.7 },
      disposition: "accepted",
    }),
  ).toThrow(/VisualIR.edges\[0\]\.target/);
});

it("round-trips ChartIR with minimal data and metadata", () => {
  const chart = {
    schemaVersion: CHART_IR_SCHEMA_VERSION,
    id: "chart-1",
    kind: "chart",
    data: {
      fields: [
        { name: "label", type: "string", extra: true },
        { name: "value", type: "number" },
      ],
      rows: [{ label: "A", value: 1 }],
    },
    marks: [{ type: "bar", encoding: { x: "label", y: "value" } }],
    encoding: { x: { field: "label", type: "nominal" }, y: { field: "value", type: "quantitative" } },
    geometry: { bbox: [1, 2, 3, 4] },
    provenance: { producer: "extract-worker", version: "10" },
    confidence: { overall: 0.76 },
    disposition: "accepted",
    chartTag: "baseline",
  };

  const parsed = deserializeChartIR(serializeChartIR(chart));
  expect(parsed.data.fields[0].extra).toBe(true);
  expect(parsed.chartTag).toBe("baseline");
});

it("rejects invalid ChartIR data sections", () => {
  expect(() =>
    parseChartIR({
      schemaVersion: CHART_IR_SCHEMA_VERSION,
      id: "chart-1",
      kind: "chart",
      data: {},
      marks: [{ type: "bar" }],
      encoding: {},
      provenance: { producer: "extract-worker", version: "10" },
      confidence: { overall: 0.5 },
      disposition: "accepted",
    }),
  ).toThrow(/ChartIR\.data/);
});
