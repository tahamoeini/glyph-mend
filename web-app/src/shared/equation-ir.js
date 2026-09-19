import { parseMathIR, serializeMathIR } from "./semantic-ir.js";
import { parseLatexToMathIR } from "./mathir-parser.js";
import { assertSafeStructuredValue } from "./security-boundaries.js";

export const EQUATION_IR_SCHEMA_VERSION = 1;
export const EQUATION_MODES = Object.freeze(["inline", "display"]);
export const EQUATION_DISPOSITIONS = Object.freeze([
  "reconstructed",
  "reconstructed-with-source",
  "preserved-source",
  "needs-review",
  "unsupported",
  "omitted-decoration",
]);
export const EQUATION_CONFIDENCE_DIMENSIONS = Object.freeze([
  "detection",
  "recognition",
  "structure",
  "validation",
  "reconstruction",
  "export",
]);

const ACCEPT_THRESHOLD = 0.82;
const REVIEW_THRESHOLD = 0.55;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, clone(item)]),
  );
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function requiredObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

function finiteNumber(value, label, fallback = null) {
  if (value === undefined && fallback !== null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function boundedConfidence(value, label, fallback = 0) {
  const number = finiteNumber(value, label, fallback);
  if (number < 0 || number > 1)
    throw new RangeError(`${label} must be between 0 and 1.`);
  return Number(number.toFixed(6));
}

function bbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4)
    throw new TypeError(`${label} must be a four-number bounding box.`);
  return value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
}

function stringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new TypeError(`${label} must be an array of strings.`);
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort();
}

function diagnostics(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new TypeError("EquationIR.diagnostics must be an array of strings.");
  return value.map((item) => item.trim()).filter(Boolean);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of canonicalJson(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function deterministicEquationId(input = {}) {
  const source = input.source || {};
  return `equation-${stableHash({
    page: input.page ?? source.page ?? 1,
    bbox: input.bbox ?? source.bbox ?? [0, 0, 0, 0],
    mode: input.mode || "display",
    latex: String(input.latex || ""),
    spanIds: source.spanIds || [],
    objectIds: source.objectIds || [],
    cropIds: source.cropIds || [],
  })}`;
}

function normalizeSource(input = {}, page, equationBbox) {
  const source = requiredObject(input, "EquationIR.source");
  return {
    kind: requiredString(source.kind || "unknown", "EquationIR.source.kind"),
    page: Math.max(1, Math.trunc(finiteNumber(source.page, "EquationIR.source.page", page))),
    bbox: bbox(source.bbox || equationBbox, "EquationIR.source.bbox"),
    coordinateSpace: requiredString(
      source.coordinateSpace || "pdf-user-space",
      "EquationIR.source.coordinateSpace",
    ),
    spanIds: stringArray(source.spanIds, "EquationIR.source.spanIds"),
    regionIds: stringArray(source.regionIds, "EquationIR.source.regionIds"),
    objectIds: stringArray(source.objectIds, "EquationIR.source.objectIds"),
    cropIds: stringArray(source.cropIds, "EquationIR.source.cropIds"),
    cropAvailable: source.cropAvailable === undefined
      ? Boolean(source.cropIds?.length)
      : Boolean(source.cropAvailable),
  };
}

function normalizeConfidence(value = {}) {
  const confidence = requiredObject(value, "EquationIR.confidence");
  const legacyOverall = confidence.overall;
  const output = {};
  for (const dimension of EQUATION_CONFIDENCE_DIMENSIONS) {
    output[dimension] = boundedConfidence(
      confidence[dimension],
      `EquationIR.confidence.${dimension}`,
      legacyOverall === undefined ? 0 : legacyOverall,
    );
  }
  return output;
}

function inferredDisposition(mathIR, source, confidence) {
  const valid = Boolean(mathIR && !mathIR.errors?.length && mathIR.disposition === "accepted");
  if (!valid) return confidence.reconstruction >= REVIEW_THRESHOLD ? "needs-review" : "preserved-source";
  if (
    confidence.reconstruction >= ACCEPT_THRESHOLD &&
    confidence.validation >= ACCEPT_THRESHOLD &&
    confidence.export >= REVIEW_THRESHOLD
  )
    return source.cropIds.length || source.cropAvailable
      ? "reconstructed-with-source"
      : "reconstructed";
  if (confidence.reconstruction >= REVIEW_THRESHOLD) return "needs-review";
  return "preserved-source";
}

/**
 * The equation envelope is intentionally separate from MathIR. MathIR carries
 * the bounded structural graph; this envelope carries page geometry, source
 * glyph/region references, explicit display mode, and export policy.
 */
export function parseEquationIR(value) {
  const source = typeof value === "string" ? JSON.parse(value) : value;
  assertSafeStructuredValue(source, "EquationIR");
  const input = requiredObject(source, "EquationIR");
  if (Number(input.schemaVersion) !== EQUATION_IR_SCHEMA_VERSION)
    throw new TypeError(`EquationIR.schemaVersion must be ${EQUATION_IR_SCHEMA_VERSION}.`);
  const page = Math.max(1, Math.trunc(finiteNumber(input.page, "EquationIR.page")));
  const equationBbox = bbox(input.bbox, "EquationIR.bbox");
  const mode = requiredString(input.mode, "EquationIR.mode");
  if (!EQUATION_MODES.includes(mode))
    throw new TypeError(`EquationIR.mode must be inline or display.`);
  const sourceRefs = normalizeSource(input.source, page, equationBbox);
  const confidence = normalizeConfidence(input.confidence);
  const out = {
    schemaVersion: EQUATION_IR_SCHEMA_VERSION,
    id: requiredString(input.id, "EquationIR.id"),
    type: "equation",
    mode,
    page,
    bbox: equationBbox,
    coordinateSpace: requiredString(
      input.coordinateSpace || sourceRefs.coordinateSpace,
      "EquationIR.coordinateSpace",
    ),
    latex: input.latex === undefined ? "" : String(input.latex).trim(),
    mathIR: input.mathIR == null ? null : parseMathIR(input.mathIR),
    source: sourceRefs,
    confidence,
    disposition: requiredString(input.disposition || "preserved-source", "EquationIR.disposition"),
    reconstructionVersion: Math.max(
      1,
      Math.trunc(finiteNumber(input.reconstructionVersion, "EquationIR.reconstructionVersion", 1)),
    ),
    diagnostics: diagnostics(input.diagnostics),
  };
  if (!EQUATION_DISPOSITIONS.includes(out.disposition))
    throw new TypeError(`EquationIR.disposition is unsupported: ${out.disposition}.`);
  if (!out.mathIR && !out.latex && out.disposition !== "preserved-source")
    throw new TypeError("Editable EquationIR requires MathIR or LaTeX content.");
  return freeze(out);
}

export function createEquationIR(input = {}) {
  const sourceInput = input.source || {};
  const page = Math.max(1, Math.trunc(finiteNumber(input.page ?? sourceInput.page, "EquationIR.page", 1)));
  const equationBbox = bbox(input.bbox || sourceInput.bbox || [0, 0, 0, 0], "EquationIR.bbox");
  const source = normalizeSource(sourceInput, page, equationBbox);
  const confidence = normalizeConfidence(input.confidence || {});
  const mathIR = input.mathIR == null ? null : parseMathIR(input.mathIR);
  const value = {
    schemaVersion: EQUATION_IR_SCHEMA_VERSION,
    id: input.id || deterministicEquationId({ ...input, page, bbox: equationBbox, source }),
    type: "equation",
    mode: input.mode || "display",
    page,
    bbox: equationBbox,
    coordinateSpace: input.coordinateSpace || source.coordinateSpace,
    latex: input.latex === undefined ? "" : String(input.latex).trim(),
    mathIR,
    source,
    confidence,
    disposition: input.disposition || inferredDisposition(mathIR, source, confidence),
    reconstructionVersion: input.reconstructionVersion || 1,
    diagnostics: diagnostics(input.diagnostics),
  };
  if (!source.cropIds.length && !source.cropAvailable)
    value.diagnostics.push("source-crop-unavailable");
  if (value.disposition === "needs-review") value.diagnostics.push("reconstruction-confidence-below-accept-threshold");
  if (mathIR?.errors?.length) value.diagnostics.push("mathir-validation-errors");
  return parseEquationIR(value);
}

export function equationFromLatex(input = {}) {
  const latex = String(input.latex || "").trim();
  let mathIR = null;
  const diagnosticsList = [...(input.diagnostics || [])];
  if (latex) {
    try {
      mathIR = parseLatexToMathIR(latex);
    } catch (error) {
      diagnosticsList.push(error instanceof Error ? error.message : "MathIR parse failed.");
    }
  } else {
    diagnosticsList.push("empty-equation-source");
  }
  if (mathIR?.errors?.length) diagnosticsList.push(...mathIR.errors.map((error) => `mathir:${error}`));
  return createEquationIR({ ...input, latex, mathIR, diagnostics: diagnosticsList });
}

export function equationToMarkdown(value) {
  const equation = parseEquationIR(value);
  if (
    !equation.mathIR ||
    equation.mathIR.errors?.length ||
    !["reconstructed", "reconstructed-with-source"].includes(equation.disposition)
  )
    return null;
  if (equation.mode === "inline") return `$${equation.latex}$`;
  return `$$\n${equation.latex}\n$$`;
}

export function equationForDocx(value) {
  const equation = parseEquationIR(value);
  if (
    !equation.mathIR ||
    equation.mathIR.errors?.length ||
    !["reconstructed", "reconstructed-with-source"].includes(equation.disposition) ||
    equation.confidence.export < REVIEW_THRESHOLD
  )
    return null;
  return equation.mathIR;
}

export function serializeEquationIR(value) {
  return canonicalJson(parseEquationIR(value));
}

export function deserializeEquationIR(value) {
  return parseEquationIR(JSON.parse(value));
}

export function compareEquationIR(left, right) {
  return serializeEquationIR(left) === serializeEquationIR(right);
}

export function serializeEquationMathIR(value) {
  return serializeMathIR(parseEquationIR(value).mathIR);
}
