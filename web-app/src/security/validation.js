const MiB = 1024 * 1024;

export class SecurityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecurityValidationError";
  }
}

export const SECURITY_LIMITS = Object.freeze({
  workspaceJsonChars: 128 * MiB,
  workspacePdfBytes: 128 * MiB,
  markdownChars: 32 * MiB,
  workerPdfBytes: 512 * MiB,
  workerPagesPerBatch: 100,
  maxPageNumber: 5000,
  pageTextChars: 5 * MiB,
  assetsPerPage: 64,
  assetBytes: 16 * MiB,
  assetsPerPageBytes: 64 * MiB,
  assetCaptionChars: 4096,
  logEntries: 10000,
  warningEntries: 10000,
  diagnosticStringChars: 8192,
  passwordChars: 1024,
  ocrLanguageChars: 32,
});

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const OPTION_KEYS = new Set([
  "removeHeaders",
  "removeFooters",
  "joinParagraphs",
  "detectHeadings",
  "detectTables",
  "extractEquations",
  "preserveVisuals",
  "useOcr",
  "forceOcr",
  "taskLists",
  "flows",
  "placeholders",
  "preserveMarkers",
  "strict",
  "ocrLanguage",
  "ocrDpi",
]);
const BOOLEAN_OPTION_KEYS = new Set(
  [...OPTION_KEYS].filter((key) => !["ocrLanguage", "ocrDpi"].includes(key)),
);
const WORKER_RESPONSE_TYPES = new Set([
  "worker-started",
  "engine-ready",
  "page-start",
  "page",
  "ocr-progress",
  "ocr-error",
  "page-error",
  "done",
  "error",
]);
const PAGE_RESPONSE_TYPES = new Set([
  "page-start",
  "page",
  "ocr-progress",
  "ocr-error",
  "page-error",
]);
const TRUSTED_OCR_SUFFIXES = [
  "/tesseract/worker.min.js",
  "/tesseract-core",
  "/tessdata",
];

function fail(message) {
  throw new SecurityValidationError(message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) fail(`${name} must be a plain object.`);
  return value;
}

function assertFiniteNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max)
    fail(`${name} is outside the allowed numeric range.`);
  return value;
}

function assertInteger(value, name, options = {}) {
  if (!Number.isInteger(value)) fail(`${name} must be an integer.`);
  return assertFiniteNumber(value, name, options);
}

function boundedString(value, name, maxChars, { allowEmpty = true } = {}) {
  if (typeof value !== "string") fail(`${name} must be a string.`);
  if (!allowEmpty && !value.length) fail(`${name} must not be empty.`);
  if (value.length > maxChars) fail(`${name} exceeds the allowed size.`);
  return value;
}

function assertNoDangerousKey(key, path) {
  if (DANGEROUS_KEYS.has(key)) fail(`Unsafe key "${key}" is not allowed at ${path}.`);
}

function cloneBoundedJson(value, path = "value", depth = 0) {
  if (depth > 16) fail(`${path} exceeds the maximum nesting depth.`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number.`);
    return value;
  }
  if (typeof value === "string")
    return boundedString(value, path, SECURITY_LIMITS.diagnosticStringChars);
  if (Array.isArray(value)) {
    if (value.length > SECURITY_LIMITS.logEntries)
      fail(`${path} contains too many entries.`);
    return value.map((item, index) => cloneBoundedJson(item, `${path}[${index}]`, depth + 1));
  }
  assertPlainObject(value, path);
  const output = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    assertNoDangerousKey(key, path);
    output[key] = cloneBoundedJson(item, `${path}.${key}`, depth + 1);
  }
  return output;
}

export function parseUntrustedJson(text, reviver) {
  boundedString(text, "JSON input", SECURITY_LIMITS.workspaceJsonChars, {
    allowEmpty: false,
  });
  return JSON.parse(text, function secureReviver(key, value) {
    if (key) assertNoDangerousKey(key, "JSON input");
    return reviver ? reviver.call(this, key, value) : value;
  });
}

export function assertSafeAssetId(value) {
  boundedString(value, "Asset id", 128, { allowEmpty: false });
  if (
    value === "." ||
    value === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  )
    fail("Asset id contains characters that could create an unsafe bundle path.");
  return value;
}

export function bundleAssetPath(assetId) {
  return `assets/${assertSafeAssetId(assetId)}.png`;
}

function validateBbox(value, name = "Asset bbox") {
  const coordinates = value === undefined ? [0, 0, 0, 0] : value;
  if (!Array.isArray(coordinates) || coordinates.length !== 4)
    fail(`${name} must contain four coordinates.`);
  return coordinates.map((coordinate, index) =>
    assertFiniteNumber(coordinate, `${name}[${index}]`, { min: -1e7, max: 1e7 }),
  );
}

function validateAsset(asset, index = 0) {
  assertPlainObject(asset, `Asset ${index}`);
  const data = asset.data;
  if (!(data instanceof Uint8Array)) fail(`Asset ${index} data must be binary bytes.`);
  if (data.byteLength > SECURITY_LIMITS.assetBytes)
    fail(`Asset ${index} exceeds the per-asset byte ceiling.`);
  const width = assertInteger(Number(asset.width ?? 1), `Asset ${index} width`, {
    min: 1,
    max: 100000,
  });
  const height = assertInteger(Number(asset.height ?? 1), `Asset ${index} height`, {
    min: 1,
    max: 100000,
  });
  const kind = boundedString(String(asset.kind || "image"), `Asset ${index} kind`, 64, {
    allowEmpty: false,
  });
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(kind))
    fail(`Asset ${index} kind is invalid.`);

  const output = {
    id: assertSafeAssetId(asset.id),
    kind,
    bbox: validateBbox(asset.bbox, `Asset ${index} bbox`),
    caption: boundedString(
      typeof asset.caption === "string" ? asset.caption : "",
      `Asset ${index} caption`,
      SECURITY_LIMITS.assetCaptionChars,
    ),
    width,
    height,
    data,
  };
  for (const key of ["y", "rawY0", "rawY1"]) {
    if (asset[key] !== undefined)
      output[key] = assertFiniteNumber(Number(asset[key]), `Asset ${index} ${key}`, {
        min: -1e7,
        max: 1e7,
      });
  }
  return output;
}

function validateAssets(value, name = "Assets") {
  if (!Array.isArray(value)) fail(`${name} must be an array.`);
  if (value.length > SECURITY_LIMITS.assetsPerPage)
    fail(`${name} exceeds the per-page asset count ceiling.`);
  const assets = value.map(validateAsset);
  const totalBytes = assets.reduce((total, asset) => total + asset.data.byteLength, 0);
  if (totalBytes > SECURITY_LIMITS.assetsPerPageBytes)
    fail(`${name} exceeds the per-page byte ceiling.`);
  return assets;
}

function validateOptions(value = {}) {
  assertPlainObject(value, "Options");
  const output = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    assertNoDangerousKey(key, "Options");
    if (!OPTION_KEYS.has(key)) fail(`Unknown option "${key}" is not allowed.`);
    if (BOOLEAN_OPTION_KEYS.has(key)) {
      if (typeof item !== "boolean") fail(`Option ${key} must be boolean.`);
      output[key] = item;
      continue;
    }
    if (key === "ocrLanguage") {
      const language = boundedString(item, "OCR language", SECURITY_LIMITS.ocrLanguageChars, {
        allowEmpty: false,
      });
      if (!/^[A-Za-z0-9_+-]+$/.test(language)) fail("OCR language contains unsafe characters.");
      output[key] = language;
      continue;
    }
    if (key === "ocrDpi")
      output[key] = assertFiniteNumber(Number(item), "OCR DPI", { min: 72, max: 600 });
  }
  return output;
}

function validateCheckpoint(page, expectedPage) {
  assertPlainObject(page, `Page ${expectedPage}`);
  const pageNumber = assertInteger(Number(page.page), `Page ${expectedPage} number`, {
    min: 1,
    max: SECURITY_LIMITS.maxPageNumber,
  });
  if (pageNumber !== expectedPage) fail(`Page key ${expectedPage} does not match its payload.`);
  return {
    page: pageNumber,
    text: boundedString(page.text || "", `Page ${pageNumber} text`, SECURITY_LIMITS.pageTextChars),
    bodySize: assertFiniteNumber(Number(page.bodySize || 0), `Page ${pageNumber} body size`, {
      min: 0,
      max: 10000,
    }),
    assets: validateAssets(page.assets || [], `Page ${pageNumber} assets`),
    edges: cloneBoundedJson(page.edges || {}, `Page ${pageNumber} edges`),
    quality: cloneBoundedJson(page.quality || {}, `Page ${pageNumber} quality`),
    engine: boundedString(String(page.engine || "mupdf-wasm"), `Page ${pageNumber} engine`, 128),
  };
}

function normalizedPdfBytes(value) {
  if (value === null || value === undefined) return null;
  let buffer;
  if (value instanceof ArrayBuffer) buffer = value;
  else if (value instanceof Uint8Array)
    buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  else fail("Workspace PDF bytes are invalid.");
  if (buffer.byteLength > SECURITY_LIMITS.workspacePdfBytes)
    fail("Workspace PDF exceeds the import byte ceiling.");
  return buffer;
}

export function validateWorkspacePayload(value) {
  assertPlainObject(value, "Workspace");
  const schema = assertInteger(Number(value.schema), "Workspace schema", { min: 2, max: 4 });
  if (![2, 3, 4].includes(schema)) fail("Unsupported workspace format.");
  const pageCount = assertInteger(Number(value.pageCount || 0), "Workspace page count", {
    min: 0,
    max: SECURITY_LIMITS.maxPageNumber,
  });
  const fileSize = assertFiniteNumber(Number(value.fileSize || 0), "Workspace file size", {
    min: 0,
    max: SECURITY_LIMITS.workerPdfBytes,
  });
  const pdfBytes = normalizedPdfBytes(value.pdfBytes);
  const markdown = boundedString(
    typeof value.markdown === "string" ? value.markdown : "",
    "Workspace Markdown",
    SECURITY_LIMITS.markdownChars,
  );
  const sourcePages = value.pages ?? {};
  assertPlainObject(sourcePages, "Workspace pages");
  const pages = Object.create(null);
  const entries = Object.entries(sourcePages);
  if (entries.length > SECURITY_LIMITS.maxPageNumber)
    fail("Workspace contains too many page checkpoints.");
  for (const [key, page] of entries) {
    if (!/^\d+$/.test(key)) fail("Workspace contains an invalid page key.");
    const pageNumber = assertInteger(Number(key), "Workspace page key", {
      min: 1,
      max: SECURITY_LIMITS.maxPageNumber,
    });
    if (pageCount && pageNumber > pageCount)
      fail(`Workspace page ${pageNumber} exceeds the declared page count.`);
    pages[pageNumber] = validateCheckpoint(page, pageNumber);
  }
  const warnings = Array.isArray(value.warnings) ? value.warnings : [];
  const logs = Array.isArray(value.logs) ? value.logs : [];
  if (warnings.length > SECURITY_LIMITS.warningEntries)
    fail("Workspace contains too many warnings.");
  if (logs.length > SECURITY_LIMITS.logEntries) fail("Workspace contains too many log entries.");

  return {
    schema,
    checkpointRevision: Number.isInteger(value.checkpointRevision)
      ? value.checkpointRevision
      : 0,
    extractionVersion: Number.isInteger(value.extractionVersion)
      ? value.extractionVersion
      : -1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt.slice(0, 128) : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt.slice(0, 128) : undefined,
    fileName: boundedString(String(value.fileName || "document.pdf"), "Workspace file name", 1024),
    fileSize,
    pageCount,
    pdfBytes,
    pages,
    markdown,
    options: validateOptions(value.options || {}),
    warnings: warnings.map((item, index) => cloneBoundedJson(item, `Warning ${index}`)),
    logs: logs.map((item, index) => cloneBoundedJson(item, `Log ${index}`)),
    engine: boundedString(String(value.engine || "mupdf-wasm"), "Workspace engine", 128),
  };
}

export function assertTrustedLocalResourceUrl(value, {
  baseUrl = globalThis.location?.href,
  allowedPathSuffixes = [],
} = {}) {
  boundedString(value, "Resource URL", 4096, { allowEmpty: false });
  if (!baseUrl) fail("A trusted base URL is required for resource validation.");
  let candidate;
  let base;
  try {
    base = new URL(baseUrl);
    candidate = new URL(value, base);
  } catch {
    fail("Resource URL is malformed.");
  }
  if (!["http:", "https:"].includes(candidate.protocol))
    fail("Only local HTTP(S) resources are allowed.");
  if (candidate.origin !== base.origin) fail("Cross-origin resource URLs are not allowed.");
  if (candidate.username || candidate.password || candidate.search || candidate.hash)
    fail("Resource URLs may not contain credentials, query strings, or fragments.");
  const path = candidate.pathname.replace(/\/+$/, "");
  if (
    allowedPathSuffixes.length &&
    !allowedPathSuffixes.some((suffix) => path.endsWith(suffix.replace(/\/+$/, "")))
  )
    fail("Resource URL is not on the local allowlist.");
  return candidate.toString();
}

export function validateWorkerRequest(value, { baseUrl = globalThis.location?.href } = {}) {
  assertPlainObject(value, "Worker request");
  if (value.type !== "extract") fail("Unknown worker request type.");
  if (!(value.buffer instanceof ArrayBuffer)) fail("Worker PDF buffer is invalid.");
  if (!value.buffer.byteLength) fail("Worker PDF buffer is empty.");
  if (value.buffer.byteLength > SECURITY_LIMITS.workerPdfBytes)
    fail("Worker PDF buffer exceeds the byte ceiling.");
  if (!Array.isArray(value.pages) || !value.pages.length)
    fail("Worker page list must not be empty.");
  if (value.pages.length > SECURITY_LIMITS.workerPagesPerBatch)
    fail("Worker page batch exceeds the page ceiling.");
  const pages = value.pages.map((page, index) =>
    assertInteger(Number(page), `Worker page ${index}`, {
      min: 1,
      max: SECURITY_LIMITS.maxPageNumber,
    }),
  );
  if (new Set(pages).size !== pages.length) fail("Worker page list contains duplicates.");
  assertPlainObject(value.ocrPaths, "OCR paths");
  const workerPath = assertTrustedLocalResourceUrl(value.ocrPaths.workerPath, {
    baseUrl,
    allowedPathSuffixes: [TRUSTED_OCR_SUFFIXES[0]],
  });
  const corePath = assertTrustedLocalResourceUrl(value.ocrPaths.corePath, {
    baseUrl,
    allowedPathSuffixes: [TRUSTED_OCR_SUFFIXES[1]],
  });
  const langPath = assertTrustedLocalResourceUrl(value.ocrPaths.langPath, {
    baseUrl,
    allowedPathSuffixes: [TRUSTED_OCR_SUFFIXES[2]],
  });
  return {
    type: "extract",
    buffer: value.buffer,
    pages,
    options: validateOptions(value.options || {}),
    password: boundedString(
      typeof value.password === "string" ? value.password : "",
      "PDF password",
      SECURITY_LIMITS.passwordChars,
    ),
    ocrPaths: { workerPath, corePath, langPath },
  };
}

export function validateWorkerResponse(value, { allowedPages = new Set() } = {}) {
  assertPlainObject(value, "Worker response");
  if (!WORKER_RESPONSE_TYPES.has(value.type)) fail("Unknown worker response type.");
  if (PAGE_RESPONSE_TYPES.has(value.type)) {
    const page = assertInteger(Number(value.page), "Worker response page", {
      min: 1,
      max: SECURITY_LIMITS.maxPageNumber,
    });
    if (allowedPages.size && !allowedPages.has(page))
      fail("Worker response references a page outside the requested batch.");
  }
  if (value.type === "page") {
    boundedString(value.text || "", "Worker page text", SECURITY_LIMITS.pageTextChars);
    validateAssets(value.assets || [], "Worker page assets");
    cloneBoundedJson(value.edges || {}, "Worker page edges");
    cloneBoundedJson(value.quality || {}, "Worker page quality");
  }
  if (value.type === "ocr-progress") {
    boundedString(String(value.status || ""), "OCR status", 256);
    assertFiniteNumber(Number(value.progress), "OCR progress", { min: 0, max: 1 });
  }
  if (["ocr-error", "page-error", "error"].includes(value.type))
    boundedString(String(value.message || ""), "Worker error message", 4096);
  if (value.type === "done")
    assertInteger(Number(value.total || 0), "Worker completed page count", {
      min: 0,
      max: SECURITY_LIMITS.workerPagesPerBatch,
    });
  return value;
}
