export async function loadMuPdfWithTiming(loader, now = () => performance.now()) {
  const startedAt = now();
  try {
    await loader();
  } catch (cause) {
    throw Object.assign(new Error(cause?.message || String(cause)), {
      stage: "mupdf-load",
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
    });
  }
  return {
    stage: "mupdf-load",
    elapsedMs: Math.max(0, Math.round(now() - startedAt)),
  };
}

export const WORKER_STARTUP_LIMITS = Object.freeze({
  workerBootMs: 30_000,
  mupdfLoadMs: 90_000,
});

export function createWorkerStartupWatchdog(
  onTimeout,
  {
    now = () => performance.now(),
    schedule = setTimeout,
    cancel = clearTimeout,
    limits = WORKER_STARTUP_LIMITS,
  } = {},
) {
  let timer = null;
  let stage = null;
  let phaseStartedAt = 0;
  let closed = false;

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function startPhase(nextStage, durationMs) {
    if (closed) return;
    clearTimer();
    stage = nextStage;
    phaseStartedAt = now();
    timer = schedule(() => {
      timer = null;
      const elapsedMs = Math.max(0, Math.round(now() - phaseStartedAt));
      onTimeout({ stage, elapsedMs });
    }, durationMs);
  }

  return {
    start() {
      startPhase("worker-boot", limits.workerBootMs);
    },
    workerStarted() {
      const elapsedMs = stage === "worker-boot" ? Math.max(0, Math.round(now() - phaseStartedAt)) : null;
      if (stage === "worker-boot") startPhase("mupdf-load", limits.mupdfLoadMs);
      return elapsedMs;
    },
    engineReady() {
      const elapsedMs = stage === "mupdf-load" ? Math.max(0, Math.round(now() - phaseStartedAt)) : null;
      if (stage === "mupdf-load") {
        clearTimer();
        stage = null;
      }
      return elapsedMs;
    },
    snapshot() {
      return stage
        ? { stage, elapsedMs: Math.max(0, Math.round(now() - phaseStartedAt)) }
        : { stage: null, elapsedMs: null };
    },
    clear() {
      clearTimer();
      stage = null;
      closed = true;
    },
  };
}