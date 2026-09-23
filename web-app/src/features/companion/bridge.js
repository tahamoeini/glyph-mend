import {
  COMPANION_IR_SCHEMA,
  COMPANION_LIMITS,
  COMPANION_PROTOCOL,
  REGION_INPUT_SCHEMA,
  companionStatus,
  validateCapability,
  validateEndpoint,
  validateInputComplete,
  validateJobCreate,
  validateProviderResult,
  validateRegionMetadata,
} from "./protocol.js";

function timeoutSignal(timeout = COMPANION_LIMITS.controlTimeoutMs) {
  return AbortSignal.timeout(timeout);
}

function requestSignal(signal) {
  return signal ? AbortSignal.any([timeoutSignal(), signal]) : timeoutSignal();
}

function requestId() {
  return crypto.randomUUID();
}

async function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  throw new TypeError("A binary PNG region crop is required.");
}

function controlBody(value) {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > COMPANION_LIMITS.controlBytes) {
    throw Object.assign(new Error("Companion control request exceeds 64 KiB."), { code: "payload-too-large" });
  }
  return body;
}

async function responseJson(response) {
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body?.detail || "Companion request failed."), {
      code: body?.code,
      earliestSequence: body?.earliestSequence,
      status: response.status,
    });
  }
  return body;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", await asBytes(value));
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
    return { status: this.session ? "connected" : "unavailable" };
  }

  async connect(userSuppliedEndpoint, pairingCode, { signal } = {}) {
    try {
      const endpoint = validateEndpoint(userSuppliedEndpoint);
      if (!pairingCode) return { status: "pairing-required" };
      const response = await responseJson(await this.fetch(endpoint + "/v1/session", {
        method: "POST",
        signal: requestSignal(signal),
        headers: { "content-type": "application/json" },
        body: controlBody({
          protocolVersion: COMPANION_PROTOCOL,
          irSchemaVersion: COMPANION_IR_SCHEMA.version,
          pairingCode,
        }),
      }));
      const negotiated = response.protocolVersion;
      if (negotiated?.major !== COMPANION_PROTOCOL.major
        || !Number.isInteger(negotiated?.minor)
        || negotiated.minor < 0
        || negotiated.minor > COMPANION_PROTOCOL.minor
        || response.irSchemaVersion !== COMPANION_IR_SCHEMA.version) {
        return { status: "protocol-incompatible" };
      }
      this.endpoint = endpoint;
      this.session = {
        id: response.sessionId,
        token: response.sessionToken,
        protocolVersion: negotiated,
      };
      const capabilities = await this.getCapabilities({ signal });
      return { status: "connected", sessionId: response.sessionId, capabilities };
    } catch (error) {
      return { status: companionStatus(error) };
    }
  }

  headers({ json = true } = {}) {
    if (!this.session) throw Object.assign(new Error("Pairing is required."), { code: "PAIRING_REQUIRED" });
    return {
      authorization: "Bearer " + this.session.token,
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  async getCapabilities({ signal } = {}) {
    const capabilities = await responseJson(await this.fetch(this.endpoint + "/v1/capabilities", {
      headers: this.headers(),
      signal: requestSignal(signal),
    }));
    return Array.isArray(capabilities) ? capabilities.map(validateCapability) : [];
  }

  async createJob(request, { signal } = {}) {
    const value = validateJobCreate({ ...request, idempotencyKey: request.idempotencyKey || requestId() });
    const response = await responseJson(await this.fetch(this.endpoint + "/v1/jobs", {
      method: "POST",
      headers: this.headers(),
      signal: requestSignal(signal),
      body: controlBody(value),
    }));
    return { jobId: response.jobId, cancel: () => this.cancel(response.jobId) };
  }

  async appendChunk(jobId, sequence, body, { signal } = {}) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError("Invalid Companion chunk sequence.");
    const bytes = await asBytes(body);
    if (bytes.byteLength > COMPANION_LIMITS.chunkBytes) {
      throw Object.assign(new Error("Companion input chunk exceeds 1 MiB."), { code: "payload-too-large" });
    }
    const response = await this.fetch(this.endpoint + "/v1/jobs/" + jobId + "/chunks/" + sequence, {
      method: "PUT",
      headers: {
        ...this.headers({ json: false }),
        "content-type": "application/octet-stream",
        "x-glyphmend-chunk-length": String(bytes.byteLength),
      },
      signal: requestSignal(signal),
      body: bytes,
    });
    await responseJson(response);
  }

  async completeInput(jobId, request, { signal } = {}) {
    const { sha256Hex, totalBytes } = validateInputComplete(request);
    return responseJson(await this.fetch(this.endpoint + "/v1/jobs/" + jobId + "/complete", {
      method: "POST",
      headers: this.headers(),
      signal: requestSignal(signal),
      body: controlBody({ sha256Hex, totalBytes }),
    }));
  }

  async getResult(jobId, { signal } = {}) {
    return responseJson(await this.fetch(this.endpoint + "/v1/jobs/" + jobId + "/result", {
      headers: this.headers(),
      signal: requestSignal(signal),
    }));
  }

  subscribe(jobId, onEvent, { signal, waitMs = COMPANION_LIMITS.eventWaitMs } = {}) {
    let stopped = false;
    let sequence = 0;
    const controller = new AbortController();
    const abort = () => {
      stopped = true;
      controller.abort(signal?.reason);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const done = (async () => {
      try {
        while (!stopped) {
          let page;
          try {
            const url = this.endpoint + "/v1/jobs/" + jobId + "/events?after=" + sequence
              + "&limit=" + COMPANION_LIMITS.maxEventBatch + "&waitMs=" + waitMs;
            page = await responseJson(await this.fetch(url, {
              headers: this.headers(),
              signal: requestSignal(controller.signal),
            }));
          } catch (error) {
            if (controller.signal.aborted || error?.name === "AbortError") {
              if (stopped || signal?.aborted) break;
            }
            if (error?.code !== "event-history-gap" || !Number.isInteger(error.earliestSequence)) throw error;
            onEvent({
              eventType: "event-history-gap",
              earliestSequence: error.earliestSequence,
              historyTruncated: true,
            });
            sequence = Math.max(sequence, error.earliestSequence - 1);
            continue;
          }
          for (const event of page.events || []) {
            sequence = Math.max(sequence, Number(event.sequence) || sequence);
            onEvent(event);
          }
          sequence = Math.max(sequence, Number(page.nextSequence) || sequence);
          if (page.terminal) break;
        }
        return sequence;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    })();
    return {
      done,
      stop() {
        stopped = true;
        controller.abort();
      },
    };
  }

  async cancel(jobId, { signal } = {}) {
    const response = await this.fetch(this.endpoint + "/v1/jobs/" + jobId + "/cancel", {
      method: "POST",
      headers: this.headers(),
      signal: requestSignal(signal),
    });
    await responseJson(response);
  }

  async disconnect() {
    this.endpoint = null;
    this.session = null;
  }
}

function abortError() {
  const error = new Error("Companion inference cancelled.");
  error.name = "AbortError";
  return error;
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
      const signal = context.signal;
      if (signal?.aborted) throw abortError();
      const bytes = await asBytes(input.cropBytes ?? input.crop);
      if (bytes.byteLength > COMPANION_LIMITS.documentBytes) {
        throw Object.assign(new Error("Region crop exceeds the Companion input limit."), { code: "payload-too-large" });
      }
      const metadata = validateRegionMetadata({
        schema: REGION_INPUT_SCHEMA,
        page: Number(input.page),
        bbox: input.bbox,
        sourceIds: Array.isArray(input.sourceIds) ? input.sourceIds : [],
        deterministicSummary: {
          nodeCount: input.deterministic?.nodes?.length || input.candidate?.nodes?.length || 0,
          edgeCount: input.deterministic?.edges?.length || input.candidate?.edges?.length || 0,
          ocrRegionCount: input.ocrTextRegions?.length || 0,
        },
      });
      let job;
      let subscription;
      try {
        job = await bridge.createJob({
          documentName: "region.png",
          capabilityId,
          inputKind: "region",
          declaredBytes: bytes.byteLength,
          pageCount: 1,
          metadata,
        }, { signal });
        for (let offset = 0, sequence = 0; offset < bytes.byteLength; offset += COMPANION_LIMITS.chunkBytes, sequence += 1) {
          const end = Math.min(offset + COMPANION_LIMITS.chunkBytes, bytes.byteLength);
          await bridge.appendChunk(job.jobId, sequence, bytes.subarray(offset, end), { signal });
        }
        await bridge.completeInput(job.jobId, {
          sha256Hex: await sha256Hex(bytes),
          totalBytes: bytes.byteLength,
        }, { signal });
        subscription = bridge.subscribe(job.jobId, () => {}, { signal });
        await subscription.done;
        if (signal?.aborted) throw abortError();
        const response = await bridge.getResult(job.jobId, { signal });
        return validateProviderResult(response.result);
      } catch (error) {
        if (signal?.aborted) {
          if (job) await bridge.cancel(job.jobId).catch(() => undefined);
          throw abortError();
        }
        throw error;
      } finally {
        subscription?.stop();
      }
    },
  });
}

export async function createCompanionBridge() {
  // The packaged shell injects this narrow adapter. No Tauri module is imported
  // by the deployed browser build.
  return globalThis.GlyphMendCompanion || new LoopbackCompanionBridge();
}
