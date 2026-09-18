import { expect, it } from "vitest";
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  documentIRFromPages,
  documentIRMetrics,
  documentIRToMarkdown,
  pageDocumentIR,
} from "./document-ir.js";

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
  expect(ir.assets[0]).toMatchObject({ id: "p2-figure-1", page: 2 });
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
