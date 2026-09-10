import { describe, expect, it } from "vitest";
import {
  cleanupDocument,
  documentMetrics,
  headingFor,
  joinPageParagraphs,
  normalizeText,
  parsePageRange,
  plainText,
  qualityAudit,
  removeRunningMatter,
} from "./cleanup.js";
describe("page ranges", () => {
  it("parses, deduplicates, and sorts", () =>
    expect(parsePageRange("3, 1-2, 2", 4)).toEqual([1, 2, 3]));
  it("rejects invalid bounds", () =>
    expect(() => parsePageRange("0-3", 4)).toThrow());
});
describe("cleanup", () => {
  it("normalizes ligatures and deterministic comma artifacts", () =>
    expect(normalizeText("ofﬁce‚ tools and (UPF)‚ James")).toBe(
      "office, tools and (UPF), James",
    ));
  it("removes repeated edge matter but preserves body", () => {
    const pages = [1, 2, 3].map((page) => ({
      page,
      text: `BOOK TITLE ${page}\nBody ${page}\n${page}`,
    }));
    expect(removeRunningMatter(pages).map((p) => p.text)).toEqual([
      "Body 1",
      "Body 2",
      "Body 3",
    ]);
  });
  it("uses geometry candidates even when a header is not the first text block", () => {
    const pages = [1, 2, 3].map((page) => ({
      page,
      text: `Figure ${page}\nIntroduction ${page}\nActual body`,
      edges: { headers: [`Introduction ${page}`], footers: [] },
    }));
    expect(removeRunningMatter(pages).map((page) => page.text)).toEqual([
      "Figure 1\nActual body",
      "Figure 2\nActual body",
      "Figure 3\nActual body",
    ]);
  });
  it("does not promote sentence fragments or years to headings", () => {
    expect(
      headingFor("2002. The book has benefited greatly,", 18, 10),
    ).toBeNull();
    expect(headingFor("This ordinary sentence fragment", 18, 10)).toBeNull();
    expect(headingFor("2.3 Capacity Control", 12, 10)).toBe(2);
  });
  it("joins a lowercase continuation across a page marker", () => {
    const value =
      "This is a sufficiently long sentence which continues\n\n<!-- page: 2 -->\n\nonto the next source page";
    expect(joinPageParagraphs(value)).toContain(
      "continues <!-- page: 2 --> onto",
    );
  });

  it("does not report ordinary compound words as broken wrap hyphens", () => {
    const audit = qualityAudit([], "single-resource capacity-control", []);
    expect(audit.issues.some((issue) => issue.code === "WRAP_HYPHENS")).toBe(false);
  });
  it("keeps page provenance when requested", () =>
    expect(
      cleanupDocument([{ page: 2, text: "Hello" }], { preserveMarkers: true }),
    ).toContain("<!-- page: 2 -->"));
});
it("applies browser semantic switches", () => {
  const source = "☑ Done\n\n$$\nx=1\n$$\n\n[VISUAL_PLACEHOLDER page=1]";
  const result = cleanupDocument([{ page: 1, text: source }], {
    taskLists: true,
    extractEquations: false,
    placeholders: false,
  });
  expect(result).toBe("- [x] Done");
});
describe("exports", () => {
  it("strips common Markdown for plain text", () =>
    expect(plainText("# Title\n\n**Bold**")).toBe("Title\n\nBold"));
  it("reports document features", () =>
    expect(
      documentMetrics('# One\n\n$$\nx=1\n$$\n[SOURCE_VISUAL id="x"]')
        .sourceVisuals,
    ).toBe(1));
  it("warns instead of calling a long empty technical extraction clean", () => {
    const text = `${"word ".repeat(11000)}${" equation theorem function probability ".repeat(8)}`;
    const audit = qualityAudit(
      [{ page: 1, text, quality: { characters: text.length } }],
      text,
    );
    expect(audit.status).toBe("warnings");
    expect(audit.issues[0].code).toBe("NO_TECHNICAL_OBJECTS");
  });
  it("warns when one preserved visual masks otherwise missing technical objects", () => {
    const text = `${"word ".repeat(11000)}${" equation theorem function probability table ".repeat(8)}\n[SOURCE_VISUAL id="only-one"]`;
    const pages = Array.from({ length: 100 }, (_, index) => ({
      page: index + 1,
      text: "Technical body",
      quality: { characters: 300, textBlocks: 2, ocrApplied: false },
    }));
    const audit = qualityAudit(pages, text);
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "LOW_TECHNICAL_OBJECTS", count: 1 }),
    );
  });
  it("requires review when most substantial pages collapse to one block", () => {
    const pages = Array.from({ length: 12 }, (_, index) => ({
      page: index + 1,
      text: "word ".repeat(80),
      quality: { characters: 400, textBlocks: 1, ocrApplied: false },
    }));
    const markdown = pages.map((page) => page.text).join("\n\n");
    const audit = qualityAudit(pages, markdown);
    expect(audit.status).toBe("needs-review");
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "STRUCTURE_COLLAPSE", count: 12 }),
    );
  });
  it("does not flag healthy multi-block text as collapsed", () => {
    const pages = Array.from({ length: 12 }, (_, index) => ({
      page: index + 1,
      text: "word ".repeat(80),
      quality: { characters: 400, textBlocks: 5, ocrApplied: false },
    }));
    const audit = qualityAudit(pages, pages.map((page) => page.text).join("\n\n"));
    expect(audit.issues.some((issue) => issue.code === "STRUCTURE_COLLAPSE")).toBe(false);
  });
  it("requires review when a selected page could not be extracted", () => {
    const audit = qualityAudit(
      [{ page: 1, text: "Recovered text", quality: { characters: 14 } }],
      "Recovered text",
      [{ type: "page-error", page: 2, message: "Malformed page" }],
    );
    expect(audit.status).toBe("needs-review");
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "PAGE_EXTRACTION_ERRORS", pages: [2] }),
    );
  });
  it("counts a failed page once when duplicate worker events are received", () => {
    const audit = qualityAudit(
      [],
      "",
      [
        { type: "page-error", page: 2, message: "Malformed page" },
        { type: "page-error", page: 2, message: "Malformed page" },
      ],
    );
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "PAGE_EXTRACTION_ERRORS", count: 1, pages: [2] }),
    );
  });
  it("labels scanned OCR-only pages without claiming an unverified source rendition", () => {
    const audit = qualityAudit(
      [
        {
          page: 1,
          text: "Recovered OCR text",
          quality: { characters: 18, textBlocks: 0, ocrApplied: true },
        },
      ],
      "Recovered OCR text",
    );
    expect(audit.status).toBe("warnings");
    const issue = audit.issues.find((item) => item.code === "OCR_ONLY_PAGES");
    expect(issue).toEqual(expect.objectContaining({ pages: [1] }));
    expect(issue.message).not.toMatch(/renditions are retained/i);
  });
});
