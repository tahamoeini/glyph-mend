const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const EXTRACTION_OPTION_KEYS = new Set([
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

const BOOLEAN_EXTRACTION_OPTIONS = new Set(
  [...EXTRACTION_OPTION_KEYS].filter((key) => !["ocrLanguage", "ocrDpi"].includes(key)),
);

export const ACTIVE_FORMAT_LIMITS = Object.freeze({
  maxPdfBytes: 512 * 1024 * 1024,
  maxBatchPages: 100,
  maxPageNumber: 2000,
  maxPageTextChars: 16 * 1024 * 1024,
  maxMessageStringChars: 16 * 1024 * 1024,
  maxAssetBytes: 32 * 1024 * 1024,
  maxPageAssetBytes: 128 * 1024 * 1024,
  maxAssetsPerPage: 256,
  maxReviewItemsPerPage: 256,
  maxStructuredDepth: 32,
  maxStructuredNodes: 100_000,
  maxPasswordChars: 1024,
  maxStatusChars: 512,
});

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function byteLength(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return -1;
}

function finiteInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function finiteNumber(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return number;
}

function boundedString(value, label, maximum, { allowEmpty = true } = {}) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  if (!allowEmpty && !value.trim()) throw new TypeError(`${label} must not be empty.`);
  if (value.length > maximum) throw new RangeError(`${label} exceeds the ${maximum}-character limit.`);
  return value;
}

function assertAllowedOwnKeys(value, allowed, label) {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain object.`);
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${label} contains unsafe key ${key}.`);
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported key ${key}.`);
  }
}

export function assertSafeStructuredValue(
  value,
  label = "value",
  limits = ACTIVE_FORMAT_LIMITS,
  state = { nodes: 0 },
  depth = 0,
) {
  if (depth > limits.maxStructuredDepth) {
    throw new RangeError(`${label} exceeds the structured-data depth limit.`);
  }
  state.nodes += 1;
  if (state.nodes > limits.maxStructuredNodes) {
    throw new RangeError(`${label} exceeds the structured-data node limit.`);
  }

  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${label} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value === "string") {
    return boundedString(value, label, limits.maxMessageStringChars);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertSafeStructuredValue(value[index], `${label}[${index}]`, limits, state, depth + 1);
    }
    return value;
  }
  if (!isPlainRecord(value)) throw new TypeError(`${label} must contain only JSON-like values or byte buffers.`);
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${label} contains unsafe key ${key}.`);
    assertSafeStructuredValue(child, `${label}.${key}`, limits, state, depth + 1);
  }
  return value;
}

function validatedLocalAssetUrl(value, label, expectedPath, baseUrl) {
  boundedString(value, label, 2048, { allowEmpty: false });
  const base = new URL(baseUrl || "https://glyphmend.invalid/");
  const url = new URL(value, base);
  if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) {
    throw new TypeError(`${label} must be a same-origin bundled asset URL.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} must not contain credentials, query parameters, or fragments.`);
  }
  const actual = url.pathname.replace(/\/+$/, "");
  const expected = expectedPath.replace(/\/+$/, "");
  if (!actual.endsWith(expected)) throw new TypeError(`${label} must resolve to ${expectedPath}.`);
  return url.toString();
}

function validatedExtractionOptions(value, limits) {
  assertAllowedOwnKeys(value, EXTRACTION_OPTION_KEYS, "Extraction request options");
  const out = {};
  for (const key of BOOLEAN_EXTRACTION_OPTIONS) {
    if (!own(value, key)) continue;
    if (typeof value[key] !== "boolean") throw new TypeError(`Extraction option ${key} must be boolean.`);
    out[key] = value[key];
  }
  const language = own(value, "ocrLanguage") ? boundedString(value.ocrLanguage, "OCR language", 16, { allowEmpty: false }) : "eng";
  if (language !== "eng") throw new TypeError("Only the bundled offline OCR language 'eng' is allowed.");
  out.ocrLanguage = language;
  out.ocrDpi = own(value, "ocrDpi") ? finiteNumber(value.ocrDpi, "OCR DPI", 72, 600) : 300;
  assertSafeStructuredValue(out, "Extraction request options", limits);
  return out;
}

export function validateExtractionRequest(
  value,
  { baseUrl = globalThis.location?.href || "https://glyphmend.invalid/", limits = ACTIVE_FORMAT_LIMITS } = {},
) {
  assertAllowedOwnKeys(
    value,
    new Set(["type", "buffer", "pages", "options", "password", "ocrPaths"]),
    "Extraction request",
  );
  if (value.type !== "extract") throw new TypeError("Extraction request type must be 'extract'.");
  const pdfBytes = byteLength(value.buffer);
  if (pdfBytes <= 0) throw new TypeError("Extraction request must include PDF bytes.");
  if (pdfBytes > limits.maxPdfBytes) throw new RangeError("PDF exceeds the extraction worker byte limit.");
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > limits.maxBatchPages) {
    throw new RangeError(`Extraction request must contain 1-${limits.maxBatchPages} pages.`);
  }
  const pages = value.pages.map((page, index) => finiteInteger(page, `pages[${index}]`, 1, limits.maxPageNumber));
  if (new Set(pages).size !== pages.length) throw new TypeError("Extraction request contains duplicate pages.");
  const password = value.password === undefined ? "" : boundedString(value.password, "PDF password", limits.maxPasswordChars);
  const options = validatedExtractionOptions(value.options || {}, limits);

  assertAllowedOwnKeys(value.ocrPaths, new Set(["workerPath", "corePath", "langPath"]), "OCR runtime paths");
  const ocrPaths = {
    workerPath: validatedLocalAssetUrl(value.ocrPaths.workerPath, "OCR worker path", "/tesseract/worker.min.js", baseUrl),
    corePath: validatedLocalAssetUrl(value.ocrPaths.corePath, "OCR core path", "/tesseract-core", baseUrl),
    langPath: validatedLocalAssetUrl(value.ocrPaths.langPath, "OCR language path", "/tessdata", baseUrl),
  };

  return {
    type: "extract",
    buffer: value.buffer,
    pages,
    options,
    password,
    ocrPaths,
  };
}

function validateAsset(asset, index, limits) {
  if (!isPlainRecord(asset)) throw new TypeError(`Worker asset ${index} must be a plain object.`);
  assertSafeStructuredValue(asset, `Worker asset ${index}`, limits);
  if (asset.id !== undefined) boundedString(asset.id, `Worker asset ${index} id`, 512, { allowEmpty: false });
  if (asset.kind !== undefined) boundedString(asset.kind, `Worker asset ${index} kind`, 128, { allowEmpty: false });
  const size = asset.data === undefined ? 0 : byteLength(asset.data);
  if (asset.data !== undefined && size < 0) throw new TypeError(`Worker asset ${index} data must be bytes.`);
  if (size > limits.maxAssetBytes) throw new RangeError(`Worker asset ${index} exceeds the per-asset byte limit.`);
  return size;
}

function validatePageWorkerMessage(value, limits) {
  const page = finiteInteger(value.page, "Worker page", 1, limits.maxPageNumber);
  const text = boundedString(value.text || "", "Worker page text", limits.maxPageTextChars);
  if (!Array.isArray(value.assets)) throw new TypeError("Worker page assets must be an array.");
  if (value.assets.length > limits.maxAssetsPerPage) throw new RangeError("Worker page contains too many assets.");
  let assetBytes = 0;
  for (let index = 0; index < value.assets.length; index += 1) assetBytes += validateAsset(value.assets[index], index, limits);
  if (assetBytes > limits.maxPageAssetBytes) throw new RangeError("Worker page assets exceed the aggregate byte limit.");
  const reviewItems = value.reviewItems === undefined ? [] : value.reviewItems;
  if (!Array.isArray(reviewItems) || reviewItems.length > limits.maxReviewItemsPerPage) {
    throw new RangeError("Worker page contains too many review items.");
  }
  assertSafeStructuredValue(reviewItems, "Worker review items", limits);
  assertSafeStructuredValue(value.edges || {}, "Worker page edges", limits);
  assertSafeStructuredValue(value.quality || {}, "Worker page quality", limits);
  if (value.reviewCandidate !== undefined) assertSafeStructuredValue(value.reviewCandidate, "Worker review candidate", limits);
  return { ...value, page, text, reviewItems };
}

export function validateExtractionWorkerMessage(value, { limits = ACTIVE_FORMAT_LIMITS } = {}) {
  if (!isPlainRecord(value)) throw new TypeError("Extraction worker message must be a plain object.");
  if (typeof value.type !== "string") throw new TypeError("Extraction worker message type is missing.");
  if (DANGEROUS_KEYS.has(value.type)) throw new TypeError("Extraction worker message type is unsafe.");

  switch (value.type) {
    case "worker-started":
      return { type: value.type };
    case "engine-ready":
      if (value.engine !== "mupdf-wasm") throw new TypeError("Extraction worker reported an unsupported engine.");
      return { type: value.type, engine: value.engine };
    case "page-start":
      return { type: value.type, page: finiteInteger(value.page, "Worker page", 1, limits.maxPageNumber) };
    case "ocr-progress":
      return {
        type: value.type,
        page: finiteInteger(value.page, "OCR page", 1, limits.maxPageNumber),
        status: boundedString(value.status || "", "OCR status", limits.maxStatusChars),
        progress: finiteNumber(value.progress ?? 0, "OCR progress", 0, 1),
      };
    case "ocr-error":
    case "page-error":
      return {
        type: value.type,
        page: finiteInteger(value.page, "Worker page", 1, limits.maxPageNumber),
        message: boundedString(value.message || "Worker error", "Worker error message", 2048),
      };
    case "page":
      return validatePageWorkerMessage(value, limits);
    case "done":
      return {
        type: value.type,
        total: finiteInteger(value.total, "Worker total", 1, limits.maxBatchPages),
        engine: value.engine === "mupdf-wasm" ? value.engine : "mupdf-wasm",
      };
    case "error":
      return {
        type: value.type,
        message: boundedString(value.message || "Extraction worker failed.", "Worker error message", 2048),
      };
    default:
      throw new TypeError(`Unsupported extraction worker message type: ${value.type}.`);
  }
}
