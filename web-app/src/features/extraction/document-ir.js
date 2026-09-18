/**
 * The page extractor speaks in coordinates; the rest of the product should
 * speak in document semantics. DocumentIR is the small, serializable seam
 * between those two concerns. It deliberately carries source geometry as
 * provenance, but Markdown generation consumes the ordered semantic blocks,
 * never the PDF coordinates directly.
 */
export const DOCUMENT_IR_SCHEMA_VERSION = 1;

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "list",
  "table",
  "figure",
  "equation",
  "caption",
  "text-block",
]);

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
  const kind = String(block?.kind || "").toLowerCase();
  if (kind === "table") return "table";
  if (kind === "equation" || kind === "equation-fallback") return "equation";
  if (["visual", "source-page", "diagram"].includes(kind)) return "figure";
  if (kind === "caption") return "caption";
  const markdown = String(block?.markdown || "").trim();
  if (/^#{1,6}\s+/.test(markdown)) return "heading";
  if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(markdown)) return "list";
  if (/^(?:figure|fig\.|table)\s+\d+/i.test(plainText(block?.rawText || markdown)))
    return "caption";
  return "paragraph";
}

function normalizeBlock(block, page, index) {
  if (!block || typeof block !== "object") return null;
  const markdown = String(block.markdown ?? block.text ?? "").trim();
  if (!markdown) return null;
  const bbox = finiteBBox(block.bbox);
  const confidence = finiteConfidence(
    block.confidence?.overall ?? block.confidence ?? block.quality?.overall,
  );
  const source = {
    page,
    ...(bbox ? { bbox } : {}),
  };
  if (block.assetId || block.sourceAssetId)
    source.assetId = String(block.assetId || block.sourceAssetId);
  if (block.provenance && typeof block.provenance === "object")
    source.provenance = block.provenance;

  return {
    id: String(block.id || `p${page}-block-${index + 1}`),
    type: inferredType(block),
    kind: String(block.kind || "text"),
    markdown,
    ...(block.rawText ? { rawText: String(block.rawText) } : {}),
    ...(bbox ? { bbox } : {}),
    ...(confidence === undefined ? {} : { confidence }),
    ...(block.caption ? { caption: String(block.caption) } : {}),
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
  const reference = {
    id: String(asset.id || `p${page}-asset`),
    kind: String(asset.kind || "unknown"),
    page: Number(asset.page || page),
  };
  const bbox = finiteBBox(asset.bbox);
  if (bbox) reference.bbox = bbox;
  if (asset.caption) reference.caption = String(asset.caption);
  if (asset.sourceType) reference.sourceType = String(asset.sourceType);
  if (asset.provenance && typeof asset.provenance === "object")
    reference.provenance = asset.provenance;
  return reference;
}

export function pageDocumentIR(page, { blocks, assets, quality } = {}) {
  const pageNumber = Number(page?.page ?? page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1)
    throw new TypeError("DocumentIR page must be a positive integer.");
  const sourceBlocks = blocks || page?.documentIR?.blocks || page?.blocks;
  const normalizedBlocks = (Array.isArray(sourceBlocks) && sourceBlocks.length
    ? sourceBlocks
    : legacyBlocks(page?.text, pageNumber))
    .map((block, index) => normalizeBlock(block, pageNumber, index))
    .filter(Boolean);
  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    page: pageNumber,
    blocks: normalizedBlocks,
    assets: (assets || page?.assets || [])
      .map((asset) => assetReference(asset, pageNumber))
      .filter(Boolean),
    ...(quality && typeof quality === "object" ? { quality } : {}),
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
  return documentIR.pages
    .slice()
    .sort((left, right) => Number(left.page) - Number(right.page))
    .map((page) => {
      const blocks = (page.blocks || [])
        .map((block) => String(block?.markdown || "").trim())
        .filter(Boolean);
      const body = blocks.join("\n\n");
      return `${preserveMarkers ? `<!-- page: ${page.page} -->\n\n` : ""}${body}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

export function documentIRMetrics(documentIR) {
  const blocks = (documentIR?.pages || []).flatMap((page) => page.blocks || []);
  return {
    pages: (documentIR?.pages || []).length,
    textBlocks: blocks.filter((block) => ["paragraph", "text-block"].includes(block.type)).length,
    paragraphs: blocks.filter((block) => block.type === "paragraph").length,
    headings: blocks.filter((block) => block.type === "heading").length,
    lists: blocks.filter((block) => block.type === "list").length,
    tables: blocks.filter((block) => block.type === "table").length,
    figures: blocks.filter((block) => block.type === "figure").length,
    equations: blocks.filter((block) => block.type === "equation").length,
    captions: blocks.filter((block) => block.type === "caption").length,
  };
}
