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

  // Keep the source's text/image/style information and ask MuPDF for its
  // paragraph/table analysis. Vector graphics are collected separately by the
  // extraction worker's page device, so requesting them here would duplicate
  // the same geometry.
  for (const option of [
    "preserve-images",
    "preserve-spans",
    "segment",
    "paragraph-break",
    "table-hunt",
  ])
    values.add(option);

  return [...values].join(",");
}

function parseStructured(structured) {
  try {
    return JSON.parse(structured.asJSON());
  } catch {
    return null;
  }
}

function collectNodes(nodes, type, result) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    if (node.type === type) result.push(node);
    collectNodes(node.blocks, type, result);
    collectNodes(node.children, type, result);
  }
  return result;
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

function verticalOverlap(a, b) {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const smaller = Math.min(a[3] - a[1], b[3] - b[1]);
  return smaller > 0 ? overlap / smaller : 0;
}

function horizontalOverlap(a, b) {
  const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const smaller = Math.min(a[2] - a[0], b[2] - b[0]);
  return smaller > 0 ? overlap / smaller : 0;
}

function unionRect(a, b) {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

export function coalesceImageRects(rects) {
  const result = [];
  for (const source of [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    let bbox = [...source];
    let changed = true;
    while (changed) {
      changed = false;
      const index = result.findIndex((existing) => {
        const h = Math.max(existing[3] - existing[1], bbox[3] - bbox[1], 1);
        const w = Math.max(existing[2] - existing[0], bbox[2] - bbox[0], 1);
        const horizontalGap = Math.max(0, Math.max(existing[0], bbox[0]) - Math.min(existing[2], bbox[2]));
        const verticalGap = Math.max(0, Math.max(existing[1], bbox[1]) - Math.min(existing[3], bbox[3]));
        return (
          (verticalOverlap(existing, bbox) >= 0.45 && horizontalGap <= Math.max(10, h * 2.4)) ||
          (horizontalOverlap(existing, bbox) >= 0.55 && verticalGap <= Math.max(3, Math.min(h, w) * 0.3))
        );
      });
      if (index >= 0) {
        bbox = unionRect(result[index], bbox);
        result.splice(index, 1);
        changed = true;
      }
    }
    result.push(bbox);
  }
  return result.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function expandTechnicalFragments(rects) {
  return rects.map((bbox) => {
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    // Many older technical PDFs encode equation fragments as small image
    // XObjects. Give substantive short fragments enough context that the
    // worker's conservative minimum-area filter retains a useful source crop.
    if (width >= 20 && width < 180 && height <= 40)
      return [bbox[0] - 8, bbox[1] - 5, bbox[2] + 8, bbox[3] + 5];
    return bbox;
  });
}

export function jsonImageRects(structured) {
  const data = parseStructured(structured);
  if (!data) return [];
  const result = [];
  collectImageRects(data?.blocks, result);
  return expandTechnicalFragments(coalesceImageRects(dedupeRects(result)));
}

function lineText(line) {
  return String(line?.text || "").replace(/\s+/g, " ").trim();
}

function lineSize(line) {
  const bbox = rect(line?.bbox);
  return Number(line?.font?.size) || (bbox ? Math.max(6, bbox[3] - bbox[1]) : 10);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function titleLike(text) {
  if (!text || text.length > 120 || /[.!?;:]$/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 14) return false;
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  const upper =
    letters.filter((char) => char === char.toUpperCase()).length /
    Math.max(1, letters.length);
  return (
    upper > 0.7 ||
    words.every((word) =>
      /^(?:[A-Z][\p{L}'’&-]*|(?:and|of|the|to|in|for|a|an))$/u.test(word),
    )
  );
}

function headingLine(line, bodySize) {
  const text = lineText(line);
  if (!text) return false;
  if (/^chapter\s+(?:\d+|[ivxlcdm]+)\b/i.test(text)) return true;
  if (/^\d+(?:\.\d+)+\.?\s+\S/.test(text)) return true;
  if (/^\d+\.\s+[A-Z][A-Z\s&-]{3,}$/.test(text)) return true;
  const font = line?.font || {};
  const bold = /bold|semibold|demi/i.test(`${font.weight || ""} ${font.name || ""}`);
  return titleLike(text) && (lineSize(line) >= bodySize * 1.14 || bold);
}

function segmentedTextBlocks(textBlocks) {
  const sizes = textBlocks.flatMap((block) =>
    (block.lines || []).map(lineSize).filter((size) => size > 4 && size < 40),
  );
  const bodySize = median(sizes);
  const result = [];

  for (const block of textBlocks) {
    const lines = (block.lines || []).filter((line) => lineText(line));
    if (lines.length <= 1) {
      if (lines.length) result.push({ ...block, lines });
      continue;
    }

    let body = [];
    const flushBody = () => {
      if (!body.length) return;
      result.push({ ...block, lines: body });
      body = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const current = lines[index];
      const text = lineText(current);
      const pureSection = /^\d+(?:\.\d+){1,5}\.?$/.test(text);
      if (pureSection && index + 1 < lines.length) {
        const next = lines[index + 1];
        if (titleLike(lineText(next)) || headingLine(next, bodySize)) {
          flushBody();
          result.push({ ...block, lines: [current, next] });
          index += 1;
          continue;
        }
      }
      if (headingLine(current, bodySize)) {
        flushBody();
        result.push({ ...block, lines: [current] });
      } else body.push(current);
    }
    flushBody();
  }
  return result;
}

function textBlocksFromData(data) {
  return segmentedTextBlocks(collectNodes(data?.blocks, "text", []));
}

function replayTextBlock(walker, block) {
  const lines = (block.lines || []).filter((line) => lineText(line));
  if (!lines.length) return;
  const blockBox = rect(block.bbox) || rect(lines[0].bbox);
  walker.beginTextBlock?.(blockBox || [0, 0, 1, 1]);
  for (const line of lines) {
    const text = lineText(line);
    const bbox = rect(line.bbox) || blockBox || [0, 0, Math.max(1, text.length), 10];
    const size = lineSize(line);
    const width = Math.max(1, bbox[2] - bbox[0]);
    const advance = width / Math.max(1, [...text].length);
    walker.beginLine?.(bbox);
    [...text].forEach((character, index) => {
      const x0 = bbox[0] + index * advance;
      const x1 = bbox[0] + (index + 1) * advance;
      walker.onChar?.(
        character,
        [x0, bbox[3]],
        line.font || null,
        size,
        [x0, bbox[1], x1, bbox[1], x1, bbox[3], x0, bbox[3]],
      );
    });
    walker.endLine?.();
  }
  walker.endTextBlock?.();
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

  prototype.walk = function walkWithStructuredRecovery(walker = {}) {
    const data = parseStructured(this);
    const jsonTextBlocks = textBlocksFromData(data);
    const jsonImages = jsonImageRects(this);

    // A recurring failure mode in tagged/older technical PDFs is that walk()
    // exposes one page-wide text block even though asJSON() still contains the
    // real block hierarchy. In that case, do not let the collapsed walk erase
    // headings, paragraphs and technical-object positions: replay the richer
    // JSON representation directly into the same public walker callbacks.
    if (jsonTextBlocks.length > 1 && typeof walker.beginTextBlock === "function") {
      for (const block of jsonTextBlocks) replayTextBlock(walker, block);
      if (typeof walker.onImageBlock === "function")
        for (const bbox of jsonImages)
          walker.onImageBlock.call(walker, bbox, null, { destroy() {} });
      return undefined;
    }

    const seenImages = [];
    const wrapped = {
      ...walker,
      onImageBlock: (bbox, transform, image) => {
        const normalized = rect(bbox);
        if (normalized) seenImages.push(normalized);
        return walker.onImageBlock?.call(walker, bbox, transform, image);
      },
    };

    const result = original.call(this, wrapped);
    if (typeof walker.onImageBlock !== "function") return result;

    for (const bbox of jsonImages) {
      if (seenImages.some((existing) => overlapRatio(existing, bbox) >= 0.97)) continue;
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
    // tests verify the supported MuPDF build against this recovery layer.
  }
  return mupdf;
}
