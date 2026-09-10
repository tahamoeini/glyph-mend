function rect(value) {
  if (Array.isArray(value) && value.length >= 4)
    return value.slice(0, 4).map(Number);
  if (!value || typeof value !== "object") return null;
  if ([value.x, value.y, value.w, value.h].every(Number.isFinite))
    return [value.x, value.y, value.x + value.w, value.y + value.h];
  if ([value.x0, value.y0, value.x1, value.y1].every(Number.isFinite))
    return [value.x0, value.y0, value.x1, value.y1];
  return null;
}

export function enrichStructuredTextOptions(options = "") {
  const values = new Set(
    String(options || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  // The browser extractor depends on images, font spans, and page segmentation.
  // paragraph-break prevents a whole page from collapsing into one semantic
  // block, while table-hunt lets MuPDF split table regions on segmented pages.
  for (const option of [
    "preserve-images",
    "preserve-spans",
    "segment",
    "paragraph-break",
    "table-hunt",
    "vectors",
  ])
    values.add(option);

  return [...values].join(",");
}

function collectImageRects(nodes, result) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "image") {
      const bbox = rect(node.bbox);
      if (bbox?.every(Number.isFinite) && bbox[2] > bbox[0] && bbox[3] > bbox[1])
        result.push(bbox);
    }
    collectImageRects(node.blocks, result);
    collectImageRects(node.children, result);
  }
}

export function jsonImageRects(structured) {
  try {
    const data = JSON.parse(structured.asJSON());
    const result = [];
    collectImageRects(data?.blocks, result);
    return dedupeRects(result);
  } catch {
    return [];
  }
}

function overlapRatio(a, b) {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const smaller = Math.min(
    (a[2] - a[0]) * (a[3] - a[1]),
    (b[2] - b[0]) * (b[3] - b[1]),
  );
  return smaller > 0 ? intersection / smaller : 0;
}

export function dedupeRects(rects) {
  const result = [];
  for (const bbox of rects) {
    if (!result.some((existing) => overlapRatio(existing, bbox) >= 0.97))
      result.push(bbox);
  }
  return result;
}

function patchPageExtraction(mupdf) {
  const prototype = mupdf?.Page?.prototype;
  if (!prototype?.toStructuredText || prototype.__pdfSanitizerStructuredOptions)
    return;
  const original = prototype.toStructuredText;
  prototype.toStructuredText = function toStructuredText(options = "") {
    return original.call(this, enrichStructuredTextOptions(options));
  };
  Object.defineProperty(prototype, "__pdfSanitizerStructuredOptions", {
    value: true,
    configurable: true,
  });
}

function patchStructuredWalk(mupdf) {
  const prototype = mupdf?.StructuredText?.prototype;
  if (!prototype?.walk || prototype.__pdfSanitizerImageRecovery) return;
  const original = prototype.walk;

  prototype.walk = function walkWithImageRecovery(walker = {}) {
    const seen = [];
    const wrapped = {
      ...walker,
      onImageBlock: (bbox, transform, image) => {
        const normalized = rect(bbox);
        if (normalized) seen.push(normalized);
        return walker.onImageBlock?.call(walker, bbox, transform, image);
      },
    };

    const result = original.call(this, wrapped);
    if (typeof walker.onImageBlock !== "function") return result;

    // Some segmented MuPDF pages expose image blocks in asJSON() but do not
    // surface all of them through walk(). The extractor only needs the bbox to
    // crop the source page, so replay the missing JSON image regions with a
    // no-op image handle. This preserves tables/formulas instead of dropping
    // them silently and does not duplicate image objects already walked.
    for (const bbox of jsonImageRects(this)) {
      if (seen.some((existing) => overlapRatio(existing, bbox) >= 0.97)) continue;
      walker.onImageBlock.call(walker, bbox, null, { destroy() {} });
    }
    return result;
  };

  Object.defineProperty(prototype, "__pdfSanitizerImageRecovery", {
    value: true,
    configurable: true,
  });
}

export function installMuPdfStructuredRecovery(mupdf) {
  try {
    patchPageExtraction(mupdf);
    patchStructuredWalk(mupdf);
  } catch {
    // The adapter must never prevent MuPDF from loading. Browser integration
    // tests verify that the supported MuPDF build receives both patches.
  }
  return mupdf;
}
