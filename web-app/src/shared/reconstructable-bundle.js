import { strToU8, zipSync } from "fflate";
import { chartIRExportSidecars } from "./chart-rendering.js";
import { routeVisualOutput } from "./visual-rendering.js";

export const RECONSTRUCTABLE_BUNDLE_VERSION = 1;
export const RECONSTRUCTABLE_BUNDLE_SCHEMA = "glyphmend.reconstructable-bundle";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function jsonBytes(value) {
  return strToU8(JSON.stringify(stableValue(value), null, 2));
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

function addFile(files, path, value) {
  const next = bytes(value);
  if (files[path]) {
    const previous = files[path];
    if (previous.byteLength === next.byteLength && previous.every((part, index) => part === next[index])) return path;
    throw new Error(`Duplicate bundle path: ${path}`);
  }
  files[path] = next;
  return path;
}

function addJson(files, path, value) {
  return addFile(files, path, jsonBytes(value));
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Bundle checksums require Web Crypto support.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function sourceAssetFor(asset, sourceAssets) {
  const sourceId = sourceMetadata(asset).sourceAssetId;
  return sourceAssets.get(String(sourceId)) || (asset?.data ? asset : null);
}

function addSemanticFiles(files, entry, asset, sourceAssets) {
  const token = entry.fileToken;
  const sourceAsset = sourceAssetFor(asset, sourceAssets);
  if (sourceAsset?.data || sourceAsset?.svg) {
    const originalToken = safeToken(sourceAsset.id || token);
    const originalPath = `assets/originals/${originalToken}.${extensionFor(sourceAsset)}`;
    addFile(files, originalPath, sourceAsset.data || sourceAsset.svg);
    entry.source.assetPath = originalPath;
  }
  if (asset?.svg) {
    entry.reconstruction.paths.push(addFile(files, `assets/rendered/${token}.svg`, asset.svg));
  }
  if (asset?.visualIR) {
    entry.reconstruction.paths.push(addJson(files, `assets/reconstructed/${token}.visual.json`, asset.visualIR));
    if (asset.visualIR.mermaid) {
      entry.reconstruction.paths.push(addFile(files, "diagrams/" + token + ".mmd", asset.visualIR.mermaid));
    } else {
      try {
        const routed = routeVisualOutput(asset.visualIR);
        if (routed.format === "mermaid") entry.reconstruction.paths.push(addFile(files, "diagrams/" + token + ".mmd", routed.output));
        if (routed.format === "plantuml") entry.reconstruction.paths.push(addFile(files, "diagrams/" + token + ".puml", routed.output));
      } catch {
        // Ambiguous VisualIR remains in the semantic JSON/source tier.
      }
    }
  }
  if (asset?.chartIR) {
    entry.reconstruction.paths.push(addJson(files, `assets/reconstructed/${token}.chart.json`, asset.chartIR));
    try {
      const sidecars = chartIRExportSidecars(asset.chartIR);
      if (entry.disposition === "accepted") {
        addFile(files, `charts/${token}.vl.json`, sidecars.spec);
        addFile(files, `charts/${token}.csv`, sidecars.csv);
      }
    } catch {
      // Unsupported or weak charts remain in the semantic JSON/source tier.
    }
  }
  if (asset?.mermaid) entry.reconstruction.paths.push(addFile(files, `diagrams/${token}.mmd`, asset.mermaid));
  if (asset?.plantuml) entry.reconstruction.paths.push(addFile(files, `diagrams/${token}.puml`, asset.plantuml));
  const latex = asset?.candidate?.latex || asset?.latex;
  if (latex) entry.reconstruction.paths.push(addFile(files, `equations/${token}.tex`, latex));
  if (asset?.mathml) entry.reconstruction.paths.push(addFile(files, `equations/${token}.mathml`, asset.mathml));
  if (asset?.candidate || asset?.parsed?.mathir) {
    entry.reconstruction.paths.push(addJson(files, `assets/reconstructed/${token}.equation.json`, {
      candidate: asset.candidate || null,
      mathIR: asset.parsed?.mathir || asset.mathIR || null,
    }));
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
} = {}) {
  const files = {};
  addFile(files, "document.md", markdown);
  if (docxBytes) addFile(files, "document.docx", docxBytes);
  if (pdfBytes) addFile(files, "assets/originals/source-document.pdf", pdfBytes);
  addJson(files, "quality-report.json", qualityReport);

  const sourceAssets = new Map(
    semanticAssets(assets, []).filter((asset) => asset?.id).map((asset) => [String(asset.id), asset]),
  );
  const manifestAssets = [];
  const usedTokens = new Set();
  for (const asset of semanticAssets(assets, reviewItems)) {
    const baseToken = safeToken(asset.id);
    let token = baseToken;
    let suffix = 2;
    while (usedTokens.has(token)) token = `${baseToken}-${suffix++}`;
    usedTokens.add(token);
    const entry = semanticManifestEntry(asset, token);
    addSemanticFiles(files, entry, asset, sourceAssets);
    manifestAssets.push(entry);
  }

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
      supported: false,
      note: "ZIP bundle import is tracked separately from the existing JSON workspace checkpoint import.",
    },
  };
  addJson(files, "manifest.json", manifest);
  const zipInput = Object.fromEntries(Object.entries(files).map(([path, value]) => [path, Uint8Array.from(value)]));
  const zipBytes = zipSync(zipInput, { level: 6, mtime: new Date("1980-01-01T00:00:00Z") }).slice();
  return {
    blob: new Blob([zipBytes], { type: "application/zip" }),
    bytes: zipBytes,
    manifest,
  };
}

export async function validateReconstructableBundle(entries) {
  if (!isPlainObject(entries) || !entries["manifest.json"]) throw new TypeError("Bundle manifest is missing.");
  const manifest = typeof entries["manifest.json"] === "string"
    ? JSON.parse(entries["manifest.json"])
    : JSON.parse(new TextDecoder().decode(bytes(entries["manifest.json"])));
  if (manifest.schema !== RECONSTRUCTABLE_BUNDLE_SCHEMA || manifest.version !== RECONSTRUCTABLE_BUNDLE_VERSION) {
    throw new TypeError("Unsupported reconstructable bundle version.");
  }
  const manifestPaths = new Set(Object.keys(manifest.files || {}));
  for (const path of manifestPaths) {
    if (!path || path.startsWith("/") || path.includes("..")) throw new TypeError("Unsafe bundle path: " + path);
    if (!entries[path]) throw new TypeError("Bundle file is missing: " + path);
  }
  for (const path of Object.keys(entries)) {
    if (path !== "manifest.json" && !manifestPaths.has(path)) throw new TypeError("Unlisted bundle file: " + path);
  }
  for (const [path, record] of Object.entries(manifest.files || {})) {
    if (!entries[path]) throw new TypeError(`Bundle file is missing: ${path}`);
    const actual = bytes(entries[path]);
    if (actual.byteLength !== record.bytes || await sha256(actual) !== record.sha256) {
      throw new TypeError(`Bundle checksum mismatch: ${path}`);
    }
  }
  return manifest;
}
