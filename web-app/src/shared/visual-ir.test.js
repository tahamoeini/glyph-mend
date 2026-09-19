import { expect, it } from "vitest";
import {
  CHART_IR_SCHEMA,
  VISUAL_IR_SCHEMA,
  classifyVisualEvidence,
  compareChartIR,
  compareVisualIR,
  createChartIR,
  createVisualIR,
  legacyVisualIRToV2,
  serializeChartIR,
  serializeVisualIR,
  validateChartIR,
  validateUntrustedVisualSource,
  validateVisualIR,
  visualIRToLegacyVisualIR,
} from "./visual-ir.js";
import { MALICIOUS_VISUAL_FIXTURES, VISUAL_IR_FIXTURES } from "./visual-ir.fixtures.js";

it("creates a versioned source-preserving VisualIR with deterministic serialization", () => {
  const left = createVisualIR({
    class: "ordinary-image",
    page: 2,
    bbox: [20, 30, 120, 160],
    source: { kind: "raster", assetId: "asset-2", cropIds: ["crop-2"] },
    confidence: { detection: 0.99, classification: 0.9, structure: 0.92, reconstruction: null, export: 0.95 },
    disposition: "preserved-source",
    reconstructionMetadata: { sourcePreserved: true, strategy: "vector-first" },
  });
  const right = validateVisualIR(JSON.parse(serializeVisualIR({
    ...left,
    reconstructionMetadata: { strategy: "vector-first", sourcePreserved: true },
  })));

  expect(left.schema).toBe(VISUAL_IR_SCHEMA);
  expect(left.schemaVersion).toBe(2);
  expect(left.id).toBe(right.id);
  expect(serializeVisualIR(left)).toBe(serializeVisualIR(right));
  expect(compareVisualIR(left, right)).toBe(true);
  expect(Object.keys(left.confidence)).toEqual([
    "classification",
    "detection",
    "export",
    "reconstruction",
    "structure",
  ]);
  expect(left.source.cropIds).toEqual(["crop-2"]);
});

it("fails closed on invalid class and disposition values at the external-data boundary", () => {
  expect(() => validateVisualIR({ schema: VISUAL_IR_SCHEMA, schemaVersion: 2, id: "x", class: "invented", page: 1, bbox: [0, 0, 1, 1], source: { kind: "raster" }, confidence: {}, disposition: "preserved-source" })).toThrow(/class/i);
  expect(() => validateVisualIR({ schema: VISUAL_IR_SCHEMA, schemaVersion: 2, id: "x", class: "ordinary-image", page: 1, bbox: [0, 0, 1, 1], source: { kind: "raster" }, confidence: {}, disposition: "invented" })).toThrow(/disposition/i);
});

it("classifies the fixture set conservatively and keeps source disposition explicit", () => {
  for (const fixture of VISUAL_IR_FIXTURES) {
    const result = classifyVisualEvidence(fixture);
    expect(result.class, fixture.id).toBe(fixture.expectedClass);
    expect(result.schemaVersion, fixture.id).toBe(2);
    expect(result.source.cropIds, fixture.id).toContain(fixture.source.cropIds[0]);
    expect(result.sourceAsset.preserved, fixture.id).toBe(true);
  }

  const uncertain = classifyVisualEvidence({
    page: 9,
    bbox: [50, 50, 250, 250],
    sourceKind: "vector",
    assetId: "ambiguous",
    candidate: {
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [],
    },
    ambiguous: true,
  });
  expect(uncertain.class).toBe("unresolved-visual");
  expect(uncertain.disposition).toBe("preserved-source");
  expect(uncertain.warnings.join(" ")).toMatch(/unresolved|source/i);
});

it("does not invent chart values and accepts ChartIR only with a data/encoding contract", () => {
  const sourceOnly = classifyVisualEvidence({
    page: 1,
    bbox: [0, 0, 200, 120],
    sourceKind: "vector",
    assetId: "chart-source",
    classHint: "chart",
    caption: "Chart 1",
  });
  expect(sourceOnly.class).toBe("chart");
  expect(sourceOnly.disposition).toBe("preserved-source");
  expect(sourceOnly.content.sourceOnly).toBe(true);
  expect(sourceOnly.content.chartIR).toBeUndefined();

  const chart = createChartIR({
    id: "chart-1",
    page: 1,
    bbox: [0, 0, 200, 120],
    source: { kind: "vector", assetId: "chart-source", cropIds: ["chart-crop"] },
    data: {
      fields: [{ name: "quarter", type: "string" }, { name: "value", type: "number" }],
      rows: [{ rowId: "r1", values: { quarter: "Q1", value: 4 } }],
    },
    marks: [{ type: "bar", provenance: { objectIds: ["bar-1"] } }],
    encoding: { x: { field: "quarter", type: "nominal" }, y: { field: "value", type: "quantitative" } },
    confidence: { detection: 0.96, classification: 0.94, structure: 0.92, reconstruction: 0.88, export: 0.9 },
    disposition: "reconstructed-with-source",
  });
  const roundTrip = validateChartIR(JSON.parse(serializeChartIR(chart)));
  expect(roundTrip.schema).toBe(CHART_IR_SCHEMA);
  expect(roundTrip.data.rows[0].values.value).toBe(4);
  expect(compareChartIR(chart, roundTrip)).toBe(true);

  const reconstructed = classifyVisualEvidence({
    page: 1,
    bbox: [0, 0, 200, 120],
    sourceKind: "vector",
    assetId: "chart-source",
    classHint: "chart",
    chartIR: chart,
  });
  expect(reconstructed.disposition).toBe("reconstructed-with-source");
  expect(reconstructed.content.chartIR.data.rows[0].values.value).toBe(4);
});

it("adapts the existing VisualIR v1 worker shape without dropping topology or provenance", () => {
  const legacy = {
    schemaVersion: 1,
    id: "legacy-flow",
    kind: "flowchart",
    page: 4,
    geometry: { bbox: [10, 20, 210, 120] },
    nodes: [{ id: "a", label: "A", geometry: { bbox: [10, 20, 80, 50] } }, { id: "b", label: "B", geometry: { bbox: [120, 80, 190, 110] } }],
    edges: [{ id: "e", source: "a", target: "b", directed: true }],
    provenance: { producer: "legacy-worker", objectIds: ["path-1"] },
    confidence: { overall: 0.9, structural: 0.88 },
    disposition: "accepted",
  };
  const v2 = legacyVisualIRToV2(legacy);
  expect(v2.class).toBe("graph-flowchart");
  expect(v2.source.objectIds).toEqual(["path-1"]);
  expect(v2.content.nodes).toHaveLength(2);
  expect(v2.disposition).toBe("reconstructed-with-source");
  const back = visualIRToLegacyVisualIR(v2);
  expect(back.nodes).toHaveLength(2);
  expect(back.edges[0].source).toBe("a");
  expect(back.provenance.sourceRefs.cropIds).toEqual([]);
});

it("rejects active content, external URLs, and oversized generated visual sources", () => {
  for (const payload of MALICIOUS_VISUAL_FIXTURES) {
    expect(() => validateUntrustedVisualSource(payload, "fixture")).toThrow();
  }
  expect(() => validateUntrustedVisualSource("x".repeat(256 * 1024 + 1), "fixture")).toThrow(/limit/i);
  expect(validateUntrustedVisualSource("flowchart LR\nn1[Safe]", "mermaid")).toContain("Safe");
});
