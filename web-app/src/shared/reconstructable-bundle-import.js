import { unzipSync } from "fflate";
import {
  RECONSTRUCTABLE_BUNDLE_LIMITS,
  assertSafeBundlePath,
  validateReconstructableBundle,
} from "./reconstructable-bundle.js";
import { parseChartIR, parseMathIR, parseVisualIR } from "./semantic-ir.js";
import { sanitizeGeneratedSvgMarkup } from "./visual-rendering.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const DEFAULT_MAX_COMPRESSION_RATIO = 500;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const decoder = new TextDecoder();

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Reconstructable bundle input must be binary ZIP data.");
}

function safeJsonParse(text, label) {
  try {
    return JSON.parse(text, (key, value) => {
      if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${label} contains unsafe key ${key}.`);
      return value;
    });
  } catch (error) {
    if (error instanceof TypeError && /unsafe key/i.test(error.message)) throw error;
    throw new TypeError(`${label} is not valid JSON: ${error?.message || String(error)}`);
  }
}

function findEocd(data, view) {
  const minimum = Math.max(0, data.byteLength - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = data.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    if (offset + 22 > data.byteLength) continue;
    const disk = view.getUint16(offset + 4, true);
    const centralDisk = view.getUint16(offset + 6, true);
    const entriesOnDisk = view.getUint16(offset + 8, true);
    const entryCount = view.getUint16(offset + 10, true);
    const centralSize = view.getUint32(offset + 12, true);
    const centralOffset = view.getUint32(offset + 16, true);
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength !== data.byteLength) continue;
    if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) continue;
    if (centralOffset + centralSize !== offset || centralOffset > offset) continue;
    if (entryCount === 0 && centralSize !== 0) continue;
    if (entryCount > 0) {
      if (centralOffset + 46 > offset) continue;
      if (view.getUint32(centralOffset, true) !== CENTRAL_SIGNATURE) continue;
    }
    return offset;
  }
  throw new TypeError("ZIP end-of-central-directory record is missing or malformed.");
}

export function preflightReconstructableZip(
  input,
  {
    limits = RECONSTRUCTABLE_BUNDLE_LIMITS,
    maxCompressionRatio = DEFAULT_MAX_COMPRESSION_RATIO,
  } = {},
) {
  const data = toBytes(input);
  if (data.byteLength < 22) throw new TypeError("ZIP file is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(data, view);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new TypeError("Multi-disk ZIP bundles are not supported.");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new TypeError("ZIP64 bundles are not supported by the guarded importer.");
  }
  if (entryCount > limits.maxEntries) {
    throw new RangeError(`ZIP bundle exceeds the ${limits.maxEntries}-entry limit.`);
  }
  if (eocd + 22 + commentLength !== data.byteLength) throw new TypeError("ZIP comment is truncated or malformed.");
  if (centralOffset + centralSize !== eocd || centralOffset + centralSize > data.byteLength) {
    throw new TypeError("ZIP central directory is outside the archive bounds.");
  }

  const paths = new Set();
  let pointer = centralOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > centralOffset + centralSize) {
      throw new TypeError("ZIP central directory entry is truncated.");
    }
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) {
      throw new TypeError("ZIP central directory signature is invalid.");
    }
    const flags = view.getUint16(pointer + 8, true);
    const compression = view.getUint16(pointer + 10, true);
    const compressedBytes = view.getUint32(pointer + 20, true);
    const uncompressedBytes = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const entryCommentLength = view.getUint16(pointer + 32, true);
    const diskStart = view.getUint16(pointer + 34, true);
    const localHeaderOffset = view.getUint32(pointer + 42, true);
    const end = pointer + 46 + nameLength + extraLength + entryCommentLength;

    if (end > centralOffset + centralSize) throw new TypeError("ZIP central directory name/extra data is truncated.");
    if (flags & 0x1) throw new TypeError("Encrypted ZIP entries are not supported.");
    if (![0, 8].includes(compression)) throw new TypeError(`Unsupported ZIP compression method: ${compression}`);
    if (diskStart !== 0) throw new TypeError("Multi-disk ZIP entry is not supported.");
    if (
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new TypeError("ZIP64 entry metadata is not supported.");
    }
    if (localHeaderOffset >= centralOffset) throw new TypeError("ZIP local entry offset is invalid.");

    const path = decoder.decode(data.subarray(pointer + 46, pointer + 46 + nameLength));
    assertSafeBundlePath(path, limits);
    if (paths.has(path)) throw new TypeError(`Duplicate ZIP entry: ${path}`);
    paths.add(path);

    if (uncompressedBytes > limits.maxEntryBytes) {
      throw new RangeError(`ZIP entry exceeds the decoded-byte limit: ${path}`);
    }
    if (path === "manifest.json" && uncompressedBytes > limits.maxManifestBytes) {
      throw new RangeError("ZIP manifest exceeds the decoded-byte limit.");
    }
    if (uncompressedBytes > 0 && compressedBytes === 0) {
      throw new RangeError(`ZIP entry has an invalid compression ratio: ${path}`);
    }
    if (
      compressedBytes > 0 &&
      uncompressedBytes / compressedBytes > maxCompressionRatio
    ) {
      throw new RangeError(`ZIP entry exceeds the compression-ratio limit: ${path}`);
    }
    totalUncompressed += uncompressedBytes;
    totalCompressed += compressedBytes;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new RangeError("ZIP bundle exceeds the aggregate decoded-byte limit.");
    }
    pointer = end;
  }
  if (pointer !== centralOffset + centralSize) {
    throw new TypeError("ZIP central directory size does not match its entries.");
  }
  if (!paths.has("manifest.json")) throw new TypeError("ZIP bundle manifest is missing.");
  return {
    entryCount,
    totalCompressedBytes: totalCompressed,
    totalUncompressedBytes: totalUncompressed,
    paths: [...paths].sort(),
  };
}

function textEntry(entries, path) {
  return path && entries[path] ? decoder.decode(entries[path]) : null;
}

function mimeForPath(path = "") {
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.pdf$/i.test(path)) return "application/pdf";
  return "image/png";
}

function pageForEntry(entry) {
  const page = Number(entry?.source?.page);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function restoredAsset(entry, entries) {
  const sourcePath = entry?.source?.assetPath;
  const sourceBytes = sourcePath && entries[sourcePath] ? Uint8Array.from(entries[sourcePath]) : null;
  const asset = {
    id: String(entry?.source?.sourceAssetId || entry?.id || "source-asset"),
    kind: entry?.source?.sourceKind || entry?.kind || "source",
    page: pageForEntry(entry),
    bbox: Array.isArray(entry?.source?.bbox) ? [...entry.source.bbox] : [0, 0, 0, 0],
    confidence: entry?.confidence || { overall: 0 },
    disposition: entry?.disposition || "preserved",
  };
  if (sourcePath && sourceBytes) {
    asset.mimeType = mimeForPath(sourcePath);
    if (asset.mimeType === "image/svg+xml") {
      asset.svg = sanitizeGeneratedSvgMarkup(decoder.decode(sourceBytes));
    } else {
      asset.data = sourceBytes;
    }
  }

  for (const path of entry?.reconstruction?.paths || []) {
    if (!entries[path]) continue;
    if (/\.visual\.json$/i.test(path)) {
      asset.visualIR = parseVisualIR(textEntry(entries, path));
    } else if (/\.chart\.json$/i.test(path)) {
      asset.chartIR = parseChartIR(textEntry(entries, path));
    } else if (/\.svg$/i.test(path)) {
      asset.svg = sanitizeGeneratedSvgMarkup(textEntry(entries, path));
    } else if (/\.mathml$/i.test(path)) {
      asset.mathml = textEntry(entries, path);
    } else if (/\.equation\.json$/i.test(path)) {
      const equation = safeJsonParse(textEntry(entries, path), `Equation sidecar ${path}`);
      if (equation?.candidate && typeof equation.candidate === "object") asset.candidate = equation.candidate;
      if (equation?.mathIR) asset.mathIR = parseMathIR(equation.mathIR);
    }
  }
  return asset;
}

function restoredReviewItem(entry, asset, entries) {
  if (entry.kind !== "equation") return null;
  const paths = entry.reconstruction?.paths || [];
  const texPath = paths.find((path) => /\.tex$/i.test(path));
  const equationPath = paths.find((path) => /\.equation\.json$/i.test(path));
  if (!texPath && !equationPath && !asset.candidate?.latex) return null;
  const latex = texPath ? textEntry(entries, texPath) || "" : String(asset.candidate?.latex || "");
  const disposition = entry.disposition || "preserved";
  return {
    id: String(entry.id),
    page: pageForEntry(entry),
    kind: "equation",
    sourceAsset: {
      id: asset.id,
      page: asset.page,
      bbox: asset.bbox,
      kind: asset.kind,
      ...(asset.data ? { data: asset.data, mimeType: asset.mimeType } : {}),
    },
    candidate: {
      ...(asset.candidate || {}),
      id: String(entry.id),
      kind: "equation",
      latex,
      normalized: latex,
      provider: entry.provenance?.producer || asset.candidate?.provider || "bundle-import",
      version: entry.provenance?.version || asset.candidate?.version || "1",
      confidence: entry.confidence || asset.candidate?.confidence || { overall: 0 },
    },
    validation: {
      parseSuccess: disposition === "accepted",
      renderSuccess: disposition === "accepted",
      semanticEquivalent: disposition === "accepted",
      confidencePass: disposition === "accepted",
      mandatoryPassed: disposition === "accepted",
      sourcePreserved: true,
      notes: ["Restored from checksum-validated reconstructable bundle."],
    },
    confidence: entry.confidence || { overall: 0 },
    disposition,
    status: disposition,
  };
}

export async function importReconstructableBundle(
  input,
  { limits = RECONSTRUCTABLE_BUNDLE_LIMITS, maxCompressionRatio = DEFAULT_MAX_COMPRESSION_RATIO } = {},
) {
  const data = toBytes(input);
  const preflight = preflightReconstructableZip(data, { limits, maxCompressionRatio });
  let entries;
  try {
    entries = unzipSync(data);
  } catch (error) {
    throw new TypeError(`ZIP decompression failed: ${error?.message || String(error)}`);
  }
  const manifest = await validateReconstructableBundle(entries, { limits });
  const markdown = textEntry(entries, manifest.canonicalSource);
  if (markdown === null) throw new TypeError("Bundle canonical Markdown is missing.");

  let qualityReport = {};
  if (entries["quality-report.json"]) {
    qualityReport = safeJsonParse(textEntry(entries, "quality-report.json"), "Bundle quality report");
  }
  const assets = new Map();
  const reviewItems = [];
  for (const entry of manifest.assets || []) {
    const asset = restoredAsset(entry, entries);
    assets.set(String(entry.id), asset);
    const review = restoredReviewItem(entry, asset, entries);
    if (review) reviewItems.push(review);
  }
  const sourcePdf = manifest.sourceDocument && entries[manifest.sourceDocument]
    ? Uint8Array.from(entries[manifest.sourceDocument])
    : null;
  return { preflight, manifest, markdown, qualityReport, sourcePdf, assets, reviewItems };
}

export function reconstructableBundleToWorkspace(bundle) {
  const report = bundle.qualityReport || {};
  const document = report.document || {};
  const pages = {};
  const qualityByPage = new Map(
    (Array.isArray(report.pageQuality) ? report.pageQuality : [])
      .map((quality) => [Number(quality.page), quality]),
  );
  for (const asset of bundle.assets.values()) {
    const page = Number(asset.page) || 1;
    pages[page] ||= {
      page,
      text: "",
      bodySize: 0,
      assets: [],
      edges: { headers: [], footers: [] },
      quality: qualityByPage.get(page) || {},
      reviewItems: [],
    };
    pages[page].assets.push(asset);
  }
  for (const item of bundle.reviewItems) {
    const page = Number(item.page) || 1;
    pages[page] ||= {
      page,
      text: "",
      bodySize: 0,
      assets: [],
      edges: { headers: [], footers: [] },
      quality: qualityByPage.get(page) || {},
      reviewItems: [],
    };
    pages[page].reviewItems.push(item);
  }
  const inferredPages = Math.max(
    0,
    ...Object.keys(pages).map(Number),
    ...(bundle.manifest.assets || []).map(pageForEntry),
  );
  const pdfBytes = bundle.sourcePdf
    ? bundle.sourcePdf.buffer.slice(
        bundle.sourcePdf.byteOffset,
        bundle.sourcePdf.byteOffset + bundle.sourcePdf.byteLength,
      )
    : null;
  return {
    schema: 4,
    checkpointRevision: 1,
    reconstructionVersion: 1,
    extractionVersion: Number.isFinite(Number(report.extractionVersion))
      ? Number(report.extractionVersion)
      : -1,
    exportedAt: new Date().toISOString(),
    fileName: String(document.name || `${bundle.manifest.exportName || "document"}.pdf`),
    fileSize: Number(document.bytes) || bundle.sourcePdf?.byteLength || 0,
    pageCount: Number(document.pages) || inferredPages,
    pdfBytes,
    pages,
    markdown: bundle.markdown,
    options: report.options && typeof report.options === "object" ? report.options : {},
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    logs: Array.isArray(report.events) ? report.events : [],
    reviewQueue: bundle.reviewItems,
  };
}
