import { strToU8, zipSync } from "fflate";
import { chartIRExportSidecars } from "./chart-rendering.js";
import { routeVisualOutput, sanitizeGeneratedSvgMarkup } from "./visual-rendering.js";

export const RECONSTRUCTABLE_BUNDLE_VERSION = 1;
export const RECONSTRUCTABLE_BUNDLE_SCHEMA = "glyphmend.reconstructable-bundle";
export const RECONSTRUCTABLE_BUNDLE_LIMITS = Object.freeze({
  maxEntries: 512,
  maxManifestBytes: 2 * 1024 * 1024,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 768 * 1024 * 1024,
  maxPathChars: 512,
  maxStructuredDepth: 32,
  maxStructuredNodes: 100_000,
});

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeStructure(value, label, limits, state = { nodes: 0 }, depth = 0) {
  if (depth > limits.maxStructuredDepth) throw new RangeError(`${label} exceeds the structured-data depth limit.`);
  state.nodes += 1;
  if (state.nodes > limits.maxStructuredNodes) throw new RangeError(`${label} exceeds the structured-data node limit.`);
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    return value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeStructure(item, `${label}[${index}]`, limits, state, depth + 1));
    return value;
  }
  if (!isPlainObject(value)) throw new TypeError(`${label} must contain only plain JSON-like values.`);
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${label} contains unsafe key ${key}.`);
    assertSafeStructure(child, `${label}.${key}`, limits, state, depth + 1);
  }
  return value;
}

function stableValue(value, limits = RECONSTRUCTABLE_BUNDLE_LIMITS) {
  assertSafeStructure(value, "Bundle structured value", limits);
  if (Array.isArray(value)) return value.map((item) => stableValue(item, limits));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item, limits)]),
  );
}

function jsonBytes(value, limits = RECONSTRUCTABLE_BUNDLE_LIMITS) {
  return strToU8(JSON.stringify(stableValue(value, limits), null, 2));
}

function stringBytes(value) {
  return strToU8(String(value ?? ""));
}

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return stringBytes(value);
  return new Uint8Array();
}

function sanitizedSvgBytes(value) {
  const source = typeof value === "string" ? value : new TextDecoder().decode(bytes(value));
  return stringBytes(sanitizeGeneratedSvgMarkup(source));
}

export function assertSafeBundlePath(path, limits = RECONSTRUCTABLE_BUNDLE_LIMITS) {
  if (typeof path !== "string" || !path || path.length > limits.maxPathChars) {
    throw new TypeError("Bundle path is empty or too long.");
  }
  if (/^[A-Za-z]:/.test(path) || path.startsWith("/") || path.startsWith("\\")) {
    throw new TypeError(`Unsafe bundle path: ${path}`);
  }
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new TypeError(`Unsafe bundle path: ${path}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError(`Unsafe bundle path: ${path}`);
  }
  return path;
}

function assertBundleResourceLimits(entries, limits = RECONSTRUCTABLE_BUNDLE_LIMITS) {
  if (!isPlainObject(entries)) throw new TypeError("Bundle entries must be a plain object.");
  const paths = Object.keys(entries);
  if (paths.length > limits.maxEntries) throw new RangeError(`Bundle exceeds the ${limits.maxEntries}-entry limit.`);
  let total = 0;
  for (const path of paths) {
    assertSafeBundlePath(path, limits);
    const size = bytes(entries[path]).byteLength;
    if (size > limits.maxEntryBytes) throw new RangeError(`Bundle entry exceeds the byte limit: ${path}`);
    total += size;
    if (total > limits.maxTotalBytes) throw new RangeError("Bundle exceeds the aggregate decoded-byte limit.");
  }
  if (entries["manifest.json"] && bytes(entries["manifest.json"]).byteLength > limits.maxManifestBytes) {
    throw new RangeError("Bundle manifest exceeds the byte limit.");
  }
  return { entries: paths.length, totalBytes: total };
}

function safeToken(value, fallback = "asset") {
  return String(value || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || fallback;
}

function extensionFor(asset) {
  const mime = String(asset?.mimeType || asset?.type || "").toLowerCase();
  if (asset?.format === "svg" || mime.includes("svg")) return "svg";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function semanticAssets(assets, reviewItems) {
  const values = assets instanceof Map ? [...assets.values()] : Array.isArray(assets) ? assets : [];
  const byId = new Map(values.filter((asset) => asset?.id).map((asset) => [String(asset.id), asset]));
  for (const review of reviewItems || []) {
    if (!review?.id || byId.has(String(review.id))) continue;
    byId.set(String(review.id), {
      ...review,
      id: String(review.id),
      kind: review.kind || "equation",
      page: review.page,
      bbox: review.sourceAsset?.bbox,
      sourceAsset: review.sourceAsset,
      candidate: review.candidate,
      confidence: review.confidence,
      disposition: review.disposition,
    });
  }
  return [...byId.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function sourceMetadata(asset) {
  const source = asset?.sourceAsset || asset?.source || {};
  return {
    page: Number(source.page ?? asset?.page ?? 1),
    bbox: Array.isArray(source.bbox || asset?.bbox) ? [...(source.bbox || asset.bbox)] : [0, 0, 0, 0],
    sourceAssetId: source.id || asset?.sourceAssetId || asset?.id || null,
    sourceKind: source.kind || asset?.sourceType || asset?.kind || "source",
  };
}

function semanticManifestEntry(asset, token) {
  const candidate = asset?.candidate || {};
  return {
    id: String(asset.id),
    kind: asset.kind || "asset",
    source: sourceMetadata(asset),
    reconstruction: {
      format: asset.visualIR || asset.chartIR ? "semantic-ir" : candidate.latex ? "math-ir" : "source-preserving",
      version: asset.reconstructionVersion || candidate.version || asset.version || null,
      paths: [],
    },
    confidence: asset.confidence || candidate.confidence || { overall: 0 },
    disposition: asset.disposition || asset.status || candidate.disposition || "preserved",
    provenance: {
      producer: asset.provenance?.producer || candidate.provider || null,
      version: asset.provenance?.version || candidate.version || null,
    },
    fileToken: token,
  };
}

function addFile(files, path, value, limits = RECONSTRUCTABLE_BUNDLE_LIMITS) {
  assertSafeBundlePath(path, limits);
  const next = bytes(value);
  if (next.byteLength > limits.maxEntryBytes) throw new RangeError(`Bundle entry exceeds the byte limit: ${path}`);
  if (files[path]) {
    const previous = files[path];
    if (previous.byteLength === next.byteLength && previous.every((part, index) => part === next[index])) return path;
    throw new Error(`Duplicate bundle path: ${path}`);
  }
  files[path] = next;
  return path;
}

function addJson(files, path, value, limits = RECONSTRUCTABLE_BUNDLE_LIMITS) {
  return addFile(files, path, jsonBytes(value, limits), limits);
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Bundle checksums require Web Crypto support.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function sourceAssetFor(asset, sourceAssets) {
  const sourceId = sourceMetadata(asset).sourceAssetId;
  return sourceAssets.get(String(sourceId)) || (asset?.data || asset?.svg ? asset : null);
}

function addSemanticFiles(files, entry, asset, sourceAssets, limits) {
  const token = entry.fileToken;
  const sourceAsset = sourceAssetFor(asset, sourceAssets);
  if (sourceAsset?.data || sourceAsset?.svg) {
    const originalToken = safeToken(sourceAsset.id || token);
    const extension = extensionFor(sourceAsset);
    const originalPath = `assets/originals/${originalToken}.${extension}`;
    const sourceValue = extension === "svg"
      ? sanitizedSvgBytes(sourceAsset.data || sourceAsset.svg)
      : sourceAsset.data || sourceAsset.svg;
    addFile(files, originalPath, sourceValue, limits);
    entry.source.assetPath = originalPath;
  }
  if (asset?.svg) {
    entry.reconstruction.paths.push(
      addFile(files, `assets/rendered/${token}.svg`, sanitizedSvgBytes(asset.svg), limits),
    );
  }
  if (asset?.visualIR) {
    entry.reconstruction.paths.push(addJson(files, `assets/reconstructed/${token}.visual.json`, asset.visualIR, limits));
    if (asset.visualIR.mermaid) {
      entry.reconstruction.paths.push(addFile(files, "diagrams/" + token + ".mmd", asset.visualIR.mermaid, limits));
    } else {
      try {
        const routed = routeVisualOutput(asset.visualIR);
        if (routed.format === "mermaid") entry.reconstruction.paths.push(addFile(files, "diagrams/" + token + ".mmd", routed.output, limits));
        if (routed.format === "plantuml") entry.reconstruction.paths.push(addFile(files, "diagrams/" + token + ".puml", routed.output, limits));
      } catch {
        // Ambiguous VisualIR remains in the semantic JSON/source tier.
      }
    }
  }
  if (asset?.chartIR) {
    entry.reconstruction.paths.push(addJson(files, `assets/reconstructed/${token}.chart.json`, asset.chartIR, limits));
    try {
      const sidecars = chartIRExportSidecars(asset.chartIR);
      if (entry.disposition === "accepted") {
        addFile(files, `charts/${token}.vl.json`, sidecars.spec, limits);
        addFile(files, `charts/${token}.csv`, sidecars.csv, limits);
      }
    } catch {
      // Unsupported or weak charts remain in the semantic JSON/source tier.
    }
  }
  if (asset?.mermaid) entry.reconstruction.paths.push(addFile(files, `diagrams/${token}.mmd`, asset.mermaid, limits));
  if (asset?.plantuml) entry.reconstruction.paths.push(addFile(files, `diagrams/${token}.puml`, asset.plantuml, limits));
  const latex = asset?.candidate?.latex || asset?.latex;
  if (latex) entry.reconstruction.paths.push(addFile(files, `equations/${token}.tex`, latex, limits));
  if (asset?.mathml) entry.reconstruction.paths.push(addFile(files, `equations/${token}.mathml`, asset.mathml, limits));
  if (asset?.candidate || asset?.parsed?.mathir) {
    entry.reconstruction.paths.push(addJson(files, `assets/reconstructed/${token}.equation.json`, {
      candidate: asset.candidate || null,
      mathIR: asset.parsed?.mathir || asset.mathIR || null,
    }, limits));
  }
}

export async function buildReconstructableBundle({
  markdown = "",
  docxBytes,
  pdfBytes,
  assets = new Map(),
  reviewItems = [],
  qualityReport = {},
  baseName = "document",
  limits = RECONSTRUCTABLE_BUNDLE_LIMITS,
} = {}) {
  const files = {};
  assertSafeStructure(qualityReport, "Quality report", limits);
  addFile(files, "document.md", markdown, limits);
  if (docxBytes) addFile(files, "document.docx", docxBytes, limits);
  if (pdfBytes) addFile(files, "assets/originals/source-document.pdf", pdfBytes, limits);
  addJson(files, "quality-report.json", qualityReport, limits);

  const sourceAssets = new Map(
    semanticAssets(assets, []).filter((asset) => asset?.id).map((asset) => [String(asset.id), asset]),
  );
  const manifestAssets = [];
  const usedTokens = new Set();
  for (const asset of semanticAssets(assets, reviewItems)) {
    assertSafeStructure(asset, `Bundle asset ${asset?.id || "unknown"}`, limits);
    const baseToken = safeToken(asset.id);
    let token = baseToken;
    let suffix = 2;
    while (usedTokens.has(token)) token = `${baseToken}-${suffix++}`;
    usedTokens.add(token);
    const entry = semanticManifestEntry(asset, token);
    addSemanticFiles(files, entry, asset, sourceAssets, limits);
    manifestAssets.push(entry);
  }

  assertBundleResourceLimits(files, limits);
  const checksums = {};
  for (const path of Object.keys(files).sort()) {
    checksums[path] = {
      bytes: files[path].byteLength,
      sha256: await sha256(files[path]),
    };
  }
  for (const entry of manifestAssets) {
    const paths = [entry.source.assetPath, ...entry.reconstruction.paths].filter(Boolean);
    entry.checksums = Object.fromEntries(paths.map((path) => [path, checksums[path]]));
  }
  const manifest = {
    schema: RECONSTRUCTABLE_BUNDLE_SCHEMA,
    version: RECONSTRUCTABLE_BUNDLE_VERSION,
    exportName: safeToken(baseName, "document"),
    canonicalSource: "document.md",
    sourceDocument: pdfBytes ? "assets/originals/source-document.pdf" : null,
    files: checksums,
    assets: manifestAssets,
    import: {
      supported: true,
      note: "Browser import validates ZIP metadata, paths, resource ceilings, manifest checksums, and semantic assets before restoring the workspace.",
    },
  };
  addJson(files, "manifest.json", manifest, limits);
  assertBundleResourceLimits(files, limits);
  if (files["manifest.json"].byteLength > limits.maxManifestBytes) throw new RangeError("Bundle manifest exceeds the byte limit.");
  const zipInput = Object.fromEntries(Object.entries(files).map(([path, value]) => [path, Uint8Array.from(value)]));
  // fflate serializes DOS timestamps through local date components. Use a
  // midday local date inside the representable range so the timestamp remains
  // valid in every browser timezone while keeping the archive deterministic.
  const zipBytes = zipSync(zipInput, { level: 6, mtime: new Date(1980, 0, 2, 12, 0, 0) }).slice();
  return {
    blob: new Blob([zipBytes], { type: "application/zip" }),
    bytes: zipBytes,
    manifest,
  };
}

function validateManifestRecord(manifest, limits) {
  assertSafeStructure(manifest, "Bundle manifest", limits);
  if (manifest.schema !== RECONSTRUCTABLE_BUNDLE_SCHEMA || manifest.version !== RECONSTRUCTABLE_BUNDLE_VERSION) {
    throw new TypeError("Unsupported reconstructable bundle version.");
  }
  if (!isPlainObject(manifest.files)) throw new TypeError("Bundle manifest files must be a plain object.");
  if (manifest.canonicalSource !== undefined) assertSafeBundlePath(manifest.canonicalSource, limits);
  if (manifest.sourceDocument) assertSafeBundlePath(manifest.sourceDocument, limits);
  for (const [path, record] of Object.entries(manifest.files)) {
    assertSafeBundlePath(path, limits);
    if (!isPlainObject(record)) throw new TypeError(`Bundle checksum record is invalid: ${path}`);
    if (!Number.isInteger(record.bytes) || record.bytes < 0 || record.bytes > limits.maxEntryBytes) {
      throw new RangeError(`Bundle checksum byte count is invalid: ${path}`);
    }
    if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
      throw new TypeError(`Bundle checksum digest is invalid: ${path}`);
    }
  }
}

export async function validateReconstructableBundle(entries, { limits = RECONSTRUCTABLE_BUNDLE_LIMITS } = {}) {
  assertBundleResourceLimits(entries, limits);
  if (!entries["manifest.json"]) throw new TypeError("Bundle manifest is missing.");
  const manifestBytes = bytes(entries["manifest.json"]);
  if (manifestBytes.byteLength > limits.maxManifestBytes) throw new RangeError("Bundle manifest exceeds the byte limit.");
  let manifest;
  try {
    manifest = typeof entries["manifest.json"] === "string"
      ? JSON.parse(entries["manifest.json"])
      : JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    throw new TypeError(`Bundle manifest is not valid JSON: ${error?.message || String(error)}`);
  }
  validateManifestRecord(manifest, limits);
  const manifestPaths = new Set(Object.keys(manifest.files));
  if (manifestPaths.size > limits.maxEntries) throw new RangeError("Bundle manifest lists too many files.");
  for (const path of manifestPaths) {
    if (!entries[path]) throw new TypeError("Bundle file is missing: " + path);
  }
  for (const path of Object.keys(entries)) {
    assertSafeBundlePath(path, limits);
    if (path !== "manifest.json" && !manifestPaths.has(path)) throw new TypeError("Unlisted bundle file: " + path);
  }
  let declaredTotal = 0;
  for (const [path, record] of Object.entries(manifest.files)) {
    if (!entries[path]) throw new TypeError(`Bundle file is missing: ${path}`);
    const actual = bytes(entries[path]);
    declaredTotal += record.bytes;
    if (declaredTotal > limits.maxTotalBytes) throw new RangeError("Bundle manifest exceeds the aggregate decoded-byte limit.");
    if (actual.byteLength !== record.bytes || await sha256(actual) !== record.sha256) {
      throw new TypeError(`Bundle checksum mismatch: ${path}`);
    }
  }
  return manifest;
}
