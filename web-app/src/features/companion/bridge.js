import {
  COMPANION_IR_SCHEMA,
  COMPANION_LIMITS,
  COMPANION_PROTOCOL,
  companionStatus,
  validateCapability,
  validateEndpoint,
  validateProviderResult,
} from "./protocol.js";

function timeoutSignal(timeout = COMPANION_LIMITS.controlTimeoutMs) {
  return AbortSignal.timeout(timeout);
}

function requestId() {
  return crypto.randomUUID();
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(String(value));
}

async function responseJson(response) {
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.detail || "Companion request failed."), { code: body?.code });
  return body;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", asBytes(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readCompanionFragment(hash = globalThis.location?.hash || "") {
  const value = String(hash).replace(/^#/, "");
  if (!value) return null;
  const params = new URLSearchParams(value);
  const endpoint = params.get("companionEndpoint");
  const pairingCode = params.get("companionCode");
  if (!endpoint || !pairingCode) return null;
  return { endpoint: validateEndpoint(endpoint), pairingCode };
}

export class LoopbackCompanionBridge {
  constructor(fetchImpl = fetch) {
    this.fetch = fetchImpl;
    this.endpoint = null;
    this.session = null;
  }

  async detect() {
    // Deliberately local-only: detection does not probe a port or network.
    return { status: this.session ? "connected" : "unavailable" };
  }

  async connect(userSuppliedEndpoint, pairingCode) {
    try {
      const endpoint = validateEndpoint(userSuppliedEndpoint);
      if (!pairingCode) return { status: "pairing-required" };
      const response = await responseJson(await this.fetch(`${endpoint}/v1/session`, {
        method: "POST",
        signal: timeoutSignal(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: COMPANION_PROTOCOL,
          irSchemaVersion: COMPANION_IR_SCHEMA.version,
          pairingCode,
        }),
      }));
      if (response.protocolVersion?.major !== COMPANION_PROTOCOL.major || response.irSchemaVersion !== COMPANION_IR_SCHEMA.version) {
        return { status: "protocol-incompatible" };
      }
      this.endpoint = endpoint;
      this.session = { id: response.sessionId, token: response.sessionToken };
      const capabilities = await this.getCapabilities();
      return { status: "connected", sessionId: response.sessionId, capabilities };
    } catch (error) {
      return { status: companionStatus(error) };
    }
  }

  headers({ json = true } = {}) {
    if (!this.session) throw Object.assign(new Error("Pairing is required."), { code: "PAIRING_REQUIRED" });
    return {
      authorization: `Bearer ${this.session.token}`,
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  async getCapabilities() {
    const capabilities = await responseJson(await this.fetch(`${this.endpoint}/v1/capabilities`, {
      headers: this.headers(),
      signal: timeoutSignal(),
    }));
    return Array.isArray(capabilities) ? capabilities.map(validateCapability) : [];
  }

  async createJob(request) {
    const response = await responseJson(await this.fetch(`${this.endpoint}/v1/jobs`, {
      method: "POST",
      headers: this.headers(),
      signal: timeoutSignal(),
      body: JSON.stringify({ ...request, idempotencyKey: request.idempotencyKey || requestId() }),
    }));
    return { jobId: response.jobId, cancel: () => this.cancel(response.jobId) };
  }

  async appendChunk(jobId, sequence, body) {
    const bytes = asBytes(body);
    const response = await this.fetch(`${this.endpoint}/v1/jobs/${jobId}/chunks/${sequence}`, {
      method: "PUT",
      headers: {
        ...this.headers({ json: false }),
        "content-type": "application/octet-stream",
        "x-glyphmend-chunk-length": String(bytes.byteLength),
      },
      signal: timeoutSignal(),
      body: bytes,
    });
    await responseJson(response);
  }

  async completeInput(jobId, { sha256Hex, totalBytes }) {
    return responseJson(await this.fetch(`${this.endpoint}/v1/jobs/${jobId}/complete`, {
      method: "POST",
      headers: this.headers(),
      signal: timeoutSignal(),
      body: JSON.stringify({ sha256Hex, totalBytes }),
    }));
  }

  async getResult(jobId) {
    return responseJson(await this.fetch(`${this.endpoint}/v1/jobs/${jobId}/result`, {
      headers: this.headers(),
      signal: timeoutSignal(),
    }));
  }

  subscribe(jobId, onEvent, { signal, waitMs = COMPANION_LIMITS.eventWaitMs } = {}) {
    let stopped = false;
    let sequence = 0;
    const controller = new AbortController();
    const done = (async () => {
      while (!stopped) {
        if (signal?.aborted) break;
        const page = await responseJson(await this.fetch(`${this.endpoint}/v1/jobs/${jobId}/events?after=${sequence}&limit=${COMPANION_LIMITS.maxEventBatch}&waitMs=${waitMs}`, {
          headers: this.headers(),
          signal: controller.signal,
        }));
        for (const event of page.events || []) {
          sequence = Math.max(sequence, Number(event.sequence) || sequence);
          onEvent(event);
        }
        sequence = Math.max(sequence, Number(page.nextSequence) || sequence);
        if (page.terminal) break;
      }
      return sequence;
    })();
    return {
      done,
      stop() {
        stopped = true;
        controller.abort();
      },
    };
  }

  async cancel(jobId) {
    const response = await this.fetch(`${this.endpoint}/v1/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: this.headers(),
      signal: timeoutSignal(),
    });
    await responseJson(response);
  }

  async disconnect() {
    this.endpoint = null;
    this.session = null;
  }
}

export function createCompanionProvider({ bridge, capabilityId = "glyphmend.visual.classify.v1" } = {}) {
  if (!bridge) throw new TypeError("A connected Companion bridge is required.");
  return Object.freeze({
    name: "glyphmend-companion",
    kind: "hybrid-local",
    runtime: "companion",
    version: "1.0.0",
    modelHash: null,
    async recognize(input = {}, context = {}) {
      const encoded = new TextEncoder().encode(JSON.stringify({ input, context }));
      const job = await bridge.createJob({
        documentName: "region.json",
        capabilityId,
        inputKind: "region",
        declaredBytes: encoded.byteLength,
        pageCount: Number(input.page) || 1,
        metadata: { source: input.source || "browser-region" },
      });
      await bridge.appendChunk(job.jobId, 0, encoded);
      await bridge.completeInput(job.jobId, {
        sha256Hex: await sha256Hex(encoded),
        totalBytes: encoded.byteLength,
      });
      const subscription = bridge.subscribe(job.jobId, () => {}, { signal: context.signal });
      try {
        await subscription.done;
      } finally {
        subscription.stop();
      }
      if (context.signal?.aborted) {
        await bridge.cancel(job.jobId).catch(() => undefined);
        const error = new Error("Companion inference cancelled.");
        error.name = "AbortError";
        throw error;
      }
      const response = await bridge.getResult(job.jobId);
      return validateProviderResult(response.result);
    },
  });
}

export async function createCompanionBridge() {
  // The packaged shell injects this narrow adapter. No Tauri module is imported
  // by the deployed browser build.
  return globalThis.GlyphMendCompanion || new LoopbackCompanionBridge();
}
