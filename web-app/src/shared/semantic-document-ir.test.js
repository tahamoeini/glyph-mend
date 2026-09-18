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

it("validates each page independently while retaining large-document provenance", () => {
  const legacy = {
    pages: Array.from({ length: 120 }, (_, pageIndex) => ({
      page: pageIndex + 1,
      blocks: [{
        id: `page-${pageIndex + 1}-paragraph`,
        type: "paragraph",
        markdown: `Page ${pageIndex + 1}`,
        bbox: [10, 10, 180, 30],
        sourceSpanIds: Array.from({ length: 1_000 }, (_, spanIndex) =>
          `p${pageIndex + 1}-span-${spanIndex}`,
        ),
      }],
    })),
  };

  const document = semanticDocumentFromLegacyDocumentIR(legacy);

  expect(document.pages).toHaveLength(120);
  expect(document.pages[0].nodes[0].source.spanIds).toHaveLength(1_000);
  expect(document.pages[119].nodes[0].source.spanIds[999]).toBe("p120-span-999");
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
