/**
 * Small deterministic semantic fixtures. They exercise the reconstruction
 * seam without shipping user PDFs or depending on a browser renderer.
 */
export const DOCUMENT_RECONSTRUCTION_FIXTURES = Object.freeze([
  {
    id: "academic-textbook",
    pages: [
      {
        page: 1,
        blocks: [
          {
            type: "heading",
            markdown: "# 2. Single-Resource Capacity Control",
            bbox: [72, 60, 360, 82],
            confidence: 0.94,
            extractionMethod: "heading-classifier",
          },
          {
            type: "paragraph",
            markdown: "A capacity-control policy allocates scarce inventory over time.",
            bbox: [72, 98, 520, 125],
            confidence: 0.96,
            extractionMethod: "mupdf-structured-text",
          },
          {
            type: "equation",
            markdown: "$$\nq_t = p_t D_t\n$$",
            bbox: [150, 150, 350, 178],
            confidence: 0.9,
            extractionMethod: "validated-equation",
          },
        ],
      },
    ],
  },
  {
    id: "research-paper",
    pages: [
      {
        page: 1,
        blocks: [
          {
            type: "heading",
            markdown: "# Abstract",
            bbox: [72, 60, 160, 80],
            confidence: 0.91,
            extractionMethod: "heading-classifier",
          },
          {
            type: "paragraph",
            markdown: "We evaluate the policy on a held-out demand sample.",
            bbox: [72, 94, 520, 121],
            confidence: 0.95,
            extractionMethod: "mupdf-structured-text",
          },
          {
            type: "footnote",
            markdown: "[^1]: The demand sample is anonymized.",
            bbox: [72, 700, 520, 718],
            confidence: 0.86,
            extractionMethod: "layout-footnote",
          },
        ],
      },
    ],
  },
  {
    id: "table-heavy",
    pages: [
      {
        page: 1,
        blocks: [
          {
            type: "table",
            markdown: "| Class | Demand |\n| --- | --- |\n| Y | 120 |",
            tableIR: {
              rows: [["Class", "Demand"], ["Y", "120"]],
              columns: 2,
              spans: [],
              confidence: 0.93,
              multiPageKey: "table-1",
            },
            bbox: [72, 120, 520, 220],
            confidence: 0.93,
            extractionMethod: "validated-table-geometry",
          },
          {
            type: "caption",
            markdown: "Table 1. Demand by class",
            bbox: [72, 228, 300, 244],
            confidence: 0.9,
            extractionMethod: "layout-caption",
          },
        ],
      },
    ],
  },
  {
    id: "equation-heavy",
    pages: [
      {
        page: 1,
        blocks: [
          {
            type: "equation",
            markdown: "$$\nP(D > y) = 1 - F(y)\n$$",
            bbox: [80, 100, 460, 135],
            confidence: 0.88,
            extractionMethod: "mupdf-equation-reconstruction",
          },
          {
            type: "equation",
            markdown: '[SOURCE_VISUAL page=1 id="equation-2"]',
            bbox: [80, 160, 460, 210],
            confidence: 0.51,
            extractionMethod: "source-preservation",
          },
        ],
      },
    ],
  },
  {
    id: "scanned-document",
    pages: [
      {
        page: 1,
        blocks: [
          {
            type: "paragraph",
            markdown: "Recovered text from a locally rendered scanned page.",
            bbox: [72, 80, 520, 110],
            confidence: 0.72,
            extractionMethod: "tesseract-ocr",
          },
          {
            type: "figure",
            markdown: '[SOURCE_VISUAL page=1 id="source-page-1"]',
            bbox: [72, 140, 520, 650],
            confidence: 0.5,
            extractionMethod: "source-preservation",
          },
        ],
      },
    ],
  },
]);
