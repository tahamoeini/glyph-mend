const RECONSTRUCTED_ASSET_SCHEMA_VERSION = 1;
const MATH_IR_SCHEMA_VERSION = 1;
const VISUAL_IR_SCHEMA_VERSION = 1;
const CHART_IR_SCHEMA_VERSION = 1;

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
  return !!value && typeof value === "object" && !Array.isArray(value);
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
  if (typeof value === "string") return JSON.parse(value);
  if (isPlainObject(value)) return value;
  throw new TypeError(`${name} must be a JSON object or JSON text.`);
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
  if (!Object.keys(out).length) throw new TypeError(`${label} must include at least one component.`);
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
  const out = cloneUnknownFields(source, new Set(["id"]));
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
  const out = cloneUnknownFields(provenance, new Set(["producer"]));
  out.producer = requiredString(provenance.producer, `${label}.producer`);
  if (provenance.version !== undefined)
    out.version = requiredString(provenance.version, `${label}.version`);
  if (provenance.algorithmVersion !== undefined)
    out.algorithmVersion = requiredString(provenance.algorithmVersion, `${label}.algorithmVersion`);
  if (provenance.model !== undefined)
    out.model = requiredString(provenance.model, `${label}.model`);
  return out;
}

function normalizeConfidence(value, label) {
  if (value === undefined) return undefined;
  return requiredStringMap(value, label);
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
  const out = cloneUnknownFields(data, new Set(["fields", "rows", "values"]));
  if (data.fields !== undefined) {
    if (!Array.isArray(data.fields)) throw new TypeError("ChartIR.data.fields must be an array.");
    out.fields = data.fields.map((field, index) => {
      const value = requiredObject(field, `ChartIR.data.fields[${index}]`);
      const fieldOut = cloneUnknownFields(value, new Set(["name", "type"]));
      fieldOut.name = requiredString(value.name, `ChartIR.data.fields[${index}].name`);
      fieldOut.type = requiredString(value.type, `ChartIR.data.fields[${index}].type`);
      return fieldOut;
    });
  }
  if (data.rows !== undefined) {
    if (!Array.isArray(data.rows)) throw new TypeError("ChartIR.data.rows must be an array.");
    out.rows = data.rows.map((row) => deepNormalize(requiredObject(row, "ChartIR.data.rows[]")));
  }
  if (data.values !== undefined) {
    if (!Array.isArray(data.values)) throw new TypeError("ChartIR.data.values must be an array.");
    out.values = data.values.map((row) => deepNormalize(row));
  }
  if (!Object.keys(out).length) throw new TypeError("ChartIR.data must include recovered data.");
  return out;
}

function normalizeChartMark(mark, index) {
  const value = requiredObject(mark, `ChartIR.marks[${index}]`);
  const out = cloneUnknownFields(value, new Set(["type"]));
  out.type = requiredString(value.type, `ChartIR.marks[${index}].type`);
  if (value.role !== undefined) out.role = requiredString(value.role, `ChartIR.marks[${index}].role`);
  if (value.geometry !== undefined)
    out.geometry = deepNormalize(requiredObject(value.geometry, `ChartIR.marks[${index}].geometry`));
  if (value.style !== undefined)
    out.style = deepNormalize(requiredObject(value.style, `ChartIR.marks[${index}].style`));
  return out;
}

function normalizeEncoding(value) {
  const encoding = requiredObject(value, "ChartIR.encoding");
  return deepNormalize(encoding);
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
  out.confidence = normalizeConfidence(source.confidence, "ReconstructedAsset.confidence");
  out.provenance = normalizeProvenance(source.provenance, "ReconstructedAsset.provenance");
  out.disposition = requiredEnum(source.disposition, DISPOSITIONS, "ReconstructedAsset.disposition");
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
  RECONSTRUCTED_ASSET_SCHEMA_VERSION,
  MATH_IR_SCHEMA_VERSION,
  VISUAL_IR_SCHEMA_VERSION,
  CHART_IR_SCHEMA_VERSION,
};
