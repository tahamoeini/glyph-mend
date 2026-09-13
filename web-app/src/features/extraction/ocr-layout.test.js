import { expect, it } from "vitest";
import { ocrMarkdownEntries } from "./ocr-layout.js";

const identity = (value) => value;

it("preserves numbered OCR headings and paragraph boundaries", () => {
  const entries = ocrMarkdownEntries(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: "1. INTRODUCTION", bbox: { x0: 10, y0: 10, x1: 200, y1: 30 } },
                { text: "Revenue management aligns price", bbox: { x0: 10, y0: 50, x1: 230, y1: 70 } },
                { text: "with available capacity.", bbox: { x0: 10, y0: 74, x1: 190, y1: 94 } },
                { text: "A new paragraph begins here.", bbox: { x0: 10, y0: 130, x1: 220, y1: 150 } },
              ],
            },
          ],
        },
      ],
    },
    identity,
  );
  expect(entries.map((entry) => entry.markdown)).toEqual([
    "# 1. INTRODUCTION",
    "Revenue management aligns price with available capacity.",
    "A new paragraph begins here.",
  ]);
});

it("reconstructs structure from plain OCR text when JSON blocks are unavailable", () => {
  const entries = ocrMarkdownEntries(
    {
      text: "2. OVERBOOKING\n\nAn overview of the model.\n\n2.1 Introduction\n\nCapacity is limited.",
      blocks: null,
    },
    identity,
  );
  expect(entries.map((entry) => entry.markdown)).toEqual([
    "# 2. OVERBOOKING",
    "An overview of the model.",
    "## 2.1 Introduction",
    "Capacity is limited.",
  ]);
});

it("keeps numbered prose as a list instead of inventing chapter headings", () => {
  const entries = ocrMarkdownEntries(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: "1. Data collection: Collect and store relevant historical data",
                  bbox: { x0: 20, y0: 10, x1: 420, y1: 30 },
                },
                {
                  text: "including prices, demand, and causal factors.",
                  bbox: { x0: 35, y0: 33, x1: 390, y1: 53 },
                },
                {
                  text: "2. Estimation and forecasting: Estimate demand.",
                  bbox: { x0: 20, y0: 72, x1: 410, y1: 92 },
                },
              ],
            },
          ],
        },
      ],
    },
    identity,
  );
  expect(entries.map((entry) => entry.markdown)).toEqual([
    "1. Data collection: Collect and store relevant historical data including prices, demand, and causal factors.",
    "2. Estimation and forecasting: Estimate demand.",
  ]);
});

it("does not turn table-of-contents rows into hundreds of Markdown headings", () => {
  const lines = [
    { text: "Contents", bbox: { x0: 20, y0: 10, x1: 120, y1: 30 } },
    { text: "1. INTRODUCTION 1", bbox: { x0: 20, y0: 50, x1: 250, y1: 70 } },
    { text: "1.1 What Is RM? 1", bbox: { x0: 30, y0: 74, x1: 250, y1: 94 } },
    { text: "1.2 The Origins of RM 6", bbox: { x0: 30, y0: 98, x1: 270, y1: 118 } },
    { text: "1.3 A Conceptual Framework for RM 11", bbox: { x0: 30, y0: 122, x1: 340, y1: 142 } },
    { text: "1.4 An Overview of a RM System 17", bbox: { x0: 30, y0: 146, x1: 350, y1: 166 } },
  ];
  const entries = ocrMarkdownEntries(
    { blocks: [{ paragraphs: [{ lines }] }] },
    identity,
  );
  expect(entries[0].markdown).toBe("# Contents");
  expect(entries.slice(1).every((entry) => !entry.markdown.startsWith("#"))).toBe(true);
});

it("normalizes OCR pixel coordinates into PDF page coordinates", () => {
  const entries = ocrMarkdownEntries(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: "Top paragraph.", bbox: { x0: 10, y0: 100, x1: 400, y1: 140 } },
                { text: "Bottom paragraph.", bbox: { x0: 10, y0: 900, x1: 400, y1: 940 } },
              ],
            },
          ],
        },
      ],
    },
    identity,
    { pageBounds: [0, 0, 456, 640] },
  );
  expect(entries[0].y).toBeGreaterThanOrEqual(0);
  expect(entries.at(-1).y).toBeLessThanOrEqual(640);
});

it("escapes OCR dollar signs so diagram noise cannot become display math", () => {
  const entries = ocrMarkdownEntries(
    { text: "$$\n$100 fare", blocks: null },
    identity,
  );
  expect(entries.map((entry) => entry.markdown).join("\n")).not.toMatch(/^\$\$$/m);
  expect(entries.map((entry) => entry.markdown).join("\n")).toContain("\\$100");
});

it("serializes detected OCR equations as LaTeX Markdown and repairs line wraps", () => {
  const ranges = [{ y0: 40, y1: 65, latex: "p \\leq q + 1" }];
  const entries = ocrMarkdownEntries(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: "over-", bbox: { x0: 10, y0: 10, x1: 70, y1: 25 } },
                { text: "booking is common.", bbox: { x0: 10, y0: 26, x1: 180, y1: 39 } },
                { text: "p ≤ q + 1", bbox: { x0: 100, y0: 40, x1: 220, y1: 65 } },
              ],
            },
          ],
        },
      ],
    },
    identity,
    { equationRanges: ranges },
  );
  expect(entries.map((entry) => entry.markdown)).toEqual([
    "overbooking is common.",
    "$$\np \\leq q + 1\n$$",
  ]);
});

it("suppresses an equation text range when validation requires visual fallback", () => {
  const entries = ocrMarkdownEntries(
    { text: "x =", blocks: null },
    identity,
    { equationRanges: [{ y0: 0, y1: 10, latex: "x =", emit: false }] },
  );
  expect(entries).toEqual([]);
});

it("keeps sentence-like numbered OCR lines out of heading syntax", () => {
  const entries = ocrMarkdownEntries(
    { text: "1. This is a numbered instruction.\n\n1.2 Revenue Controls", blocks: null },
    identity,
  );
  expect(entries.map((entry) => entry.markdown)).toEqual([
    "1. This is a numbered instruction.",
    "## 1.2 Revenue Controls",
  ]);
});

it("does not promote cropped all-caps abbreviations to headings", () => {
  const entries = ocrMarkdownEntries({ text: "RM.\n\nINTRODUCTION", blocks: null }, identity);
  expect(entries.map((entry) => entry.markdown)).toEqual(["RM.", "# INTRODUCTION"]);
});

it("promotes a short all-caps OCR heading when real layout evidence supports it", () => {
  const entries = ocrMarkdownEntries(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: "API", bbox: { x0: 180, y0: 10, x1: 230, y1: 36 } },
                {
                  text: "Application programming interfaces connect systems.",
                  bbox: { x0: 20, y0: 70, x1: 410, y1: 86 },
                },
                {
                  text: "This paragraph continues normally.",
                  bbox: { x0: 20, y0: 90, x1: 360, y1: 106 },
                },
              ],
            },
          ],
        },
      ],
    },
    identity,
  );
  expect(entries.map((entry) => entry.markdown)).toEqual([
    "# API",
    "Application programming interfaces connect systems. This paragraph continues normally.",
  ]);
});
