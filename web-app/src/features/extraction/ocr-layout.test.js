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
                { text: "1. INTRODUCTION", bbox: { y0: 10, y1: 30 } },
                { text: "Revenue management aligns price", bbox: { y0: 50, y1: 70 } },
                { text: "with available capacity.", bbox: { y0: 74, y1: 94 } },
                { text: "A new paragraph begins here.", bbox: { y0: 130, y1: 150 } },
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
