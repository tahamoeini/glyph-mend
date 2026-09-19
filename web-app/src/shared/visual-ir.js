import { assertSafeStructuredValue } from "./security-boundaries.js";

export const VISUAL_IR_SCHEMA = "glyphmend.visual-ir";
export const VISUAL_IR_SCHEMA_VERSION = 2;
export const CHART_IR_SCHEMA = "glyphmend.chart-ir";
export const CHART_IR_SCHEMA_VERSION = 2;

export const VISUAL_CLASSES = Object.freeze([
  "ordinary-image",
  "chart",
  "graph-flowchart",
  "diagram",
  "equation-image",
  "logo",
  "decoration",
  "separator",
  "background",
  "unresolved-visual",
]);

export const VISUAL_DISPOSITIONS = Object.freeze([
  "reconstructed",
  "reconstructed-with-source",
  "preserved-source",
  "needs-review",
  "unsupported",
  "omitted-decoration",
]);

const VISUAL_SOURCE_KINDS = new Set([
  "vector",
  "raster",
  "ocr",
  "mixed",
  "source-page",
  "source-crop",
  "unknown",
]);
const VISUAL_CLASS_SET = new Set(VISUAL_CLASSES);
const VISUAL_DISPOSITION_SET = new Set(VISUAL_DISPOSITIONS);
const MAX_VISUAL_TEXT = 256 * 1024;
const MAX_VISUAL_ITEMS = 8192;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneAndSort(value) {
  if (Array.isArray(value)) return value.map((item) => cloneAndSort(item));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = cloneAndSort(value[key]);
  return output;
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(cloneAndSort(value));
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite.`);
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new TypeError(`${label} must be a positive integer.`);
  return number;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  if (value.length > MAX_VISUAL_TEXT) throw new RangeError(`${label} exceeds the visual text limit.`);
  return value.trim();
}

function stringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new TypeError(`${label} must be an array of strings.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function bbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4)
    throw new TypeError(`${label} must be [x0, y0, x1, y1].`);
  const output = value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
  if (output[2] < output[0] || output[3] < output[1])
    throw new TypeError(`${label} must have non-negative width and height.`);
  return output;
}

function nullableScore(value, label) {
  if (value === null || value === undefined) return null;
  const score = finiteNumber(value, label);
  if (score < 0 || score > 1) throw new RangeError(`${label} must be between 0 and 1.`);
  return score;
}

function confidence(value, label, defaults = {}) {
  if (value !== undefined && !isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  const source = value || {};
  return {
    detection: nullableScore(source.detection ?? defaults.detection, `${label}.detection`),
    classification: nullableScore(source.classification ?? defaults.classification, `${label}.classification`),
    structure: nullableScore(source.structure ?? defaults.structure, `${label}.structure`),
    reconstruction: nullableScore(source.reconstruction ?? defaults.reconstruction, `${label}.reconstruction`),
    export: nullableScore(source.export ?? defaults.export, `${label}.export`),
  };
}

function sourceRefs(value, fallback = {}) {
  const source = value === undefined ? {} : value;
  if (!isPlainObject(source)) throw new TypeError("VisualIR.source must be an object.");
  const kind = String(source.kind || fallback.kind || "unknown");
  if (!VISUAL_SOURCE_KINDS.has(kind)) throw new TypeError(`VisualIR.source.kind is unsupported: ${kind}.`);
  const output = {
    kind,
    spanIds: stringArray(source.spanIds ?? fallback.spanIds, "VisualIR.source.spanIds"),
    objectIds: stringArray(source.objectIds ?? fallback.objectIds, "VisualIR.source.objectIds"),
    cropIds: stringArray(source.cropIds ?? fallback.cropIds, "VisualIR.source.cropIds"),
  };
  for (const key of ["assetId", "pageId", "checksum", "format"]) {
    if (source[key] !== undefined) output[key] = nonEmptyString(String(source[key]), `VisualIR.source.${key}`);
    else if (fallback[key] !== undefined) output[key] = nonEmptyString(String(fallback[key]), `VisualIR.source.${key}`);
  }
  if (source.provenance !== undefined) {
    if (!isPlainObject(source.provenance)) throw new TypeError("VisualIR.source.provenance must be an object.");
    output.provenance = cloneAndSort(source.provenance);
  }
  return output;
}

function diagnostics(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value.map((item, index) => {
    if (!isPlainObject(item)) throw new TypeError(`${label}[${index}] must be an object.`);
    const severity = String(item.severity || "warning");
    if (!["info", "warning", "error"].includes(severity))
      throw new TypeError(`${label}[${index}].severity is unsupported.`);
    return {
      ...cloneAndSort(item),
      code: nonEmptyString(String(item.code || "visual-diagnostic"), `${label}[${index}].code`),
      severity,
      message: nonEmptyString(String(item.message || ""), `${label}[${index}].message`),
    };
  });
}

function normalizeContent(value, label = "VisualIR.content") {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  const output = cloneAndSort(value);
  const count = ["nodes", "edges", "labels", "shapes"].reduce(
    (total, key) => total + (Array.isArray(output[key]) ? output[key].length : 0),
    0,
  );
  if (count > MAX_VISUAL_ITEMS) throw new RangeError(`${label} exceeds the visual item limit.`);
  return output;
}

function hash32(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stableVisualId(input = {}) {
  const page = Number(input.page || 1);
  const box = Array.isArray(input.bbox) ? input.bbox.map(Number) : [0, 0, 0, 0];
  const refs = input.source || {};
  const fingerprint = canonicalJson({
    page,
    bbox: box,
    class: input.class || input.kind || "unresolved-visual",
    sourceKind: refs.kind || input.sourceKind || "unknown",
    spanIds: refs.spanIds || input.spanIds || [],
    objectIds: refs.objectIds || input.objectIds || [],
    cropIds: refs.cropIds || input.cropIds || [],
    assetId: refs.assetId || input.assetId || "",
  });
  return `visual-p${Number.isInteger(page) && page > 0 ? page : 1}-${hash32(fingerprint)}`;
}

function normalizeVisualInput(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("VisualIR must be an object.");
  assertSafeStructuredValue(input, "VisualIR");
  const page = positiveInteger(input.page, "VisualIR.page");
  if (input.class !== undefined && !VISUAL_CLASS_SET.has(input.class))
    throw new TypeError(`VisualIR.class is unsupported: ${input.class}.`);
  if (input.disposition !== undefined && !VISUAL_DISPOSITION_SET.has(input.disposition))
    throw new TypeError(`VisualIR.disposition is unsupported: ${input.disposition}.`);
  const output = {
    schema: VISUAL_IR_SCHEMA,
    schemaVersion: VISUAL_IR_SCHEMA_VERSION,
    id: nonEmptyString(String(input.id || stableVisualId(input)), "VisualIR.id"),
    class: input.class || "unresolved-visual",
    page,
    bbox: bbox(input.bbox, "VisualIR.bbox"),
    coordinateSpace: nonEmptyString(String(input.coordinateSpace || "page-points"), "VisualIR.coordinateSpace"),
    source: sourceRefs(input.source, {
      kind: input.sourceKind,
      assetId: input.assetId,
      spanIds: input.spanIds,
      objectIds: input.objectIds,
      cropIds: input.cropIds,
    }),
    content: normalizeContent(input.content),
    confidence: confidence(input.confidence, "VisualIR.confidence"),
    disposition: input.disposition || "preserved-source",
    reconstructionVersion: positiveInteger(input.reconstructionVersion || 1, "VisualIR.reconstructionVersion"),
    reconstructionMetadata: isPlainObject(input.reconstructionMetadata)
      ? cloneAndSort(input.reconstructionMetadata)
      : {},
    warnings: stringArray(input.warnings, "VisualIR.warnings"),
    diagnostics: diagnostics(input.diagnostics, "VisualIR.diagnostics"),
  };
  if (input.children !== undefined) output.children = stringArray(input.children, "VisualIR.children");
  if (input.sourceAsset !== undefined) {
    if (!isPlainObject(input.sourceAsset)) throw new TypeError("VisualIR.sourceAsset must be an object.");
    output.sourceAsset = cloneAndSort(input.sourceAsset);
  }
  if (input.chartIR !== undefined) output.chartIR = validateChartIR(input.chartIR);
  return freezeDeep(cloneAndSort(output));
}

export function createVisualIR(input = {}) {
  return normalizeVisualInput({
    page: input.page || 1,
    bbox: input.bbox || [0, 0, 0, 0],
    ...input,
  });
}

export function validateVisualIR(value) {
  if (typeof value === "string") {
    if (value.length > MAX_VISUAL_TEXT) throw new RangeError("VisualIR JSON exceeds the visual text limit.");
    value = JSON.parse(value);
  }
  if (!isPlainObject(value) || value.schema !== VISUAL_IR_SCHEMA || Number(value.schemaVersion) !== VISUAL_IR_SCHEMA_VERSION)
    throw new TypeError("VisualIR must use glyphmend.visual-ir schema version 2.");
  return normalizeVisualInput(value);
}

export function serializeVisualIR(value) {
  return canonicalJson(validateVisualIR(value));
}

export function deserializeVisualIR(value) {
  return validateVisualIR(value);
}

export function compareVisualIR(left, right) {
  return serializeVisualIR(left) === serializeVisualIR(right);
}

function normalizeChartData(value) {
  if (!isPlainObject(value)) throw new TypeError("ChartIR.data must be an object.");
  const output = cloneAndSort(value);
  if (output.fields !== undefined && !Array.isArray(output.fields)) throw new TypeError("ChartIR.data.fields must be an array.");
  if (output.rows !== undefined && !Array.isArray(output.rows)) throw new TypeError("ChartIR.data.rows must be an array.");
  if (output.values !== undefined && !Array.isArray(output.values)) throw new TypeError("ChartIR.data.values must be an array.");
  if (!output.fields && !output.rows && !output.values)
    throw new TypeError("ChartIR.data must include fields, rows, or values recovered from evidence.");
  return output;
}

function normalizeChartInput(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("ChartIR must be an object.");
  assertSafeStructuredValue(input, "ChartIR");
  const base = normalizeVisualInput({
    ...input,
    class: "chart",
    source: input.source || {},
  });
  if (!Array.isArray(input.marks) || input.marks.length === 0)
    throw new TypeError("ChartIR.marks must be a non-empty array.");
  if (!isPlainObject(input.encoding)) throw new TypeError("ChartIR.encoding must be an object.");
  return freezeDeep(cloneAndSort({
    schema: CHART_IR_SCHEMA,
    schemaVersion: CHART_IR_SCHEMA_VERSION,
    id: base.id,
    page: base.page,
    bbox: base.bbox,
    coordinateSpace: base.coordinateSpace,
    source: base.source,
    data: normalizeChartData(input.data),
    marks: cloneAndSort(input.marks),
    encoding: cloneAndSort(input.encoding),
    geometry: input.geometry === undefined ? undefined : cloneAndSort(input.geometry),
    confidence: base.confidence,
    disposition: base.disposition,
    reconstructionVersion: base.reconstructionVersion,
    reconstructionMetadata: base.reconstructionMetadata,
    warnings: base.warnings,
    diagnostics: base.diagnostics,
  }));
}

export function createChartIR(input = {}) {
  return normalizeChartInput({
    page: input.page || 1,
    bbox: input.bbox || [0, 0, 0, 0],
    ...input,
  });
}

export function validateChartIR(value) {
  if (typeof value === "string") {
    if (value.length > MAX_VISUAL_TEXT) throw new RangeError("ChartIR JSON exceeds the visual text limit.");
    value = JSON.parse(value);
  }
  if (!isPlainObject(value) || value.schema !== CHART_IR_SCHEMA || Number(value.schemaVersion) !== CHART_IR_SCHEMA_VERSION)
    throw new TypeError("ChartIR must use glyphmend.chart-ir schema version 2.");
  return normalizeChartInput(value);
}

export function serializeChartIR(value) {
  return canonicalJson(validateChartIR(value));
}

export function deserializeChartIR(value) {
  return validateChartIR(value);
}

export function compareChartIR(left, right) {
  return serializeChartIR(left) === serializeChartIR(right);
}

export function chartIRToLegacyChartIR(value) {
  const parsed = validateChartIR(value);
  const scores = Object.values(parsed.confidence).filter((item) => typeof item === "number");
  const disposition = parsed.disposition === "needs-review" ? "review" : parsed.disposition === "preserved-source" || parsed.disposition === "unsupported" ? "preserved" : "accepted";
  return {
    schemaVersion: 1,
    id: parsed.id,
    kind: "chart",
    data: parsed.data,
    marks: parsed.marks,
    encoding: parsed.encoding,
    ...(parsed.geometry ? { geometry: parsed.geometry } : { geometry: { bbox: parsed.bbox } }),
    provenance: {
      producer: "chart-ir-v2-adapter",
      page: parsed.page,
      bbox: parsed.bbox,
      source: parsed.source,
      reconstructionMetadata: parsed.reconstructionMetadata,
    },
    confidence: {
      ...parsed.confidence,
      overall: scores.length ? Math.min(...scores) : 0,
    },
    disposition,
    warnings: parsed.warnings,
    errors: parsed.diagnostics.filter((item) => item.severity === "error").map((item) => item.message),
  };
}

function classFromLegacyKind(kind) {
  const value = String(kind || "").toLowerCase();
  if (value === "flowchart" || value === "graph") return "graph-flowchart";
  if (value === "chart") return "chart";
  if (value === "equation" || value === "equation-image") return "equation-image";
  if (value === "image" || value === "photo" || value === "illustration") return "ordinary-image";
  if (value === "logo") return "logo";
  if (value === "decoration") return "decoration";
  if (value === "separator") return "separator";
  if (value === "background" || value === "source-page") return "background";
  return "diagram";
}

function dispositionFromLegacy(value) {
  if (value === "accepted") return "reconstructed-with-source";
  if (value === "review") return "needs-review";
  return "preserved-source";
}

function legacyConfidence(value = {}) {
  const overall = value.overall ?? value.quality ?? null;
  return confidence({
    detection: value.detection ?? value.recognition ?? overall,
    classification: value.classification ?? value.structural ?? overall,
    structure: value.structure ?? value.structural ?? value.topology ?? overall,
    reconstruction: value.reconstruction ?? value.nodeAccuracy ?? null,
    export: value.export ?? null,
  });
}

export function legacyVisualIRToV2(value, context = {}) {
  if (isPlainObject(value) && value.schema === VISUAL_IR_SCHEMA && Number(value.schemaVersion) === VISUAL_IR_SCHEMA_VERSION)
    return validateVisualIR(value);
  if (!isPlainObject(value)) throw new TypeError("Legacy VisualIR must be an object.");
  const page = Number(value.page || value.candidate?.page || context.page || 1);
  const sourceKind = value.sourceType || value.candidate?.sourceType || context.sourceKind || "unknown";
  const legacyBox = value.geometry?.bbox || value.bbox || value.candidate?.bbox || context.bbox || [0, 0, 0, 0];
  const source = {
    kind: sourceKind === "pdf-page" ? "source-page" : sourceKind,
    assetId: context.assetId || value.sourceAsset?.id,
    spanIds: value.provenance?.spanIds || value.spanIds || [],
    objectIds: value.provenance?.objectIds || value.objectIds || [],
    cropIds: context.cropIds || value.provenance?.cropIds || [],
  };
  const content = {
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    edges: Array.isArray(value.edges) ? value.edges : [],
    ...(Array.isArray(value.labels) ? { labels: value.labels } : {}),
    ...(Array.isArray(value.shapes) ? { shapes: value.shapes } : {}),
    ...(value.geometry ? { geometry: value.geometry } : {}),
    ...(value.styles ? { styles: value.styles } : {}),
  };
  return createVisualIR({
    schema: VISUAL_IR_SCHEMA,
    schemaVersion: VISUAL_IR_SCHEMA_VERSION,
    id: value.id || stableVisualId({ page, bbox: legacyBox, kind: value.kind, source }),
    class: classFromLegacyKind(value.kind),
    page,
    bbox: legacyBox,
    coordinateSpace: context.coordinateSpace || "page-points",
    source,
    content,
    confidence: legacyConfidence(value.confidence),
    disposition: dispositionFromLegacy(value.disposition),
    reconstructionVersion: value.reconstructionVersion || 1,
    reconstructionMetadata: {
      adapter: "legacy-visual-ir-v1",
      producer: value.provenance?.producer || "unknown",
      ...(value.provenance ? { legacyProvenance: value.provenance } : {}),
    },
    warnings: value.warnings || [],
    diagnostics: value.provenance?.diagnostics || [],
    ...(value.sourceAsset ? { sourceAsset: value.sourceAsset } : {}),
  });
}

function legacyKind(value) {
  return {
    "graph-flowchart": "flowchart",
    "ordinary-image": "image",
    "equation-image": "equation",
    "unresolved-visual": "unknown",
  }[value] || value;
}

function legacyOverall(confidenceValue) {
  const scores = Object.values(confidenceValue).filter((value) => typeof value === "number");
  return scores.length ? Math.min(...scores) : 0;
}

export function visualIRToLegacyVisualIR(value) {
  const parsed = validateVisualIR(value);
  const content = parsed.content || {};
  const legacyDisposition = parsed.disposition === "needs-review" ? "review" : parsed.disposition === "preserved-source" || parsed.disposition === "unsupported" ? "preserved" : "accepted";
  const legacy = {
    schemaVersion: 1,
    id: parsed.id,
    kind: legacyKind(parsed.class),
    page: parsed.page,
    nodes: Array.isArray(content.nodes) ? content.nodes : [],
    edges: Array.isArray(content.edges) ? content.edges : [],
    ...(Array.isArray(content.labels) ? { labels: content.labels } : {}),
    ...(Array.isArray(content.shapes) ? { shapes: content.shapes } : {}),
    ...(content.geometry ? { geometry: content.geometry } : { geometry: { bbox: parsed.bbox } }),
    ...(content.styles ? { styles: content.styles } : {}),
    provenance: {
      producer: "visual-ir-v2-adapter",
      source: parsed.source.kind,
      page: parsed.page,
      bbox: parsed.bbox,
      sourceRefs: parsed.source,
      reconstructionMetadata: parsed.reconstructionMetadata,
    },
    confidence: {
      ...parsed.confidence,
      overall: legacyOverall(parsed.confidence),
    },
    disposition: legacyDisposition,
    warnings: parsed.warnings,
    errors: parsed.diagnostics.filter((item) => item.severity === "error").map((item) => item.message),
  };
  return legacy;
}

function hintText(input) {
  return [input.classHint, input.kind, input.caption, input.text, input.alt].filter(Boolean).join(" ").toLowerCase();
}

function vectorEvidence(vectors = []) {
  const list = Array.isArray(vectors) ? vectors : [];
  const nodes = list.filter((item) => /node|shape|box|rect|ellipse|diamond|closed/i.test(String(item?.kind || item?.type || "")) || item?.flags?.filled === true);
  const edges = list.filter((item) => /edge|connector|arrow|line|path/i.test(String(item?.kind || item?.type || "")) || item?.flags?.stroked === true);
  const rules = list.filter((item) => {
    if (/rule|separator|line/i.test(String(item?.kind || item?.type || ""))) return true;
    const box = Array.isArray(item?.bbox) ? item.bbox.map(Number) : [];
    const width = box[2] - box[0];
    const height = box[3] - box[1];
    return Number.isFinite(width) && Number.isFinite(height) && (height <= 3 || width <= 3);
  });
  return { list, nodes, edges, rules };
}

function cropIdsFor(input) {
  return input.source?.cropIds || input.sourceCropIds || (input.cropId ? [input.cropId] : []);
}

function classificationDisposition(visualClass, score, hasSource) {
  if (["decoration", "separator", "background"].includes(visualClass) && score >= 0.9)
    return "omitted-decoration";
  if (visualClass === "graph-flowchart" && score >= 0.86 && hasSource) return "reconstructed-with-source";
  if (visualClass === "chart" && score >= 0.86 && hasSource) return "reconstructed-with-source";
  return "preserved-source";
}

/**
 * Classify evidence without recognizing pixels or inventing semantics. Vector
 * primitives are considered before raster hints; uncertain content remains a
 * source-preserved visual with diagnostics.
 */
export function classifyVisualEvidence(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("Visual evidence must be an object.");
  const vectors = vectorEvidence(input.vectors);
  const images = Array.isArray(input.images) ? input.images : [];
  const page = positiveInteger(input.page || 1, "Visual evidence.page");
  const box = bbox(input.bbox || [0, 0, 0, 0], "Visual evidence.bbox");
  const area = Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
  const pageArea = Math.max(1, Number(input.pageArea) || area || 1);
  const hints = hintText(input);
  const explicit = VISUAL_CLASS_SET.has(input.classHint) ? input.classHint : null;
  let visualClass = explicit;
  const warnings = [];
  let detection = input.detectionConfidence ?? (vectors.list.length || images.length ? 0.82 : 0.3);
  let classification = explicit ? 0.95 : 0.46;
  let structure = null;
  let reconstruction = null;
  const hasSource = Boolean(input.assetId || input.source?.assetId || input.cropId || cropIdsFor(input).length);
  const graphCandidate = input.candidate || input.content || {};
  const candidateNodes = Array.isArray(graphCandidate.nodes) ? graphCandidate.nodes : [];
  const candidateEdges = Array.isArray(graphCandidate.edges) ? graphCandidate.edges : [];
  const graphEvidence = candidateNodes.length >= 2 && candidateEdges.length >= 1 && input.ambiguous !== true;
  const explicitDecoration = /(?:^|\b)(?:decoration|separator|background)(?:\b|$)/i.test(hints);
  const chartHint = /\b(?:chart|plot|histogram|bar chart|line chart|scatter plot)\b/i.test(hints);
  const diagramHint = /\b(?:diagram|flowchart|schematic|workflow)\b/i.test(hints);
  const equationHint = /\b(?:equation|formula|math|mathematical)\b/i.test(hints);
  const logoHint = /\blogo\b/i.test(hints);

  if (!visualClass && input.sourceKind === "source-page") visualClass = "background";
  if (!visualClass && explicitDecoration && /separator/i.test(hints)) visualClass = "separator";
  if (!visualClass && explicitDecoration && /background/i.test(hints)) visualClass = "background";
  if (!visualClass && explicitDecoration && /decoration/i.test(hints)) visualClass = "decoration";
  if (!visualClass && logoHint) visualClass = "logo";
  if (!visualClass && equationHint && images.length) visualClass = "equation-image";
  if (!visualClass && chartHint) visualClass = "chart";
  if (!visualClass && diagramHint && images.length) visualClass = "diagram";
  if (!visualClass && graphEvidence) visualClass = "graph-flowchart";
  if (!visualClass && vectors.nodes.length >= 2) visualClass = "diagram";
  if (!visualClass && images.length) visualClass = "ordinary-image";
  if (!visualClass && vectors.rules.length && (box[2] - box[0] > (box[3] - box[1]) * 8 || box[3] - box[1] < 4)) visualClass = "separator";
  if (!visualClass) visualClass = "unresolved-visual";

  if (visualClass === "graph-flowchart") {
    structure = graphEvidence || (vectors.nodes.length >= 2 && vectors.edges.length >= 1) ? 0.88 : 0.42;
    classification = graphEvidence ? 0.91 : 0.7;
    reconstruction = structure >= 0.86 ? 0.86 : null;
    if (structure < 0.86) warnings.push("Vector topology is incomplete or ambiguous; source visual retained.");
  } else if (visualClass === "chart") {
    const chart = input.chartIR ? validateChartIR(input.chartIR) : null;
    if (chart) {
      structure = chart.confidence.structure;
      reconstruction = chart.confidence.reconstruction;
    } else {
      structure = 0.25;
      warnings.push("Chart-like evidence has no validated data and encoding contract; values were not reconstructed.");
    }
    classification = chartHint || input.classHint === "chart" ? 0.9 : 0.72;
  } else if (["ordinary-image", "equation-image", "logo"].includes(visualClass)) {
    structure = 0.92;
    classification = explicit || logoHint || equationHint ? 0.9 : 0.78;
  } else if (["decoration", "separator", "background"].includes(visualClass)) {
    structure = explicitDecoration || input.sourceKind === "source-page" ? 0.93 : 0.65;
    classification = explicitDecoration || input.sourceKind === "source-page" ? 0.94 : 0.58;
    if (classification < 0.9) warnings.push("Decoration classification is not reliable enough to omit.");
  } else if (visualClass === "diagram") {
    structure = vectors.nodes.length >= 2 ? 0.56 : 0.3;
    warnings.push("Diagram structure is not sufficiently evidenced for editable reconstruction.");
  } else {
    structure = 0.2;
    warnings.push("Visual class is unresolved; original source evidence is retained.");
  }

  const visualSource = {
    kind: input.source?.kind || input.sourceKind || (vectors.list.length ? "vector" : images.length ? "raster" : "unknown"),
    assetId: input.source?.assetId || input.assetId,
    spanIds: input.source?.spanIds || input.sourceSpanIds || [],
    objectIds: input.source?.objectIds || input.sourceObjectIds || [],
    cropIds: cropIdsFor(input),
  };
  const content = {
    ...(Array.isArray(graphCandidate.nodes) ? { nodes: graphCandidate.nodes } : {}),
    ...(Array.isArray(graphCandidate.edges) ? { edges: graphCandidate.edges } : {}),
    ...(Array.isArray(graphCandidate.labels) ? { labels: graphCandidate.labels } : {}),
    ...(Array.isArray(graphCandidate.shapes) ? { shapes: graphCandidate.shapes } : {}),
  };
  const chartIR = input.chartIR ? validateChartIR(input.chartIR) : undefined;
  if (chartIR) content.chartIR = chartIR;
  if (visualClass === "chart" && !chartIR) content.sourceOnly = true;
  const sourceAsset = input.sourceAsset || {
    assetId: visualSource.assetId || undefined,
    cropIds: visualSource.cropIds,
    preserved: true,
  };
  return createVisualIR({
    id: input.id || stableVisualId({ page, bbox: box, class: visualClass, source: visualSource }),
    class: visualClass,
    page,
    bbox: box,
    coordinateSpace: input.coordinateSpace || "page-points",
    source: visualSource,
    sourceAsset,
    content,
    chartIR,
    confidence: {
      detection,
      classification,
      structure,
      reconstruction,
      export: hasSource ? 0.94 : 0.35,
    },
    disposition: classificationDisposition(visualClass, Math.min(Number(classification) || 0, Number(structure) || 0), hasSource),
    reconstructionVersion: 2,
    reconstructionMetadata: {
      strategy: "vector-first",
      recognizer: "deterministic-visual-classifier",
      sourcePreserved: true,
    },
    warnings,
    diagnostics: [
      {
        code: "visual-classification",
        severity: warnings.length ? "warning" : "info",
        message: `Classified as ${visualClass} using deterministic evidence.`,
        details: {
          vectorCount: vectors.list.length,
          vectorNodeCount: vectors.nodes.length,
          vectorEdgeCount: vectors.edges.length,
          imageCount: images.length,
          pageAreaRatio: area / pageArea,
        },
      },
    ],
  });
}

export function validateUntrustedVisualSource(value, format = "text") {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Generated visual source must be non-empty text.");
  if (value.length > 256 * 1024) throw new RangeError("Generated visual source exceeds the 256 KiB limit.");
  if (/\b(?:javascript|vbscript|file|data):/i.test(value) || /<script\b|<foreignObject\b|\bon[a-z]+\s*=/i.test(value))
    throw new TypeError(`Unsafe ${format} visual source rejected.`);
  if (/!include\b|!pragma\b|@import\b|https?:\/\//i.test(value))
    throw new TypeError(`External ${format} visual source is not allowed.`);
  return value;
}
