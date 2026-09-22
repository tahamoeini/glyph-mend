// Versioned browser-side constants for the transport-neutral Companion API.
export const COMPANION_PROTOCOL = Object.freeze({ major: 1, minor: 1 });
export const COMPANION_IR_SCHEMA = Object.freeze({ id: "glyphmend.semantic-document-ir", version: 2 });
export const COMPANION_RESULT_SCHEMA = "glyphmend.provider-result.v1";
export const COMPANION_LIMITS = Object.freeze({
  chunkBytes: 1024 * 1024,
  documentBytes: 512 * 1024 * 1024,
  controlTimeoutMs: 30_000,
  eventWaitMs: 15_000,
  maxEventBatch: 128,
});
export const COMPANION_STATUSES = Object.freeze([
  "unavailable",
  "pairing-required",
  "connected",
  "busy",
  "protocol-incompatible",
  "security-rejected",
  "timed-out",
  "failed",
]);
export const PROVIDER_KINDS = Object.freeze(["deterministic", "hybrid-local", "ml"]);
export const INPUT_KINDS = Object.freeze(["document", "region"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("Enter a valid local companion endpoint."); }
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "http:" || !loopback || url.username || url.password || url.pathname !== "/") {
    throw new TypeError("The companion endpoint must be an explicit http://127.0.0.1 or http://[::1] address.");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateEnvelope(value) {
  if (!isPlainObject(value)) throw new TypeError("Invalid companion envelope.");
  const allowed = new Set(["protocolVersion", "messageType", "requestId", "sessionId", "jobId", "engineVersion", "irSchemaVersion", "sequence", "payload"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError("Unknown companion envelope field.");
  if (value.protocolVersion?.major !== COMPANION_PROTOCOL.major || !Number.isInteger(value.protocolVersion?.minor)) throw new TypeError("Unsupported companion protocol.");
  if (!Number.isInteger(value.sequence) || value.sequence < 0 || typeof value.messageType !== "string") throw new TypeError("Invalid companion envelope metadata.");
  return value;
}

export function validateCapability(value) {
  if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.version !== "string") {
    throw new TypeError("Invalid Companion capability descriptor.");
  }
  if (!PROVIDER_KINDS.includes(value.providerKind) || !Array.isArray(value.executionLocations)) {
    throw new TypeError("Invalid Companion provider metadata.");
  }
  return value;
}

export function validateProviderResult(value) {
  if (!isPlainObject(value) || value.schema !== COMPANION_RESULT_SCHEMA) {
    throw new TypeError("Invalid Companion provider result.");
  }
  if (!isPlainObject(value.source) || !Array.isArray(value.observations) || !isPlainObject(value.provider)) {
    throw new TypeError("Incomplete Companion provider result.");
  }
  if (!PROVIDER_KINDS.includes(value.provider.kind)) throw new TypeError("Invalid Companion provider kind.");
  return value;
}

export function companionStatus(error) {
  const code = error?.code || error?.message;
  if (code === "protocol-incompatible" || code === "PROTOCOL_INCOMPATIBLE") return "protocol-incompatible";
  if (code === "security-rejected" || code === "SECURITY_REJECTED") return "security-rejected";
  if (code === "pairing-required" || code === "PAIRING_REQUIRED" || code === "SESSION_EXPIRED") return "pairing-required";
  if (code === "busy" || code === "BUSY") return "busy";
  if (error?.name === "AbortError" || code === "timed-out") return "timed-out";
  return "failed";
}
