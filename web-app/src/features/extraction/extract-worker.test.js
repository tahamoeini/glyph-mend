import { expect, it } from "vitest";
import {
  buildEquationCandidate,
  captionFor,
  jsonFallbackBlocks,
  latexMarkdown,
  looksLikeOcrEquation,
  normalizeBackground,
  ocrProgressMessage,
  ocrTableMarkdown,
  textFallbackBlocks,
} from "./extract-worker.js";

it("reconstructs equation candidates as LaTeX instead of visual assets", () => {
  expect(latexMarkdown("p ≤ μ + ½")).toBe("p \\leq \\mu + \\frac{1}{2}");
});

it("associates a nearby figure caption with its visual placeholder", () => {
  const blocks = [
    {
      lines: [
        {
          text: "Figure 3.2. Booking curve by fare class",
          bbox: [70, 240, 320, 254],
        },
      ],
    },
  ];
  expect(captionFor(blocks, [60, 100, 340, 230], 12)).toBe(
    "Figure 3.2. Booking curve by fare class",
  );
});

it("converts a stable OCR word grid into a Markdown table", () => {
  const line = (y, values) => ({
    words: values.map(([text, x0, x1]) => ({
      text,
      confidence: 95,
      bbox: { x0, y0: y, x1, y1: y + 12 },
    })),
  });
  const data = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              line(10, [["Class", 10, 45], ["Demand", 110, 160], ["Fare", 220, 250]]),
              line(30, [["Y", 10, 18], ["120", 110, 135], ["450", 220, 245]]),
              line(50, [["M", 10, 22], ["85", 110, 128], ["320", 220, 245]]),
              line(70, [["B", 10, 18], ["40", 110, 128], ["180", 220, 245]]),
            ],
          },
        ],
      },
    ],
  };
  expect(ocrTableMarkdown(data)).toBe(
    "| Class | Demand | Fare |\n| --- | --- | --- |\n| Y | 120 | 450 |\n| M | 85 | 320 |\n| B | 40 | 180 |",
  );
});

it("rejects prose-like or geometrically unstable OCR instead of inventing a table", () => {
  const data = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  { text: "This", confidence: 94, bbox: { x0: 10, y0: 10, x1: 40, y1: 22 } },
                  { text: "paragraph", confidence: 94, bbox: { x0: 90, y0: 10, x1: 145, y1: 22 } },
                ],
              },
              {
                words: [
                  { text: "does", confidence: 94, bbox: { x0: 35, y0: 30, x1: 58, y1: 42 } },
                  { text: "not", confidence: 94, bbox: { x0: 180, y0: 30, x1: 200, y1: 42 } },
                ],
              },
              {
                words: [
                  { text: "form", confidence: 94, bbox: { x0: 10, y0: 50, x1: 38, y1: 62 } },
                  { text: "columns", confidence: 94, bbox: { x0: 130, y0: 50, x1: 175, y1: 62 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(ocrTableMarkdown(data)).toBeNull();
});

it("rejects Revenue Management prose and incomplete OCR equations", () => {
  expect(looksLikeOcrEquation("2.2.2.1 Dynamic Programming Formulation")).toBe(false);
  expect(
    looksLikeOcrEquation(
      "chosen to present all problems in discrete time. This eliminates several",
    ),
  ).toBe(false);
  expect(looksLikeOcrEquation("p2 = p1 P(D1 > y1)")).toBe(true);
  expect(looksLikeOcrEquation("Sy <<")).toBe(false);
  expect(looksLikeOcrEquation("x =")).toBe(false);
});

it("records source provenance and a reversible crop for OCR equation candidates", () => {
  const candidate = buildEquationCandidate(
    3,
    { kind: "equation", bbox: [60, 110, 300, 150], text: "x = y + 1" },
    { data: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), width: 2, height: 1 },
    "raster",
    "x = y + 1",
  );

  expect(candidate.page).toBe(3);
  expect(candidate.sourceAsset.page).toBe(3);
  expect(candidate.sourceAsset.bbox).toEqual([60, 110, 300, 150]);
  expect(candidate.sourceAsset.crop.format).toBe("png");
  expect(candidate.sourceAsset.crop.data.length).toBeGreaterThan(0);
  expect(candidate.evidence.text).toContain("x = y + 1");
  expect(["accepted", "review", "preserved"]).toContain(candidate.disposition);
});

it("keeps prose from being mistaken for a math region while preserving nearby valid equations", () => {
  const proseCandidate = buildEquationCandidate(
    4,
    { kind: "equation", bbox: [40, 80, 220, 100], text: "This paragraph does not form an equation" },
    { data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 },
    "raster",
    "This paragraph does not form an equation",
  );
  const mathCandidate = buildEquationCandidate(
    4,
    { kind: "equation", bbox: [40, 120, 220, 150], text: "p ≤ μ + ½" },
    { data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 },
    "raster",
    "p ≤ μ + ½",
  );

  expect(proseCandidate.disposition).toBe("preserved");
  expect(mathCandidate.disposition).not.toBe("preserved");
  expect(
    normalizeBackground({ data: new Uint8Array([240, 240, 240, 255]), width: 1, height: 1 }).background,
  ).toBe(255);
});

it("recovers text nested below MuPDF structural grouping blocks", () => {
  const blocks = jsonFallbackBlocks({
    asJSON: () =>
      JSON.stringify({
        blocks: [
          {
            type: "structure",
            contents: [
              {
                type: "text",
                bbox: [72, 700, 360, 720],
                lines: [{ text: "Browser Extraction Test", bbox: [72, 700, 360, 720] }],
              },
            ],
          },
        ],
      }),
  });
  expect(blocks).toHaveLength(1);
  expect(blocks[0].lines[0].text).toBe("Browser Extraction Test");
});

it("uses MuPDF plain text as a final structured-text fallback", () => {
  const blocks = textFallbackBlocks({ asText: () => "One line\nSecond line\n" });
  expect(blocks[0].lines.map((line) => line.text)).toEqual(["One line", "Second line"]);
});

it("creates valid OCR progress messages for initialization and recognition", () => {
  expect(
    ocrProgressMessage(1, { status: "loading tesseract core", progress: 0.25 }),
  ).toEqual({
    type: "ocr-progress",
    page: 1,
    status: "loading tesseract core",
    progress: 0.25,
  });
  expect(
    ocrProgressMessage(745, { status: "recognizing text", progress: 1.4 }),
  ).toEqual({
    type: "ocr-progress",
    page: 745,
    status: "recognizing text",
    progress: 1,
  });
});

it("suppresses OCR progress events that have no valid page context", () => {
  expect(ocrProgressMessage(undefined, { status: "loading", progress: 0 })).toBeNull();
  expect(ocrProgressMessage(0, { status: "loading", progress: 0 })).toBeNull();
  expect(ocrProgressMessage(2001, { status: "loading", progress: 0 })).toBeNull();
});
