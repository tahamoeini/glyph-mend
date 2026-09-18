import { describe, expect, it } from "vitest";
import {
  cleanupDocument,
  documentMetrics,
  headingFor,
  joinPageParagraphs,
  normalizeHeadingHierarchy,
  repairDisplayMathProse,
  repairLineWrapHyphens,
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
  it("removes repeated running headers even when extraction promoted them to Markdown headings", () => {
    const pages = [12, 13, 14].map((page) => ({
      page,
      text: `## THE THEORY AND PRACTICE OF REVENUE MANAGEMENT ${page}\n\nActual body ${page}\n\n${page}`,
      edges: {
        headers: [`THE THEORY AND PRACTICE OF REVENUE MANAGEMENT ${page}`],
        footers: [`${page}`],
      },
    }));
    expect(
      cleanupDocument(pages, {
        removeHeaders: true,
        removeFooters: true,
        detectHeadings: true,
      }),
    ).toBe("Actual body 12\n\nActual body 13\n\nActual body 14");
  });
  it("removes repeated footers from short pages even when the last line is only a page label", () => {
    const pages = [1, 2, 3].map((page) => ({
      page,
      text: `Chapter title\nBody ${page}\nRUNNING FOOTER\n${page}`,
    }));
    expect(
      cleanupDocument(pages, {
        removeFooters: true,
      }),
    ).toBe("Chapter title\nBody 1\n\nChapter title\nBody 2\n\nChapter title\nBody 3");
  });
  it("removes URL footers with dynamic page fractions without touching body URLs", () => {
    const pages = [1, 2, 3].map((page) => ({
      page,
      text: `Body ${page}\nhttps://share.example/reconnection/${page}/3`,
      edges: {
        headers: [],
        footers: [`https://share.example/reconnection/${page}/3`],
      },
    }));
    const result = removeRunningMatter(pages, { headers: false, footers: true });
    expect(result.map((page) => page.text)).toEqual([
      "Body 1",
      "Body 2",
      "Body 3",
    ]);
  });
  it("respects header/footer switches independently", () => {
    const pages = [1, 2, 3].map((page) => ({
      page,
      text: `RUNNING TITLE ${page}\nBody ${page}\nPage ${page}`,
      edges: {
        headers: [`RUNNING TITLE ${page}`],
        footers: [`Page ${page}`],
      },
    }));
    const result = cleanupDocument(pages, {
      removeHeaders: true,
      removeFooters: false,
    });
    expect(result).not.toContain("RUNNING TITLE");
    expect(result).toContain("Page 1");
    expect(result).toContain("Page 3");
  });
  it("does not remove a genuine first heading that is not repeated running matter", () => {
    const pages = [
      {
        page: 1,
        text: "# Introduction\nBody one",
        edges: { headers: ["Introduction"], footers: [] },
      },
      {
        page: 2,
        text: "# Capacity Control\nBody two",
        edges: { headers: ["Capacity Control"], footers: [] },
      },
      {
        page: 3,
        text: "# Dynamic Pricing\nBody three",
        edges: { headers: ["Dynamic Pricing"], footers: [] },
      },
    ];
    expect(
      cleanupDocument(pages, { removeHeaders: true, detectHeadings: true }),
    ).toContain("# Introduction");
  });
  it("does not promote sentence fragments or years to headings", () => {
    expect(
      headingFor("2002. The book has benefited greatly,", 18, 10),
    ).toBeNull();
    expect(headingFor("This ordinary sentence fragment", 18, 10)).toBeNull();
    expect(headingFor("2.3 Capacity Control", 12, 10)).toBe(2);
  });
  it("recognizes conventional front/back matter headings conservatively", () => {
    expect(headingFor("Contents", 11, 10)).toBe(1);
    expect(headingFor("References", 11, 10)).toBe(1);
    expect(headingFor("Acknowledgments", 9, 10)).toBeNull();
  });
  it("normalizes numbered heading depth and impossible non-numbered jumps", () => {
    const source = "# Chapter 2\n\n#### Revenue Controls\n\n##### 2.3 Capacity Control\n\n### 2.3.1 Nested Model";
    expect(normalizeHeadingHierarchy(source)).toBe(
      "# Chapter 2\n\n## Revenue Controls\n\n## 2.3 Capacity Control\n\n### 2.3.1 Nested Model",
    );
  });
  it("joins a lowercase continuation when page markers are not requested", () => {
    const value =
      "This is a sufficiently long sentence which continues\n\n<!-- page: 2 -->\n\nonto the next source page";
    expect(joinPageParagraphs(value)).toContain("continues onto");
    expect(joinPageParagraphs(value)).not.toContain("<!-- page: 2 -->");
  });

  it("repairs line-wrap hyphens without touching code fences", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const fenced = [fence, "con-\ntent", fence].join("\n");
    expect(
      repairLineWrapHyphens(["Un-\nder and grow-\ning", fenced].join("\n\n")),
    ).toBe(["Under and growing", fenced].join("\n\n"));
  });
  it("repairs mixed display math while keeping the prose editable", () => {
    const displayMath = String.fromCharCode(36).repeat(2);
    const source = [
      displayMath,
      "0.284 × 33 = 16.23. This is higher than given",
      displayMath,
    ].join("\n");
    expect(repairDisplayMathProse(source)).toBe([
      displayMath,
      "0.284 × 33 = 16.23",
      displayMath,
      "",
      "This is higher than given",
    ].join("\n"));
  });
  it("keeps valid display-math delimiters paired across later blocks", () => {
    const displayMath = String.fromCharCode(36).repeat(2);
    const source = [
      displayMath,
      "cameraConfigurationVersion = 103",
      displayMath,
      "Then creates:",
      displayMath,
      "desiredVersion = 103",
      displayMath,
      "If WebSocket exists:",
    ].join("\n");
    expect(repairDisplayMathProse(source)).toBe(source);
  });
  it("does not let prose thresholds or page content swallow the document as math", () => {
    const displayMath = String.fromCharCode(36).repeat(2);
    expect(
      repairDisplayMathProse(
        [displayMath, "last heartbeat > 180 sec", displayMath].join("\n"),
      ),
    ).toBe("last heartbeat > 180 sec");
    expect(
      repairDisplayMathProse(
        [displayMath, "Security Per Transport # HTTPS TLS", displayMath].join("\n"),
      ),
    ).toBe("Security Per Transport # HTTPS TLS");
    expect(
      repairDisplayMathProse(
        [
          displayMath,
          "Identity may be validated here. desiredVersion = 103. If WebSocket exists, keep the connection alive. <!-- page: 35 -->",
          displayMath,
        ].join("\n"),
      ),
    ).not.toContain(displayMath);
  });
  it("does not report ordinary compound words as broken wrap hyphens", () => {
    const audit = qualityAudit([], "single-resource capacity-control", []);
    expect(audit.issues.some((issue) => issue.code === "WRAP_HYPHENS")).toBe(false);
  });
  it("keeps page provenance when requested", () =>
    expect(
      cleanupDocument([{ page: 2, text: "Hello" }], { preserveMarkers: true }),
    ).toContain("<!-- page: 2 -->"));
  it("never embeds a preserved page marker inside a paragraph", () => {
    const result = cleanupDocument(
      [
        { page: 1, text: "This is a sufficiently long sentence which continues" },
        { page: 2, text: "onto the next source page" },
      ],
      { joinParagraphs: true, preserveMarkers: true },
    );
    expect(result).toContain("continues\n\n<!-- page: 2 -->\n\nonto");
    expect(result).not.toContain("continues <!-- page: 2 --> onto");
  });
  it("preserves code and diagram fences while removing running matter", () => {
    const fence = "```";
    const pages = [1, 2, 3].map((page) => ({
      page,
      text: `RUNNING TITLE ${page}\n\n${fence}\nRUNNING TITLE ${page}\n${page}/3\nA -> B\n${fence}\n\n${page}`,
      edges: { headers: [`RUNNING TITLE ${page}`], footers: [`${page}`] },
    }));
    const result = cleanupDocument(pages, {
      removeHeaders: true,
      removeFooters: true,
    });
    expect(result).toContain(`\`\`\`\nRUNNING TITLE 1\n1/3\nA -> B\n\`\`\``);
  });
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
  it("removes only Markdown escape slashes while retaining LaTeX commands", () =>
    expect(plainText("short \\-lived value \\. \\frac{1}{2}")).toBe(
      "short -lived value . \\frac{1}{2}",
    ));
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
      text: "word ".repeat(90),
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
      text: "word ".repeat(90),
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
    expect(audit.coverage.ocrAppliedPages).toEqual([1]);
    const issue = audit.issues.find((item) => item.code === "OCR_ONLY_PAGES");
    expect(issue).toEqual(expect.objectContaining({ pages: [1] }));
    expect(issue.message).not.toMatch(/renditions are retained/i);
  });

  it("reports embedded PDF font encoding damage for source review", () => {
    const audit = qualityAudit(
      [{ page: 1, text: "nia�n", quality: { characters: 5, embeddedTextCorrupt: true } }],
      "nia�n",
    );
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "TEXT_ENCODING_DAMAGE", pages: [1] }),
    );
  });

  it("exposes bounded confidence, figure preservation, and OCR usage", () => {
    const audit = qualityAudit(
      [
        {
          page: 1,
          text: "Native page",
          quality: {
            textBlocks: 3,
            textConfidence: 0.96,
            tableConfidence: 0.9,
            equationConfidence: 0.8,
            figurePreservation: { detected: 2, preserved: 2, sourceEvidence: 1 },
            ocrApplied: false,
          },
        },
        {
          page: 2,
          text: "OCR page",
          quality: {
            textBlocks: 3,
            textConfidence: 0.72,
            tableConfidence: 0.84,
            equationConfidence: 0.7,
            figurePreservation: { detected: 1, preserved: 1, sourceEvidence: 1 },
            ocrApplied: true,
          },
        },
      ],
      "Native page\n\nOCR page",
    );
    expect(audit.confidence).toEqual({ text: 0.84, table: 0.87, equation: 0.75 });
    expect(audit.figurePreservation).toEqual({ detected: 3, preserved: 3, sourceEvidence: 2 });
    expect(audit.ocrUsage).toMatchObject({ pages: 1, pageNumbers: [2], ratio: 0.5 });
  });

  it("labels a custom page range as a partial document", () => {
    const audit = qualityAudit(
      [{ page: 1, text: "Recovered page", quality: { characters: 14 } }],
      "Recovered page",
      [],
      { sourcePages: 56, selectedPages: 1, mode: "custom" },
    );
    expect(audit.coverage).toMatchObject({ sourcePages: 56, selectedPages: 1 });
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "PARTIAL_DOCUMENT", count: 1 }),
    );
  });

  it("fails quality audit when damaged source text has no preserved page evidence", () => {
    const audit = qualityAudit(
      [{ page: 4, text: "nia�n", quality: { characters: 5, embeddedTextCorrupt: true, sourcePageFallbackFailed: true } }],
      "nia�n",
    );
    expect(audit.status).toBe("needs-review");
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "SOURCE_EVIDENCE_MISSING", pages: [4] }),
    );
  });
});
