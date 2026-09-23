// Versioned browser-side constants and validators for the Companion REST API.
export const COMPANION_PROTOCOL = Object.freeze({ major: 1, minor: 2 });
export const COMPANION_IR_SCHEMA = Object.freeze({ id: "glyphmend.semantic-document-ir", version: 2 });
export const COMPANION_RESULT_SCHEMA = "glyphmend.provider-result.v1";
export const REGION_INPUT_SCHEMA = "glyphmend.region-input.v1";
export const DOCUMENT_EXTRACTION_CAPABILITY = "glyphmend.document.extract.v2";
export const DOCUMENT_OPTIONS_SCHEMA = "glyphmend.document-extraction-options.v2";
export const COMPANION_LIMITS = Object.freeze({
  controlBytes: 64 * 1024,
  chunkBytes: 1024 * 1024,
  documentBytes: 512 * 1024 * 1024,
  runtimeBytes: 1024 * 1024 * 1024,
  sessionBytes: 512 * 1024 * 1024,
  controlTimeoutMs: 30_000,
  eventWaitMs: 15_000,
  maxEventBatch: 128,
  maxObservations: 256,
  maxWarnings: 64,
  maxMetadataBytes: 16 * 1024,
  maxDiagnosticsBytes: 32 * 1024,
  maxProviderResultBytes: 64 * 1024,
  maxIrResultBytes: 32 * 1024 * 1024,
  maxIdentifierBytes: 128,
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

function encodedSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validSha256(value) {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
}

export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("Enter a valid local companion endpoint."); }
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "http:" || !loopback || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("The companion endpoint must be an explicit http://127.0.0.1 or http://[::1] address.");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateRegionMetadata(value) {
  if (!isPlainObject(value)
    || value.schema !== REGION_INPUT_SCHEMA
    || !Number.isInteger(value.page)
    || value.page < 1
    || !Array.isArray(value.bbox)
    || value.bbox.length !== 4
    || value.bbox.some((coordinate) => !Number.isFinite(coordinate))
    || !Array.isArray(value.sourceIds)
    || value.sourceIds.length > COMPANION_LIMITS.maxObservations
    || value.sourceIds.some((sourceId) => typeof sourceId !== "string" || !sourceId || utf8Length(sourceId) > COMPANION_LIMITS.maxIdentifierBytes)
    || !isPlainObject(value.deterministicSummary)) {
    throw new TypeError("Invalid region input metadata.");
  }
  const allowed = new Set(["schema", "page", "bbox", "sourceIds", "deterministicSummary"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError("Unknown region input metadata field.");
  if (encodedSize(value) > COMPANION_LIMITS.maxMetadataBytes) throw new TypeError("Region metadata exceeds its size limit.");
  return value;
}

export function validateCapability(value) {
  const fields = new Set(["id", "version", "providerKind", "inputSchema", "outputSchema", "executionLocations", "deterministic", "requiresModel", "confidenceCalibrated", "privacyClass", "diagnosticOnly", "irSchemaVersion"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, fields)
    || typeof value.id !== "string" || !value.id || utf8Length(value.id) > COMPANION_LIMITS.maxIdentifierBytes
    || typeof value.version !== "string" || !value.version || utf8Length(value.version) > COMPANION_LIMITS.maxIdentifierBytes
    || typeof value.inputSchema !== "string" || !value.inputSchema || utf8Length(value.inputSchema) > COMPANION_LIMITS.maxIdentifierBytes
    || typeof value.outputSchema !== "string" || !value.outputSchema || utf8Length(value.outputSchema) > COMPANION_LIMITS.maxIdentifierBytes
    || typeof value.privacyClass !== "string" || !value.privacyClass || utf8Length(value.privacyClass) > COMPANION_LIMITS.maxIdentifierBytes
    || !Number.isInteger(value.irSchemaVersion) || value.irSchemaVersion < 1
    || [value.deterministic, value.requiresModel, value.confidenceCalibrated, value.diagnosticOnly].some((flag) => typeof flag !== "boolean")) {
    throw new TypeError("Invalid Companion capability descriptor.");
  }
  if (!PROVIDER_KINDS.includes(value.providerKind) || !Array.isArray(value.executionLocations)
    || value.executionLocations.length > 16
    || value.executionLocations.some((location) => typeof location !== "string" || !location || utf8Length(location) > COMPANION_LIMITS.maxIdentifierBytes)) {
    throw new TypeError("Invalid Companion provider metadata.");
  }
  return value;
}

export function validateProviderResult(value) {
  const resultFields = new Set(["schema", "capability", "source", "observations", "provider", "model", "warnings", "diagnostics"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, resultFields) || value.schema !== COMPANION_RESULT_SCHEMA
    || typeof value.capability !== "string" || !value.capability
    || utf8Length(value.capability) > COMPANION_LIMITS.maxIdentifierBytes
    || !isPlainObject(value.source) || !hasOnlyKeys(value.source, new Set(["page", "bbox", "contentHash"]))
    || !Array.isArray(value.observations)
    || !isPlainObject(value.provider) || !hasOnlyKeys(value.provider, new Set(["id", "kind", "version"]))
    || !PROVIDER_KINDS.includes(value.provider.kind)) {
    throw new TypeError("Invalid Companion provider result.");
  }
  if (!Number.isInteger(value.source.page) || value.source.page < 1
    || !Array.isArray(value.source.bbox) || value.source.bbox.length !== 4
    || value.source.bbox.some((coordinate) => !Number.isFinite(coordinate))
    || !validSha256(value.source.contentHash)) {
    throw new TypeError("Invalid Companion provider source.");
  }
  if (value.observations.length > COMPANION_LIMITS.maxObservations
    || value.observations.some((observation) => !isPlainObject(observation)
      || !hasOnlyKeys(observation, new Set(["type", "value", "confidence"]))
      || !Object.hasOwn(observation, "value")
      || typeof observation.type !== "string" || !observation.type
      || utf8Length(observation.type) > COMPANION_LIMITS.maxIdentifierBytes
      || (observation.confidence !== undefined && observation.confidence !== null
        && (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1)))) {
    throw new TypeError("Invalid Companion observations.");
  }
  if (typeof value.provider.id !== "string" || !value.provider.id
    || utf8Length(value.provider.id) > COMPANION_LIMITS.maxIdentifierBytes
    || typeof value.provider.version !== "string" || !value.provider.version
    || utf8Length(value.provider.version) > COMPANION_LIMITS.maxIdentifierBytes) {
    throw new TypeError("Invalid Companion provider metadata.");
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > COMPANION_LIMITS.maxWarnings
    || value.warnings.some((warning) => typeof warning !== "string" || utf8Length(warning) > 512)) {
    throw new TypeError("Invalid Companion warnings.");
  }
  if (!isPlainObject(value.diagnostics) || encodedSize(value.diagnostics) > COMPANION_LIMITS.maxDiagnosticsBytes) {
    throw new TypeError("Invalid Companion diagnostics.");
  }
  if (value.model != null && (!isPlainObject(value.model)
    || !hasOnlyKeys(value.model, new Set(["id", "revision", "sha256"]))
    || typeof value.model.id !== "string" || !value.model.id
    || utf8Length(value.model.id) > COMPANION_LIMITS.maxIdentifierBytes
    || typeof value.model.revision !== "string" || !value.model.revision
    || utf8Length(value.model.revision) > COMPANION_LIMITS.maxIdentifierBytes
    || !validSha256(value.model.sha256))) {
    throw new TypeError("Invalid Companion model metadata.");
  }
  if (encodedSize(value) > COMPANION_LIMITS.maxProviderResultBytes) {
    throw new TypeError("Companion provider result exceeds its size limit.");
  }
  return value;
}

export function validateJobCreate(request) {
  const fields = new Set(["documentName", "capabilityId", "inputKind", "declaredBytes", "pageCount", "metadata", "idempotencyKey"]);
  if (!isPlainObject(request) || !hasOnlyKeys(request, fields)
    || typeof request.documentName !== "string" || utf8Length(request.documentName) > 255
    || request.documentName.includes("/") || request.documentName.includes("\\") || request.documentName.includes(":") || request.documentName.includes(String.fromCharCode(0)) || request.documentName.includes("://")
    || typeof request.capabilityId !== "string" || !request.capabilityId
    || utf8Length(request.capabilityId) > COMPANION_LIMITS.maxIdentifierBytes
    || !INPUT_KINDS.includes(request.inputKind)
    || !Number.isSafeInteger(request.declaredBytes) || request.declaredBytes < 0 || request.declaredBytes > COMPANION_LIMITS.documentBytes
    || !Number.isInteger(request.pageCount) || request.pageCount < 0 || request.pageCount > 0xffffffff
    || !isPlainObject(request.metadata)
    || typeof request.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.idempotencyKey)) {
    throw new TypeError("Invalid Companion job request.");
  }
  if (encodedSize(request.metadata) > COMPANION_LIMITS.maxMetadataBytes) throw new TypeError("Companion metadata exceeds its size limit.");
  if (request.inputKind === "region") validateRegionMetadata(request.metadata);
  if (request.capabilityId === DOCUMENT_EXTRACTION_CAPABILITY) {
    const value = request.metadata;
    const fields = new Set(["schema", "selectedPages", "ocrAccuracy", "useOcr", "forceOcr", "password"]);
    if (request.inputKind !== "document" || !hasOnlyKeys(value, fields)
      || value.schema !== DOCUMENT_OPTIONS_SCHEMA
      || !Array.isArray(value.selectedPages) || value.selectedPages.length < 1 || value.selectedPages.length > 2000
      || value.selectedPages.some((page) => !Number.isInteger(page) || page < 1 || page > request.pageCount)
      || new Set(value.selectedPages).size !== value.selectedPages.length
      || !["fast", "high-accuracy"].includes(value.ocrAccuracy)
      || (value.useOcr !== undefined && typeof value.useOcr !== "boolean")
      || (value.forceOcr !== undefined && typeof value.forceOcr !== "boolean")
      || (value.password !== undefined && (typeof value.password !== "string" || utf8Length(value.password) > 4096))) {
      throw new TypeError("Invalid document extraction options.");
    }
  }
  if (encodedSize(request) > COMPANION_LIMITS.controlBytes) throw new TypeError("Companion control request exceeds 64 KiB.");
  return request;
}

export function validateInputComplete(value) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, new Set(["sha256Hex", "totalBytes"]))
    || !validSha256(value.sha256Hex) || !Number.isSafeInteger(value.totalBytes)
    || value.totalBytes < 0 || value.totalBytes > COMPANION_LIMITS.documentBytes) {
    throw new TypeError("Invalid Companion input completion.");
  }
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
