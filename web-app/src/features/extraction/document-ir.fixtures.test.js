import { expect, it } from "vitest";
import {
  documentIRFromPages,
  documentIRMetrics,
  documentIRToMarkdown,
} from "./document-ir.js";
import { DOCUMENT_RECONSTRUCTION_FIXTURES } from "./document-ir.fixtures.js";

it.each(DOCUMENT_RECONSTRUCTION_FIXTURES)(
  "keeps the $id reconstruction fixture semantic and serializable",
  (fixture) => {
    const ir = documentIRFromPages(fixture.pages, { fixture: fixture.id });
    const blocks = ir.pages.flatMap((page) => page.blocks);
    expect(ir.metadata).toEqual({ fixture: fixture.id });
    expect(ir.pages.length).toBeGreaterThan(0);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.sourcePage).toBeGreaterThan(0);
      expect(block.bbox === null || block.bbox).toBeTruthy();
      expect(block.confidence).toBeGreaterThanOrEqual(0);
      expect(block.confidence).toBeLessThanOrEqual(1);
      expect(block.extractionMethod).toEqual(expect.any(String));
      expect(block.children).toEqual(expect.any(Array));
    }
    expect(documentIRToMarkdown(ir)).toContain(fixture.pages[0].blocks[0].markdown);
    expect(documentIRMetrics(ir).blocks).toBe(blocks.length);
  },
);
