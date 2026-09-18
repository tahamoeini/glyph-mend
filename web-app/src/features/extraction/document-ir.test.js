import { expect, it } from "vitest";
import {
  DOCUMENT_BLOCK_TYPES,
  DOCUMENT_IR_SCHEMA_VERSION,
  documentIRFromPages,
  documentIRMetrics,
  documentIRToMarkdown,
  pageDocumentIR,
} from "./document-ir.js";
import { semanticDocumentFromLegacyDocumentIR } from "../../shared/semantic-document-ir.js";

it("normalizes ordered page blocks into semantic DocumentIR without losing provenance", () => {
  const ir = pageDocumentIR(
    {
      page: 2,
      assets: [{ id: "p2-figure-1", kind: "graphic", bbox: [10, 20, 80, 90] }],
    },
    {
      blocks: [
        { kind: "text", markdown: "# Heading", bbox: [1, 2, 3, 4] },
        { kind: "table", markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |", confidence: { overall: 0.91 } },
        { kind: "visual", markdown: '[SOURCE_VISUAL page=2 id="p2-figure-1" kind="graphic"]' },
        { kind: "equation", markdown: "$$\nx = 1\n$$" },
      ],
    },
  );

  expect(ir.schemaVersion).toBe(DOCUMENT_IR_SCHEMA_VERSION);
  expect(ir.blocks.map((block) => block.type)).toEqual([
    "heading",
    "table",
    "figure",
    "equation",
  ]);
  expect(ir.blocks[0].source).toMatchObject({ page: 2, bbox: [1, 2, 3, 4] });
  expect(ir.blocks[1].confidence).toBe(0.91);
  expect(ir.blocks.every((block) =>
    DOCUMENT_BLOCK_TYPES.includes(block.type) &&
    block.sourcePage === 2 &&
    (block.bbox === null || Array.isArray(block.bbox)) &&
    typeof block.confidence === "number" &&
    typeof block.extractionMethod === "string" &&
    Array.isArray(block.children),
  )).toBe(true);
  expect(ir.layout).toBeUndefined();
  expect(ir.assets[0]).toMatchObject({ id: "p2-figure-1", page: 2 });
});

it("links captions to nearby figures and preserves table spans and footnotes", () => {
  const ir = pageDocumentIR(
    { page: 3 },
    {
      blocks: [
        {
          id: "figure-1",
          type: "figure",
          markdown: '[SOURCE_VISUAL page=3 id="figure-1"]',
          bbox: [40, 100, 300, 220],
          confidence: 0.84,
        },
        {
          id: "caption-1",
          type: "caption",
          markdown: "Figure 1. Demand by fare class",
          bbox: [45, 225, 300, 242],
        },
        {
          id: "table-1",
          type: "table",
          markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |",
          tableIR: {
            rows: [[
              { text: "A", colSpan: 2 },
            ], [
              { text: "1", rowSpan: 2 },
              { text: "2" },
            ]],
            columns: 2,
            spans: [{ row: 0, column: 0, rowSpan: 1, colSpan: 2 }],
            confidence: 0.88,
            multiPageKey: "table-1",
          },
        },
        { id: "footnote-1", type: "footnote", markdown: "[^1]: Source note" },
      ],
    },
  );

  expect(ir.relationships).toContainEqual({
    type: "caption-for",
    from: "figure-1",
    to: "caption-1",
  });
  expect(ir.blocks.find((block) => block.id === "figure-1").children).toEqual([
    "caption-1",
  ]);
  expect(ir.blocks.find((block) => block.id === "caption-1").parentId).toBe(
    "figure-1",
  );
  expect(ir.blocks.find((block) => block.id === "table-1").table).toMatchObject({
    columns: 2,
    multiPageKey: "table-1",
    spans: [{ row: 0, column: 0, rowSpan: 1, colSpan: 2 }],
  });
  expect(documentIRMetrics({ pages: [ir] }).footnotes).toBe(1);
});

it("generates Markdown from semantic block order rather than coordinate sorting", () => {
  const ir = documentIRFromPages([
    {
      page: 2,
      documentIR: pageDocumentIR({ page: 2 }, {
        blocks: [
          { kind: "text", markdown: "right column" },
          { kind: "table", markdown: "| A |\n| --- |\n| B |" },
        ],
      }),
    },
    { page: 1, text: "first page" },
  ]);

  expect(documentIRToMarkdown(ir, { preserveMarkers: true })).toBe(
    "<!-- page: 1 -->\n\nfirst page\n\n<!-- page: 2 -->\n\nright column\n\n| A |\n| --- |\n| B |",
  );
  expect(documentIRMetrics(ir)).toMatchObject({ pages: 2, paragraphs: 2, tables: 1 });
});

it("keeps legacy checkpoints exportable through a text-block IR fallback", () => {
  const ir = documentIRFromPages([{ page: 4, text: "Legacy paragraph\n\n- item" }]);
  expect(ir.pages[0].blocks.map((block) => block.type)).toEqual(["paragraph", "list"]);
  expect(documentIRToMarkdown(ir)).toBe("Legacy paragraph\n\n- item");
});

it("carries layout classification, source IDs, and separate structure confidence into v2", () => {
  const ir = pageDocumentIR({ page: 5 }, {
    blocks: [{
      id: "p5-block-1",
      kind: "text",
      layoutType: "heading",
      headingLevel: 2,
      markdown: "## 1.1 Scope",
      rawText: "1.1 Scope",
      bbox: [40, 60, 180, 75],
      confidence: { overall: 0.98 },
      structureConfidence: 0.91,
      sourceSpanIds: ["p5-span-1"],
      sourceObjectIds: ["p5-object-1"],
      diagnostics: [{ code: "heading-evidence", severity: "info", message: "Numbering and spacing agree." }],
    }],
    layout: {
      orderMethod: "layout-v1",
      columns: 1,
      confidence: 0.88,
      layerVersion: "layout-v1",
      metrics: { blockCount: 1 },
    },
  });
  const semantic = semanticDocumentFromLegacyDocumentIR({ pages: [ir] });
  expect(ir.blocks[0]).toMatchObject({
    type: "heading",
    structureConfidence: 0.91,
    sourceSpanIds: ["p5-span-1"],
  });
  expect(ir.layout).toMatchObject({ layerVersion: "layout-v1", metrics: { blockCount: 1 } });
  expect(semantic.pages[0].nodes[0]).toMatchObject({
    type: "heading",
    source: { spanIds: ["p5-span-1"], objectIds: ["p5-object-1"] },
    confidence: { extraction: 0.98, structure: 0.91 },
  });
});
