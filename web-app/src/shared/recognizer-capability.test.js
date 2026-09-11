import { expect, it, vi } from "vitest";
import {
  capabilityUnavailable,
  createWorkerCapability,
  workerCancelEnvelope,
  workerErrorEnvelope,
  workerProgressEnvelope,
  workerProtocolMessage,
  workerResultEnvelope,
} from "./recognizer-capability.js";

it("creates deterministic protocol messages", () => {
  expect(workerProtocolMessage("run", { b: 2, a: 1 })).toBe('{"a":1,"b":2,"type":"run"}');
});

it("wraps worker results and errors in typed envelopes", () => {
  expect(workerResultEnvelope({ ok: true }, { version: "1", modelHash: "abc" })).toEqual({
    ok: true,
    result: { ok: true },
    meta: { version: "1", modelHash: "abc", capability: "unknown" },
  });
  expect(workerErrorEnvelope(new Error("boom"), { code: "FAIL", retryable: true })).toEqual({
    ok: false,
    error: { name: "Error", message: "boom", code: "FAIL", fatal: true, retryable: true, details: {} },
  });
  expect(workerProgressEnvelope({ done: 1, total: 4, message: "step" })).toEqual({
    ok: true,
    type: "progress",
    progress: { done: 1, total: 4, message: "step", stage: "" },
  });
  expect(workerCancelEnvelope("stop")).toEqual({ ok: false, cancelled: true, reason: "stop" });
});

it("returns unavailable capabilities without throwing", async () => {
  const capability = createWorkerCapability({
    name: "math-worker",
    fallback: () => capabilityUnavailable("disabled"),
  });
  await expect(capability.ensure()).resolves.toMatchObject({ available: false, status: "unavailable" });
  await expect(capability.run({})).resolves.toMatchObject({ available: false, status: "unavailable" });
});

it("runs, cancels, and disposes a worker capability", async () => {
  const run = vi.fn(async () => ({ value: 7 }));
  const cancel = vi.fn(async () => undefined);
  const dispose = vi.fn(async () => undefined);
  const capability = createWorkerCapability({
    name: "visual-worker",
    workerFactory: async () => ({ run, cancel, dispose }),
  });

  const ready = await capability.ensure();
  expect(ready.status).toBe("ready");
  const result = await capability.run({ page: 1 });
  expect(result.ok).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(capability.cancel("stop")).resolves.toMatchObject({ cancelled: true });
  await expect(capability.dispose()).resolves.toMatchObject({ status: "disposed" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
});

it("returns typed failures and preserves retryability for worker exceptions", async () => {
  const run = vi.fn(async () => {
    throw new Error("kaboom");
  });
  const capability = createWorkerCapability({
    name: "math-worker",
    workerFactory: async () => ({ run }),
  });

  const first = await capability.run({ text: "x+y" });
  const second = await capability.run({ text: "x+y" });
  expect(first.ok).toBe(false);
  expect(first.error.code).toBe("MATH-WORKER_FAILED");
  expect(first.error.retryable).toBe(true);
  expect(second.ok).toBe(false);
  expect(run).toHaveBeenCalledTimes(2);
});
