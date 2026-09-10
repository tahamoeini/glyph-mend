import { describe, expect, it } from "vitest";
import {
  coalesceImageRects,
  enrichStructuredTextOptions,
  installMuPdfStructuredRecovery,
  jsonImageRects,
} from "./structured-recovery.js";

function quad(x0, y0, x1, y1) {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

function emitLine(walker, text, bbox, size = 10, gaps = {}) {
  walker.beginLine?.(bbox);
  let x = bbox[0];
  const visible = Math.max(1, [...text].filter((char) => char !== " ").length);
  const defaultAdvance = Math.max(3, (bbox[2] - bbox[0]) / visible);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (Object.hasOwn(gaps, index)) x += gaps[index];
    const advance = char === " " ? Math.max(2, defaultAdvance * 0.35) : defaultAdvance;
    walker.onChar?.(char, [x, bbox[3]], null, size, quad(x, bbox[1], x + advance, bbox[3]));
    x += advance;
  }
  walker.endLine?.();
}

function collectBlocks(structured) {
  const blocks = [];
  let current = null;
  let line = "";
  const charBoxes = [];
  let lineBoxes = [];
  structured.walk({
    beginTextBlock() {
      current = [];
      lineBoxes = [];
    },
    beginLine() {
      line = "";
      lineBoxes.push([]);
    },
    onChar(value, _origin, _font, _size, characterQuad) {
      line += value;
      lineBoxes.at(-1).push(characterQuad);
    },
    endLine() {
      current.push(line);
    },
    endTextBlock() {
      blocks.push(current);
      charBoxes.push(lineBoxes);
    },
  });
  return { blocks, charBoxes };
}

describe("structured text recovery", () => {
  it("enables whitespace, paragraph, table, image, span, and vector preservation", () => {
    const options = enrichStructuredTextOptions("segment");
    const values = new Set(options.split(","));
    expect(values).toEqual(
      new Set([
        "preserve-images",
        "preserve-spans",
        "preserve-whitespace",
        "segment",
        "paragraph-break",
        "table-hunt",
        "vectors",
      ]),
    );
  });

  it("recovers and deduplicates nested image regions from structured JSON", () => {
    const structured = {
      asJSON: () =>
        JSON.stringify({
          blocks: [
            { type: "image", bbox: { x: 10, y: 20, w: 100, h: 50 } },
            {
              type: "structure",
              children: [
                { type: "image", bbox: [10, 20, 110, 70] },
                { type: "image", bbox: { x: 40, y: 95, w: 150, h: 80 } },
              ],
            },
          ],
        }),
    };
    expect(jsonImageRects(structured)).toEqual([
      [10, 20, 110, 70],
      [40, 95, 190, 175],
    ]);
  });

  it("coalesces equation-like image fragments that share a visual line", () => {
    expect(
      coalesceImageRects([
        [80, 100, 115, 112],
        [124, 101, 160, 113],
        [70, 150, 130, 164],
      ]),
    ).toEqual([
      [80, 100, 160, 113],
      [70, 150, 130, 164],
    ]);
  });

  it("replays JSON images omitted by the native walk", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({
          blocks: [{ type: "image", bbox: { x: 50, y: 60, w: 80, h: 40 } }],
        });
      }
      walk(walker) {
        walker.beginTextBlock?.([0, 0, 10, 10]);
        walker.endTextBlock?.();
      }
    }

    installMuPdfStructuredRecovery({ Page, StructuredText });
    const page = new Page();
    const options = page.toStructuredText("segment");
    expect(options).toContain("paragraph-break");
    expect(options).toContain("vectors");

    const images = [];
    new StructuredText().walk({
      onImageBlock(bbox, _transform, image) {
        images.push(bbox);
        expect(typeof image.destroy).toBe("function");
      },
    });
    expect(images).toEqual([[42, 55, 138, 105]]);
  });

  it("splits a single native page-wide text block into headings and paragraphs", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({ blocks: [] });
      }
      walk(walker) {
        walker.beginTextBlock?.([50, 50, 430, 190]);
        emitLine(walker, "2.3 Adaptive Methods", [50, 50, 220, 64], 13);
        emitLine(walker, "The first paragraph begins here and continues", [50, 82, 410, 94]);
        emitLine(walker, "on a second wrapped line.", [50, 96, 240, 108]);
        emitLine(walker, "A new paragraph starts after the visible gap", [64, 128, 410, 140]);
        emitLine(walker, "and has its own continuation line.", [50, 142, 300, 154]);
        walker.endTextBlock?.();
      }
    }

    installMuPdfStructuredRecovery({ Page, StructuredText });
    expect(collectBlocks(new StructuredText()).blocks).toEqual([
      ["2.3 Adaptive Methods"],
      ["The first paragraph begins here and continues", "on a second wrapped line."],
      ["A new paragraph starts after the visible gap", "and has its own continuation line."],
    ]);
  });

  it("preserves native character geometry while isolating table rows", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({ blocks: [] });
      }
      walk(walker) {
        walker.beginTextBlock?.([40, 40, 430, 180]);
        emitLine(walker, "Introductory prose.", [40, 40, 180, 52]);
        emitLine(walker, "Class Revenue Demand", [40, 80, 300, 92], 10, { 6: 36, 14: 34 });
        emitLine(walker, "Y 100 20", [40, 96, 260, 108], 10, { 2: 56, 6: 54 });
        emitLine(walker, "M 75 35", [40, 112, 260, 124], 10, { 2: 56, 5: 54 });
        emitLine(walker, "K 50 45", [40, 128, 260, 140], 10, { 2: 56, 5: 54 });
        emitLine(walker, "Following prose.", [40, 166, 180, 178]);
        walker.endTextBlock?.();
      }
    }

    installMuPdfStructuredRecovery({ Page, StructuredText });
    const { blocks, charBoxes } = collectBlocks(new StructuredText());
    expect(blocks).toEqual([
      ["Introductory prose."],
      ["Class Revenue Demand", "Y 100 20", "M 75 35", "K 50 45"],
      ["Following prose."],
    ]);

    const tableBoxes = charBoxes[1][1];
    const firstDataGap = tableBoxes[2][0] - tableBoxes[1][2];
    expect(firstDataGap).toBeGreaterThan(20);
  });

  it("turns flattened contents entries into readable list items instead of headings", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({ blocks: [] });
      }
      walk(walker) {
        walker.beginTextBlock?.([50, 40, 430, 160]);
        emitLine(walker, "Contents", [180, 40, 250, 55], 14);
        emitLine(walker, "1. INTRODUCTION 1", [50, 80, 250, 92]);
        emitLine(walker, "1.1 What Is RM? 1", [50, 98, 260, 110]);
        emitLine(walker, "2. SINGLE-RESOURCE CAPACITY CONTROL 27", [50, 116, 390, 128]);
        walker.endTextBlock?.();
      }
    }

    installMuPdfStructuredRecovery({ Page, StructuredText });
    expect(collectBlocks(new StructuredText()).blocks).toEqual([
      ["Contents"],
      ["- 1. INTRODUCTION 1"],
      ["- 1.1 What Is RM? 1"],
      ["- 2. SINGLE-RESOURCE CAPACITY CONTROL 27"],
    ]);
  });

  it("normalizes common PDF bullet glyphs to Markdown bullets", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({ blocks: [] });
      }
      walk(walker) {
        walker.beginTextBlock?.([50, 40, 430, 100]);
        emitLine(walker, "• First item", [50, 40, 180, 52]);
        emitLine(walker, "• Second item", [50, 64, 190, 76]);
        walker.endTextBlock?.();
      }
    }

    installMuPdfStructuredRecovery({ Page, StructuredText });
    expect(collectBlocks(new StructuredText()).blocks).toEqual([
      ["- First item"],
      ["- Second item"],
    ]);
  });
});
