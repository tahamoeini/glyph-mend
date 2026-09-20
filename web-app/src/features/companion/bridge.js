import { COMPANION_IR_SCHEMA, COMPANION_LIMITS, COMPANION_PROTOCOL, companionStatus, validateEndpoint } from "./protocol.js";

function timeoutSignal() { return AbortSignal.timeout(COMPANION_LIMITS.controlTimeoutMs); }
function requestId() { return crypto.randomUUID(); }

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.detail || "Companion request failed."), { code: body?.code });
  return body;
}

export class LoopbackCompanionBridge {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; this.endpoint = null; this.session = null; }

  async detect() {
    // Deliberately local-only: detection does not probe a port or network.
    return { status: this.session ? "connected" : "unavailable" };
  }

  async connect(userSuppliedEndpoint, pairingCode) {
    try {
      const endpoint = validateEndpoint(userSuppliedEndpoint);
      const hello = await responseJson(await this.fetch(`${endpoint}/v1/hello`, { method: "POST", signal: timeoutSignal(), headers: { "content-type": "application/json" }, body: JSON.stringify({ protocolVersion: COMPANION_PROTOCOL, irSchemaVersion: COMPANION_IR_SCHEMA.version }) }));
      if (hello.protocolVersion?.major !== COMPANION_PROTOCOL.major) return { status: "protocol-incompatible" };
      if (hello.irSchemaVersion !== COMPANION_IR_SCHEMA.version) return { status: "protocol-incompatible" };
      if (!pairingCode) return { status: "pairing-required" };
      const paired = await responseJson(await this.fetch(`${endpoint}/v1/pair`, { method: "POST", signal: timeoutSignal(), headers: { "content-type": "application/json" }, body: JSON.stringify({ pairingCode, origin: location.origin }) }));
      this.endpoint = endpoint;
      this.session = { id: paired.sessionId, token: paired.sessionToken };
      return { status: "connected", sessionId: paired.sessionId };
    } catch (error) { return { status: companionStatus(error) }; }
  }

  headers() {
    if (!this.session) throw Object.assign(new Error("Pairing is required."), { code: "PAIRING_REQUIRED" });
    return { authorization: `Bearer ${this.session.token}`, "content-type": "application/json" };
  }

  async getCapabilities() {
    return responseJson(await this.fetch(`${this.endpoint}/v1/capabilities`, { headers: this.headers(), signal: timeoutSignal() }));
  }

  async createJob(request) {
    const response = await responseJson(await this.fetch(`${this.endpoint}/v1/jobs`, { method: "POST", headers: this.headers(), signal: timeoutSignal(), body: JSON.stringify({ ...request, idempotencyKey: request.idempotencyKey || requestId() }) }));
    return { jobId: response.jobId, cancel: () => this.cancel(response.jobId) };
  }

  subscribe(jobId, onEvent) {
    const url = new URL(`${this.endpoint.replace("http", "ws")}/v1/jobs/${jobId}/events`);
    const socket = new WebSocket(url);
    socket.onmessage = (event) => { try { onEvent(JSON.parse(event.data)); } catch {} };
    return () => socket.close();
  }

  async cancel(jobId) {
    const response = await this.fetch(`${this.endpoint}/v1/jobs/${jobId}/cancel`, { method: "POST", headers: this.headers(), signal: timeoutSignal() });
    if (!response.ok) await responseJson(response);
  }

  async disconnect() { this.endpoint = null; this.session = null; }
}

export async function createCompanionBridge() {
  // The packaged shell injects this narrow adapter. No Tauri module is imported
  // by the deployed browser build.
  return globalThis.GlyphMendCompanion || new LoopbackCompanionBridge();
}
