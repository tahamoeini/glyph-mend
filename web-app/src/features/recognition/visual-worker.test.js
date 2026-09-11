import { expect, it, vi } from "vitest";
import { createVisualWorkerCapability } from "./visual-worker.js";
import { createMockVisualProvider, createVisualRecognizerProvider } from "./visual-provider.js";

it("builds a visual capability shell around the shared worker protocol", async () => {
  const run = vi.fn(async () => ({ nodes: [] }));
  const capability = createVisualWorkerCapability({ workerFactory: async () => ({ run }) });
  const result = await capability.run({ page: 1 });
  expect(result.ok).toBe(true);
  expect(result.meta.capability).toBe("visual");
  expect(run).toHaveBeenCalledTimes(1);
});

it("returns a staged raster-flowchart result when no worker is supplied", async () => {
  const capability = createVisualWorkerCapability();
  const result = await capability.run({
    page: 2,
    bbox: [0, 0, 240, 160],
    raster: {
      lines: [{ id: "l1" }, { id: "l2" }],
      contours: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      density: 0.5,
      shapes: [
        { id: "start", bbox: [20, 20, 90, 60], label: "Start" },
        { id: "end", bbox: [150, 20, 220, 60], label: "End" },
      ],
      connectors: [
        {
          id: "edge-1",
          bbox: [80, 34, 160, 48],
          endpoints: [{ x: 90, y: 40 }, { x: 180, y: 40 }],
          arrowheads: { start: false, end: true },
        },
      ],
    },
    ocrTextRegions: [
      { id: "ocr-start", text: "Start", bbox: [20, 20, 90, 60] },
      { id: "ocr-end", text: "End", bbox: [150, 20, 220, 60] },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.result.kind).toBe("flowchart");
  expect(result.result.nodes).toHaveLength(2);
  expect(result.result.edges).toHaveLength(1);
  expect(result.result.provenance.source).toBe("raster-flowchart");
  expect(result.result.provenance.diagnostics.length).toBeGreaterThan(0);
  expect(result.result.provenance.diagnostics.length).toBeGreaterThan(0);
});

it("preserves ambiguous or non-simple raster flowcharts instead of inventing topology", async () => {
  const capability = createVisualWorkerCapability();
  const result = await capability.run({
    page: 3,
    bbox: [0, 0, 120, 120],
    raster: { entropy: 10.5, lines: [], contours: [] },
  });

  expect(result.ok).toBe(true);
  expect(result.result.disposition).toBe("preserved");
  expect(result.result.warnings.join(" ")).toContain("not a simple flowchart");
});

it("uses the optional ML provider only after deterministic evidence exists", async () => {
  const provider = createVisualRecognizerProvider({
    provider: createMockVisualProvider({ name: "mock-visual-ci" }),
  });
  const capability = createVisualWorkerCapability({ enableMl: true, provider, featureFlag: true });
  const result = await capability.run({
    page: 4,
    bbox: [0, 0, 240, 160],
    raster: {
      lines: [{ id: "l1" }, { id: "l2" }],
      contours: [{ id: "c1" }, { id: "c2" }],
      density: 0.5,
      shapes: [
        { id: "start", bbox: [20, 20, 90, 60], label: "Start" },
        { id: "end", bbox: [150, 20, 220, 60], label: "End" },
      ],
      connectors: [
        {
          id: "edge-1",
          bbox: [80, 34, 160, 48],
          endpoints: [{ x: 90, y: 40 }, { x: 180, y: 40 }],
          arrowheads: { start: false, end: true },
        },
      ],
    },
    ocrTextRegions: [
      { id: "ocr-start", text: "Start", bbox: [20, 20, 90, 60] },
      { id: "ocr-end", text: "End", bbox: [150, 20, 220, 60] },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.meta.mlEnabled).toBe(true);
  expect(result.meta.provider).toBe("mock-visual-ci");
  expect(result.result.provenance.provider.name).toBe("mock-visual-ci");
  expect(result.result.disposition).toMatch(/accepted|review/);
});

it("downgrades contradictory ML topology to review instead of trusting it", async () => {
  const provider = createVisualRecognizerProvider({
    provider: {
      kind: "mock",
      name: "contradictory-provider",
      runtime: "browser-js",
      version: "1",
      modelHash: "contradictory-hash",
      async recognize() {
        return {
          ok: true,
          provider: {
            name: "contradictory-provider",
            kind: "mock",
            runtime: "browser-js",
            version: "1",
            modelHash: "contradictory-hash",
          },
          candidates: [
            {
              id: "ml-1",
              kind: "flowchart",
              nodes: [
                { id: "alpha", label: "Alpha" },
                { id: "beta", label: "Beta" },
              ],
              edges: [{ from: "beta", to: "alpha", label: "edge 1", directed: true }],
              confidence: { overall: 0.97, token: 0.97, sequence: 0.97 },
            },
          ],
          warnings: [],
          timing: { durationMs: 2, startedAt: 1, finishedAt: 3 },
          resources: { wasm: false, modelBytes: 0, peakMemoryMb: 0 },
          metadata: {},
          confidence: { overall: 0.97, token: 0.97, sequence: 0.97 },
        };
      },
    },
  });
  const capability = createVisualWorkerCapability({ enableMl: true, provider, featureFlag: true });
  const result = await capability.run({
    page: 5,
    bbox: [0, 0, 240, 160],
    raster: {
      lines: [{ id: "l1" }, { id: "l2" }],
      contours: [{ id: "c1" }, { id: "c2" }],
      density: 0.6,
      shapes: [
        { id: "start", bbox: [20, 20, 90, 60], label: "Start" },
        { id: "end", bbox: [150, 20, 220, 60], label: "End" },
      ],
      connectors: [
        {
          id: "edge-1",
          bbox: [80, 34, 160, 48],
          endpoints: [{ x: 90, y: 40 }, { x: 180, y: 40 }],
          arrowheads: { start: false, end: true },
        },
      ],
    },
    ocrTextRegions: [
      { id: "ocr-start", text: "Start", bbox: [20, 20, 90, 60] },
      { id: "ocr-end", text: "End", bbox: [150, 20, 220, 60] },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.result.disposition).toBe("review");
  expect(result.result.warnings.join(" ")).toContain("contradicted deterministic evidence");
  expect(result.result.provenance.comparison.contradiction).toBe(true);
});

it("keeps ML disabled without affecting deterministic extraction", async () => {
  const capability = createVisualWorkerCapability({ enableMl: false, featureFlag: true });
  const result = await capability.run({
    page: 6,
    bbox: [0, 0, 240, 160],
    raster: {
      lines: [{ id: "l1" }],
      contours: [{ id: "c1" }],
      density: 0.4,
      shapes: [
        { id: "start", bbox: [20, 20, 90, 60], label: "Start" },
        { id: "end", bbox: [150, 20, 220, 60], label: "End" },
      ],
      connectors: [
        {
          id: "edge-1",
          bbox: [80, 34, 160, 48],
          endpoints: [{ x: 90, y: 40 }, { x: 180, y: 40 }],
          arrowheads: { start: false, end: true },
        },
      ],
    },
    ocrTextRegions: [
      { id: "ocr-start", text: "Start", bbox: [20, 20, 90, 60] },
      { id: "ocr-end", text: "End", bbox: [150, 20, 220, 60] },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.meta.mlEnabled).toBe(false);
  expect(result.result.nodes).toHaveLength(2);
  expect(result.result.edges).toHaveLength(1);
});
