import {
  semanticDocumentFromLegacyDocumentIR,
  semanticDocumentToMarkdown,
} from "../../shared/semantic-document-ir.js";
import { TABLE_IR_SCHEMA, validateTableIR } from "../../shared/table-ir.js";
import { parseEquationIR } from "../../shared/equation-ir.js";

/**
 * The page extractor speaks in coordinates; the rest of the product should
 * speak in document semantics. DocumentIR is the serializable seam between
 * those concerns. Coordinates remain evidence and provenance, while Markdown
 * and DOCX generation consume the ordered semantic block stream.
 */
export const DOCUMENT_IR_SCHEMA_VERSION = 2;

export const DOCUMENT_BLOCK_TYPES = Object.freeze([
  "heading",
  "paragraph",
  "list",
  "table",
  "figure",
  "equation",
  "caption",
  "footnote",
  "text-block",
]);

const BLOCK_TYPES = new Set(DOCUMENT_BLOCK_TYPES);

function finiteBBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const bbox = value.map(Number);
  return bbox.every(Number.isFinite) ? bbox : undefined;
}

function finiteConfidence(value) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : undefined;
}

function plainText(value) {
  return String(value || "")
    .replace(/<!--.*?-->/gs, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferredType(block) {
  if (BLOCK_TYPES.has(block?.type)) return block.type;
  if (BLOCK_TYPES.has(block?.layoutType)) return block.layoutType;
  if (block?.layoutType === "list-item") return "list";
  const kind = String(block?.kind || "").toLowerCase();
  if (kind === "table") return "table";
  if (kind === "equation" || kind === "equation-fallback") return "equation";
  if (["visual", "source-page", "diagram", "chart", "image"].includes(kind))
    return "figure";
  if (kind === "caption") return "caption";
  if (kind === "footnote" || kind === "foot-note") return "footnote";
  const markdown = String(block?.markdown || block?.text || "").trim();
  if (/^\[\^[^\]]+\]:\s+/u.test(markdown)) return "footnote";
  if (/^#{1,6}\s+/.test(markdown)) return "heading";
  if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(markdown)) return "list";
  if (/^(?:figure|fig\.|table)\s+\d+/i.test(plainText(block?.rawText || markdown)))
    return "caption";
  return "paragraph";
}

function extractionMethod(block, type) {
  const explicit =
    block?.extractionMethod ||
    block?.method ||
    block?.provenance?.extractionMethod ||
    block?.source?.extractionMethod;
  if (explicit) return String(explicit);
  return (
    {
      heading: "heading-classifier",
      paragraph: "mupdf-structured-text",
      "text-block": "legacy-text",
      list: "layout-list",
      table: "validated-table-geometry",
      figure: "source-preservation",
      equation: "validated-equation",
      caption: "layout-caption",
      footnote: "layout-footnote",
    }[type] || "layout-text"
  );
}

function confidenceFor(block, type, method) {
  const explicit = finiteConfidence(
    block?.confidence?.overall ?? block?.confidence ?? block?.quality?.overall,
  );
  if (explicit !== undefined) return { value: explicit, source: "extractor" };
  if (/ocr/i.test(method)) return { value: 0.72, source: "ocr-default" };
  if (/source-preservation|fallback/i.test(method))
    return { value: 0.5, source: "preservation-default" };
  if (["heading", "table", "equation"].includes(type))
    return { value: 0.5, source: "unvalidated-default" };
  return { value: 0.5, source: "not-provided" };
}

function childIds(block) {
  const children = block?.childrenIds || block?.children;
  if (!Array.isArray(children)) return [];
  return children
    .map((child) => (child && typeof child === "object" ? child.id : child))
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map(String);
}

function normalizeTableIR(value, fallbackConfidence = 0.5) {
  if (!value || typeof value !== "object") return undefined;
  if (value.schema === TABLE_IR_SCHEMA) {
    const table = validateTableIR(value);
    const cellsById = new Map(table.cells.map((cell) => [cell.id, cell]));
    return {
      schema: table.schema,
      schemaVersion: table.schemaVersion,
      tableId: table.tableId,
      bbox: table.bbox,
      coordinateSpace: table.coordinateSpace,
      rows: table.rows.map((row) => ({
        ...row,
        cells: row.cells.map((id) => cellsById.get(id)).filter(Boolean),
      })),
      columns: table.columns.length,
      columnDefinitions: table.columns,
      cells: table.cells,
      spans: table.cells
        .filter((cell) => cell.rowSpan > 1 || cell.colSpan > 1)
        .map((cell) => ({
          cellId: cell.id,
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          rowSpan: cell.rowSpan,
          colSpan: cell.colSpan,
        })),
      confidence: table.confidence.structure ?? fallbackConfidence,
      confidenceDimensions: table.confidence,
      source: table.source,
      detectedRules: table.detectedRules,
      alignment: table.alignment,
      ...(table.method ? { method: table.method } : {}),
      ...(table.caption ? { caption: table.caption } : {}),
      unresolvedCellDiagnostics: table.unresolvedCellDiagnostics,
      diagnostics: table.diagnostics,
      disposition: table.disposition,
      reconstructionVersion: table.reconstructionVersion,
      emptyCellPolicy: table.emptyCellPolicy,
    };
  }
  const normalizeCell = (cell) => {
    const bbox = finiteBBox(cell?.bbox);
    return {
      text: String(cell?.text ?? cell ?? ""),
      rowSpan: Math.max(1, Number(cell?.rowSpan) || 1),
      colSpan: Math.max(1, Number(cell?.colSpan) || 1),
      ...(bbox ? { bbox } : {}),
    };
  };
  const rows = Array.isArray(value.rows)
    ? value.rows.map((row) => {
        if (Array.isArray(row))
          return {
            cells: row.map(normalizeCell),
          };
        return {
          cells: Array.isArray(row?.cells)
            ? row.cells.map(normalizeCell)
            : [],
        };
      })
    : [];
  if (!rows.length) return undefined;
  return {
    rows,
    columns: Math.max(
      0,
      Number(value.columns) || Math.max(...rows.map((row) => row.cells.length), 0),
    ),
    spans: Array.isArray(value.spans)
      ? value.spans.map((span) => ({ ...span }))
      : [],
    confidence: finiteConfidence(value.confidence) ?? fallbackConfidence,
    ...(value.multiPageKey ? { multiPageKey: String(value.multiPageKey) } : {}),
  };
}

function normalizeLayout(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    orderMethod: value.orderMethod ? String(value.orderMethod) : "unknown",
    columns: Math.max(1, Number(value.columns) || 1),
    confidence: finiteConfidence(value.confidence) ?? 0.5,
    ...(value.direction ? { direction: String(value.direction) } : {}),
    ...(value.layerVersion ? { layerVersion: String(value.layerVersion) } : {}),
    ...(Array.isArray(value.diagnostics) ? { diagnostics: value.diagnostics.map((item) => ({ ...item })) } : {}),
    ...(value.metrics && typeof value.metrics === "object" ? { metrics: { ...value.metrics } } : {}),
  };
}

function normalizeBlock(block, page, index) {
  if (!block || typeof block !== "object") return null;
  const markdown = String(block.markdown ?? block.text ?? "").trim();
  if (!markdown) return null;
  const type = inferredType(block);
  const bbox = finiteBBox(block.bbox);
  const method = extractionMethod(block, type);
  const confidence = confidenceFor(block, type, method);
  const id = String(block.id || `p${page}-block-${index + 1}`);
  const provenance = block.provenance && typeof block.provenance === "object"
    ? block.provenance
    : {};
  const sourceSpanIds = block.sourceSpanIds ?? provenance.spanIds ?? provenance.spanId;
  const sourceObjectIds = block.sourceObjectIds ?? provenance.objectIds ?? provenance.objectId;
  const sourceCropIds = block.sourceCropIds ?? provenance.cropIds ?? provenance.cropId;
  const source = {
    page,
    sourcePage: page,
    extractionMethod: method,
    ...(bbox ? { bbox } : {}),
  };
  if (block.assetId || block.sourceAssetId)
    source.assetId = String(block.assetId || block.sourceAssetId);
  if (Object.keys(provenance).length) source.provenance = provenance;
  if (sourceSpanIds) source.spanIds = sourceSpanIds;
  if (sourceObjectIds) source.objectIds = sourceObjectIds;
  if (sourceCropIds) source.cropIds = sourceCropIds;

  const table = normalizeTableIR(block.tableIR || block.table, confidence.value);
  const equationIR = block.equationIR ? parseEquationIR(block.equationIR) : undefined;
  const inlineEquationIRs = Array.isArray(block.inlineEquationIRs)
    ? block.inlineEquationIRs.map((value) => parseEquationIR(value))
    : undefined;
  return {
    id,
    type,
    kind: String(block.kind || "text"),
    markdown,
    sourcePage: page,
    // `null` means geometry was not available. It is deliberately different
    // from a fabricated zero-sized box.
    bbox: bbox || null,
    confidence: confidence.value,
    confidenceSource: confidence.source,
    ...(block.structureConfidence !== undefined
      ? { structureConfidence: finiteConfidence(block.structureConfidence) }
      : {}),
    ...(block.reconstructionConfidence !== undefined
      ? { reconstructionConfidence: finiteConfidence(block.reconstructionConfidence) }
      : {}),
    ...(block.exportConfidence !== undefined
      ? { exportConfidence: finiteConfidence(block.exportConfidence) }
      : {}),
    ...(Array.isArray(block.diagnostics) ? { diagnostics: block.diagnostics.map((item) => ({ ...item })) } : {}),
    ...(sourceSpanIds ? { sourceSpanIds: Array.isArray(sourceSpanIds) ? [...sourceSpanIds] : [sourceSpanIds] } : {}),
    ...(sourceObjectIds ? { sourceObjectIds: Array.isArray(sourceObjectIds) ? [...sourceObjectIds] : [sourceObjectIds] } : {}),
    ...(sourceCropIds ? { sourceCropIds: Array.isArray(sourceCropIds) ? [...sourceCropIds] : [sourceCropIds] } : {}),
    extractionMethod: method,
    children: childIds(block),
    ...(block.parentId ? { parentId: String(block.parentId) } : {}),
    ...(block.rawText ? { rawText: String(block.rawText) } : {}),
    ...(block.caption ? { caption: String(block.caption) } : {}),
    ...(equationIR ? { equationIR } : {}),
    ...(inlineEquationIRs?.length
      ? { inlineEquationIRs }
      : {}),
    ...(table ? { table } : {}),
    source,
  };
}

function legacyBlocks(markdown, page) {
  return String(markdown || "")
    .replace(/^\s*<!--\s*page:\s*\d+\s*-->\s*$/gmu, "")
    .split(/\n{2,}/u)
    .map((value) => ({ markdown: value.trim(), kind: "text" }))
    .filter((value) => value.markdown)
    .map((value, index) => normalizeBlock(value, page, index))
    .filter(Boolean);
}

function assetReference(asset, page) {
  if (!asset || typeof asset !== "object") return null;
  const sourcePage = Number(asset.sourcePage || asset.page || page);
  const reference = {
    id: String(asset.id || `p${page}-asset`),
    kind: String(asset.kind || "unknown"),
    page: sourcePage,
    sourcePage,
    extractionMethod: String(
      asset.extractionMethod ||
        asset.provenance?.extractionMethod ||
        "source-preservation",
    ),
    confidence:
      finiteConfidence(asset.confidence?.overall ?? asset.confidence) ?? 0.5,
  };
  const bbox = finiteBBox(asset.bbox);
  reference.bbox = bbox || null;
  if (asset.caption) reference.caption = String(asset.caption);
  if (asset.sourceType) reference.sourceType = String(asset.sourceType);
  if (asset.provenance && typeof asset.provenance === "object")
    reference.provenance = asset.provenance;
  return reference;
}

function horizontalOverlap(a, b) {
  if (!a || !b) return false;
  return Math.min(a[2], b[2]) > Math.max(a[0], b[0]);
}

function verticalDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a[3] < b[1]) return b[1] - a[3];
  if (b[3] < a[1]) return a[1] - b[3];
  return 0;
}

function linkCaptionRelationships(blocks, existing = []) {
  const relationships = Array.isArray(existing)
    ? existing
        .filter((value) => value && value.from && value.to && value.type)
        .map((value) => ({
          type: String(value.type),
          from: String(value.from),
          to: String(value.to),
        }))
    : [];
  const byId = new Map(blocks.map((block) => [block.id, block]));
  for (const caption of blocks.filter((block) => block.type === "caption")) {
    if (caption.parentId) {
      const target = byId.get(caption.parentId);
      if (
        target &&
        !relationships.some(
          (relation) =>
            relation.type === "caption-for" &&
            relation.from === target.id &&
            relation.to === caption.id,
        )
      ) {
        if (!target.children.includes(caption.id)) target.children.push(caption.id);
        relationships.push({ type: "caption-for", from: target.id, to: caption.id });
      }
      continue;
    }
    if (caption.children.length) continue;
    const candidates = blocks
      .filter(
        (block) =>
          block !== caption &&
          ["figure", "table", "equation"].includes(block.type) &&
          !relationships.some(
            (relation) =>
              relation.type === "caption-for" && relation.to === caption.id,
          ),
      )
      .map((block) => ({
        block,
        distance: verticalDistance(caption.bbox, block.bbox),
        overlap: horizontalOverlap(caption.bbox, block.bbox),
      }))
      .filter((value) => value.overlap || value.distance <= 48)
      .sort(
        (left, right) =>
          Number(!left.overlap) - Number(!right.overlap) ||
          left.distance - right.distance,
      );
    const target = candidates[0]?.block;
    if (!target) continue;
    caption.parentId = target.id;
    if (!target.children.includes(caption.id)) target.children.push(caption.id);
    relationships.push({ type: "caption-for", from: target.id, to: caption.id });
  }
  return relationships.filter(
    (relation) => byId.has(relation.from) && byId.has(relation.to),
  );
}

export function pageDocumentIR(
  page,
  { blocks, assets, quality, layout, relationships } = {},
) {
  const pageNumber = Number(page?.page ?? page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1)
    throw new TypeError("DocumentIR page must be a positive integer.");
  const existing = page?.documentIR;
  const sourceBlocks = blocks || existing?.blocks || page?.blocks;
  const normalizedBlocks = (Array.isArray(sourceBlocks) && sourceBlocks.length
    ? sourceBlocks
    : legacyBlocks(page?.text, pageNumber))
    .map((block, index) => normalizeBlock(block, pageNumber, index))
    .filter(Boolean);
  const pageRelationships = linkCaptionRelationships(
    normalizedBlocks,
    relationships || existing?.relationships,
  );
  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    page: pageNumber,
    sourcePage: pageNumber,
    bbox: finiteBBox(page?.bbox) || null,
    blocks: normalizedBlocks,
    relationships: pageRelationships,
    assets: (assets || page?.assets || [])
      .map((asset) => assetReference(asset, pageNumber))
      .filter(Boolean),
    layout: normalizeLayout(layout || existing?.layout || page?.layout),
    quality: quality || existing?.quality || page?.quality || {},
  };
}

export function documentIRFromPages(pages = [], metadata = {}) {
  const normalizedPages = pages
    .filter(Boolean)
    .map((page) => pageDocumentIR(page))
    .sort((left, right) => left.page - right.page);
  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    metadata: { ...metadata },
    pages: normalizedPages,
  };
}

export function documentIRToMarkdown(documentIR, { preserveMarkers = false } = {}) {
  if (!documentIR || !Array.isArray(documentIR.pages)) return "";
  return semanticDocumentToMarkdown(
    semanticDocumentFromLegacyDocumentIR(documentIR),
    { preserveMarkers },
  );
}

/** Compatibility boundary for consumers migrating from block-oriented IR. */
export function documentIRToSemanticDocumentIR(documentIR, metadata = {}) {
  return semanticDocumentFromLegacyDocumentIR(documentIR, metadata);
}

export function documentIRMetrics(documentIR) {
  const blocks = (documentIR?.pages || []).flatMap((page) => page.blocks || []);
  return {
    pages: (documentIR?.pages || []).length,
    blocks: blocks.length,
    textBlocks: blocks.filter((block) => ["paragraph", "text-block"].includes(block.type)).length,
    paragraphs: blocks.filter((block) => block.type === "paragraph").length,
    headings: blocks.filter((block) => block.type === "heading").length,
    lists: blocks.filter((block) => block.type === "list").length,
    tables: blocks.filter((block) => block.type === "table").length,
    figures: blocks.filter((block) => block.type === "figure").length,
    equations: blocks.filter((block) => block.type === "equation").length,
    captions: blocks.filter((block) => block.type === "caption").length,
    footnotes: blocks.filter((block) => block.type === "footnote").length,
  };
}
