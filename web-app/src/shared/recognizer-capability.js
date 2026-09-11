const CAPABILITY_STATUSES = new Set(["available", "unavailable", "initializing", "ready", "running", "cancelled", "failed", "disposed"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function capabilityAvailable(value) {
  return !!value?.available;
}

export function capabilityUnavailable(reason = "unavailable") {
  return Object.freeze({
    available: false,
    status: "unavailable",
    reason,
  });
}

export function capabilityEnvelope(value = {}) {
  const status = CAPABILITY_STATUSES.has(value.status) ? value.status : "available";
  return Object.freeze({
    available: value.available !== false,
    status,
    name: value.name || "recognizer",
    version: value.version || "unknown",
    modelHash: value.modelHash || null,
    metadata: isPlainObject(value.metadata) ? { ...value.metadata } : {},
  });
}

export function workerErrorEnvelope(error, context = {}) {
  return {
    ok: false,
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error || "Unknown worker error"),
      code: context.code || "WORKER_ERROR",
      fatal: context.fatal !== false,
      retryable: !!context.retryable,
      details: isPlainObject(context.details) ? { ...context.details } : {},
    },
  };
}

export function workerResultEnvelope(result, meta = {}) {
  return {
    ok: true,
    result,
    meta: {
      version: meta.version || "unknown",
      modelHash: meta.modelHash || null,
      capability: meta.capability || "unknown",
    },
  };
}

export function workerProgressEnvelope(progress = {}) {
  return {
    ok: true,
    type: "progress",
    progress: {
      done: Number(progress.done) || 0,
      total: Number(progress.total) || 0,
      message: progress.message || "",
      stage: progress.stage || "",
    },
  };
}

export function workerCancelEnvelope(reason = "cancelled") {
  return {
    ok: false,
    cancelled: true,
    reason,
  };
}

export function workerProtocolMessage(type, payload = {}) {
  return canonicalJson({ type, ...payload });
}

export function createWorkerCapability({ name, workerFactory, fallback, metadata = {} }) {
  let worker = null;
  let state = capabilityEnvelope({ name, metadata });
  return Object.freeze({
    name,
    get available() {
      return !!workerFactory;
    },
    get status() {
      return state.status;
    },
    info() {
      return state;
    },
    async ensure() {
      if (!workerFactory) {
        state = capabilityUnavailable(`${name} unavailable`);
        return state;
      }
      if (!worker) {
        state = capabilityEnvelope({ name, status: "initializing", metadata });
        worker = await workerFactory();
        state = capabilityEnvelope({
          name,
          status: "ready",
          version: metadata.version || "unknown",
          modelHash: metadata.modelHash || null,
          metadata,
        });
      }
      return state;
    },
    async run(input, { signal, onProgress } = {}) {
      try {
        const ready = await this.ensure();
        if (!ready.available) return fallback?.(input, ready) || capabilityUnavailable(`${name} unavailable`);
        state = capabilityEnvelope({ name, status: "running", metadata });
        const result = await worker.run(input, { signal, onProgress });
        state = capabilityEnvelope({ name, status: "ready", metadata });
        return workerResultEnvelope(result, { capability: name, ...metadata });
      } catch (error) {
        state = capabilityEnvelope({ name, status: "failed", metadata });
        return workerErrorEnvelope(error, { code: `${name.toUpperCase()}_FAILED`, retryable: true, details: { capability: name } });
      }
    },
    async cancel(reason = "cancelled") {
      if (worker?.cancel) await worker.cancel(reason);
      state = capabilityEnvelope({ name, status: "cancelled", metadata });
      return workerCancelEnvelope(reason);
    },
    async dispose() {
      if (worker?.dispose) await worker.dispose();
      worker = null;
      state = capabilityEnvelope({ name, status: "disposed", metadata });
      return state;
    },
  });
}
