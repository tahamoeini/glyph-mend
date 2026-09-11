import { expect, it, vi } from "vitest";
import { createMathWorkerCapability } from "./math-worker.js";

it("builds a math capability shell around the shared worker protocol", async () => {
  const run = vi.fn(async () => ({ latex: "x+y" }));
  const capability = createMathWorkerCapability({ workerFactory: async () => ({ run }) });
  const result = await capability.run({ text: "x+y" });
  expect(result.ok).toBe(true);
  expect(result.meta.capability).toBe("math");
  expect(run).toHaveBeenCalledTimes(1);
});
