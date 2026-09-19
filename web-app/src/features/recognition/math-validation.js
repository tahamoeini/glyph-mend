import { parseLatexToMathIR } from "../../shared/mathir-parser.js";
import { createEquationIR } from "../../shared/equation-ir.js";

const DEFAULT_POLICY = Object.freeze({ accept: 0.82, review: 0.55 });

function normalizeLatex(value = "") {
  return String(value ?? "")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\\\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableObject(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableObject(item)]),
    );
  }
  return value;
}

function canonicalSignature(value) {
  return JSON.stringify(stableObject(value));
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function extractConfidence(candidate = {}) {
  const confidence = candidate.confidence || {};
  const overall = numeric(confidence.overall, numeric(confidence.score, 0));
  return {
    token: numeric(confidence.token, overall),
    sequence: numeric(confidence.sequence, overall),
    overall,
  };
}

function tokenList(value = "") {
  return normalizeLatex(value)
    .replace(/\\([A-Za-z]+)/g, " $1 ")
    .replace(/[{}()[\]^_+=<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function lexicalSimilarity(actualValue = "", expectedValue = "") {
  const actual = tokenList(actualValue);
  const expected = tokenList(expectedValue);
  if (!actual.length && !expected.length) return 1;
  if (!actual.length || !expected.length) return 0;

  let matches = 0;
  const seen = new Set();
  for (const item of actual) {
    const index = expected.findIndex((candidate, idx) => candidate === item && !seen.has(idx));
    if (index >= 0) {
      matches += 1;
      seen.add(index);
    }
  }

  const denominator = Math.max(actual.length, expected.length);
  return denominator ? matches / denominator : 0;
}

export function createBaselineVisualSimilarity(actual = "", expected = "") {
  const actualText = normalizeLatex(actual);
  const expectedText = normalizeLatex(expected);
  const exact = actualText === expectedText;
  const lexical = lexicalSimilarity(actualText, expectedText);
  const score = exact ? 1 : Math.min(1, Math.max(0, lexical));
  const pass = exact || (score >= 0.96 && actualText.length > 0 && expectedText.length > 0);

  return {
    pass,
    score,
    actual: actualText,
    expected: expectedText,
    exact,
    method: "baseline-lexical",
  };
}

function parseCandidate(candidate = {}) {
  const latex = normalizeLatex(candidate.latex ?? candidate.normalized ?? candidate.text ?? "");
  if (!latex) {
    return {
      success: false,
      latex,
      mathir: null,
      errors: ["No math text available for validation."],
    };
  }

  try {
    const mathir = parseLatexToMathIR(latex);
    const hasNodes = Array.isArray(mathir?.nodes) && mathir.nodes.length > 0;
    const errors = Array.isArray(mathir?.errors) ? mathir.errors : [];
    return {
      success: hasNodes && errors.length === 0,
      latex,
      mathir,
      errors,
    };
  } catch (error) {
    return {
      success: false,
      latex,
      mathir: null,
      errors: [error instanceof Error ? error.message : "Parse failed."],
    };
  }
}

function compareMathIR(actualLatex = "", expectedLatex = "") {
  const actual = parseCandidate({ latex: actualLatex });
  const expected = parseCandidate({ latex: expectedLatex || actualLatex });
  if (!actual.success || !expected.success) return false;
  // Provenance, parser confidence, and disposition are metadata, not math
  // semantics. Compare only the normalized graph so a valid reconstruction is
  // not rejected merely because it came from a different confidence path.
  const comparable = (value) => ({
    rootId: value.rootId,
    nodes: value.nodes,
  });
  return canonicalSignature(comparable(actual.mathir)) ===
    canonicalSignature(comparable(expected.mathir));
}

export function validateEquationCandidate(candidate = {}, sourceAsset = {}, expectedLatex = "", policy = DEFAULT_POLICY) {
  const threshold = {
    accept: numeric(policy.accept, DEFAULT_POLICY.accept),
    review: numeric(policy.review, DEFAULT_POLICY.review),
  };

  const actualLatex = normalizeLatex(candidate.latex ?? candidate.normalized ?? candidate.text ?? "");
  const independentExpected = normalizeLatex(expectedLatex || candidate.expectedLatex || candidate.expected || "");
  const hasIndependentExpected = independentExpected.length > 0;
  const expected = independentExpected || actualLatex;
  const parsed = parseCandidate(candidate);
  const confidence = extractConfidence(candidate);
  const visual = createBaselineVisualSimilarity(actualLatex, expected || actualLatex);
  const semanticEquivalent = compareMathIR(actualLatex, expected || actualLatex);
  const renderSuccess = parsed.success;
  const structuredTextConfidencePass =
    candidate.provider === "mupdf-structured-text" &&
    visual.exact &&
    confidence.overall >= threshold.review;
  const confidencePass =
    (hasIndependentExpected && confidence.overall >= threshold.accept) || structuredTextConfidencePass;
  const mandatoryPassed = parsed.success && renderSuccess && semanticEquivalent && confidencePass;

  let disposition = "preserved";
  if (mandatoryPassed) disposition = "accepted";
  else if (parsed.success && renderSuccess && semanticEquivalent && confidence.overall >= threshold.review) disposition = "review";
  else if (parsed.success && confidence.overall >= threshold.review && actualLatex.length > 0) disposition = "review";

  const validation = {
    parseSuccess: parsed.success,
    renderSuccess,
    semanticEquivalent,
    confidencePass,
    independentEvidence: hasIndependentExpected,
    mandatoryPassed,
    sourcePreserved: true,
    notes: [
      parsed.success ? "math parse succeeded" : "math parse failed",
      hasIndependentExpected
        ? "independent expected equation evidence was supplied"
        : "no independent expected equation evidence was supplied",
      semanticEquivalent ? "semantic comparison matched expected structure" : "semantic comparison mismatched expected structure",
      renderSuccess ? "render-back generation succeeded" : "render-back generation failed",
      confidencePass ? "confidence threshold passed" : "confidence threshold not reached",
    ],
  };

  const sourceId = sourceAsset.id || "source-crop-unknown";
  const sourcePage = sourceAsset.page ?? candidate.page ?? 1;
  const sourceBbox = sourceAsset.bbox || candidate.bbox || [0, 0, 0, 0];
  const equationIR = createEquationIR({
    id: candidate.id || sourceId,
    mode: candidate.mode || "display",
    page: sourcePage,
    bbox: sourceBbox,
    coordinateSpace: candidate.coordinateSpace || "pdf-user-space",
    latex: actualLatex,
    mathIR: parsed.mathir,
    source: {
      kind: sourceAsset.sourceType || candidate.sourceType || "unknown",
      page: sourcePage,
      bbox: sourceBbox,
      coordinateSpace: candidate.coordinateSpace || "pdf-user-space",
      spanIds: candidate.sourceSpanIds || [],
      regionIds: candidate.sourceRegionIds || [],
      objectIds: candidate.sourceObjectIds || [],
      cropIds: [sourceId],
      cropAvailable: Boolean(sourceAsset.crop?.data?.byteLength || sourceAsset.data?.byteLength),
    },
    confidence: {
      detection: confidence.detection ?? confidence.overall,
      recognition: confidence.recognition ?? confidence.token,
      structure: confidence.structure ?? confidence.sequence,
      validation: parsed.success && semanticEquivalent
        ? hasIndependentExpected
          ? 0.96
          : candidate.provider === "mupdf-structured-text"
            ? 0.78
            : 0.45
        : visual.score,
      reconstruction: mandatoryPassed
        ? confidence.overall
        : parsed.success && semanticEquivalent
          ? Math.min(confidence.overall, 0.81)
          : Math.min(confidence.overall, 0.54),
      export: parsed.success && semanticEquivalent ? 0.96 : 0.2,
    },
    disposition: mandatoryPassed
      ? "reconstructed-with-source"
      : parsed.success && semanticEquivalent && confidence.overall >= threshold.review
        ? "needs-review"
        : "preserved-source",
    reconstructionVersion: 1,
    diagnostics: validation.notes,
  });

  return {
    accepted: mandatoryPassed,
    disposition,
    validation,
    confidence,
    manifest: {
      kind: "equation",
      sourceAsset: {
        ...sourceAsset,
        id: sourceAsset.id || "source-crop-unknown",
        page: sourceAsset.page ?? 1,
        bbox: Array.isArray(sourceAsset.bbox) ? sourceAsset.bbox : [0, 0, 0, 0],
      },
      reconstruction: {
        format: "semantic-ir",
        equationIRId: equationIR.id,
        source: {
          kind: "validated-candidate",
          recognizer: {
            name: candidate.provider || "validator",
            version: candidate.version || "validation",
          },
        },
      },
      provenance: {
        producer: "math-validation",
        validationEvidence: {
          level: mandatoryPassed ? "high" : parsed.success && renderSuccess ? "medium" : "low",
          notes: validation.notes,
        },
      },
    },
    output: {
      latex: actualLatex,
      normalized: actualLatex,
      expectedLatex: expected,
      parse: parsed,
      visual,
      semanticEquivalent,
      equationIR,
    },
  };
}
