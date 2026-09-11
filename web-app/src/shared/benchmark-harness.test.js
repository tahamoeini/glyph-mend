import { expect, it } from "vitest";
import {
  benchmarkFixtureSet,
  createBenchmarkResult,
  defaultDiagramFixtureSet,
  defaultMathFixtureSet,
  evaluateMathFixture,
  evaluateVisualFixture,
} from "./benchmark-harness.js";

it("runs a lightweight deterministic benchmark fixture set", () => {
  const result = benchmarkFixtureSet({ modelName: "fixture-baseline" });
  expect(result.schemaVersion).toBe(1);
  expect(result.summary.total).toBeGreaterThan(0);
  expect(result.summary.failed).toBe(0);
  expect(Array.isArray(result.fixtures)).toBe(true);
});

it("detects a wrong equation AST as a benchmark failure", () => {
  const fixture = defaultMathFixtureSet().find((item) => item.id === "math/simple-linear");
  const result = evaluateMathFixture(fixture, {
    ast: {
      type: "equation",
      left: { type: "number", value: 1 },
      right: { type: "number", value: 2 },
    },
    latex: "x + 1 = 2",
    serialized: '{"type":"equation","left":{"type":"number","value":1},"right":{"type":"number","value":2}}',
  });

  expect(result.passed).toBe(false);
  expect(result.metrics.semanticEquivalent).toBe(false);
});

it("detects a deliberately wrong arrow direction in diagram fixtures", () => {
  const fixture = defaultDiagramFixtureSet().find((item) => item.id === "diagram/reversed-arrow-trap");
  const result = evaluateVisualFixture(fixture, {
    nodes: [{ id: "source", label: "Source" }, { id: "target", label: "Target" }],
    edges: [{ from: "target", to: "source", direction: "backward" }],
  });

  expect(result.passed).toBe(false);
  expect(result.metrics.directionCorrect).toBe(false);
  expect(result.metrics.edgeCorrect).toBe(false);
});

it("exposes a machine-readable benchmark result payload", () => {
  const result = createBenchmarkResult("benchmark-check");
  expect(result.model).toBe("benchmark-check");
  expect(result.summary).toEqual({
    total: expect.any(Number),
    passed: expect.any(Number),
    failed: expect.any(Number),
  });
  expect(typeof JSON.stringify(result)).toBe("string");
});
