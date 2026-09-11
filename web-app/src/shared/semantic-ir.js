import { assertSafeStructuredValue } from "./security-boundaries.js";

const RECONSTRUCTED_ASSET_SCHEMA_VERSION = 1;
const MATH_IR_SCHEMA_VERSION = 1;
const VISUAL_IR_SCHEMA_VERSION = 1;
const CHART_IR_SCHEMA_VERSION = 1;
const MAX_IR_JSON_CHARS = 16 * 1024 * 1024;

const DEFAULT_POLICY_THRESHOLDS = Object.freeze({
  accept: 0.82,
  review: 0.55,
});
const VALIDATION_EVIDENCE_LEVELS = new Set(["high", "medium", "low", "missing"]);
const DEFAULT_RECONSTRUCTION_VERSION = 1;

const RECONSTRUCTED_ASSET_KINDS = new Set([
  "equation",
  "flowchart",
  "diagram",
  "chart",
  "illustration",
  "photo",
  "unknown",
]);
const SOURCE_TYPES = new Set(["vector", "raster", "mixed"]);
const DISPOSITIONS = new Set(["accepted", "review", "preserved"]);

/**
 * @typedef {Object} ReconstructedAsset
 * @property {number} schemaVersion
 * @property {string} id
 * @property {number} page
 * @property {[number, number, number, number]} bbox
 * @property {string} kind
 * @property {string} sourceType
 * @property {Object} sourceAsset
 * @property {{ format: string, source: Object }} reconstruction
 * @property {Object<string, number>} confidence
 * @property {Object} provenance
 * @property {"accepted"|"review"|"preserved"} disposition
 * @property {string[]=} warnings
 * @property {string[]=} errors
 */

/**
 * @typedef {Object} MathIR
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} kind
 * @property {string} rootId
 * @property {Array<Object>} nodes
 * @property {Object} provenance
 * @property {Object<string, number>} confidence
 * @property {"accepted"|"review"|"preserved"} disposition
 * @property {string[]=} warnings
 * @property {string[]=} errors
 */

/**
 * @typedef {Object} VisualIR
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} kind
 * @property {Array<Object>} nodes
 * @property {Array<Object>} edges
 * @property {Array<Object>=} labels
 * @property {Object=} geometry
 * @property {Array<Object>=} shapes
 * @property {Object=} styles
 * @property {Object} provenance
 * @property {Object<string, number>} confidence
 * @property {"accepted"|"review"|"preserved"} disposition
 * @property {string[]=} warnings
 * @property {string[]=} errors
 */

/**
 * @typedef {Object} ChartIR
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} kind
 * @property {Object} data
 * @property {Array<Object>} marks
 * @property {Object} encoding
 * @property {Object=} geometry
 * @property {Object} provenance
 * @property {Object<string, number>} confidence
 * @property {"accepted"|"review"|"preserved"} disposition
 * @property {string[]=} warnings
 * @property {string[]=} errors
 */

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepNormalize(value) {
  if (Array.isArray(value)) return value.map((item) => deepNormalize(item));
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = deepNormalize(value[key]);
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(deepNormalize(value));
}

function parseJson(value, name) {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > MAX_IR_JSON_CHARS)
      throw new RangeError(`${name} JSON exceeds the ${MAX_IR_JSON_CHARS}-character limit.`);
    parsed = JSON.parse(value);
  }
  if (!isPlainObject(parsed)) throw new TypeError(`${name} must be a JSON object or JSON text.`);
  assertSafeStructuredValue(parsed, name);
  return parsed;
}

function requiredObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty.`);
  return text;
}

function optionalStringArray(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new TypeError(`${label} must be an array of strings.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function requiredFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function requiredPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new TypeError(`${label} must be a positive integer.`);
  return number;
}

function requiredBBox(value, label) {
  if (!Array.isArray(value) || value.length !== 4)
    throw new TypeError(`${label} must be a 4-item bounding box.`);
  return value.map((item, index) => requiredFiniteNumber(item, `${label}[${index}]`));
}

function requiredEnum(value, allowed, label) {
  const text = requiredString(value, label);
  if (!allowed.has(text)) throw new TypeError(`${label} must be one of: ${[...allowed].join(", ")}.`);
  return text;
}

function requiredStringMap(value, label) {
  const object = requiredObject(value, label);
  const out = {};
  for (const [key, item] of Object.entries(object)) {
    out[key] = requiredFiniteNumber(item, `${label}.${key}`);
  }
  return out;
}

function normalizeConfidenceComponents(value, label) {
  const components = requiredStringMap(value, label);
  return Object.fromEntries(
    Object.entries(components).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeEvidence(value, label) {
  const evidence = requiredObject(value, label);
  const out = cloneUnknownFields(evidence, new Set(["level"]));
  out.level = requiredEnum(evidence.level, VALIDATION_EVIDENCE_LEVELS, `${label}.level`);
  if (evidence.notes !== undefined) {
    if (!Array.isArray(evidence.notes) || !evidence.notes.every((item) => typeof item === "string"))
      throw new TypeError(`${label}.notes must be an array of strings.`);
    out.notes = evidence.notes.map((item) => item.trim()).filter(Boolean);
  }
  if (evidence.sources !== undefined) {
    if (!Array.isArray(evidence.sources)) throw new TypeError(`${label}.sources must be an array.`);
    out.sources = evidence.sources.map((source, index) => {
      const item = requiredObject(source, `${label}.sources[${index}]`);
      const entry = cloneUnknownFields(item, new Set(["kind", "value"]));
      entry.kind = requiredString(item.kind, `${label}.sources[${index}].kind`);
      entry.value = requiredString(item.value, `${label}.sources[${index}].value`);
      if (item.href !== undefined) entry.href = requiredString(item.href, `${label}.sources[${index}].href`);
      return entry;
    });
  }
  return out;
}

function normalizeRecognizer(value, label) {
  const recognizer = requiredObject(value, label);
  const out = cloneUnknownFields(recognizer, new Set(["name"]));
  out.name = requiredString(recognizer.name, `${label}.name`);
  if (recognizer.version !== undefined) out.version = requiredString(recognizer.version, `${label}.version`);
  if (recognizer.modelHash !== undefined)
    out.modelHash = requiredString(recognizer.modelHash, `${label}.modelHash`);
  if (recognizer.preprocessVersion !== undefined)
    out.preprocessVersion = requiredString(recognizer.preprocessVersion, `${label}.preprocessVersion`);
  return out;
}

function cloneUnknownFields(source, knownKeys) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!knownKeys.has(key)) out[key] = deepNormalize(value);
  }
  return out;
}

function normalizeSourceAsset(value) {
  const source = requiredObject(value, "ReconstructedAsset.sourceAsset");
  const out = cloneUnknownFields(source, new Set(["id", "page", "bbox"]));
  out.id = requiredString(source.id, "ReconstructedAsset.sourceAsset.id");
  if (source.kind !== undefined) out.kind = requiredString(source.kind, "ReconstructedAsset.sourceAsset.kind");
  if (source.page !== undefined)
    out.page = requiredPositiveInteger(source.page, "ReconstructedAsset.sourceAsset.page");
  if (source.bbox !== undefined)
    out.bbox = requiredBBox(source.bbox, "ReconstructedAsset.sourceAsset.bbox");
  if (source.href !== undefined) out.href = requiredString(source.href, "ReconstructedAsset.sourceAsset.href");
  if (source.checksum !== undefined)
    out.checksum = requiredString(source.checksum, "ReconstructedAsset.sourceAsset.checksum");
  return out;
}

function normalizeReconstruction(value) {
  const reconstruction = requiredObject(value, "ReconstructedAsset.reconstruction");
  const out = cloneUnknownFields(reconstruction, new Set(["format", "source"]));
  out.format = requiredString(reconstruction.format, "ReconstructedAsset.reconstruction.format");
  out.source = requiredObject(reconstruction.source, "ReconstructedAsset.reconstruction.source");
  out.source = cloneUnknownFields(reconstruction.source, new Set(["kind"]));
  out.source.kind = requiredString(reconstruction.source.kind, "ReconstructedAsset.reconstruction.source.kind");
  if (reconstruction.source.recognizer !== undefined)
    out.source.recognizer = normalizeRecognizer(
      reconstruction.source.recognizer,
      "ReconstructedAsset.reconstruction.source.recognizer",
    );
  if (reconstruction.source.version !== undefined)
    out.source.version = requiredString(
      reconstruction.source.version,
      "ReconstructedAsset.reconstruction.source.version",
    );
  if (reconstruction.source.engine !== undefined)
    out.source.engine = requiredString(
      reconstruction.source.engine,
      "ReconstructedAsset.reconstruction.source.engine",
    );
  if (reconstruction.source.model !== undefined)
    out.source.model = requiredString(
      reconstruction.source.model,
      "ReconstructedAsset.reconstruction.source.model",
    );
  return out;
}

function normalizeProvenance(value, label) {
  const provenance = requiredObject(value, label);
  const out = cloneUnknownFields(provenance, new Set(["producer", "recognizer", "validationEvidence"]));
  out.producer = requiredString(provenance.producer, `${label}.producer`);
  if (provenance.recognizer !== undefined)
    out.recognizer = normalizeRecognizer(provenance.recognizer, `${label}.recognizer`);
  if (provenance.version !== undefined)
    out.version = requiredString(provenance.version, `${label}.version`);
  if (provenance.algorithmVersion !== undefined)
    out.algorithmVersion = requiredString(provenance.algorithmVersion, `${label}.algorithmVersion`);
  if (provenance.model !== undefined)
    out.model = requiredString(provenance.model, `${label}.model`);
  if (provenance.validationEvidence !== undefined)
    out.validationEvidence = normalizeEvidence(
      provenance.validationEvidence,
      `${label}.validationEvidence`,
    );
  return out;
}

function normalizeConfidence(value, label) {
  if (value === undefined) return undefined;
  return normalizeConfidenceComponents(value, label);
}

function normalizeAssetConfidence(value, label) {
  if (!value) return undefined;
  const components = normalizeConfidenceComponents(value, label);
  const out = { ...components };
  if (value.overall !== undefined) out.overall = requiredFiniteNumber(value.overall, `${label}.overall`);
  if (value.quality !== undefined) out.quality = requiredFiniteNumber(value.quality, `${label}.quality`);
  return out;
}

function weightedConfidenceScore(components) {
  const weights = {
    recognition: 1,
    parseValidity: 1,
    visualSimilarity: 1,
    cropQuality: 1,
    nodeAccuracy: 1,
    topologyConfidence: 1,
    structural: 1,
    semantic: 1,
    overall: 1,
    quality: 1,
  };
  let totalWeight = 0;
  let sum = 0;
  for (const [name, value] of Object.entries(components || {})) {
    const weight = weights[name] || 0.5;
    totalWeight += weight;
    sum += value * weight;
  }
  return totalWeight ? sum / totalWeight : 0;
}

function evidenceRank(level) {
  return { high: 3, medium: 2, low: 1, missing: 0 }[level] ?? 0;
}

export function defaultReconstructionVersion() {
  return 1;
}

export function normalizeConfidencePolicy(input = {}) {
  const thresholds = { ...DEFAULT_POLICY_THRESHOLDS };
  if (input.accept !== undefined) thresholds.accept = requiredFiniteNumber(input.accept, "policy.accept");
  if (input.review !== undefined) thresholds.review = requiredFiniteNumber(input.review, "policy.review");
  if (thresholds.accept < thresholds.review)
    throw new TypeError("policy.accept must be greater than or equal to policy.review.");
  return Object.freeze(thresholds);
}

export function dispositionForEvidence(value, policy = DEFAULT_POLICY_THRESHOLDS) {
  const thresholds = normalizeConfidencePolicy(policy);
  const hasConfidenceInput = !!value.confidence;
  const confidence = hasConfidenceInput
    ? normalizeAssetConfidence(value.confidence, "evidence.confidence") || {}
    : {};
  const hasConfidence = Object.keys(confidence).length > 0;
  const score = weightedConfidenceScore(confidence);
  const evidence = value.validationEvidence ? normalizeEvidence(value.validationEvidence, "evidence.validationEvidence") : null;
  const evidenceLevel = evidence ? evidenceRank(evidence.level) : 0;

  if (value.disposition) return requiredEnum(value.disposition, DISPOSITIONS, "evidence.disposition");
  if (!hasConfidenceInput && !evidence) return "preserved";
  if (!hasConfidence && !evidence) return "preserved";
  if (evidenceLevel >= evidenceRank("high") && score >= thresholds.accept) return "accepted";
  if (evidenceLevel >= evidenceRank("medium") && score >= thresholds.review) return "review";
  if (score >= thresholds.accept) return "accepted";
  if (score >= thresholds.review) return "review";
  return "preserved";
}

export function reconstructionPolicy(input = {}) {
  const thresholds = normalizeConfidencePolicy(input.thresholds || input);
  return Object.freeze({
    thresholds,
    decide(value) {
      return dispositionForEvidence(value, thresholds);
    },
    accepted(value) {
      return dispositionForEvidence(value, thresholds) === "accepted";
    },
    review(value) {
      return dispositionForEvidence(value, thresholds) === "review";
    },
    preserved(value) {
      return dispositionForEvidence(value, thresholds) === "preserved";
    },
  });
}

export function normalizeReconstructedAsset(value, policy = DEFAULT_POLICY_THRESHOLDS) {
  const parsed = parseReconstructedAsset(value);
  const confidence = normalizeAssetConfidence(parsed.confidence || {}, "ReconstructedAsset.confidence") || {};
  const provenance = parsed.provenance || {};
  const validationEvidence = provenance.validationEvidence ? normalizeEvidence(provenance.validationEvidence, "ReconstructedAsset.provenance.validationEvidence") : null;
  const policyEngine = reconstructionPolicy(policy);
  const disposition = dispositionForEvidence(
    {
      confidence,
      validationEvidence,
      disposition: parsed.disposition,
    },
    policyEngine.thresholds,
  );
  return finalizeContract({
    ...parsed,
    confidence,
    provenance: validationEvidence
      ? { ...provenance, validationEvidence }
      : provenance,
    disposition,
    reconstructionVersion: Number.isFinite(Number(parsed.reconstructionVersion))
      ? Number(parsed.reconstructionVersion)
      : DEFAULT_RECONSTRUCTION_VERSION,
  });
}

export function defaultReconstructedAsset(source = {}, policy = DEFAULT_POLICY_THRESHOLDS) {
  const input = requiredObject(source, "ReconstructedAsset");
  const provenance = isPlainObject(input.provenance) ? { ...input.provenance } : {};
  if (!provenance.producer) provenance.producer = "unknown";
  const confidence = isPlainObject(input.confidence) ? { ...input.confidence } : undefined;
  const policyEngine = reconstructionPolicy(policy);
  const disposition = dispositionForEvidence(
    {
      confidence,
      validationEvidence: provenance.validationEvidence,
      disposition: input.disposition,
    },
    policyEngine.thresholds,
  );
  return normalizeReconstructedAsset({
    ...input,
    schemaVersion: Number.isFinite(Number(input.schemaVersion)) ? Number(input.schemaVersion) : RECONSTRUCTED_ASSET_SCHEMA_VERSION,
    id: input.id || "asset-unknown",
    page: Number.isFinite(Number(input.page)) ? Number(input.page) : 1,
    bbox: Array.isArray(input.bbox) ? input.bbox : [0, 0, 0, 0],
    kind: input.kind || "unknown",
    sourceType: input.sourceType || "mixed",
    sourceAsset: input.sourceAsset || {
      id: input.id || "source-unknown",
      page: Number.isFinite(Number(input.page)) ? Number(input.page) : 1,
      bbox: Array.isArray(input.bbox) ? input.bbox : [0, 0, 0, 0],
    },
    reconstruction: input.reconstruction || {
      format: "semantic-ir",
      source: {
        kind: "preserved",
        recognizer: {
          name: "unknown",
          version: "unknown",
          preprocessVersion: "unknown",
        },
      },
    },
    confidence: confidence || {},
    provenance,
    reconstructionVersion: Number.isFinite(Number(input.reconstructionVersion))
      ? Number(input.reconstructionVersion)
      : DEFAULT_RECONSTRUCTION_VERSION,
    disposition,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    errors: Array.isArray(input.errors) ? input.errors : [],
  }, policyEngine.thresholds);
}

function normalizeNode(node, label) {
  const value = requiredObject(node, label);
  const out = cloneUnknownFields(value, new Set(["id", "type"]));
  out.id = requiredString(value.id, `${label}.id`);
  out.type = requiredString(value.type, `${label}.type`);
  if (value.text !== undefined) out.text = requiredString(value.text, `${label}.text`);
  if (value.children !== undefined) {
    if (!Array.isArray(value.children) || !value.children.every((item) => typeof item === "string"))
      throw new TypeError(`${label}.children must be an array of strings.`);
    out.children = value.children.map((item) => item.trim()).filter(Boolean);
  }
  return out;
}

function normalizeVisualNode(node, label) {
  const value = requiredObject(node, label);
  const out = cloneUnknownFields(value, new Set(["id"]));
  out.id = requiredString(value.id, `${label}.id`);
  if (value.label !== undefined) out.label = requiredString(value.label, `${label}.label`);
  if (value.shape !== undefined) out.shape = requiredString(value.shape, `${label}.shape`);
  if (value.geometry !== undefined) out.geometry = deepNormalize(requiredObject(value.geometry, `${label}.geometry`));
  if (value.style !== undefined) out.style = deepNormalize(requiredObject(value.style, `${label}.style`));
  return out;
}

function normalizeVisualEdge(edge, label) {
  const value = requiredObject(edge, label);
  const out = cloneUnknownFields(value, new Set(["source", "target"]));
  out.source = requiredString(value.source, `${label}.source`);
  out.target = requiredString(value.target, `${label}.target`);
  if (value.id !== undefined) out.id = requiredString(value.id, `${label}.id`);
  if (value.label !== undefined) out.label = requiredString(value.label, `${label}.label`);
  if (value.directed !== undefined) out.directed = Boolean(value.directed);
  if (value.geometry !== undefined) out.geometry = deepNormalize(requiredObject(value.geometry, `${label}.geometry`));
  if (value.style !== undefined) out.style = deepNormalize(requiredObject(value.style, `${label}.style`));
  return out;
}

function normalizeVisualLabel(label, path) {
  const value = requiredObject(label, path);
  const out = cloneUnknownFields(value, new Set(["text"]));
  out.text = requiredString(value.text, `${path}.text`);
  if (value.id !== undefined) out.id = requiredString(value.id, `${path}.id`);
  if (value.nodeId !== undefined) out.nodeId = requiredString(value.nodeId, `${path}.nodeId`);
  if (value.position !== undefined)
    out.position = requiredString(value.position, `${path}.position`);
  if (value.geometry !== undefined)
    out.geometry = deepNormalize(requiredObject(value.geometry, `${path}.geometry`));
  return out;
}

function normalizeVisualShape(shape, path) {
  const value = requiredObject(shape, path);
  const out = cloneUnknownFields(value, new Set(["type"]));
  out.type = requiredString(value.type, `${path}.type`);
  if (value.id !== undefined) out.id = requiredString(value.id, `${path}.id`);
  if (value.geometry !== undefined)
    out.geometry = deepNormalize(requiredObject(value.geometry, `${path}.geometry`));
  if (value.style !== undefined) out.style = deepNormalize(requiredObject(value.style, `${path}.style`));
  return out;
}

function normalizeChartData(value) {
  const data = requiredObject(value, "ChartIR.data");
  const out = cloneUnknownFields(data, new Set(["fields", "rows", "values", "source"]));
  if (data.fields !== undefined) {
    if (!Array.isArray(data.fields)) throw new TypeError("ChartIR.data.fields must be an array.");
    out.fields = data.fields.map((field, index) => {
      const value = requiredObject(field, `ChartIR.data.fields[${index}]`);
      const fieldOut = cloneUnknownFields(value, new Set(["name", "type", "title", "unit", "scale", "provenance"]));
      fieldOut.name = requiredString(value.name, `ChartIR.data.fields[${index}].name`);
      fieldOut.type = requiredString(value.type, `ChartIR.data.fields[${index}].type`);
      if (value.title !== undefined) fieldOut.title = requiredString(value.title, `ChartIR.data.fields[${index}].title`);
      if (value.unit !== undefined) fieldOut.unit = requiredString(value.unit, `ChartIR.data.fields[${index}].unit`);
      if (value.scale !== undefined) fieldOut.scale = deepNormalize(requiredObject(value.scale, `ChartIR.data.fields[${index}].scale`));
      if (value.provenance !== undefined)
        fieldOut.provenance = deepNormalize(requiredObject(value.provenance, `ChartIR.data.fields[${index}].provenance`));
      return fieldOut;
    });
  }
  if (data.rows !== undefined) {
    if (!Array.isArray(data.rows)) throw new TypeError("ChartIR.data.rows must be an array.");
    out.rows = data.rows.map((row, index) => {
      const value = requiredObject(row, `ChartIR.data.rows[${index}]`);
      const rowOut = cloneUnknownFields(value, new Set(["values", "provenance", "rowId"])) ;
      if (value.rowId !== undefined) rowOut.rowId = requiredString(value.rowId, `ChartIR.data.rows[${index}].rowId`);
      if (value.values !== undefined) {
        if (!isPlainObject(value.values)) throw new TypeError(`ChartIR.data.rows[${index}].values must be an object.`);
        rowOut.values = deepNormalize(value.values);
      } else {
        rowOut.values = deepNormalize(value);
      }
      if (value.provenance !== undefined)
        rowOut.provenance = deepNormalize(requiredObject(value.provenance, `ChartIR.data.rows[${index}].provenance`));
      return rowOut;
    });
  }
  if (data.values !== undefined) {
    if (!Array.isArray(data.values)) throw new TypeError("ChartIR.data.values must be an array.");
    out.values = data.values.map((row) => deepNormalize(row));
  }
  if (data.source !== undefined) {
    const source = requiredObject(data.source, "ChartIR.data.source");
    const outSource = cloneUnknownFields(source, new Set(["kind", "href", "checksum", "page", "bbox", "provenance"]));
    if (source.kind !== undefined) outSource.kind = requiredString(source.kind, "ChartIR.data.source.kind");
    if (source.href !== undefined) outSource.href = requiredString(source.href, "ChartIR.data.source.href");
    if (source.checksum !== undefined) outSource.checksum = requiredString(source.checksum, "ChartIR.data.source.checksum");
    if (source.page !== undefined) outSource.page = requiredPositiveInteger(source.page, "ChartIR.data.source.page");
    if (source.bbox !== undefined) outSource.bbox = requiredBBox(source.bbox, "ChartIR.data.source.bbox");
    if (source.provenance !== undefined)
      outSource.provenance = deepNormalize(requiredObject(source.provenance, "ChartIR.data.source.provenance"));
    out.source = outSource;
  }
  if (!Object.keys(out).length) throw new TypeError("ChartIR.data must include recovered data.");
  return out;
}

function normalizeChartMark(mark, index) {
  const value = requiredObject(mark, `ChartIR.marks[${index}]`);
  const out = cloneUnknownFields(value, new Set(["type", "role", "channel", "scale", "field", "axis", "legend", "provenance"]));
  out.type = requiredString(value.type, `ChartIR.marks[${index}].type`);
  if (value.role !== undefined) out.role = requiredString(value.role, `ChartIR.marks[${index}].role`);
  if (value.channel !== undefined) out.channel = requiredString(value.channel, `ChartIR.marks[${index}].channel`);
  if (value.field !== undefined) out.field = requiredString(value.field, `ChartIR.marks[${index}].field`);
  if (value.scale !== undefined) out.scale = deepNormalize(requiredObject(value.scale, `ChartIR.marks[${index}].scale`));
  if (value.axis !== undefined) out.axis = deepNormalize(requiredObject(value.axis, `ChartIR.marks[${index}].axis`));
  if (value.legend !== undefined) out.legend = deepNormalize(requiredObject(value.legend, `ChartIR.marks[${index}].legend`));
  if (value.geometry !== undefined)
    out.geometry = deepNormalize(requiredObject(value.geometry, `ChartIR.marks[${index}].geometry`));
  if (value.style !== undefined)
    out.style = deepNormalize(requiredObject(value.style, `ChartIR.marks[${index}].style`));
  if (value.provenance !== undefined)
    out.provenance = deepNormalize(requiredObject(value.provenance, `ChartIR.marks[${index}].provenance`));
  return out;
}

function normalizeEncoding(value) {
  const encoding = requiredObject(value, "ChartIR.encoding");
  const out = cloneUnknownFields(encoding, new Set(["x", "y", "color", "size", "shape", "tooltip", "column", "row", "detail", "opacity", "theta", "radius", "text", "order", "facet"]));
  for (const [channel, channelValue] of Object.entries(encoding)) {
    if (!isPlainObject(channelValue)) {
      if (typeof channelValue === "string") out[channel] = { field: channelValue };
      else out[channel] = deepNormalize(channelValue);
      continue;
    }
    const channelOut = cloneUnknownFields(channelValue, new Set(["field", "type", "aggregate", "bin", "axis", "legend", "scale", "title", "value", "sort", "timeUnit", "stack", "format", "provenance"]));
    if (channelValue.field !== undefined) channelOut.field = requiredString(channelValue.field, `ChartIR.encoding.${channel}.field`);
    if (channelValue.type !== undefined) channelOut.type = requiredString(channelValue.type, `ChartIR.encoding.${channel}.type`);
    if (channelValue.aggregate !== undefined) channelOut.aggregate = requiredString(channelValue.aggregate, `ChartIR.encoding.${channel}.aggregate`);
    if (channelValue.bin !== undefined) channelOut.bin = channelValue.bin === true ? true : deepNormalize(requiredObject(channelValue.bin, `ChartIR.encoding.${channel}.bin`));
    if (channelValue.axis !== undefined) channelOut.axis = deepNormalize(requiredObject(channelValue.axis, `ChartIR.encoding.${channel}.axis`));
    if (channelValue.legend !== undefined) channelOut.legend = deepNormalize(requiredObject(channelValue.legend, `ChartIR.encoding.${channel}.legend`));
    if (channelValue.scale !== undefined) channelOut.scale = deepNormalize(requiredObject(channelValue.scale, `ChartIR.encoding.${channel}.scale`));
    if (channelValue.title !== undefined) channelOut.title = requiredString(channelValue.title, `ChartIR.encoding.${channel}.title`);
    if (channelValue.value !== undefined) channelOut.value = deepNormalize(channelValue.value);
    if (channelValue.sort !== undefined) channelOut.sort = deepNormalize(channelValue.sort);
    if (channelValue.timeUnit !== undefined) channelOut.timeUnit = requiredString(channelValue.timeUnit, `ChartIR.encoding.${channel}.timeUnit`);
    if (channelValue.stack !== undefined) channelOut.stack = requiredString(channelValue.stack, `ChartIR.encoding.${channel}.stack`);
    if (channelValue.format !== undefined) channelOut.format = requiredString(channelValue.format, `ChartIR.encoding.${channel}.format`);
    if (channelValue.provenance !== undefined)
      channelOut.provenance = deepNormalize(requiredObject(channelValue.provenance, `ChartIR.encoding.${channel}.provenance`));
    out[channel] = channelOut;
  }
  return out;
}

function normalizeBaseContract(value, label) {
  const source = requiredObject(value, label);
  const schemaVersion = requiredPositiveInteger(source.schemaVersion, `${label}.schemaVersion`);
  if (schemaVersion < 1)
    throw new TypeError(`${label}.schemaVersion must be at least 1.`);
  return { source, schemaVersion };
}

function finalizeContract(contract) {
  return deepFreeze(contract);
}

function deepFreeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

export function parseReconstructedAsset(value) {
  const source = parseJson(value, "ReconstructedAsset");
  const { schemaVersion } = normalizeBaseContract(source, "ReconstructedAsset");
  const out = cloneUnknownFields(source, new Set([
    "schemaVersion",
    "id",
    "page",
    "bbox",
    "kind",
    "sourceType",
    "sourceAsset",
    "reconstruction",
    "confidence",
    "provenance",
    "disposition",
    "warnings",
    "errors",
  ]));
  out.schemaVersion = schemaVersion;
  out.id = requiredString(source.id, "ReconstructedAsset.id");
  out.page = requiredPositiveInteger(source.page, "ReconstructedAsset.page");
  out.bbox = requiredBBox(source.bbox, "ReconstructedAsset.bbox");
  out.kind = requiredEnum(source.kind, RECONSTRUCTED_ASSET_KINDS, "ReconstructedAsset.kind");
  out.sourceType = requiredEnum(source.sourceType, SOURCE_TYPES, "ReconstructedAsset.sourceType");
  out.sourceAsset = normalizeSourceAsset(source.sourceAsset);
  out.reconstruction = normalizeReconstruction(source.reconstruction);
  out.confidence = normalizeAssetConfidence(source.confidence, "ReconstructedAsset.confidence");
  out.provenance = normalizeProvenance(source.provenance, "ReconstructedAsset.provenance");
  out.reconstructionVersion = Number.isFinite(Number(source.reconstructionVersion))
    ? Number(source.reconstructionVersion)
    : DEFAULT_RECONSTRUCTION_VERSION;
  out.disposition = requiredEnum(source.disposition || "preserved", DISPOSITIONS, "ReconstructedAsset.disposition");
  const warnings = optionalStringArray(source.warnings, "ReconstructedAsset.warnings");
  if (warnings !== undefined) out.warnings = warnings;
  const errors = optionalStringArray(source.errors, "ReconstructedAsset.errors");
  if (errors !== undefined) out.errors = errors;
  return finalizeContract(out);
}

export function serializeReconstructedAsset(value) {
  return canonicalJson(parseReconstructedAsset(value));
}

export function deserializeReconstructedAsset(value) {
  return parseReconstructedAsset(JSON.parse(value));
}

export function parseMathIR(value) {
  const source = parseJson(value, "MathIR");
  const { schemaVersion } = normalizeBaseContract(source, "MathIR");
  const out = cloneUnknownFields(source, new Set([
    "schemaVersion",
    "id",
    "kind",
    "rootId",
    "nodes",
    "provenance",
    "confidence",
    "disposition",
    "warnings",
    "errors",
  ]));
  out.schemaVersion = schemaVersion;
  out.id = requiredString(source.id, "MathIR.id");
  out.kind = requiredString(source.kind, "MathIR.kind");
  out.rootId = requiredString(source.rootId, "MathIR.rootId");
  if (!Array.isArray(source.nodes) || !source.nodes.length)
    throw new TypeError("MathIR.nodes must be a non-empty array.");
  out.nodes = source.nodes.map((node, index) => normalizeNode(node, `MathIR.nodes[${index}]`));
  const nodeIds = new Set(out.nodes.map((node) => node.id));
  if (!nodeIds.has(out.rootId)) throw new TypeError("MathIR.rootId must match a node id.");
  if (nodeIds.size !== out.nodes.length)
    throw new TypeError("MathIR.nodes must use unique node ids.");
  out.provenance = normalizeProvenance(source.provenance, "MathIR.provenance");
  out.confidence = normalizeConfidence(source.confidence, "MathIR.confidence");
  out.disposition = requiredEnum(source.disposition, DISPOSITIONS, "MathIR.disposition");
  const warnings = optionalStringArray(source.warnings, "MathIR.warnings");
  if (warnings !== undefined) out.warnings = warnings;
  const errors = optionalStringArray(source.errors, "MathIR.errors");
  if (errors !== undefined) out.errors = errors;
  return finalizeContract(out);
}

export function serializeMathIR(value) {
  return canonicalJson(parseMathIR(value));
}

export function deserializeMathIR(value) {
  return parseMathIR(JSON.parse(value));
}

export function parseVisualIR(value) {
  const source = parseJson(value, "VisualIR");
  const { schemaVersion } = normalizeBaseContract(source, "VisualIR");
  const out = cloneUnknownFields(source, new Set([
    "schemaVersion",
    "id",
    "kind",
    "nodes",
    "edges",
    "labels",
    "geometry",
    "shapes",
    "styles",
    "provenance",
    "confidence",
    "disposition",
    "warnings",
    "errors",
  ]));
  out.schemaVersion = schemaVersion;
  out.id = requiredString(source.id, "VisualIR.id");
  out.kind = requiredString(source.kind, "VisualIR.kind");
  if (!Array.isArray(source.nodes) || !source.nodes.length)
    throw new TypeError("VisualIR.nodes must be a non-empty array.");
  if (!Array.isArray(source.edges)) throw new TypeError("VisualIR.edges must be an array.");
  out.nodes = source.nodes.map((node, index) => normalizeVisualNode(node, `VisualIR.nodes[${index}]`));
  out.edges = source.edges.map((edge, index) => normalizeVisualEdge(edge, `VisualIR.edges[${index}]`));
  if (source.labels !== undefined) {
    if (!Array.isArray(source.labels)) throw new TypeError("VisualIR.labels must be an array.");
    out.labels = source.labels.map((label, index) => normalizeVisualLabel(label, `VisualIR.labels[${index}]`));
  }
  if (source.geometry !== undefined)
    out.geometry = deepNormalize(requiredObject(source.geometry, "VisualIR.geometry"));
  if (source.shapes !== undefined) {
    if (!Array.isArray(source.shapes)) throw new TypeError("VisualIR.shapes must be an array.");
    out.shapes = source.shapes.map((shape, index) => normalizeVisualShape(shape, `VisualIR.shapes[${index}]`));
  }
  if (source.styles !== undefined)
    out.styles = deepNormalize(requiredObject(source.styles, "VisualIR.styles"));
  out.provenance = normalizeProvenance(source.provenance, "VisualIR.provenance");
  out.confidence = normalizeConfidence(source.confidence, "VisualIR.confidence");
  out.disposition = requiredEnum(source.disposition, DISPOSITIONS, "VisualIR.disposition");
  const warnings = optionalStringArray(source.warnings, "VisualIR.warnings");
  if (warnings !== undefined) out.warnings = warnings;
  const errors = optionalStringArray(source.errors, "VisualIR.errors");
  if (errors !== undefined) out.errors = errors;
  return finalizeContract(out);
}

export function serializeVisualIR(value) {
  return canonicalJson(parseVisualIR(value));
}

export function deserializeVisualIR(value) {
  return parseVisualIR(JSON.parse(value));
}

export function parseChartIR(value) {
  const source = parseJson(value, "ChartIR");
  const { schemaVersion } = normalizeBaseContract(source, "ChartIR");
  const out = cloneUnknownFields(source, new Set([
    "schemaVersion",
    "id",
    "kind",
    "data",
    "marks",
    "encoding",
    "geometry",
    "provenance",
    "confidence",
    "disposition",
    "warnings",
    "errors",
  ]));
  out.schemaVersion = schemaVersion;
  out.id = requiredString(source.id, "ChartIR.id");
  out.kind = requiredString(source.kind, "ChartIR.kind");
  out.data = normalizeChartData(source.data);
  if (!Array.isArray(source.marks) || !source.marks.length)
    throw new TypeError("ChartIR.marks must be a non-empty array.");
  out.marks = source.marks.map((mark, index) => normalizeChartMark(mark, index));
  out.encoding = normalizeEncoding(source.encoding);
  if (source.geometry !== undefined)
    out.geometry = deepNormalize(requiredObject(source.geometry, "ChartIR.geometry"));
  out.provenance = normalizeProvenance(source.provenance, "ChartIR.provenance");
  out.confidence = normalizeConfidence(source.confidence, "ChartIR.confidence");
  out.disposition = requiredEnum(source.disposition, DISPOSITIONS, "ChartIR.disposition");
  if (source.axes !== undefined) {
    if (!Array.isArray(source.axes)) throw new TypeError("ChartIR.axes must be an array.");
    out.axes = source.axes.map((axis, index) => {
      const value = requiredObject(axis, `ChartIR.axes[${index}]`);
      const axisOut = cloneUnknownFields(value, new Set(["channel", "title", "field", "type", "scale", "domain", "range", "format", "provenance"]));
      axisOut.channel = requiredString(value.channel, `ChartIR.axes[${index}].channel`);
      if (value.title !== undefined) axisOut.title = requiredString(value.title, `ChartIR.axes[${index}].title`);
      if (value.field !== undefined) axisOut.field = requiredString(value.field, `ChartIR.axes[${index}].field`);
      if (value.type !== undefined) axisOut.type = requiredString(value.type, `ChartIR.axes[${index}].type`);
      if (value.scale !== undefined) axisOut.scale = deepNormalize(requiredObject(value.scale, `ChartIR.axes[${index}].scale`));
      if (value.domain !== undefined) axisOut.domain = deepNormalize(value.domain);
      if (value.range !== undefined) axisOut.range = deepNormalize(value.range);
      if (value.format !== undefined) axisOut.format = requiredString(value.format, `ChartIR.axes[${index}].format`);
      if (value.provenance !== undefined)
        axisOut.provenance = deepNormalize(requiredObject(value.provenance, `ChartIR.axes[${index}].provenance`));
      return axisOut;
    });
  }
  if (source.labels !== undefined) {
    if (!Array.isArray(source.labels)) throw new TypeError("ChartIR.labels must be an array.");
    out.labels = source.labels.map((label, index) => {
      const value = requiredObject(label, `ChartIR.labels[${index}]`);
      const labelOut = cloneUnknownFields(value, new Set(["text", "field", "channel", "position", "align", "baseline", "provenance"]));
      labelOut.text = requiredString(value.text, `ChartIR.labels[${index}].text`);
      if (value.field !== undefined) labelOut.field = requiredString(value.field, `ChartIR.labels[${index}].field`);
      if (value.channel !== undefined) labelOut.channel = requiredString(value.channel, `ChartIR.labels[${index}].channel`);
      if (value.position !== undefined) labelOut.position = requiredString(value.position, `ChartIR.labels[${index}].position`);
      if (value.align !== undefined) labelOut.align = requiredString(value.align, `ChartIR.labels[${index}].align`);
      if (value.baseline !== undefined) labelOut.baseline = requiredString(value.baseline, `ChartIR.labels[${index}].baseline`);
      if (value.provenance !== undefined)
        labelOut.provenance = deepNormalize(requiredObject(value.provenance, `ChartIR.labels[${index}].provenance`));
      return labelOut;
    });
  }
  if (source.legend !== undefined)
    out.legend = deepNormalize(requiredObject(source.legend, "ChartIR.legend"));
  const warnings = optionalStringArray(source.warnings, "ChartIR.warnings");
  if (warnings !== undefined) out.warnings = warnings;
  const errors = optionalStringArray(source.errors, "ChartIR.errors");
  if (errors !== undefined) out.errors = errors;
  return finalizeContract(out);
}

export function serializeChartIR(value) {
  return canonicalJson(parseChartIR(value));
}

export function deserializeChartIR(value) {
  return parseChartIR(JSON.parse(value));
}

export {
  DEFAULT_POLICY_THRESHOLDS,
  DEFAULT_RECONSTRUCTION_VERSION,
  RECONSTRUCTED_ASSET_SCHEMA_VERSION,
  MATH_IR_SCHEMA_VERSION,
  VISUAL_IR_SCHEMA_VERSION,
  CHART_IR_SCHEMA_VERSION,
};
