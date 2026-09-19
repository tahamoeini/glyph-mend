import { expect, it } from "vitest";
import {
  compareSemanticDocumentIR,
  createSemanticDocumentIR,
  deserializeSemanticDocumentIR,
  semanticDocumentFromLegacyDocumentIR,
  semanticDocumentQualityReport,
  semanticDocumentToMarkdown,
  serializeSemanticDocumentIR,
  validateSemanticDocumentIR,
} from "./semantic-document-ir.js";
import { SEMANTIC_DOCUMENT_IR_V2_FIXTURE } from "./semantic-document-ir.fixtures.js";
import { tableIRFromRows } from "./table-ir.js";
import { classifyVisualEvidence } from "./visual-ir.js";

it("creates and validates v2 nodes without collapsing confidence dimensions", () => {
  const document = createSemanticDocumentIR(SEMANTIC_DOCUMENT_IR_V2_FIXTURE);
  const nodes = document.pages[0].nodes;
  expect(document.schemaVersion).toBe(2);
  expect(nodes.map((node) => node.type)).toEqual([
    "heading",
    "paragraph",
    "quote",
    "list",
    "table",
    "equation",
    "figure",
  ]);
  expect(nodes[3].children[0].type).toBe("list-item");
  expect(nodes[5].confidence).toEqual({
    extraction: 0.9,
    structure: 0.78,
    reconstruction: 0.74,
    export: 0.7,
  });
  expect(nodes[6].source.cropIds).toEqual(["crop-figure-1"]);
  expect(Object.isFrozen(document)).toBe(true);
  expect(Object.isFrozen(nodes[0])).toBe(true);
});

it("serializes deterministically and round-trips through runtime validation", () => {
  const first = createSemanticDocumentIR(SEMANTIC_DOCUMENT_IR_V2_FIXTURE);
  const second = createSemanticDocumentIR({
    pages: SEMANTIC_DOCUMENT_IR_V2_FIXTURE.pages,
    documentId: "fixture-semantic-document-v2",
    metadata: { fixture: "semantic-document-ir-v2" },
  });
  const serialized = serializeSemanticDocumentIR(first);
  expect(serialized).toBe(serializeSemanticDocumentIR(second));
  expect(compareSemanticDocumentIR(first, deserializeSemanticDocumentIR(serialized))).toBe(true);
  expect(validateSemanticDocumentIR(JSON.parse(serialized)).documentId).toBe("fixture-semantic-document-v2");
});

it("adapts legacy extraction blocks without losing text or source references", () => {
  const legacy = {
    schemaVersion: 2,
    pages: [{
      page: 4,
      blocks: [
        {
          id: "legacy-heading",
          type: "heading",
          markdown: "# Legacy heading",
          bbox: [10, 20, 180, 40],
          confidence: 0.91,
          source: { spanIds: ["span-legacy-heading"] },
        },
        {
          id: "legacy-figure",
          type: "figure",
          markdown: '[SOURCE_VISUAL page=4 id="crop-4" kind="graphic"]',
          bbox: [10, 50, 300, 200],
          assetId: "crop-4",
          extractionMethod: "source-preservation",
        },
        { type: "list", markdown: "- one\n- two" },
      ],
    }],
  };
  const document = semanticDocumentFromLegacyDocumentIR(legacy);
  expect(semanticDocumentToMarkdown(document)).toBe(
    '# Legacy heading\n\n[SOURCE_VISUAL page=4 id="crop-4" kind="graphic"]\n\n- one\n- two',
  );
  expect(document.pages[0].nodes[0].source.spanIds).toEqual(["span-legacy-heading"]);
  expect(document.pages[0].nodes[1].source.cropIds).toEqual(["crop-4"]);
  expect(document.pages[0].nodes[2].children.map((node) => node.type)).toEqual([
    "list-item",
    "list-item",
  ]);
  expect(document.pages[0].nodes[0].confidence.structure).toBeNull();
  expect(document.pages[0].nodes[0].diagnostics[0].code).toBe("LEGACY_CONFIDENCE_DIMENSION");
});

it("keeps the structured-data budget independent for each page", () => {
  const legacy = {
    pages: Array.from({ length: 51 }, (_, pageIndex) => ({
      page: pageIndex + 1,
      blocks: [{
        id: `page-${pageIndex + 1}-paragraph`,
        type: "paragraph",
        markdown: `Page ${pageIndex + 1}`,
        bbox: [10, 10, 180, 30],
        sourceSpanIds: Array.from({ length: 2_500 }, (_, spanIndex) =>
          `p${pageIndex + 1}-span-${spanIndex}`,
        ),
      }],
    })),
  };

  const document = semanticDocumentFromLegacyDocumentIR(legacy);
  const restored = deserializeSemanticDocumentIR(serializeSemanticDocumentIR(document));

  expect(restored.pages).toHaveLength(51);
  expect(restored.pages[0].nodes[0].source.spanIds).toHaveLength(2_500);
  expect(restored.pages[50].nodes[0].source.spanIds).toContain("p51-span-2499");
});

it("still rejects a single page that exceeds the structured-data budget", () => {
  expect(() => semanticDocumentFromLegacyDocumentIR({
    pages: [{
      page: 1,
      blocks: [{
        type: "paragraph",
        markdown: "Oversized page",
        bbox: [10, 10, 180, 30],
        sourceSpanIds: Array.from({ length: 101_000 }, (_, spanIndex) => `span-${spanIndex}`),
      }],
    }],
  })).toThrow(/exceeds the .*node limit/);
});


it("keeps VisualIR diagnostics within a page-scoped structured-data budget", () => {
  const pages = Array.from({ length: 51 }, (_, pageIndex) => {
    const page = pageIndex + 1;
    const visualIR = classifyVisualEvidence({
      page,
      bbox: [20, 40, 240, 180],
      sourceKind: "raster",
      assetId: `page-${page}-visual`,
      sourceSpanIds: Array.from({ length: 2_500 }, (_, spanIndex) => `p${page}-span-${spanIndex}`),
      images: [{ id: `page-${page}-image`, bbox: [20, 40, 240, 180] }],
      sourceAsset: {
        assetId: `page-${page}-visual`,
        cropIds: [`page-${page}-crop`],
        format: "raster",
        preserved: true,
      },
    });
    return {
      page,
      blocks: [{
        id: `page-${page}-visual-block`,
        type: "figure",
        markdown: `[SOURCE_VISUAL page=${page} id="page-${page}-visual" kind="image"]`,
        bbox: [20, 40, 240, 180],
        source: { spanIds: visualIR.source.spanIds, cropIds: visualIR.source.cropIds },
        visualIR,
      }],
    };
  });
  const document = semanticDocumentFromLegacyDocumentIR({ pages });
  const restored = deserializeSemanticDocumentIR(serializeSemanticDocumentIR(document));

  expect(restored.pages).toHaveLength(51);
  expect(restored.pages[50].nodes[0].content.visualIR.diagnostics[0].details.imageCount).toBe(1);
  expect(restored.pages[50].nodes[0].source.spanIds).toHaveLength(2_500);
});

it("rejects invalid external IR at the schema boundary", () => {
  expect(() => validateSemanticDocumentIR({ schemaVersion: 1, pages: [] })).toThrow(/schemaVersion/);
  expect(() => createSemanticDocumentIR({
    pages: [{
      pageNumber: 1,
      nodes: [{
        type: "paragraph",
        content: { text: "bad bbox" },
        bbox: [0, 0, 1],
      }],
    }],
  })).toThrow(/bbox/);
  expect(() => createSemanticDocumentIR({
    pages: [{
      pageNumber: 1,
      nodes: [{
        type: "paragraph",
        content: { text: "bad disposition" },
        disposition: "accepted",
      }],
    }],
  })).not.toThrow();
});

it("reports provenance, dispositions, diagnostics, and confidence dimensions separately", () => {
  const report = semanticDocumentQualityReport(SEMANTIC_DOCUMENT_IR_V2_FIXTURE);
  expect(report.nodeTypes).toMatchObject({ heading: 1, paragraph: 1, table: 1, equation: 1, figure: 1 });
  expect(report.dispositions["preserved-source"]).toBe(1);
  expect(report.confidence.extraction).toMatchObject({ known: 6, unknown: 1 });
  expect(report.confidence.structure).toMatchObject({ known: 7, unknown: 0 });
  expect(report.provenance.nodesWithSourceCrop).toBe(2);
  expect(report).not.toHaveProperty("overall");
});

it("includes canonical TableIR confidence and unresolved-cell metrics in quality reports", () => {
  const table = tableIRFromRows({
    tableId: "quality-table",
    rows: [["A", "B"], ["1", "2"]],
    confidence: { detection: 0.9, structure: 0.85, content: 0.8, export: 0.82 },
  });
  const document = createSemanticDocumentIR({
    documentId: "table-quality-document",
    pages: [{ pageNumber: 1, nodes: [{ type: "table", content: { table }, sourcePage: 1, sourceKind: "native-text" }] }],
  });
  const report = semanticDocumentQualityReport(document);
  expect(report.tables).toMatchObject({ count: 1, cells: 4, unresolvedCellDiagnostics: 0 });
  expect(report.tables.confidence.structure).toMatchObject({ known: 1, mean: 0.85 });
});
