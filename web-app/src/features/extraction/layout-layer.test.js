import { expect, it } from "vitest";
import {
  analyzePageLayout,
  detectRepeatedHeaderFooter,
  groupLinesIntoBlocks,
  groupSpansIntoLines,
  layoutQualityMetrics,
} from "./layout-layer.js";

const pageBounds = [0, 0, 612, 792];
const line = (text, x, y, size = 10, extra = {}) => ({
  text,
  bbox: [x, y, x + Math.max(60, text.length * size * 0.48), y + size],
  size,
  ...extra,
});
const block = (text, x, y, size = 10, extra = {}) => ({
  lines: [line(text, x, y, size, extra)],
  bbox: [x, y, x + Math.max(80, text.length * size * 0.48), y + size],
  ...extra,
});

it("reconstructs hierarchical table-of-contents headings in source order", () => {
  const analysis = analyzePageLayout({
    page: 1,
    pageBounds,
    blocks: [
      block("1 Introduction ........................ 1", 72, 80, 12),
      block("1.1 Scope ............................ 2", 88, 108, 10),
      block("1.2 Method ........................... 4", 88, 132, 10),
      block("2 Results ............................ 8", 72, 170, 12),
    ],
  });
  expect(analysis.candidates.map((candidate) => candidate.text)).toEqual([
    "1 Introduction ........................ 1",
    "1.1 Scope ............................ 2",
    "1.2 Method ........................... 4",
    "2 Results ............................ 8",
  ]);
  expect(analysis.candidates.map((candidate) => candidate.type)).toEqual([
    "heading",
    "heading",
    "heading",
    "heading",
  ]);
  expect(analysis.candidates.map((candidate) => candidate.headingLevel)).toEqual([1, 2, 2, 1]);
  expect(analysis.candidates.every((candidate) => candidate.bbox.length === 4 && candidate.sourcePage === 1)).toBe(true);
});

it("reads a stable academic two-column page by column, preserving a full-width anchor", () => {
  const analysis = analyzePageLayout({
    page: 2,
    pageBounds,
    blocks: [
      block("Abstract", 50, 40, 15, { kind: "text" }),
      block("Left paragraph one", 55, 90),
      block("Left paragraph two", 55, 125),
      block("Right paragraph one", 335, 90),
      block("Right paragraph two", 335, 125),
    ],
  });
  expect(analysis.columns.count).toBe(2);
  expect(analysis.candidates.map((candidate) => candidate.text)).toEqual([
    "Abstract",
    "Left paragraph one",
    "Left paragraph two",
    "Right paragraph one",
    "Right paragraph two",
  ]);
  expect(analysis.candidates.slice(1).every((candidate) => candidate.bbox.length === 4)).toBe(true);
});

it("keeps a sparse sidebar in source geometry instead of forcing a false column order", () => {
  const analysis = analyzePageLayout({
    pageBounds,
    blocks: [
      block("Body paragraph one", 55, 80),
      block("Sidebar note", 470, 92, 9),
      block("Body paragraph two", 55, 120),
      block("Body paragraph three", 55, 160),
    ],
  });
  expect(analysis.columns.count).toBe(1);
  expect(analysis.candidates.map((candidate) => candidate.text)).toEqual([
    "Body paragraph one",
    "Sidebar note",
    "Body paragraph two",
    "Body paragraph three",
  ]);
  expect(analysis.candidates.every((candidate) => candidate.structureConfidence < 0.6 && candidate.disposition === "needs-review")).toBe(true);
  expect(analysis.diagnostics.some((item) => item.code === "ambiguous-column-split")).toBe(true);
});

it("uses writing-direction evidence for a supported right-to-left page", () => {
  const analysis = analyzePageLayout({
    pageBounds,
    direction: "rtl",
    blocks: [
      block("يمين واحد", 350, 80),
      block("يمين اثنان", 350, 120),
      block("يسار واحد", 70, 80),
      block("يسار اثنان", 70, 120),
    ],
  });
  expect(analysis.columns.count).toBe(2);
  expect(analysis.direction).toBe("rtl");
  expect(analysis.candidates.map((candidate) => candidate.text)).toEqual([
    "يمين واحد",
    "يمين اثنان",
    "يسار واحد",
    "يسار اثنان",
  ]);
});

it("does not invent a column split when gutter evidence overlaps", () => {
  const analysis = analyzePageLayout({
    pageBounds,
    blocks: [
      block("A", 55, 40),
      block("B", 150, 70),
      block("C", 240, 100),
      block("D", 330, 130),
    ],
  });
  expect(analysis.columns.count).toBe(1);
  expect(analysis.diagnostics.some((item) => item.code === "ambiguous-column-split" || item.code === "overlapping-column-evidence")).toBe(true);
});

it("groups spans into lines and keeps source span IDs", () => {
  const lines = groupSpansIntoLines([
    { id: "s1", value: "Hello", bbox: [50, 20, 75, 30], size: 10 },
    { id: "s2", value: "world", bbox: [78, 20, 110, 30], size: 10 },
    { id: "s3", value: "Next", bbox: [50, 42, 73, 52], size: 10 },
  ]);
  expect(lines).toHaveLength(2);
  expect(lines[0].text).toBe("Hello world");
  expect(lines[0].sourceSpanIds).toEqual(["s1", "s2"]);
});

it("groups conservative paragraph continuations and records merges", () => {
  const blocks = groupLinesIntoBlocks([
    line("This sentence continues", 50, 40),
    line("on the next visual block", 50, 52),
    line("A new heading", 50, 100, 16),
  ]);
  expect(blocks[0].lines).toHaveLength(2);
  expect(blocks[0].diagnostics.some((item) => item.code === "merged-blocks")).toBe(true);
  expect(blocks).toHaveLength(2);
});

it("reports repeated running matter and separate structural metrics", () => {
  const pages = [1, 2, 3].map((page) => ({
    page,
    pageBounds,
    candidates: [
      { text: "Acme Annual Report", bbox: [50, 20, 240, 30] },
      { text: `Body ${page}`, bbox: [60, 200, 240, 212] },
      { text: "Confidential", bbox: [50, 760, 180, 770] },
    ],
  }));
  expect(detectRepeatedHeaderFooter(pages)).toEqual([
    { text: "Acme Annual Report", position: "header", pages: [1, 2, 3] },
    { text: "Confidential", position: "footer", pages: [1, 2, 3] },
  ]);
  expect(layoutQualityMetrics(["a", "b"], ["a", "b"], {
    expectedHeadings: [{ text: "A", level: 1 }],
    actualHeadings: [{ text: "A", level: 1 }],
    expectedParagraphBoundaries: [1],
    actualParagraphBoundaries: [1],
    duplicateHeaderFooterCount: 1,
    headerFooterCount: 4,
  })).toMatchObject({
    readingOrderAccuracy: 1,
    headingLevelAccuracy: 1,
    paragraphBoundaryAccuracy: 1,
    duplicateHeaderFooterRate: 0.25,
  });
});
