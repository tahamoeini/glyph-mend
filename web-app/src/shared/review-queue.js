import { parseLatexToMathIR } from "./mathir-parser.js";
import { assertSafeStructuredValue } from "./security-boundaries.js";

const REVIEW_STATUSES = new Set(["queued", "accepted", "review", "preserved"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value = "") {
  return String(value ?? "")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeIdentifier(value, fallback = "review-item") {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 256);
  return normalized || fallback;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map((item) => stableObject(item));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableObject(item)]),
  );
}

function canonicalSignature(value) {
  return JSON.stringify(stableObject(value));
}

function parseEquationLatex(latex = "") {
  const normalized = normalizeText(latex);
  if (!normalized) {
    return {
      latex: normalized,
      success: false,
      mathir: null,
      confidence: { overall: 0, parseValidity: 0 },
      warnings: ["Missing LaTeX candidate."],
      errors: ["Missing LaTeX candidate."],
    };
  }
  try {
    const mathir = parseLatexToMathIR(normalized);
    const success = Array.isArray(mathir?.nodes) && mathir.nodes.length > 0 && !(mathir.errors || []).length;
    return {
      latex: normalized,
      success,
      mathir,
      confidence: {
        overall: numeric(mathir?.confidence?.overall, 0),
        parseValidity: numeric(mathir?.confidence?.parseValidity, 0),
        recognition: numeric(mathir?.confidence?.recognition, 0),
      },
      warnings: Array.isArray(mathir?.warnings) ? mathir.warnings : [],
      errors: Array.isArray(mathir?.errors) ? mathir.errors : [],
    };
  } catch (error) {
    return {
      latex: normalized,
      success: false,
      mathir: null,
      confidence: { overall: 0, parseValidity: 0 },
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function normalizeReviewItem(value = {}) {
  assertSafeStructuredValue(value, "Review item");
  const item = isPlainObject(value) ? value : {};
  const sourceAsset = isPlainObject(item.sourceAsset) ? { ...item.sourceAsset } : {};
  const candidate = isPlainObject(item.candidate) ? { ...item.candidate } : {};
  const parsed = item.parsed || parseEquationLatex(candidate.latex || candidate.normalized || item.latex || "");
  const confidence = isPlainObject(item.confidence) ? { ...item.confidence } : { ...parsed.confidence };
  const disposition = REVIEW_STATUSES.has(item.disposition) ? item.disposition : (item.status || "queued");
  const validation = isPlainObject(item.validation) ? { ...item.validation } : {};
  const manifest = isPlainObject(item.manifest) ? { ...item.manifest } : {};
  const provenance = isPlainObject(item.provenance) ? { ...item.provenance } : {};
  const rawId = item.id || sourceAsset.id || candidate.id || `review-${sourceAsset.page || 1}-${Math.abs((candidate.latex || item.latex || "").length)}`;

  return {
    id: safeIdentifier(rawId),
    kind: item.kind || candidate.kind || sourceAsset.kind || "equation",
    page: numeric(item.page, numeric(sourceAsset.page, 1)),
    status: disposition,
    disposition,
    sourceAsset: {
      id: safeIdentifier(sourceAsset.id || item.sourceAssetId || rawId, "source-unknown"),
      page: numeric(sourceAsset.page, numeric(item.page, 1)),
      bbox: Array.isArray(sourceAsset.bbox) ? sourceAsset.bbox : [0, 0, 0, 0],
      kind: sourceAsset.kind || "page-crop",
      ...sourceAsset,
      id: safeIdentifier(sourceAsset.id || item.sourceAssetId || rawId, "source-unknown"),
    },
    candidate: {
      latex: normalizeText(candidate.latex || item.latex || ""),
      normalized: normalizeText(candidate.normalized || candidate.latex || item.latex || ""),
      provider: candidate.provider || item.provider || "unknown",
      version: candidate.version || item.version || "unknown",
      modelHash: candidate.modelHash || item.modelHash || null,
      confidence: confidence,
      ...candidate,
    },
    parsed,
    confidence,
    validation: {
      parseSuccess: !!validation.parseSuccess,
      renderSuccess: !!validation.renderSuccess,
      semanticEquivalent: !!validation.semanticEquivalent,
      confidencePass: !!validation.confidencePass,
      mandatoryPassed: !!validation.mandatoryPassed,
      sourcePreserved: validation.sourcePreserved !== false,
      notes: Array.isArray(validation.notes) ? validation.notes : [],
      ...validation,
    },
    manifest: {
      kind: manifest.kind || item.kind || "equation",
      sourceAsset: manifest.sourceAsset || sourceAsset,
      reconstruction: manifest.reconstruction || {
        format: "semantic-ir",
        source: {
          kind: "review-queue",
          recognizer: {
            name: candidate.provider || item.provider || "unknown",
            version: candidate.version || item.version || "unknown",
            preprocessVersion: candidate.preprocessVersion || item.preprocessVersion || "unknown",
          },
        },
      },
      provenance: manifest.provenance || provenance,
      ...manifest,
    },
    rendered: item.rendered || candidate.rendered || null,
    notes: Array.isArray(item.notes) ? item.notes : [],
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
  };
}

export function serializeReviewItem(value = {}) {
  const item = normalizeReviewItem(value);
  return canonicalSignature(item);
}

export function buildReviewQueue(pages = {}) {
  assertSafeStructuredValue(pages, "Review queue pages");
  return Object.values(pages)
    .flatMap((page) => Array.isArray(page?.reviewItems) ? page.reviewItems.map((item) => normalizeReviewItem({ ...item, page: page.page })) : [])
    .sort((left, right) => left.page - right.page || left.id.localeCompare(right.id));
}

export function reviewQueueSummary(queue = []) {
  const items = Array.isArray(queue) ? queue.map((item) => normalizeReviewItem(item)) : [];
  const counts = items.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      accumulator[item.disposition] = (accumulator[item.disposition] || 0) + 1;
      accumulator[item.kind] = (accumulator[item.kind] || 0) + 1;
      return accumulator;
    },
    { total: 0, accepted: 0, review: 0, preserved: 0 },
  );
  return counts;
}

export function reviewQueueCanAccept(item = {}) {
  const normalized = normalizeReviewItem(item);
  return normalized.validation?.mandatoryPassed && normalized.disposition !== "preserved";
}

export function reviewQueueDecide(item = {}, action = "keep-original") {
  const normalized = normalizeReviewItem(item);
  const next = { ...normalized, updatedAt: new Date().toISOString() };
  if (action === "accept") {
    if (!reviewQueueCanAccept(next)) return { ...next, disposition: "review", status: "review" };
    return { ...next, disposition: "accepted", status: "accepted" };
  }
  if (action === "edit") {
    const parsed = parseEquationLatex(next.candidate?.latex || next.latex || "");
    return {
      ...next,
      parsed,
      confidence: { ...next.confidence, ...parsed.confidence },
      validation: {
        ...next.validation,
        parseSuccess: parsed.success,
        renderSuccess: parsed.success,
        semanticEquivalent: parsed.success,
        confidencePass: numeric(parsed.confidence?.overall, 0) >= 0.82,
        mandatoryPassed: parsed.success && numeric(parsed.confidence?.overall, 0) >= 0.82,
        sourcePreserved: true,
        notes: ["Edited LaTeX revalidated locally."],
      },
      disposition: parsed.success && numeric(parsed.confidence?.overall, 0) >= 0.82 ? "review" : "preserved",
      status: parsed.success && numeric(parsed.confidence?.overall, 0) >= 0.82 ? "review" : "preserved",
    };
  }
  return { ...next, disposition: "preserved", status: "preserved" };
}
