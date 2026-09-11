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
