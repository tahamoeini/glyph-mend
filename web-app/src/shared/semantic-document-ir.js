import { assertSafeStructuredValue } from "./security-boundaries.js";
import { TABLE_IR_SCHEMA, validateTableIR } from "./table-ir.js";

/**
 * Semantic Document IR v2 is the stable, JSON-safe contract between page
 * extraction, layout analysis, reconstruction, provenance, quality reports,
 * and exporters. The existing extraction/document-ir.js module remains the
 * compatibility shape; adapters in this module make that shape consumable
 * without changing its current output.
 */
export const SEMANTIC_DOCUMENT_IR_SCHEMA = "glyphmend.semantic-document-ir";
export const SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION = 2;

export const SEMANTIC_DOCUMENT_NODE_TYPES = Object.freeze([
  "heading",
  "paragraph",
  "quote",
  "list",
  "list-item",
  "table",
  "equation",
  "figure",
  "chart",
  "caption",
  "footnote",
  "header-footer",
  "metadata",
  "unresolved-visual",
]);

export const SEMANTIC_DOCUMENT_DISPOSITIONS = Object.freeze([
  "reconstructed",
  "reconstructed-with-source",
  "preserved-source",
  "needs-review",
  "unsupported",
  "omitted-decoration",
]);

export const SEMANTIC_DOCUMENT_SOURCE_KINDS = Object.freeze([
  "native-text",
  "ocr-text",
  "image",
  "vector",
  "mixed",
  "table-lines",
  "source-crop",
  "derived",
  "metadata",
  "legacy",
  "unknown",
]);

export const SEMANTIC_DOCUMENT_COORDINATE_SPACES = Object.freeze([
  "page-points",
  "normalized-page",
  "crop-pixels",
  "document-points",
  "unknown",
]);

export const SEMANTIC_DOCUMENT_IR_LIMITS = Object.freeze({
  maxPages: 2000,
  maxNodes: 100_000,
  maxDiagnosticsPerNode: 64,
  maxTextCharacters: 16 * 1024 * 1024,
});

const NODE_TYPES = new Set(SEMANTIC_DOCUMENT_NODE_TYPES);
const DISPOSITIONS = new Set(SEMANTIC_DOCUMENT_DISPOSITIONS);
const SOURCE_KINDS = new Set(SEMANTIC_DOCUMENT_SOURCE_KINDS);
const COORDINATE_SPACES = new Set(SEMANTIC_DOCUMENT_COORDINATE_SPACES);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a plain object.`);
  return value;
}

function assertSafeJsonValue(value, label = "value", depth = 0, state = { nodes: 0 }) {
  if (depth > 32) throw new RangeError(`${label} exceeds the IR depth limit.`);
  state.nodes += 1;
  if (state.nodes > SEMANTIC_DOCUMENT_IR_LIMITS.maxNodes)
    throw new RangeError(`${label} exceeds the IR node limit.`);
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > SEMANTIC_DOCUMENT_IR_LIMITS.maxTextCharacters)
      throw new RangeError(`${label} exceeds the IR text limit.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJsonValue(item, `${label}[${index}]`, depth + 1, state));
    return;
  }
  assertRecord(value, label);
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${label} contains unsafe key ${key}.`);
    assertSafeJsonValue(child, `${label}.${key}`, depth + 1, state);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  assertSafeJsonValue(value, "Semantic Document IR");
  return JSON.stringify(canonicalize(value));
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isRecord(value)) return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = deepClone(child);
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hashText(value) {
  // FNV-1a is small, deterministic, and available in every supported browser.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deterministicId(prefix, value) {
  return `${prefix}-${hashText(canonicalJson(value))}`;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer.`);
  return number;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite.`);
  return number;
}

function confidence(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) throw new RangeError(`${label} must be between 0 and 1.`);
  return number;
}

function normalizeBBox(value, label) {
  if (value === null || value === undefined) return null;
  let bbox;
  if (Array.isArray(value) && value.length === 4) {
    bbox = { x0: value[0], y0: value[1], x1: value[2], y1: value[3] };
  } else if (isRecord(value)) {
    if (["x0", "y0", "x1", "y1"].every((key) => value[key] !== undefined)) {
      bbox = { x0: value.x0, y0: value.y0, x1: value.x1, y1: value.y1 };
    } else if (["x", "y", "width", "height"].every((key) => value[key] !== undefined)) {
      bbox = {
        x0: value.x,
        y0: value.y,
        x1: Number(value.x) + Number(value.width),
        y1: Number(value.y) + Number(value.height),
      };
    }
  }
  if (!bbox) throw new TypeError(`${label} must be [x0,y0,x1,y1] or a bbox object.`);
  for (const [key, number] of Object.entries(bbox)) bbox[key] = finiteNumber(number, `${label}.${key}`);
  if (bbox.x1 < bbox.x0 || bbox.y1 < bbox.y0) throw new RangeError(`${label} must have non-negative dimensions.`);
  return bbox;
}

function enumValue(value, allowed, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = requiredString(String(value), label);
  if (!allowed.has(text)) throw new TypeError(`${label} must be one of: ${[...allowed].join(", ")}.`);
  return text;
}

function idArray(value, label) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number") value = [value];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return [...new Set(value.map((item, index) => requiredString(String(item), `${label}[${index}]`)))].sort();
}

function normalizeDiagnostics(value, label = "diagnostics") {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > SEMANTIC_DOCUMENT_IR_LIMITS.maxDiagnosticsPerNode)
    throw new RangeError(`${label} exceeds the diagnostics limit.`);
  return value.map((diagnostic, index) => {
    const item = assertRecord(diagnostic, `${label}[${index}]`);
    const output = {
      code: requiredString(String(item.code || "UNSPECIFIED"), `${label}[${index}].code`),
      severity: enumValue(item.severity, new Set(["info", "warning", "error"]), "warning", `${label}[${index}].severity`),
      message: requiredString(String(item.message || "No diagnostic message."), `${label}[${index}].message`),
    };
    if (item.path !== undefined) output.path = requiredString(String(item.path), `${label}[${index}].path`);
    if (item.details !== undefined) {
      assertSafeJsonValue(item.details, `${label}[${index}].details`);
      output.details = deepClone(item.details);
    }
    return output;
  });
}

function normalizeRelationships(value, label = "relationships") {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value
    .map((relation, index) => {
      const item = assertRecord(relation, `${label}[${index}]`);
      return {
        type: requiredString(String(item.type), `${label}[${index}].type`),
        from: requiredString(String(item.from), `${label}[${index}].from`),
        to: requiredString(String(item.to), `${label}[${index}].to`),
      };
    })
    .sort((left, right) =>
      `${left.type}\u0000${left.from}\u0000${left.to}`.localeCompare(
        `${right.type}\u0000${right.from}\u0000${right.to}`,
      ),
    );
}

function normalizeContent(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") return { markdown: value, text: value };
  const content = assertRecord(value, label);
  assertSafeJsonValue(content, label);
  return deepClone(content);
}

function normalizeSource(value, sourceKind, label = "source") {
  const input = value === undefined || value === null ? {} : assertRecord(value, label);
  const source = {
    spanIds: idArray(input.spanIds ?? input.spanId, `${label}.spanIds`),
    objectIds: idArray(input.objectIds ?? input.objectId, `${label}.objectIds`),
    cropIds: idArray(input.cropIds ?? input.cropId, `${label}.cropIds`),
  };
  const known = new Set(["kind", "spanIds", "spanId", "objectIds", "objectId", "cropIds", "cropId", "extra"]);
  const extra = {};
  for (const [key, child] of Object.entries(input)) {
    if (!known.has(key)) extra[key] = deepClone(child);
  }
  if (input.extra !== undefined) {
    assertSafeJsonValue(input.extra, `${label}.extra`);
    Object.assign(extra, deepClone(input.extra));
  }
  if (Object.keys(extra).length) source.extra = extra;
  source.kind = sourceKind;
  return source;
}

function normalizeConfidence(value, label = "confidence") {
  const input = typeof value === "number" ? { legacyOverall: value } : value || {};
  const record = assertRecord(input, label);
  const legacyOverall = confidence(record.legacyOverall ?? record.overall, `${label}.overall`);
  return {
    extraction: confidence(record.extraction ?? record.extractionConfidence ?? legacyOverall, `${label}.extraction`),
    structure: confidence(record.structure ?? record.structureConfidence, `${label}.structure`),
    reconstruction: confidence(record.reconstruction ?? record.reconstructionConfidence, `${label}.reconstruction`),
    export: confidence(record.export ?? record.exportConfidence, `${label}.export`),
    ...(legacyOverall !== null ? { legacyOverall } : {}),
  };
}

function normalizeNodeType(value, label) {
  const type = String(value || "paragraph").toLowerCase();
  if (type === "text-block") return "paragraph";
  if (type === "header" || type === "footer") return "header-footer";
  if (type === "visual" || type === "source-page" || type === "image" || type === "diagram") return "figure";
  if (type === "equation-fallback") return "equation";
  if (!NODE_TYPES.has(type)) throw new TypeError(`${label} must be one of: ${[...NODE_TYPES].join(", ")}.`);
  return type;
}

function normalizeDisposition(value, node, source) {
  const legacy = { accepted: "reconstructed", review: "needs-review", preserved: "preserved-source" };
  if (value !== undefined && value !== null) {
    const mapped = legacy[String(value)] || String(value);
    if (!DISPOSITIONS.has(mapped)) throw new TypeError(`Invalid node disposition: ${value}.`);
    return mapped;
  }
  if (["figure", "chart", "unresolved-visual"].includes(node.type) || source.kind === "source-crop") return "preserved-source";
  return "reconstructed";
}

function normalizeNode(value, pageNumber, index, parentId = null) {
  const input = assertRecord(value, `pages[${pageNumber}].nodes[${index}]`);
  const type = normalizeNodeType(input.type ?? input.kind, `pages[${pageNumber}].nodes[${index}].type`);
  const sourceKind = enumValue(
    input.sourceKind ?? input.source?.kind,
    SOURCE_KINDS,
    type === "figure" || type === "chart" || type === "unresolved-visual" ? "source-crop" : "native-text",
    `pages[${pageNumber}].nodes[${index}].sourceKind`,
  );
  let content = normalizeContent(
    input.content ?? (input.markdown !== undefined || input.text !== undefined
      ? { markdown: input.markdown ?? input.text, text: input.text ?? input.rawText ?? input.markdown }
      : undefined),
    `pages[${pageNumber}].nodes[${index}].content`,
  );
  if (content.table?.schema === TABLE_IR_SCHEMA)
    content = { ...content, table: validateTableIR(content.table) };
  const source = normalizeSource(input.source, sourceKind, `pages[${pageNumber}].nodes[${index}].source`);
  const sourcePage = positiveInteger(input.sourcePage ?? input.page ?? pageNumber, "node.sourcePage");
  const bbox = normalizeBBox(input.bbox ?? input.source?.bbox, "node.bbox");
  const confidenceValue = normalizeConfidence(input.confidence, "node.confidence");
  const diagnostics = normalizeDiagnostics(input.diagnostics, "node.diagnostics");
  if (typeof input.confidence === "number" || input.confidence?.overall !== undefined) {
    diagnostics.push({
      code: "LEGACY_CONFIDENCE_DIMENSION",
      severity: "info",
      message: "A legacy overall confidence was mapped to extraction confidence; structure and export confidence remain separate.",
    });
  }
  const childValues = input.children === undefined ? [] : input.children;
  if (!Array.isArray(childValues)) throw new TypeError(`node.children must be an array.`);
  const identity = {
    page: sourcePage,
    index,
    parentId,
    type,
    source,
    content,
  };
  const id = input.id ? requiredString(String(input.id), "node.id") : deterministicId("node", identity);
  const children = childValues.map((child, childIndex) => normalizeNode(child, sourcePage, childIndex, id));
  const output = {
    id,
    type,
    content,
    children,
    sourcePage,
    bbox,
    coordinateSpace: enumValue(input.coordinateSpace, COORDINATE_SPACES, bbox ? "page-points" : "unknown", "node.coordinateSpace"),
    sourceKind,
    source,
    confidence: confidenceValue,
    disposition: normalizeDisposition(input.disposition, { type }, source),
    reconstructionVersion: positiveInteger(input.reconstructionVersion ?? 2, "node.reconstructionVersion"),
    diagnostics,
  };
  if (input.parentId || parentId) output.parentId = String(input.parentId || parentId);
  if (input.label !== undefined) output.label = requiredString(String(input.label), "node.label");
  return output;
}

function normalizePage(value, index) {
  const input = assertRecord(value, `pages[${index}]`);
  const pageNumber = positiveInteger(input.pageNumber ?? input.page ?? index + 1, `pages[${index}].pageNumber`);
  const nodeValues = input.nodes ?? input.blocks ?? [];
  if (!Array.isArray(nodeValues)) throw new TypeError(`pages[${index}].nodes must be an array.`);
  const pageIdentity = { pageNumber, index, sourcePage: input.sourcePage ?? pageNumber };
  const output = {
    id: input.id ? requiredString(String(input.id), `pages[${index}].id`) : deterministicId("page", pageIdentity),
    pageNumber,
    sourcePage: positiveInteger(input.sourcePage ?? pageNumber, `pages[${index}].sourcePage`),
    bbox: normalizeBBox(input.bbox, `pages[${index}].bbox`),
    coordinateSpace: enumValue(input.coordinateSpace, COORDINATE_SPACES, input.bbox ? "page-points" : "unknown", `pages[${index}].coordinateSpace`),
    nodes: nodeValues.map((node, nodeIndex) => normalizeNode(node, pageNumber, nodeIndex)),
    relationships: normalizeRelationships(input.relationships, `pages[${index}].relationships`),
    diagnostics: normalizeDiagnostics(input.diagnostics, `pages[${index}].diagnostics`),
  };
  if (input.layout !== undefined) {
    assertSafeJsonValue(input.layout, `pages[${index}].layout`);
    output.layout = deepClone(input.layout);
  }
  if (input.source !== undefined) {
    assertSafeJsonValue(input.source, `pages[${index}].source`);
    output.source = deepClone(input.source);
  }
  return output;
}

function normalizeDocument(input, { allowMissingVersion = false } = {}) {
  const source = assertRecord(input, "Semantic Document IR");
  assertSafeStructuredValue(source, "Semantic Document IR");
  if (!allowMissingVersion && source.schemaVersion !== SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION)
    throw new TypeError(`Semantic Document IR schemaVersion must be ${SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION}.`);
  if (source.schema !== undefined && source.schema !== SEMANTIC_DOCUMENT_IR_SCHEMA)
    throw new TypeError(`Semantic Document IR schema must be ${SEMANTIC_DOCUMENT_IR_SCHEMA}.`);
  const pageValues = source.pages ?? [];
  if (!Array.isArray(pageValues)) throw new TypeError("Semantic Document IR pages must be an array.");
  if (pageValues.length > SEMANTIC_DOCUMENT_IR_LIMITS.maxPages)
    throw new RangeError(`Semantic Document IR exceeds the ${SEMANTIC_DOCUMENT_IR_LIMITS.maxPages}-page limit.`);
  const pages = pageValues.map(normalizePage).sort((left, right) => left.pageNumber - right.pageNumber);
  const allIds = new Set();
  const collect = (node, label) => {
    if (allIds.has(node.id)) throw new TypeError(`${label} reuses node id ${node.id}.`);
    allIds.add(node.id);
    node.children.forEach((child, index) => collect(child, `${label}.children[${index}]`));
  };
  pages.forEach((page, pageIndex) => {
    if (allIds.has(page.id)) throw new TypeError(`pages[${pageIndex}] reuses id ${page.id}.`);
    allIds.add(page.id);
    page.nodes.forEach((node, nodeIndex) => collect(node, `pages[${pageIndex}].nodes[${nodeIndex}]`));
    page.relationships.forEach((relation, relationIndex) => {
      if (!allIds.has(relation.from) || !allIds.has(relation.to))
        throw new TypeError(`pages[${pageIndex}].relationships[${relationIndex}] references an unknown node.`);
    });
  });
  const metadata = source.metadata === undefined ? {} : source.metadata;
  assertSafeJsonValue(metadata, "Semantic Document IR metadata");
  const documentId = source.documentId ?? source.id ?? deterministicId("document", pages.map((page) => ({ id: page.id, nodes: page.nodes.map((node) => node.id) })));
  const output = {
    schema: SEMANTIC_DOCUMENT_IR_SCHEMA,
    schemaVersion: SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION,
    documentId: requiredString(String(documentId), "Semantic Document IR documentId"),
    metadata: deepClone(metadata),
    pages,
    diagnostics: normalizeDiagnostics(source.diagnostics, "Semantic Document IR diagnostics"),
  };
  if (source.quality !== undefined) {
    assertSafeJsonValue(source.quality, "Semantic Document IR quality");
    output.quality = deepClone(source.quality);
  }
  return deepFreeze(output);
}

function sourceKindForLegacy(block, type) {
  const method = String(block?.extractionMethod || block?.method || block?.provenance?.extractionMethod || "").toLowerCase();
  const kind = String(block?.kind || "").toLowerCase();
  if (/ocr/.test(method)) return "ocr-text";
  if (type === "figure" || type === "chart" || type === "unresolved-visual") {
    if (/vector|path/.test(kind)) return "vector";
    if (/image|raster|photo/.test(kind)) return "image";
    return "source-crop";
  }
  if (/table.*line|vector.*table/.test(method)) return "table-lines";
  if (/legacy/.test(method)) return "legacy";
  return "native-text";
}

function sourceIdsForLegacy(block) {
  const provenance = block?.provenance || block?.source || {};
  return {
    spanIds: provenance.spanIds ?? provenance.spanId ?? block?.sourceSpanIds ?? [],
    objectIds: provenance.objectIds ?? provenance.objectId ?? block?.sourceObjectIds ?? [],
    cropIds: provenance.cropIds ?? provenance.cropId ?? provenance.assetId ?? provenance.sourceAssetId ?? block?.assetId ?? block?.sourceAssetId ?? [],
    legacyBlockId: block?.id ? String(block.id) : undefined,
  };
}

function listItemChildren(markdown, pageNumber, parentIdentity) {
  const lines = String(markdown || "").split("\n").filter((line) => /^\s*(?:[-*+] |\d+[.)]\s+)/.test(line));
  return lines.map((line, index) => ({
    id: deterministicId("list-item", { parent: parentIdentity, index, line }),
    type: "list-item",
    content: { markdown: line.trim(), text: line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, "").trim() },
    children: [],
    sourcePage: pageNumber,
    bbox: null,
    coordinateSpace: "unknown",
    sourceKind: "native-text",
    source: { legacyListItem: true },
    confidence: { extraction: null, structure: null, reconstruction: null, export: null },
    disposition: "reconstructed",
    reconstructionVersion: 2,
    diagnostics: [],
  }));
}

function legacyNode(block, pageNumber, index) {
  const legacyType = String(block?.layoutType || block?.type || block?.kind || "paragraph").toLowerCase();
  const type = normalizeNodeType(legacyType, "legacy block type");
  const markdown = String(block?.markdown ?? block?.text ?? "");
  const sourceIds = sourceIdsForLegacy(block);
  const sourceKind = sourceKindForLegacy(block, type);
  const confidenceInput = block?.confidence;
  const identity = { pageNumber, index, legacyId: block?.id || null, type, markdown, sourceIds };
  const id = deterministicId("node", identity);
  const content = {
    ...(markdown ? { markdown, text: String(block?.rawText ?? block?.text ?? markdown) } : {}),
    ...(block?.caption ? { caption: String(block.caption) } : {}),
    ...(block?.tableIR || block?.table ? { table: deepClone(block.tableIR || block.table) } : {}),
    ...(block?.headingLevel ? { headingLevel: Number(block.headingLevel) } : {}),
    legacyType,
  };
  const node = {
    id,
    type,
    content,
    children: type === "list" ? listItemChildren(markdown, pageNumber, identity) : [],
    sourcePage: pageNumber,
    bbox: normalizeBBox(block?.bbox ?? block?.source?.bbox, "legacy block bbox"),
    coordinateSpace: block?.coordinateSpace || (block?.bbox ? "page-points" : "unknown"),
    sourceKind,
    source: sourceIds,
    confidence: normalizeConfidence({
      ...(typeof confidenceInput === "object" ? confidenceInput : { legacyOverall: confidenceInput }),
      ...(block?.structureConfidence !== undefined ? { structure: block.structureConfidence } : {}),
      ...(block?.reconstructionConfidence !== undefined ? { reconstruction: block.reconstructionConfidence } : {}),
      ...(block?.exportConfidence !== undefined ? { export: block.exportConfidence } : {}),
    }),
    disposition: normalizeDisposition(block?.disposition, { type }, { kind: sourceKind }),
    reconstructionVersion: 2,
    diagnostics: normalizeDiagnostics(block?.diagnostics, `legacy block ${index} diagnostics`),
  };
  if (typeof confidenceInput === "number" || confidenceInput?.overall !== undefined)
    node.diagnostics.push({
      code: "LEGACY_CONFIDENCE_DIMENSION",
      severity: "info",
      message: "Legacy scalar confidence was retained as extraction confidence only.",
    });
  return node;
}

/** Convert the current page/block DocumentIR into Semantic Document IR v2. */
export function semanticDocumentFromLegacyDocumentIR(legacyDocumentIR, metadata = {}) {
  const source = assertRecord(legacyDocumentIR, "Legacy DocumentIR");
  const pages = Array.isArray(source.pages) ? source.pages : [];
  return normalizeDocument({
    schema: SEMANTIC_DOCUMENT_IR_SCHEMA,
    schemaVersion: SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION,
    documentId: source.documentId || source.id,
    metadata: { ...(isRecord(source.metadata) ? source.metadata : {}), ...metadata },
    pages: pages.map((page, pageIndex) => {
      const pageNumber = page.page ?? page.sourcePage ?? pageIndex + 1;
      const legacyBlocks = page.blocks || [];
      const nodes = legacyBlocks.map((block, index) => legacyNode(block, pageNumber, index));
      const idMap = new Map(
        legacyBlocks
          .filter((block) => block?.id)
          .map((block, index) => [String(block.id), nodes[index].id]),
      );
      const relationships = (page.relationships || [])
        .map((relation) => ({
          ...relation,
          from: idMap.get(String(relation.from)) || String(relation.from),
          to: idMap.get(String(relation.to)) || String(relation.to),
        }))
        .filter((relation) => nodes.some((node) => node.id === relation.from) && nodes.some((node) => node.id === relation.to));
      return {
        pageNumber,
        sourcePage: page.sourcePage ?? pageNumber,
        bbox: page.bbox,
        coordinateSpace: page.coordinateSpace,
        nodes,
        relationships,
        diagnostics: page.diagnostics,
        layout: page.layout,
        source: { legacyPage: pageNumber },
      };
    }),
  });
}

/** Convert v2 back to the existing page/block compatibility shape. */
export function legacyDocumentIRFromSemanticDocument(document) {
  const value = validateSemanticDocumentIR(document);
  return {
    schemaVersion: 2,
    metadata: deepClone(value.metadata),
    pages: value.pages.map((page) => ({
      page: page.pageNumber,
      sourcePage: page.sourcePage,
      bbox: page.bbox ? [page.bbox.x0, page.bbox.y0, page.bbox.x1, page.bbox.y1] : null,
      blocks: page.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        kind: node.type,
        markdown: String(node.content.markdown ?? node.content.text ?? ""),
        rawText: node.content.text,
        bbox: node.bbox ? [node.bbox.x0, node.bbox.y0, node.bbox.x1, node.bbox.y1] : null,
        confidence: node.confidence.extraction,
        extractionMethod: `semantic-document-ir-v${node.reconstructionVersion}`,
        children: node.children.map((child) => child.id),
        source: deepClone(node.source),
      })),
      relationships: deepClone(page.relationships),
      layout: deepClone(page.layout),
    })),
  };
}

/** Create a v2 document from raw v2-compatible input and freeze it. */
export function createSemanticDocumentIR(input = {}) {
  return normalizeDocument({
    schema: SEMANTIC_DOCUMENT_IR_SCHEMA,
    schemaVersion: SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION,
    ...input,
  }, { allowMissingVersion: true });
}

/** Validate and normalize external/worker JSON at the v2 boundary. */
export function validateSemanticDocumentIR(value) {
  return normalizeDocument(value);
}

export function serializeSemanticDocumentIR(value) {
  return canonicalJson(validateSemanticDocumentIR(value));
}

export function deserializeSemanticDocumentIR(value) {
  if (typeof value !== "string") throw new TypeError("Serialized Semantic Document IR must be a string.");
  return validateSemanticDocumentIR(JSON.parse(value));
}

export function compareSemanticDocumentIR(left, right) {
  return serializeSemanticDocumentIR(left) === serializeSemanticDocumentIR(right);
}

/** Markdown compatibility adapter. It intentionally preserves existing block Markdown verbatim. */
export function semanticDocumentToMarkdown(value, { preserveMarkers = false } = {}) {
  const document = validateSemanticDocumentIR(value);
  return document.pages
    .slice()
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => {
      const blocks = page.nodes
        .filter((node) => node.disposition !== "omitted-decoration")
        .map((node) => String(node.content.markdown ?? node.content.text ?? "").trim())
        .filter(Boolean);
      const body = blocks.join("\n\n");
      return `${preserveMarkers ? `<!-- page: ${page.pageNumber} -->\n\n` : ""}${body}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

export function semanticDocumentQualityReport(value) {
  const document = validateSemanticDocumentIR(value);
  const nodes = document.pages.flatMap((page) => page.nodes);
  const allDiagnostics = [
    ...document.diagnostics,
    ...document.pages.flatMap((page) => [...page.diagnostics, ...page.nodes.flatMap((node) => node.diagnostics)]),
  ];
  const confidenceReport = {};
  for (const dimension of ["extraction", "structure", "reconstruction", "export"]) {
    const values = nodes.map((node) => node.confidence[dimension]).filter((item) => item !== null);
    confidenceReport[dimension] = {
      known: values.length,
      unknown: nodes.length - values.length,
      minimum: values.length ? Math.min(...values) : null,
      maximum: values.length ? Math.max(...values) : null,
      mean: values.length ? Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(6)) : null,
    };
  }
  const countBy = (items) => Object.fromEntries(
    [...new Set(items)].sort().map((key) => [key, items.filter((item) => item === key).length]),
  );
  const tables = nodes
    .map((node) => node.content?.table)
    .filter((table) => table?.schema === TABLE_IR_SCHEMA);
  const tableConfidence = {};
  for (const dimension of ["detection", "structure", "content", "export"]) {
    const values = tables.map((table) => table.confidence[dimension]).filter((item) => item !== null);
    tableConfidence[dimension] = {
      known: values.length,
      unknown: tables.length - values.length,
      minimum: values.length ? Math.min(...values) : null,
      maximum: values.length ? Math.max(...values) : null,
      mean: values.length ? Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(6)) : null,
    };
  }
  return {
    schema: SEMANTIC_DOCUMENT_IR_SCHEMA,
    schemaVersion: SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION,
    documentId: document.documentId,
    pages: document.pages.length,
    nodes: nodes.length,
    nodeTypes: countBy(nodes.map((node) => node.type)),
    dispositions: countBy(nodes.map((node) => node.disposition)),
    confidence: confidenceReport,
    tables: {
      count: tables.length,
      cells: tables.reduce((sum, table) => sum + table.cells.length, 0),
      unresolvedCellDiagnostics: tables.reduce((sum, table) => sum + table.unresolvedCellDiagnostics.length, 0),
      dispositions: countBy(tables.map((table) => table.disposition)),
      confidence: tableConfidence,
    },
    provenance: {
      nodesWithBbox: nodes.filter((node) => node.bbox).length,
      nodesWithSourceSpan: nodes.filter((node) => node.source.spanIds.length).length,
      nodesWithSourceObject: nodes.filter((node) => node.source.objectIds.length).length,
      nodesWithSourceCrop: nodes.filter((node) => node.source.cropIds.length).length,
    },
    diagnostics: countBy(allDiagnostics.map((diagnostic) => diagnostic.code)),
  };
}

export function semanticDocumentToDocxMarkdown(value, options = {}) {
  return semanticDocumentToMarkdown(value, { preserveMarkers: options.preserveMarkers ?? true });
}
