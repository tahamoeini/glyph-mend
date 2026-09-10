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
  const extractionWorkerPass =
    values.has("preserve-images") && values.has("preserve-spans");

  // Preserve the native text geometry that downstream structure detection needs.
  // The extraction worker already collects page vectors through a separate
  // Device pass, so asking StructuredText for vectors as well only duplicates
  // geometry and can suppress image-XObject recovery in MuPDF WASM.
  for (const option of [
    "preserve-images",
    "preserve-spans",
    "preserve-whitespace",
    "segment",
    "paragraph-break",
    "table-hunt",
  ])
    values.add(option);
  if (!extractionWorkerPass) values.add("vectors");

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
        const horizontalGap = Math.max(
          0,
          Math.max(existing[0], bbox[0]) - Math.min(existing[2], bbox[2]),
        );
        const verticalGap = Math.max(
          0,
          Math.max(existing[1], bbox[1]) - Math.min(existing[3], bbox[3]),
        );
        return (
          (verticalOverlap(existing, bbox) >= 0.45 &&
            horizontalGap <= Math.max(10, h * 2.4)) ||
          (horizontalOverlap(existing, bbox) >= 0.55 &&
            verticalGap <= Math.max(3, Math.min(h, w) * 0.3))
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
  if (typeof line?.text === "string")
    return line.text.replace(/\s+/g, " ").trim();
  return (line?.chars || [])
    .map((args) => String(args?.[0] || ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function charRect(args) {
  const quad = Array.isArray(args?.[4]) ? args[4] : [];
  if (quad.length < 4) return null;
  const xs = quad.filter((_, index) => index % 2 === 0).map(Number);
  const ys = quad.filter((_, index) => index % 2 === 1).map(Number);
  if (!xs.length || !ys.length || ![...xs, ...ys].every(Number.isFinite)) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function nativeLineSize(line) {
  const sizes = (line?.chars || [])
    .map((args) => Number(args?.[3]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (sizes.length) return median(sizes);
  const bbox = rect(line?.bbox);
  return bbox ? Math.max(6, bbox[3] - bbox[1]) : 10;
}

function jsonLineSize(line) {
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

function headingText(text, size, bodySize, font = null) {
  if (!text) return false;
  if (/^(?:chapter|appendix)\s+(?:\d+|[ivxlcdm]+)\b/i.test(text)) return true;
  if (/^(?:contents|list of (?:figures|tables)|preface|acknowledg(?:e)?ments|references|index)$/i.test(text))
    return true;
  if (/^\d+(?:\.\d+)+\.?\s+\S/.test(text)) return true;
  if (/^\d+\.\s+[A-Z][A-Z\s&-]{3,}$/.test(text)) return true;
  if (/^(?:theorem|proposition|definition|lemma|corollary|example)\s+\d/i.test(text))
    return true;
  const bold = /bold|semibold|demi/i.test(
    `${font?.weight || ""} ${font?.name || ""}`,
  );
  return titleLike(text) && (size >= bodySize * 1.14 || bold);
}

function listLine(text) {
  return /^(?:[-*+•◦▪‣]\s+|(?:\d+|[A-Za-z])\s*[.)]\s+|\([A-Za-z0-9]+\)\s+)/.test(
    text,
  );
}

function captionLine(text) {
  return /^(?:figure|fig\.|table)\s+\d+(?:\.\d+)*(?:[.:]|\b)/i.test(text);
}

function tocEntry(text) {
  return (
    text.length <= 180 &&
    /(?:^|\s)(?:\d{1,4}|[ivxlcdm]{1,10})$/i.test(text) &&
    (/(?:\.{2,}|\s{2,})/.test(text) || /^\d+(?:\.\d+)*\.?\s+\S/.test(text))
  );
}

function isTocPage(lines) {
  const texts = lines.map(lineText).filter(Boolean);
  if (!texts.length) return false;
  if (
    texts.slice(0, 8).some((text) =>
      /^(?:contents|list of (?:figures|tables))(?:\s+[ivxlcdm\d]+)?$/i.test(text),
    )
  )
    return true;
  const candidates = texts.filter(tocEntry).length;
  return texts.length >= 8 && candidates / texts.length >= 0.38;
}

function nativeCellCount(line, bodySize) {
  const chars = (line?.chars || [])
    .map((args) => ({ value: String(args?.[0] || ""), bbox: charRect(args) }))
    .filter((item) => item.value.trim() && item.bbox);
  if (chars.length < 2) return 1;
  let count = 1;
  let previous = chars[0];
  for (const current of chars.slice(1)) {
    const gap = current.bbox[0] - previous.bbox[2];
    if (gap > bodySize * 1.55) count += 1;
    previous = current;
  }
  return count;
}

function tableRanges(lines, bodySize) {
  const counts = lines.map((line) => nativeCellCount(line, bodySize));
  const result = [];
  let start = null;
  for (let index = 0; index <= counts.length; index += 1) {
    if (index < counts.length && counts[index] >= 2) {
      if (start === null) start = index;
      continue;
    }
    if (start !== null) {
      const end = index - 1;
      const run = counts.slice(start, end + 1);
      if (run.length >= 3) {
        const columns = Math.round(median(run));
        const consistent = run.filter((value) => value === columns).length;
        if (columns >= 2 && columns <= 8 && consistent / run.length >= 0.75)
          result.push([start, end]);
      }
      start = null;
    }
  }
  return result;
}

function lineBounds(lines) {
  const boxes = lines.map((line) => rect(line.bbox)).filter(Boolean);
  if (!boxes.length) return [0, 0, 1, 1];
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function paragraphBoundary(lines, index, bodySize, bodyLeft, bodyRight, baseGap) {
  if (index <= 0) return false;
  const previous = lines[index - 1];
  const current = lines[index];
  const previousBox = rect(previous.bbox);
  const currentBox = rect(current.bbox);
  if (!previousBox || !currentBox) return false;
  const gap = currentBox[1] - previousBox[3];
  if (gap > Math.max(bodySize * 0.62, baseGap * 2.1 + 1)) return true;

  const previousText = lineText(previous);
  const currentIndent = currentBox[0] - bodyLeft;
  const previousIndent = previousBox[0] - bodyLeft;
  const previousShort = previousBox[2] < bodyRight - bodySize * 2.1;
  const sentenceEnd = /[.!?][”"')\]]?$/.test(previousText);
  if (
    currentIndent > bodySize * 0.85 &&
    previousIndent < bodySize * 0.5 &&
    previousShort
  )
    return true;
  if (
    previousShort &&
    sentenceEnd &&
    currentBox[0] <= bodyLeft + bodySize * 0.55
  )
    return true;
  return false;
}

function segmentNativeBlock(block, bodySize) {
  const lines = (block.lines || []).filter((line) => lineText(line));
  if (lines.length <= 1) return lines.length ? [{ ...block, lines }] : [];

  const toc = isTocPage(lines);
  if (toc) {
    return lines.map((line, index) => ({
      ...block,
      bbox: rect(line.bbox) || block.bbox,
      lines: [
        {
          ...line,
          markdownPrefix: index > 0 && tocEntry(lineText(line)) ? "- " : "",
        },
      ],
    }));
  }

  const [bodyLeft, , bodyRight] = lineBounds(lines);
  const positiveGaps = lines
    .slice(1)
    .map((line, index) => {
      const previous = rect(lines[index].bbox);
      const current = rect(line.bbox);
      return previous && current ? current[1] - previous[3] : 0;
    })
    .filter((gap) => gap >= 0 && gap < bodySize * 2.5);
  const baseGap = median(positiveGaps);
  const tables = tableRanges(lines, bodySize);
  const tableAt = new Map();
  for (const [start, end] of tables) tableAt.set(start, end);
  const tableInterior = new Set(
    tables.flatMap(([start, end]) =>
      Array.from(
        { length: Math.max(0, end - start) },
        (_, offset) => start + offset + 1,
      ),
    ),
  );

  const result = [];
  let body = [];
  const flush = () => {
    if (!body.length) return;
    result.push({ ...block, bbox: lineBounds(body), lines: body });
    body = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (tableAt.has(index)) {
      flush();
      const end = tableAt.get(index);
      const rows = lines.slice(index, end + 1);
      result.push({ ...block, bbox: lineBounds(rows), lines: rows });
      index = end;
      continue;
    }
    if (tableInterior.has(index)) continue;

    const current = lines[index];
    const text = lineText(current);
    const size = nativeLineSize(current);
    const pureSection = /^\d+(?:\.\d+){1,5}\.?$/.test(text);
    if (pureSection && index + 1 < lines.length) {
      const next = lines[index + 1];
      const nextText = lineText(next);
      if (titleLike(nextText) || headingText(nextText, nativeLineSize(next), bodySize)) {
        flush();
        const pair = [current, next];
        result.push({ ...block, bbox: lineBounds(pair), lines: pair });
        index += 1;
        continue;
      }
    }

    if (headingText(text, size, bodySize) || captionLine(text)) {
      flush();
      result.push({ ...block, bbox: rect(current.bbox) || block.bbox, lines: [current] });
      continue;
    }

    if (listLine(text)) {
      flush();
      body.push(current);
      continue;
    }

    if (
      body.length &&
      (listLine(lineText(body[0])) ||
        paragraphBoundary(lines, index, bodySize, bodyLeft, bodyRight, baseGap))
    )
      flush();
    body.push(current);
  }
  flush();
  return result;
}

function segmentNativeBlocks(blocks) {
  const sizes = blocks.flatMap((block) =>
    (block.lines || []).map(nativeLineSize).filter((size) => size > 4 && size < 40),
  );
  const bodySize = median(sizes);
  return blocks.flatMap((block) => segmentNativeBlock(block, bodySize));
}

function segmentedJsonTextBlocks(data) {
  const textBlocks = collectNodes(data?.blocks, "text", []);
  const sizes = textBlocks.flatMap((block) =>
    (block.lines || []).map(jsonLineSize).filter((size) => size > 4 && size < 40),
  );
  const bodySize = median(sizes);
  const result = [];
  for (const block of textBlocks) {
    const lines = (block.lines || []).filter((line) => lineText(line));
    if (!lines.length) continue;
    if (isTocPage(lines)) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        result.push({
          ...block,
          bbox: rect(line.bbox) || block.bbox,
          lines: [
            {
              ...line,
              markdownPrefix: index > 0 && tocEntry(lineText(line)) ? "- " : "",
            },
          ],
        });
      }
      continue;
    }
    let body = [];
    const flush = () => {
      if (!body.length) return;
      result.push({ ...block, bbox: lineBounds(body), lines: body });
      body = [];
    };
    const [bodyLeft, , bodyRight] = lineBounds(lines);
    const positiveGaps = lines
      .slice(1)
      .map((line, index) => {
        const previous = rect(lines[index].bbox);
        const current = rect(line.bbox);
        return previous && current ? current[1] - previous[3] : 0;
      })
      .filter((gap) => gap >= 0 && gap < bodySize * 2.5);
    const baseGap = median(positiveGaps);
    for (let index = 0; index < lines.length; index += 1) {
      const current = lines[index];
      const text = lineText(current);
      const size = jsonLineSize(current);
      if (headingText(text, size, bodySize, current.font) || captionLine(text)) {
        flush();
        result.push({ ...block, bbox: rect(current.bbox) || block.bbox, lines: [current] });
        continue;
      }
      if (listLine(text)) {
        flush();
        body.push(current);
        continue;
      }
      if (
        body.length &&
        (listLine(lineText(body[0])) ||
          paragraphBoundary(lines, index, bodySize, bodyLeft, bodyRight, baseGap))
      )
        flush();
      body.push(current);
    }
    flush();
  }
  return result;
}

function syntheticCharArgs(character, index, text, bbox, line) {
  const size = jsonLineSize(line);
  const width = Math.max(1, bbox[2] - bbox[0]);
  const advance = width / Math.max(1, [...text].length);
  const x0 = bbox[0] + index * advance;
  const x1 = bbox[0] + (index + 1) * advance;
  return [
    character,
    [x0, bbox[3]],
    line.font || null,
    size,
    [x0, bbox[1], x1, bbox[1], x1, bbox[3], x0, bbox[3]],
  ];
}

function prefixArgs(prefix, line) {
  if (!prefix) return [];
  const bbox = rect(line.bbox) || [0, 0, 20, 10];
  const size = nativeLineSize(line);
  const width = Math.max(size * 0.55, 4);
  return [...prefix].map((character, index) => {
    const x1 = bbox[0] - (prefix.length - index - 1) * width;
    const x0 = x1 - width;
    return [
      character,
      [x0, bbox[3]],
      null,
      size,
      [x0, bbox[1], x1, bbox[1], x1, bbox[3], x0, bbox[3]],
    ];
  });
}

function normalizedNativeChars(line) {
  const chars = [...(line.chars || [])];
  const prefix = line.markdownPrefix || "";
  if (prefix) return [...prefixArgs(prefix, line), ...chars];
  const first = chars.findIndex((args) => String(args?.[0] || "").trim());
  if (first >= 0 && /^[•◦▪‣]$/.test(String(chars[first]?.[0] || ""))) {
    const copy = [...chars[first]];
    copy[0] = "-";
    chars[first] = copy;
  }
  return chars;
}

function replayNativeBlock(walker, block) {
  const lines = (block.lines || []).filter((line) => lineText(line));
  if (!lines.length) return;
  walker.beginTextBlock?.(block.bbox || lineBounds(lines));
  for (const line of lines) {
    const beginArgs = line.beginArgs?.length ? line.beginArgs : [line.bbox];
    walker.beginLine?.(...beginArgs);
    for (const args of normalizedNativeChars(line)) walker.onChar?.(...args);
    walker.endLine?.();
  }
  walker.endTextBlock?.();
}

function replayJsonBlock(walker, block) {
  const lines = (block.lines || []).filter((line) => lineText(line));
  if (!lines.length) return;
  walker.beginTextBlock?.(rect(block.bbox) || lineBounds(lines));
  for (const line of lines) {
    const originalText = lineText(line);
    const text = `${line.markdownPrefix || ""}${originalText}`;
    const bbox =
      rect(line.bbox) || rect(block.bbox) || [0, 0, Math.max(1, text.length), 10];
    walker.beginLine?.(bbox);
    [...text].forEach((character, index) =>
      walker.onChar?.(...syntheticCharArgs(character, index, text, bbox, line)),
    );
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
  if (!prototype?.walk || prototype.__pdfSanitizerStructuredRecoveryV2) return;
  const original = prototype.walk;

  prototype.walk = function walkWithStructuredRecovery(walker = {}) {
    const data = parseStructured(this);
    const jsonImages = jsonImageRects(this);
    const seenImages = [];

    // Image-only consumers do not need text buffering. Keep the native path and
    // supplement image regions MuPDF omitted from walk().
    if (typeof walker.beginTextBlock !== "function") {
      const wrapped = {
        ...walker,
        onImageBlock: (bbox, transform, image) => {
          const normalized = rect(bbox);
          if (normalized) seenImages.push(normalized);
          return walker.onImageBlock?.call(walker, bbox, transform, image);
        },
      };
      const result = original.call(this, wrapped);
      if (typeof walker.onImageBlock === "function")
        for (const bbox of jsonImages) {
          if (seenImages.some((existing) => overlapRatio(existing, bbox) >= 0.97))
            continue;
          walker.onImageBlock.call(walker, bbox, null, { destroy() {} });
        }
      return result;
    }

    // Capture native text first so we retain the real per-character quads. The
    // previous recovery reconstructed each line with evenly spaced characters,
    // which erased column gaps and made table detection impossible.
    const nativeBlocks = [];
    const nativeImages = [];
    let currentBlock = null;
    let currentLine = null;
    const wrapped = {
      ...walker,
      beginTextBlock(bbox) {
        currentBlock = { bbox: rect(bbox) || bbox, lines: [] };
      },
      beginLine(...args) {
        currentLine = { bbox: rect(args[0]) || args[0], beginArgs: args, chars: [] };
      },
      onChar(...args) {
        if (currentLine) currentLine.chars.push(args);
      },
      endLine() {
        if (currentBlock && currentLine && lineText(currentLine))
          currentBlock.lines.push(currentLine);
        currentLine = null;
      },
      endTextBlock() {
        if (currentBlock?.lines.length) nativeBlocks.push(currentBlock);
        currentBlock = null;
      },
      onImageBlock(bbox, transform, image) {
        const normalized = rect(bbox);
        if (normalized) seenImages.push(normalized);
        nativeImages.push({ bbox, transform, image });
      },
    };

    const result = original.call(this, wrapped);
    const recovered = segmentNativeBlocks(nativeBlocks);
    if (recovered.length) {
      for (const block of recovered) replayNativeBlock(walker, block);
    } else {
      for (const block of segmentedJsonTextBlocks(data)) replayJsonBlock(walker, block);
    }

    if (typeof walker.onImageBlock === "function") {
      if (jsonImages.length) {
        // Prefer asJSON image geometry when present. It is already deduplicated
        // and coalesced, and the extraction worker crops from the source page so
        // it does not need a live image object here.
        for (const bbox of jsonImages)
          walker.onImageBlock.call(walker, bbox, null, { destroy() {} });
        for (const item of nativeImages) item.image?.destroy?.();
      } else {
        for (const item of nativeImages)
          walker.onImageBlock.call(
            walker,
            item.bbox,
            item.transform,
            item.image,
          );
      }
    } else {
      for (const item of nativeImages) item.image?.destroy?.();
    }
    return result;
  };

  Object.defineProperty(prototype, "__pdfSanitizerStructuredRecoveryV2", {
    value: true,
    configurable: true,
  });
}

export function installMuPdfStructuredRecovery(mupdf) {
  try {
    patchPageExtraction(mupdf);
    patchStructuredWalk(mupdf);
  } catch {
    // Recovery must never prevent MuPDF from loading; extraction can still use
    // its native structured-text implementation if an adapter assumption fails.
  }
  return mupdf;
}
