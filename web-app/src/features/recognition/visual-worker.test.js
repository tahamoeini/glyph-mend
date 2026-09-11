import { expect, it, vi } from "vitest";
import { createVisualWorkerCapability } from "./visual-worker.js";

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
  expect(result.result.mermaid).toContain("flowchart");
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
