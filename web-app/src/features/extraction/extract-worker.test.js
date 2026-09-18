import { expect, it } from "vitest";
import {
  buildEquationCandidate,
  captionFor,
  dedupeNearbyEquationEntries,
  embeddedTextNeedsOcr,
  equationImageCandidatesFor,
  isDiagramLike,
  isEquation,
  jsonFallbackBlocks,
  latexMarkdown,
  looksLikeOcrEquation,
  normalizeBackground,
  orderPageEntries,
  pageLayoutSummary,
  ocrProgressMessage,
  ocrTableMarkdown,
  paddedBbox,
  pageTableFromBlocks,
  pageTableFromVectors,
  textFallbackBlocks,
} from "./extract-worker.js";

it("reconstructs equation candidates as LaTeX instead of visual assets", () => {
  expect(latexMarkdown("p ≤ μ + ½")).toBe("p \\leq \\mu + \\frac{1}{2}");
});

it("routes replacement-character PDF text to OCR", () => {
  expect(
    embeddedTextNeedsOcr([{ lines: [{ text: "nia\uFFFDn" }] }]),
  ).toBe(true);
  expect(embeddedTextNeedsOcr([{ lines: [{ text: "normal text" }] }])).toBe(false);
});

it("removes only adjacent duplicate equation emissions", () => {
  const entries = [
    { kind: "equation", y: 100, markdown: "$$\\nx=1\\n$$" },
    { kind: "equation", y: 104, markdown: "$$\\nx=1\\n$$" },
    { kind: "equation", y: 300, markdown: "$$\\nx=1\\n$$" },
  ];
  expect(dedupeNearbyEquationEntries(entries, 10)).toHaveLength(2);
  expect(dedupeNearbyEquationEntries(entries, 10).at(-1).y).toBe(300);
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

it("returns table confidence and refuses inconsistent block rows", () => {
  const row = (y, cells) => cells.map((text, index) => ({
    bbox: [10 + index * 90, y, 70 + index * 90, y + 12],
    text,
  }));
  const stable = pageTableFromBlocks(
    [{ lines: [
      ...row(10, ["Class", "Demand"]),
      ...row(30, ["Y", "120"]),
      ...row(50, ["M", "85"]),
    ] }],
    10,
    [0, 0, 300, 500],
  );
  expect(stable).toMatchObject({
    confidence: expect.any(Number),
    rows: 3,
    columns: 2,
    tableIR: {
      columns: 2,
      rows: expect.arrayContaining([["Class", "Demand"]]),
    },
  });
  expect(stable.confidence).toBeGreaterThanOrEqual(0.82);

  const unstable = pageTableFromBlocks(
    [{ lines: [
      ...row(10, ["Class", "Demand"]),
      ...row(30, ["Y", "120", "450"]),
      ...row(50, ["M", "85"]),
    ] }],
    10,
    [0, 0, 300, 500],
  );
  expect(unstable).toBeNull();
});

it("reconstructs a conservative table from a stable PDF vector grid", () => {
  const vector = (bbox) => ({ bbox });
  const vectors = [
    vector([10, 0, 250, 0.3]),
    vector([10, 20, 250, 20.3]),
    vector([10, 40, 250, 40.3]),
    vector([10, 60, 250, 60.3]),
    vector([90, 0, 90.3, 60]),
    vector([170, 0, 170.3, 60]),
  ];
  const text = (row, column, value) => ({
    text: value,
    bbox: [10 + column * 80, row * 20 + 5, 60 + column * 80, row * 20 + 15],
  });
  const result = pageTableFromVectors(
    [{
      lines: [
        text(0, 0, "Class"), text(0, 1, "Demand"), text(0, 2, "Fare"),
        text(1, 0, "Y"), text(1, 1, "120"), text(1, 2, "450"),
        text(2, 0, "M"), text(2, 1, "85"), text(2, 2, "320"),
      ],
    }],
    vectors,
    10,
    [0, 0, 300, 100],
  );
  expect(result).toMatchObject({
    rows: 3,
    columns: 3,
    tableIR: {
      method: "pdf-vector-grid",
      columns: 3,
    },
  });
  expect(result.markdown).toContain("| Class | Demand | Fare |");
  expect(result.confidence).toBeGreaterThanOrEqual(0.82);
});

it("rejects a vector table row that spans columns instead of inventing cells", () => {
  const vector = (bbox) => ({ bbox });
  const vectors = [
    vector([10, 0, 250, 0.3]),
    vector([10, 20, 250, 20.3]),
    vector([10, 40, 250, 40.3]),
    vector([10, 60, 250, 60.3]),
    vector([90, 0, 90.3, 60]),
    vector([170, 0, 170.3, 60]),
  ];
  expect(
    pageTableFromVectors(
      [{
        lines: [
          { text: "Merged heading", bbox: [10, 5, 160, 15] },
          { text: "Y", bbox: [10, 25, 60, 35] },
          { text: "120", bbox: [90, 25, 140, 35] },
          { text: "450", bbox: [170, 25, 220, 35] },
          { text: "M", bbox: [10, 45, 60, 55] },
          { text: "85", bbox: [90, 45, 140, 55] },
          { text: "320", bbox: [170, 45, 220, 55] },
        ],
      }],
      vectors,
      10,
      [0, 0, 300, 100],
    ),
  ).toBeNull();
});

it("keeps visual crop padding bounded by page geometry", () => {
  expect(paddedBbox([10, 20, 30, 40], [0, 0, 100, 100], 5)).toEqual([
    5,
    15,
    35,
    45,
  ]);
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

it("keeps ASCII diagrams out of display math and accepts compact equations", () => {
  expect(isDiagramLike("+------------------+\n| Hub              |" )).toBe(true);
  expect(isDiagramLike("+--> Public Key")).toBe(true);
  expect(isEquation("+------------------+", { bbox: [0, 0, 200, 20], size: 10 }, [0, 0, 612, 792], 10)).toBe(false);
  expect(isEquation("p ≤ μ + ½", { bbox: [80, 240, 260, 260], size: 12 }, [0, 0, 612, 792], 10)).toBe(true);
  expect(isEquation("status = PENDING_ENROLLMENT", { bbox: [0, 0, 240, 20], size: 10 }, [0, 0, 612, 792], 10)).toBe(false);
  expect(isEquation("last heartbeat < 60 sec", { bbox: [0, 0, 240, 20], size: 10 }, [0, 0, 612, 792], 10)).toBe(false);
  expect(isEquation("cameraConfigurationVersion = 103", { bbox: [0, 0, 240, 20], size: 10 }, [0, 0, 612, 792], 10)).toBe(false);
});

it("reads stable text columns top-to-bottom before moving to the next column", () => {
  const entries = [
    { kind: "text", x: 340, y: 20, rawText: "right one" },
    { kind: "text", x: 70, y: 60, rawText: "left two" },
    { kind: "text", x: 340, y: 60, rawText: "right two" },
    { kind: "text", x: 70, y: 20, rawText: "left one" },
  ];
  expect(orderPageEntries(entries, [0, 0, 612, 792], 10).map((entry) => entry.rawText)).toEqual([
    "left one",
    "left two",
    "right one",
    "right two",
  ]);
  expect(pageLayoutSummary(entries, [0, 0, 612, 792], 10)).toMatchObject({
    orderMethod: "two-column-geometry",
    columns: 2,
    confidence: 0.9,
  });
});

it("keeps full-width headings and visuals as reading-order anchors", () => {
  const entries = [
    { kind: "visual", x: 50, y: 8, bbox: [50, 8, 570, 24], markdown: "# Title" },
    { kind: "text", x: 70, y: 40, rawText: "left one", bbox: [70, 40, 200, 52] },
    { kind: "text", x: 340, y: 40, rawText: "right one", bbox: [340, 40, 470, 52] },
    { kind: "text", x: 70, y: 60, rawText: "left two", bbox: [70, 60, 200, 72] },
    { kind: "text", x: 340, y: 60, rawText: "right two", bbox: [340, 60, 470, 72] },
    { kind: "visual", x: 50, y: 90, bbox: [50, 90, 570, 180], markdown: "[figure]" },
    { kind: "source-page", x: 0, y: 181, bbox: [0, 0, 612, 792], markdown: "[source]" },
  ];
  expect(orderPageEntries(entries, [0, 0, 612, 792], 10).map((entry) => entry.rawText || entry.markdown)).toEqual([
    "# Title",
    "left one",
    "left two",
    "right one",
    "right two",
    "[figure]",
    "[source]",
  ]);
});

it("finds compact equation images next to a formula cue", () => {
  const candidates = equationImageCandidatesFor(
    [{ bbox: [120, 180, 280, 205], image: {} }],
    [{
      lines: [{
        text: "The condition is satisfying",
        bbox: [70, 150, 300, 166],
      }],
    }],
    [0, 0, 336, 504],
    10,
  );
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    kind: "equation-image",
    sourceImageIndex: 0,
    cueText: "The condition is satisfying",
  });
});

it("does not classify a captioned figure as an equation image", () => {
  const candidates = equationImageCandidatesFor(
    [{ bbox: [120, 180, 280, 205], image: {} }],
    [{
      lines: [
        { text: "satisfying", bbox: [70, 150, 300, 166] },
        { text: "Figure 4.2. Demand curve", bbox: [70, 210, 300, 224] },
      ],
    }],
    [0, 0, 336, 504],
    10,
  );
  expect(candidates).toHaveLength(0);
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
