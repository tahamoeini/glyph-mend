import { describe, expect, it } from "vitest";
import {
  coalesceImageRects,
  enrichStructuredTextOptions,
  installMuPdfStructuredRecovery,
  jsonImageRects,
} from "./structured-recovery.js";

describe("structured text recovery", () => {
  it("adds paragraph and table analysis without duplicating vector collection", () => {
    const options = enrichStructuredTextOptions("preserve-whitespace,segment");
    const values = new Set(options.split(","));
    expect(values).toEqual(
      new Set([
        "preserve-whitespace",
        "preserve-images",
        "preserve-spans",
        "segment",
        "paragraph-break",
        "table-hunt",
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

  it("replays JSON images omitted by walk while preserving native callbacks", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({
          blocks: [
            { type: "image", bbox: { x: 50, y: 60, w: 80, h: 40 } },
          ],
        });
      }
      walk(walker) {
        walker.beginTextBlock?.([0, 0, 10, 10]);
        walker.endTextBlock?.();
      }
    }

    const fakeMuPdf = { Page, StructuredText };
    installMuPdfStructuredRecovery(fakeMuPdf);

    const page = new Page();
    expect(page.toStructuredText("preserve-whitespace")).toContain("paragraph-break");

    const images = [];
    new StructuredText().walk({
      onImageBlock(bbox, _transform, image) {
        images.push(bbox);
        expect(typeof image.destroy).toBe("function");
      },
    });
    expect(images).toEqual([[42, 55, 138, 105]]);
  });

  it("uses richer JSON blocks instead of a single collapsed native walk block", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({
          blocks: [
            {
              type: "text",
              bbox: [60, 60, 360, 95],
              lines: [
                {
                  text: "2.3",
                  bbox: [60, 60, 90, 74],
                  font: { name: "Times-Bold", weight: "bold", size: 13 },
                },
                {
                  text: "Adaptive Methods",
                  bbox: [98, 60, 220, 74],
                  font: { name: "Times-Bold", weight: "bold", size: 13 },
                },
                {
                  text: "This body paragraph should not become part of the heading.",
                  bbox: [60, 80, 360, 95],
                  font: { name: "Times-Roman", weight: "normal", size: 10 },
                },
              ],
            },
            {
              type: "text",
              bbox: [60, 120, 360, 140],
              lines: [
                {
                  text: "A second paragraph remains a distinct structured block.",
                  bbox: [60, 120, 360, 140],
                  font: { name: "Times-Roman", size: 10 },
                },
              ],
            },
          ],
        });
      }
      walk(walker) {
        walker.beginTextBlock?.([0, 0, 500, 700]);
        walker.beginLine?.([0, 0, 500, 20]);
        for (const char of "collapsed entire page")
          walker.onChar?.(char, [0, 0], null, 10, [0, 0, 1, 0, 1, 10, 0, 10]);
        walker.endLine?.();
        walker.endTextBlock?.();
      }
    }

    installMuPdfStructuredRecovery({ Page, StructuredText });
    const blocks = [];
    let current = null;
    let line = "";
    new StructuredText().walk({
      beginTextBlock() {
        current = [];
      },
      beginLine() {
        line = "";
      },
      onChar(value) {
        line += value;
      },
      endLine() {
        current.push(line);
      },
      endTextBlock() {
        blocks.push(current);
      },
    });

    expect(blocks).toEqual([
      ["2.3", "Adaptive Methods"],
      ["This body paragraph should not become part of the heading."],
      ["A second paragraph remains a distinct structured block."],
    ]);
    expect(blocks.flat().join(" ")).not.toContain("collapsed entire page");
  });
});
