import { expect, it, vi } from "vitest";
import { createMathRecognizerProvider, createMathWorkerCapability } from "./math-worker.js";
import { createMockMathProvider, evaluateMathProvider } from "./math-provider.js";

it("builds a math capability shell around the shared worker protocol", async () => {
  const run = vi.fn(async () => ({ latex: "x+y" }));
  const capability = createMathWorkerCapability({ workerFactory: async () => ({ run }) });
  const result = await capability.run({ text: "x+y" });
  expect(result.ok).toBe(true);
  expect(result.meta.capability).toBe("math");
  expect(run).toHaveBeenCalledTimes(1);
});

it("uses a deterministic mock provider with provider metadata and candidate confidence", async () => {
  const provider = createMathRecognizerProvider({ provider: createMockMathProvider({ name: "test-provider" }) });
  const result = await provider.recognize({ text: "x + 1 = 2" }, { fixtureId: "ci-check" });
  expect(result.ok).toBe(true);
  expect(result.provider.name).toBe("test-provider");
  expect(result.candidates[0].latex).toContain("x + 1 = 2");
  expect(result.confidence.overall).toBeGreaterThan(0.8);
  expect(result.warnings).toEqual([]);
});

it("can benchmark provider output against the shared math fixture set", async () => {
  const provider = createMathRecognizerProvider({
    provider: createMockMathProvider({ name: "benchmark-provider" }),
  });
  const benchmark = await evaluateMathProvider(provider);
  expect(benchmark.total).toBeGreaterThan(0);
  expect(benchmark.failed).toBe(0);
});
