// Generated from companion/schemas/companion/v1/protocol.json. Keep this file
// dependency-free so the ordinary browser build never needs native libraries.
export const COMPANION_PROTOCOL = Object.freeze({ major: 1, minor: 0 });
export const COMPANION_IR_SCHEMA = Object.freeze({ id: "glyphmend.semantic-document-ir", version: 2 });
export const COMPANION_LIMITS = Object.freeze({ chunkBytes: 1024 * 1024, documentBytes: 512 * 1024 * 1024, controlTimeoutMs: 30_000 });
export const COMPANION_STATUSES = Object.freeze(["unavailable", "pairing-required", "connected", "busy", "protocol-incompatible", "security-rejected", "timed-out", "failed"]);

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
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid companion envelope.");
  const allowed = new Set(["protocolVersion", "messageType", "requestId", "sessionId", "jobId", "engineVersion", "irSchemaVersion", "sequence", "payload"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError("Unknown companion envelope field.");
  if (value.protocolVersion?.major !== COMPANION_PROTOCOL.major || !Number.isInteger(value.protocolVersion?.minor)) throw new TypeError("Unsupported companion protocol.");
  if (!Number.isInteger(value.sequence) || value.sequence < 0 || typeof value.messageType !== "string") throw new TypeError("Invalid companion envelope metadata.");
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
