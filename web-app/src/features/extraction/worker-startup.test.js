import { afterEach, expect, it, vi } from "vitest";
import { createWorkerStartupWatchdog, loadMuPdfWithTiming } from "./worker-startup.js";

afterEach(() => vi.useRealTimers());

it("reports worker boot timeout with its phase and elapsed time", () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const watchdog = createWorkerStartupWatchdog(onTimeout, { now: () => Date.now() });
  watchdog.start();
  vi.advanceTimersByTime(30_000);
  expect(onTimeout).toHaveBeenCalledWith({ stage: "worker-boot", elapsedMs: 30_000 });
});

it("allows MuPDF initialization to take longer than 45 seconds", async () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const watchdog = createWorkerStartupWatchdog(onTimeout, { now: () => Date.now() });
  watchdog.start();
  vi.advanceTimersByTime(9_000);
  expect(watchdog.workerStarted()).toBe(9_000);
  const initialization = loadMuPdfWithTiming(
    () => new Promise((resolve) => setTimeout(resolve, 46_000)),
    () => Date.now(),
  );
  await vi.advanceTimersByTimeAsync(46_000);
  expect(await initialization).toEqual({ stage: "mupdf-load", elapsedMs: 46_000 });
  expect(onTimeout).not.toHaveBeenCalled();
  expect(watchdog.engineReady()).toBe(46_000);
  vi.advanceTimersByTime(90_000);
  expect(onTimeout).not.toHaveBeenCalled();
});

it("reports MuPDF loader rejection with its phase and elapsed time", async () => {
  vi.useFakeTimers();
  const initialization = loadMuPdfWithTiming(
    () => new Promise((resolve, reject) => setTimeout(() => reject(new Error("WASM fetch failed")), 125)),
    () => Date.now(),
  );
  const rejection = expect(initialization).rejects.toMatchObject({
    message: "WASM fetch failed",
    stage: "mupdf-load",
    elapsedMs: 125,
  });
  await vi.advanceTimersByTimeAsync(125);
  await rejection;
});

it("reports the MuPDF initialization deadline and clears it after timeout", () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const watchdog = createWorkerStartupWatchdog(onTimeout, { now: () => Date.now() });
  watchdog.start();
  watchdog.workerStarted();
  vi.advanceTimersByTime(90_000);
  watchdog.clear();
  vi.advanceTimersByTime(90_000);
  expect(onTimeout).toHaveBeenCalledTimes(1);
  expect(onTimeout).toHaveBeenCalledWith({ stage: "mupdf-load", elapsedMs: 90_000 });
  expect(watchdog.snapshot()).toEqual({ stage: null, elapsedMs: null });
});

it("clears the active timer when the batch completes or is cancelled", () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const watchdog = createWorkerStartupWatchdog(onTimeout, { now: () => Date.now() });
  watchdog.start();
  watchdog.clear();
  vi.advanceTimersByTime(120_000);
  expect(onTimeout).not.toHaveBeenCalled();
});
