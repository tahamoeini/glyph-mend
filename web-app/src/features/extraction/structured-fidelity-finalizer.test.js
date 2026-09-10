import { expect, it } from "vitest";
import { installFinalStructuredFidelity } from "./structured-fidelity-finalizer.js";

function collect(structured) {
  const blocks = [];
  let block = null;
  let line = "";
  structured.walk({
    beginTextBlock() {
      block = [];
    },
    beginLine() {
      line = "";
    },
    onChar(value) {
      line += value;
    },
    endLine() {
      block.push(line);
    },
    endTextBlock() {
      blocks.push(block);
    },
  });
  return blocks;
}

it("uses richer JSON blocks when the current MuPDF walk flattens the page to one line", () => {
  class StructuredText {
    asJSON() {
      return JSON.stringify({
        blocks: [
          {
            type: "structure",
            contents: [
              {
                type: "text",
                bbox: [72, 42, 250, 64],
                lines: [
                  {
                    text: "TECHNICAL NOTE",
                    bbox: [72, 42, 250, 64],
                    font: { size: 20 },
                  },
                ],
              },
              {
                type: "text",
                bbox: [72, 100, 500, 130],
                lines: [
                  {
                    text: "Ordinary body text remains a paragraph.",
                    bbox: [72, 100, 500, 112],
                    font: { size: 11 },
                  },
                  {
                    text: "Its wrapped continuation remains with it.",
                    bbox: [72, 116, 430, 128],
                    font: { size: 11 },
                  },
                ],
              },
              {
                type: "text",
                bbox: [72, 400, 330, 414],
                lines: [
                  {
                    text: "Figure 1. Embedded source visual",
                    bbox: [72, 400, 330, 414],
                    font: { size: 11 },
                  },
                ],
              },
            ],
          },
        ],
      });
    }

    walk(walker) {
      walker.beginTextBlock?.([72, 42, 500, 414]);
      walker.beginLine?.([72, 42, 500, 414]);
      for (const value of
        "TECHNICAL NOTE Ordinary body text remains a paragraph. Its wrapped continuation remains with it. Figure 1. Embedded source visual")
        walker.onChar?.(value, [0, 0], null, 11, [0, 0, 1, 0, 1, 1, 0, 1]);
      walker.endLine?.();
      walker.endTextBlock?.();
    }
  }

  installFinalStructuredFidelity({ StructuredText });
  expect(collect(new StructuredText())).toEqual([
    ["TECHNICAL NOTE"],
    [
      "Ordinary body text remains a paragraph.",
      "Its wrapped continuation remains with it.",
    ],
    ["Figure 1. Embedded source visual"],
  ]);
});

it("keeps an already-structured native walk instead of replacing useful character geometry", () => {
  class StructuredText {
    asJSON() {
      return JSON.stringify({
        blocks: [
          {
            type: "text",
            lines: [
              { text: "Heading", bbox: [0, 0, 100, 12], font: { size: 12 } },
              { text: "Body", bbox: [0, 20, 100, 32], font: { size: 10 } },
            ],
          },
        ],
      });
    }

    walk(walker) {
      for (const [text, y] of [
        ["Heading", 0],
        ["Body", 20],
      ]) {
        walker.beginTextBlock?.([0, y, 100, y + 12]);
        walker.beginLine?.([0, y, 100, y + 12]);
        [...text].forEach((value, index) =>
          walker.onChar?.(
            value,
            [index * 5, y + 12],
            null,
            10,
            [index * 5, y, index * 5 + 4, y, index * 5 + 4, y + 12, index * 5, y + 12],
          ),
        );
        walker.endLine?.();
        walker.endTextBlock?.();
      }
    }
  }

  installFinalStructuredFidelity({ StructuredText });
  expect(collect(new StructuredText())).toEqual([["Heading"], ["Body"]]);
});
