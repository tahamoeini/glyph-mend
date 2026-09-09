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
