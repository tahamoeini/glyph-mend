import { createWorker as createOcrWorker } from "tesseract.js";
import { headingFor, normalizeText } from "./cleanup.js";
import { ocrLines, ocrMarkdownEntries } from "./ocr-layout.js";
import { validateExtractionRequest } from "../../shared/security-boundaries.js";

const FORMULA_CUE =
  /(?:equation|formula|expression|defined by|given by|satisfies|we have|becomes|therefore|hence|where)\s*:?[\s]*$/i;
const MAX_RASTER_PIXELS = 40_000_000;
const MAX_RASTER_BYTES = 32 * 1024 * 1024;
let ocrWorker;
let mupdf;
let ocrProgressPage;

const LATEX_SYMBOLS = new Map([
  ["≤", "\\leq"],
  ["≥", "\\geq"],
  ["≠", "\\neq"],
  ["≈", "\\approx"],
  ["∞", "\\infty"],
  ["∑", "\\sum"],
  ["∏", "\\prod"],
  ["∫", "\\int"],
  ["√", "\\sqrt"],
  ["×", "\\times"],
  ["÷", "\\div"],
  ["μ", "\\mu"],
  ["σ", "\\sigma"],
  ["λ", "\\lambda"],
  ["α", "\\alpha"],
  ["β", "\\beta"],
  ["γ", "\\gamma"],
  ["δ", "\\delta"],
  ["θ", "\\theta"],
  ["π", "\\pi"],
  ["ρ", "\\rho"],
  ["τ", "\\tau"],
  ["φ", "\\phi"],
]);
const MATH_SYMBOLS = /[=<>≤≥≠≈+−×÷∑∏∫√∞]/g;

function rect(value) {
  if (Array.isArray(value) && value.length >= 4)
    return value.slice(0, 4).map(Number);
  if (!value || typeof value !== "object") return [0, 0, 0, 0];
  if ([value.x, value.y, value.w, value.h].every(Number.isFinite))
    return [value.x, value.y, value.x + value.w, value.y + value.h];
  if ([value.x0, value.y0, value.x1, value.y1].every(Number.isFinite))
    return [value.x0, value.y0, value.x1, value.y1];
  return [0, 0, 0, 0];
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function normalizeTextLine(value = "") {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function escapeMd(value) {
  return value.replace(/([\\`*{}\[\]<>#+\-.!_|$])/g, "\\$1");
}

function joinWrapped(lines) {
  return lines
    .map((line) => line.text)
    .join(" ")
    .replace(/(\p{L})-\s+(?=\p{Ll})/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tableFor(block, bodySize) {
  const rows = block.lines
    .map((line) => {
      const cells = [];
      let current = "";
      let previous = null;
      for (const char of line.chars || []) {
        if (
          previous &&
          char.value.trim() &&
          previous.value.trim() &&
          char.x0 - previous.x1 > bodySize * 1.55
        ) {
          cells.push(current.trim());
          current = "";
        }
        current += char.value;
        previous = char;
      }
      if (current.trim()) cells.push(current.trim());
      return cells;
    })
    .filter((cells) => cells.length >= 2);
  if (rows.length < 3) return null;
  const columns = Math.round(median(rows.map((row) => row.length)));
  if (columns < 2 || columns > 8) return null;
  const consistent = rows.filter((row) => row.length === columns);
  return consistent.length / rows.length >= 0.75 ? consistent : null;
}

function markdownTable(rows) {
  const columns = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row.map(escapeMd),
    ...Array(Math.max(0, columns - row.length)).fill(""),
  ]);
  const header = normalized[0];
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array(columns).fill("---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function wordBox(word) {
  const box = word?.bbox || {};
  const x0 = Number(box.x0 ?? box.left);
  const y0 = Number(box.y0 ?? box.top);
  const x1 = Number(box.x1 ?? box.right);
  const y1 = Number(box.y1 ?? box.bottom);
  return [x0, y0, x1, y1];
}

function ocrWordRows(data) {
  const result = [];
  for (const block of data?.blocks || []) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        const words = (line?.words || [])
          .map((word) => ({
            text: normalizeTextLine(word?.text || ""),
            bbox: wordBox(word),
            confidence: Number.isFinite(Number(word?.confidence))
              ? Number(word.confidence)
              : 100,
          }))
          .filter(
            (word) =>
              word.text &&
              word.bbox.every(Number.isFinite) &&
              word.bbox[2] > word.bbox[0] &&
              word.bbox[3] > word.bbox[1] &&
              word.confidence >= 58,
          )
          .sort((a, b) => a.bbox[0] - b.bbox[0]);
        if (words.length < 2) continue;
        const lineHeight = median(words.map((word) => word.bbox[3] - word.bbox[1]));
        const gapThreshold = Math.max(10, lineHeight * 1.15);
        const cells = [];
        let current = { text: words[0].text, x0: words[0].bbox[0], x1: words[0].bbox[2] };
        let previous = words[0];
        for (const word of words.slice(1)) {
          const gap = word.bbox[0] - previous.bbox[2];
          if (gap > gapThreshold) {
            cells.push(current);
            current = { text: word.text, x0: word.bbox[0], x1: word.bbox[2] };
          } else {
            current.text = `${current.text} ${word.text}`.trim();
            current.x1 = word.bbox[2];
          }
          previous = word;
        }
        cells.push(current);
        if (cells.length < 2) continue;
        result.push({
          cells,
          y0: Math.min(...words.map((word) => word.bbox[1])),
          y1: Math.max(...words.map((word) => word.bbox[3])),
          lineHeight,
        });
      }
    }
  }
  return result.sort((a, b) => a.y0 - b.y0);
}

export function ocrTableMarkdown(data) {
  const rows = ocrWordRows(data);
  if (rows.length < 3) return null;
  const frequencies = new Map();
  for (const row of rows) {
    const count = row.cells.length;
    if (count >= 2 && count <= 8) frequencies.set(count, (frequencies.get(count) || 0) + 1);
  }
  const columns = [...frequencies].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!columns) return null;
  const consistent = rows.filter((row) => row.cells.length === columns);
  if (consistent.length < 3 || consistent.length / rows.length < 0.78) return null;

  const starts = Array.from({ length: columns }, (_, index) =>
    median(consistent.map((row) => row.cells[index].x0)),
  );
  const allCells = consistent.flatMap((row) => row.cells);
  const tableLeft = Math.min(...allCells.map((cell) => cell.x0));
  const tableRight = Math.max(...allCells.map((cell) => cell.x1));
  const tableWidth = Math.max(1, tableRight - tableLeft);
  const tolerance = Math.max(
    median(consistent.map((row) => row.lineHeight)) * 2.2,
    tableWidth * 0.055,
  );
  const aligned = consistent.filter((row) =>
    row.cells.every((cell, index) => Math.abs(cell.x0 - starts[index]) <= tolerance),
  );
  if (aligned.length / consistent.length < 0.82) return null;

  const textCells = aligned.flatMap((row) => row.cells.map((cell) => cell.text));
  const shortCells = textCells.filter((cell) => cell.split(/\s+/).length <= 8).length;
  const numericCells = textCells.filter((cell) => /\d/.test(cell)).length;
  const sentenceLike = textCells.filter(
    (cell) =>
      cell.split(/\s+/).length > 10 ||
      /\b(?:the|and|that|this|with|from|which|because|therefore)\b/i.test(cell),
  ).length;
  if (shortCells / textCells.length < 0.72) return null;
  if (sentenceLike / textCells.length > 0.28 && numericCells / textCells.length < 0.15)
    return null;

  return markdownTable(aligned.map((row) => row.cells.map((cell) => cell.text)));
}

function mathScore(text) {
  let score = 0;
  score += (text.match(MATH_SYMBOLS) || []).length * 2;
  score += (text.match(/[A-Za-z]\s*[_^]\s*[A-Za-z0-9({[]/g) || []).length * 2;
  score += (text.match(/\b(?:sin|cos|tan|log|ln|exp|max|min|arg|maximize|minimize)\b/gi) || [])
    .length;
  score += (text.match(/[()[\]{}]/g) || []).length * 0.35;
  return score;
}

export function latexMarkdown(value) {
  let text = normalizeTextLine(value);
  for (const [symbol, latex] of LATEX_SYMBOLS) text = text.split(symbol).join(latex);
  text = text.replace(/½/g, "\\frac{1}{2}");
  return text;
}

function isEquation(text, block, pageBounds, bodySize) {
  if (!text || text.length > 240 || text.split(/\s+/).length > 28) return false;
  if (/^(?:figure|fig\.|table|chapter|source|note|proof)\b/i.test(text)) return false;
  const score = mathScore(text);
  if (score < 4) return false;
  const prose =
    /\b(?:the|and|that|this|with|from|where|which|then|than|for|are|was|were|have|has|into|when)\b/i.test(
      text,
    );
  if (prose && score < 7) return false;
  const width = block.bbox[2] - block.bbox[0];
  const pageWidth = pageBounds[2] - pageBounds[0];
  return width <= pageWidth * 0.9 || block.size >= bodySize * 0.95;
}

async function loadMupdf() {
  if (!mupdf) mupdf = (await import("../../mupdf-vite.js")).default;
  return mupdf;
}

export function textFallbackBlocks(structured) {
  try {
    const text = structured.asText?.();
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(normalizeTextLine)
      .filter(Boolean);
    if (!lines.length) return [];
    return [
      {
        bbox: [0, 0, 0, 0],
        lines: lines.map((value) => ({
          bbox: [0, 0, 0, 0],
          text: value,
          chars: [],
          sizes: [10],
          size: 10,
        })),
        sizes: [10],
        maxSize: 10,
        size: 10,
      },
    ];
  } catch {
    return [];
  }
}

export function jsonFallbackBlocks(structured) {
  try {
    const data = JSON.parse(structured.asJSON());
    const textBlocks = [];
    const collectTextBlocks = (nodes) => {
      for (const value of nodes || []) {
        if (value?.type === "text") textBlocks.push(value);
        collectTextBlocks(value?.blocks);
        collectTextBlocks(value?.children);
        collectTextBlocks(value?.contents);
      }
    };
    collectTextBlocks(data?.blocks);
    return textBlocks
      .map((value) => {
        const lines = (value.lines || [])
          .map((line) => ({
            bbox: rect(line.bbox),
            text: normalizeTextLine(line.text || ""),
            chars: [],
            sizes: [Number(line.font?.size) || 10],
            size: Number(line.font?.size) || 10,
          }))
          .filter((line) => line.text);
        const sizes = lines.flatMap((line) => line.sizes);
        return {
          bbox: rect(value.bbox),
          lines,
          sizes,
          maxSize: Math.max(...sizes, 10),
          size: median(sizes),
        };
      })
      .filter((block) => block.lines.length);
  } catch {
    return [];
  }
}

function readStructuredPage(page) {
  const blocks = [];
  const images = [];
  const vectors = [];
  let block = null;
  let line = null;
  const structured = page.toStructuredText(
    "preserve-images,preserve-spans,segment",
  );
  structured.walk({
    beginTextBlock(bbox) {
      block = { bbox: rect(bbox), lines: [], sizes: [] };
    },
    beginLine(bbox) {
      line = { bbox: rect(bbox), text: "", chars: [], sizes: [] };
    },
    onChar(value, _origin, _font, size, quad) {
      const points = Array.isArray(quad) ? quad : [];
      const xs = points.filter((_, index) => index % 2 === 0);
      line.text += value;
      line.sizes.push(size);
      line.chars.push({
        value,
        x0: xs.length ? Math.min(...xs) : line.bbox[0],
        x1: xs.length ? Math.max(...xs) : line.bbox[2],
      });
    },
    endLine() {
      line.text = normalizeText(line.text);
      if (line.text) {
        line.size = median(line.sizes);
        block.lines.push(line);
        block.sizes.push(...line.sizes);
      }
      line = null;
    },
    endTextBlock() {
      if (block.lines.length) {
        block.maxSize = Math.max(...block.sizes);
        block.size = median(block.sizes);
        blocks.push(block);
      }
      block = null;
    },
    onImageBlock(bbox, _transform, image) {
      images.push({ bbox: rect(bbox), image });
    },
    onVector(bbox, flags) {
      vectors.push({ bbox: rect(bbox), flags });
    },
  });

  if (!blocks.length) blocks.push(...jsonFallbackBlocks(structured));
  if (!blocks.length) blocks.push(...textFallbackBlocks(structured));
  structured.destroy?.();

  const device = new mupdf.Device({
    fillPath(path, _evenOdd, ctm) {
      try {
        vectors.push({
          bbox: rect(path.getBounds(null, ctm)),
          flags: { filled: true },
        });
      } catch {
        /* ignore malformed paths */
      }
    },
    strokePath(path, stroke, ctm) {
      try {
        vectors.push({
          bbox: rect(path.getBounds(stroke, ctm)),
          flags: { stroked: true },
        });
      } catch {
        /* ignore malformed paths */
      }
    },
  });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } catch {
    /* text extraction is still usable */
  }
  return { blocks, images, vectors };
}

function cropPage(page, bbox, scale = 2) {
  const target = bbox.map((value) => Math.round(value * scale));
  if (target[2] <= target[0] || target[3] <= target[1])
    throw new Error("Invalid visual crop bounds.");
  const width = target[2] - target[0];
  const height = target[3] - target[1];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width * height > MAX_RASTER_PIXELS)
    throw new RangeError(`Visual raster exceeds the ${MAX_RASTER_PIXELS.toLocaleString()}-pixel safety limit.`);
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, target, false);
  pixmap.clear(255);
  const device = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pixmap);
  page.run(device, mupdf.Matrix.identity);
  device.close();
  const data = new Uint8Array(pixmap.asPNG());
  const renderedWidth = pixmap.getWidth();
  const renderedHeight = pixmap.getHeight();
  pixmap.destroy?.();
  if (data.byteLength > MAX_RASTER_BYTES)
    throw new RangeError(`Visual raster exceeds the ${MAX_RASTER_BYTES}-byte encoded safety limit.`);
  return { data, width: renderedWidth, height: renderedHeight };
}

export function normalizeCropBounds(bbox, pageBounds, padding = 0) {
  const [left, top, right, bottom] = pageBounds;
  return [
    Math.max(left, bbox[0] - padding),
    Math.max(top, bbox[1] - padding),
    Math.min(right, bbox[2] + padding),
    Math.min(bottom, bbox[3] + padding),
  ];
}

export function normalizeBackground(rendered, fallbackBackground = 255) {
  if (!rendered?.data || !rendered.width || !rendered.height) {
    return { background: fallbackBackground, normalized: true, brightness: fallbackBackground };
  }
  let total = 0;
  let count = 0;
  for (let index = 0; index < rendered.data.length; index += 4) {
    const r = rendered.data[index];
    const g = rendered.data[index + 1];
    const b = rendered.data[index + 2];
    total += (r + g + b) / 3;
    count += 1;
  }
  const brightness = count ? total / count : fallbackBackground;
  return {
    background: brightness > 220 ? 255 : 0,
    normalized: true,
    brightness,
    threshold: brightness > 220 ? 245 : 210,
  };
}

export function deskewIfNeeded(bbox, pageBounds) {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const pageWidth = pageBounds[2] - pageBounds[0];
  const pageHeight = pageBounds[3] - pageBounds[1];
  const skew = Math.min(1, Math.max(0, Math.abs(width / Math.max(1, pageWidth) - height / Math.max(1, pageHeight))));
  return {
    skew,
    needsDeskew: skew > 0.18,
    bbox: [...bbox],
  };
}

export function buildEquationCandidate(pageNumber, candidate, rendered, sourceType = "raster", text = "") {
  const baseText = String(text || candidate?.text || "").trim();
  const mathScore = (baseText.match(/[=<>≤≥≠≈+−×÷∑∏∫√∞]/g) || []).length * 2 +
    (baseText.match(/[A-Za-z]\s*[_^]\s*[A-Za-z0-9({\[]/g) || []).length * 2 +
    (baseText.match(/\b(?:sin|cos|tan|log|ln|exp|max|min|arg|maximize|minimize)\b/gi) || []).length;
  const confidence = Math.min(0.99, Math.max(0.15, 0.52 + mathScore * 0.09));
  const disposition = confidence >= 0.82 ? "accepted" : confidence >= 0.55 ? "review" : "preserved";
  const cropBBox = Array.isArray(candidate?.bbox) ? candidate.bbox.map(Number) : [0, 0, 1, 1];
  const normalized = normalizeCropBounds(cropBBox, [0, 0, 1, 1], 0);
  const background = normalizeBackground(rendered);
  const deskew = deskewIfNeeded(normalized, [0, 0, 1, 1]);
  const cropId = `p${pageNumber}-equation-${Math.round(cropBBox[0])}-${Math.round(cropBBox[1])}`;
  const sourceAsset = {
    id: cropId,
    page: pageNumber,
    kind: "equation",
    bbox: cropBBox,
    sourceType,
    crop: {
      format: "png",
      width: rendered?.width || 0,
      height: rendered?.height || 0,
      data: rendered?.data || new Uint8Array(),
    },
    provenance: {
      source: "local-pdf-page",
      pageNumber,
      cropNormalized: true,
      preserved: true,
      reversible: true,
    },
  };

  return {
    ...candidate,
    page: pageNumber,
    sourceType,
    bbox: cropBBox,
    sourceAsset,
    evidence: {
      text: baseText,
      source: "pdf-structure-text",
      reason: "equation-like text and math symbol density",
      cue: baseText && /[=<>≤≥≠≈+−×÷∑∏∫√∞]/.test(baseText) ? "math-symbol-density" : "text-layout",
    },
    qualitySignals: {
      resolution: rendered?.width && rendered?.height ? Math.round(rendered.width * rendered.height / 1000) : 0,
      skew: deskew.skew,
      noise: background.brightness > 220 ? 0.12 : 0.18,
      backgroundNormalized: background.normalized,
    },
    confidence: {
      overall: Number(confidence.toFixed(3)),
      symbolDensity: Number(Math.min(1, Math.max(0, mathScore / 10)).toFixed(3)),
      geometry: 0.5,
    },
    disposition,
    cropAsset: sourceAsset,
  };
}

function paddedBbox(bbox, pageBounds, padding = 0) {
  const [left, top, right, bottom] = pageBounds;
  return [
    Math.max(left, bbox[0] - padding),
    Math.max(top, bbox[1] - padding),
    Math.min(right, bbox[2] + padding),
    Math.min(bottom, bbox[3] + padding),
  ];
}

function vectorGraphicCandidates(vectors, pageBounds, bodySize) {
  const groups = [];
  for (const vector of vectors) {
    if (!vector.bbox.every(Number.isFinite)) continue;
    let group = groups.find(
      (item) =>
        !(
          vector.bbox[2] < item.bbox[0] - bodySize ||
          vector.bbox[0] > item.bbox[2] + bodySize ||
          vector.bbox[3] < item.bbox[1] - bodySize ||
          vector.bbox[1] > item.bbox[3] + bodySize
        ),
    );
    if (!group) {
      group = { bbox: [...vector.bbox], count: 0 };
      groups.push(group);
    }
    group.count += 1;
    group.bbox = [
      Math.min(group.bbox[0], vector.bbox[0]),
      Math.min(group.bbox[1], vector.bbox[1]),
      Math.max(group.bbox[2], vector.bbox[2]),
      Math.max(group.bbox[3], vector.bbox[3]),
    ];
  }
  const pageArea =
    (pageBounds[2] - pageBounds[0]) * (pageBounds[3] - pageBounds[1]);
  return groups
    .filter((group) => {
      const width = group.bbox[2] - group.bbox[0],
        height = group.bbox[3] - group.bbox[1],
        area = width * height;
      return (
        group.count >= 4 &&
        area / pageArea >= 0.004 &&
        area / pageArea < 0.65 &&
        width > (pageBounds[2] - pageBounds[0]) * 0.12 &&
        height > (pageBounds[3] - pageBounds[1]) * 0.025
      );
    })
    .slice(0, 10)
    .map((group) => ({ ...group, y: group.bbox[1], kind: "graphic" }));
}

function sourceMarker(pageNumber, asset) {
  const box = asset.bbox.map((value) => Math.round(value * 10) / 10).join(",");
  const caption = asset.caption
    ? ` caption="${asset.caption.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`
    : "";
  return `[SOURCE_VISUAL page=${pageNumber} id="${asset.id}" kind="${asset.kind}" bbox="${box}"${caption}]`;
}

function horizontalAffinity(a, b, bodySize) {
  const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  if (overlap > 0) return true;
  const centerA = (a[0] + a[2]) / 2;
  const centerB = (b[0] + b[2]) / 2;
  return Math.abs(centerA - centerB) <= Math.max(bodySize * 8, (a[2] - a[0]) * 0.45);
}

export function captionFor(blocks, bbox, bodySize) {
  const captionPattern = /^(?:figure|fig\.|table)\s+\d+(?:\.\d+)*(?:[.:]|\b)/i;
  const limit = Math.max(30, bodySize * 8);
  return (
    blocks
      .flatMap((block) => block.lines)
      .map((line) => ({ text: joinWrapped([line]), bbox: line.bbox }))
      .filter((line) => captionPattern.test(line.text) && line.bbox?.length >= 4)
      .map((line) => {
        const below = Math.max(0, line.bbox[1] - bbox[3]);
        const above = Math.max(0, bbox[1] - line.bbox[3]);
        const overlapsVertically = line.bbox[1] < bbox[3] && line.bbox[3] > bbox[1];
        const distance = overlapsVertically ? 0 : Math.min(below || Infinity, above || Infinity);
        const figure = /^(?:figure|fig\.)/i.test(line.text);
        const directionPenalty = figure && line.bbox[3] <= bbox[1] ? bodySize * 0.75 : 0;
        return { ...line, distance, score: distance + directionPenalty };
      })
      .filter(
        (line) =>
          line.distance <= limit && horizontalAffinity(line.bbox, bbox, bodySize),
      )
      .sort((a, b) => a.score - b.score)[0]?.text || ""
  );
}

function textHeavyRegion(blocks, bbox) {
  const lines = blocks
    .flatMap((block) => block.lines)
    .filter((line) => line.bbox[1] < bbox[3] && line.bbox[3] > bbox[1]);
  const words = lines.reduce(
    (count, line) => count + joinWrapped([line]).split(/\s+/).length,
    0,
  );
  return lines.length >= 3 && words >= 24;
}

function ocrGeometry(data, lines, pageBounds) {
  if (!lines.some((line) => line.x1 > line.x0 && line.y1 > line.y0)) return null;
  const measuredWidth = Math.max(...lines.map((line) => line.x1), 1);
  const measuredHeight = Math.max(...lines.map((line) => line.y1), 1);
  const rawWidth = Math.max(1, Number(data?._rasterWidth) || measuredWidth);
  const rawHeight = Math.max(1, Number(data?._rasterHeight) || measuredHeight);
  const [left, top, right, bottom] = pageBounds;
  const pageWidth = right - left;
  const pageHeight = bottom - top;
  const x = (value) => left + (value / rawWidth) * pageWidth;
  const y = (value) => top + (value / rawHeight) * pageHeight;
  return {
    rawWidth,
    rawHeight,
    x,
    y,
    box(line) {
      return [x(line.x0), y(line.y0), x(line.x1), y(line.y1)];
    },
  };
}

export function looksLikeOcrEquation(text) {
  if (
    !text ||
    text.length > 220 ||
    /^(?:figure|fig\.|table|chapter|source|note|proof)\b/i.test(text)
  )
    return false;
  const words = text.split(/\s+/).length;
  if (words > 24) return false;
  if (/[=<>≤≥≠≈+−×÷]\s*$/u.test(text)) return false;
  const mathSymbols = (text.match(MATH_SYMBOLS) || []).length;
  const hasRelation = /[=<>≤≥≠≈]/.test(text);
  if (!hasRelation || mathSymbols === 0) return false;
  const prose =
    /\b(?:the|and|that|this|with|from|where|which|then|than|for|are|was|were|have|has|into|when)\b/i.test(
      text,
    );
  if (prose && words > 5 && mathSymbols < 4) return false;
  return mathScore(text) >= (prose ? 7 : 4);
}

function ocrVisualCandidates(data, lines, pageBounds) {
  const geometry = ocrGeometry(data, lines, pageBounds);
  if (!geometry) return { candidates: [], excludeRanges: [] };
  const lineHeight = median(lines.map((line) => Math.max(1, line.y1 - line.y0)));
  const [left, top, right, bottom] = pageBounds;
  const pageWidth = right - left;
  const pageHeight = bottom - top;
  const candidates = [];
  const excludeRanges = [];
  const figureRanges = [];
  const captionPattern = /^(?:figure|fig\.|table)\s+\d+(?:\.\d+)*(?:[.:]|\b)/i;

  for (let index = 0; index < lines.length; index += 1) {
    const caption = lines[index];
    if (!captionPattern.test(caption.text)) continue;
    let rawY0 = Math.max(0, caption.y0 - geometry.rawHeight * 0.62);
    for (let cursor = 0; cursor < index - 1; cursor += 1) {
      const current = lines[cursor];
      const next = lines[cursor + 1];
      if (next.y0 < rawY0) continue;
      if (
        next.y0 - current.y1 > lineHeight * 1.9 &&
        next.y0 < caption.y0 - lineHeight * 3
      ) {
        rawY0 = next.y0;
        break;
      }
    }
    const rawY1 = Math.min(geometry.rawHeight, caption.y1 + lineHeight * 0.7);
    const bbox = [
      left + pageWidth * 0.035,
      Math.max(top, geometry.y(rawY0) - pageHeight * 0.012),
      right - pageWidth * 0.035,
      Math.min(bottom, geometry.y(rawY1) + pageHeight * 0.012),
    ];
    if (bbox[3] - bbox[1] < pageHeight * 0.06) continue;
    const candidate = {
      kind: "graphic",
      bbox,
      y: bbox[1],
      rawY0,
      rawY1,
      caption: caption.text,
    };
    candidates.push(candidate);
    figureRanges.push(candidate);

    for (const item of lines) {
      if (item.y0 < rawY0 || item.y1 > rawY1 || captionPattern.test(item.text))
        continue;
      const wordCount = item.text.split(/\s+/).length;
      const lowConfidence = item.confidence != null && item.confidence < 72;
      const diagramLike =
        item.text.length < 110 &&
        (wordCount <= 7 || mathScore(item.text) > 0 || lowConfidence);
      if (diagramLike)
        excludeRanges.push({ y0: item.y0, y1: item.y1, keepCaption: true });
    }
  }

  const equationLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const item = lines[index];
    if (
      figureRanges.some(
        (range) => item.y0 < range.rawY1 && item.y1 > range.rawY0,
      )
    )
      continue;
    const previous = lines[index - 1];
    const cued =
      previous &&
      FORMULA_CUE.test(previous.text) &&
      item.text.length <= 220 &&
      item.text.split(/\s+/).length <= 28 &&
      /[=<>≤≥≠≈+−×÷∑∏∫√]/.test(item.text);
    if (
      looksLikeOcrEquation(item.text) ||
      (cued && !/[=<>≤≥≠≈+−×÷]\s*$/u.test(item.text))
    )
      equationLines.push(item);
  }

  const groups = [];
  for (const item of equationLines) {
    const previousGroup = groups.at(-1);
    if (
      previousGroup &&
      item.y0 - previousGroup.at(-1).y1 <= lineHeight * 1.7
    )
      previousGroup.push(item);
    else groups.push([item]);
  }
  for (const group of groups) {
    const rawY0 = Math.max(
      0,
      Math.min(...group.map((item) => item.y0)) - lineHeight * 0.9,
    );
    const rawY1 = Math.min(
      geometry.rawHeight,
      Math.max(...group.map((item) => item.y1)) + lineHeight * 0.9,
    );
    const bbox = [
      left + pageWidth * 0.065,
      geometry.y(rawY0),
      right - pageWidth * 0.065,
      geometry.y(rawY1),
    ];
    const text = group.map((item) => item.text).join(" ");
    const candidate = {
      kind: "equation",
      bbox,
      y: bbox[1],
      rawY0,
      rawY1,
      text,
    };
    candidates.push(candidate);
  }

  return {
    candidates,
    excludeRanges,
    equationRanges: groups.map((group) => ({
      y0: Math.min(...group.map((item) => item.y0)),
      y1: Math.max(...group.map((item) => item.y1)),
      latex: latexMarkdown(group.map((item) => item.text).join(" ")),
    })),
  };
}

async function ensureOcrWorker(options, paths) {
  if (!ocrWorker) {
    ocrWorker = await createOcrWorker(options.ocrLanguage || "eng", 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
      logger: (event) =>
        self.postMessage({
          type: "ocr-progress",
          page: ocrProgressPage,
          status: event.status,
          progress: event.progress,
        }),
    });
  }
  return ocrWorker;
}

async function recognizeRaster(image, options, paths) {
  const worker = await ensureOcrWorker(options, paths);
  ocrProgressPage = options.page;
  const result = await worker.recognize(image.data, {}, { text: true, blocks: true });
  result.data._rasterWidth = image.width;
  result.data._rasterHeight = image.height;
  return result.data;
}

async function recognizePage(page, options, paths) {
  const image = cropPage(
    page,
    rect(page.getBounds()),
    Math.max(1, Math.min(600, Number(options.ocrDpi) || 300)) / 72,
  );
  return recognizeRaster(image, options, paths);
}

async function tableMarkdownForVisual(rendered, caption, options, paths, pageNumber) {
  if (
    !options.detectTables ||
    !options.useOcr ||
    !/^table\s+\d+(?:\.\d+)*(?:[.:]|\b)/i.test(caption || "")
  )
    return null;
  try {
    const data = await recognizeRaster(
      rendered,
      { ...options, page: pageNumber },
      paths,
    );
    return ocrTableMarkdown(data);
  } catch {
    return null;
  }
}

export async function pageMarkdown(page, pageNumber, options, ocrPaths) {
  const pageBounds = rect(page.getBounds());
  const { blocks, images, vectors } = readStructuredPage(page);
  const bodySize = median(
    blocks
      .flatMap((block) => block.sizes)
      .filter((size) => size > 4 && size < 40),
  );
  const pageHeight = pageBounds[3] - pageBounds[1];
  const assets = [];
  const entries = [];
  const edges = { headers: [], footers: [] };
  let ocrCandidates = [];
  const reviewItems = [];

  let ocrApplied = false;
  if (
    options.forceOcr ||
    (options.useOcr &&
      blocks.reduce(
        (count, value) => count + joinWrapped(value.lines).length,
        0,
      ) < 40)
  ) {
    const ocrData = await recognizePage(
      page,
      { ...options, page: pageNumber },
      ocrPaths,
    );
    const lines = ocrLines(ocrData);
    const detected =
      options.preserveVisuals === false
        ? { candidates: [], excludeRanges: [], equationRanges: [] }
        : ocrVisualCandidates(ocrData, lines, pageBounds);
    ocrCandidates = detected.candidates;
    ocrApplied = true;
    entries.push(
      ...ocrMarkdownEntries(ocrData, escapeMd, {
        pageBounds,
        rawHeight: ocrData._rasterHeight,
        excludeRanges: detected.excludeRanges,
        equationRanges: options.extractEquations ? detected.equationRanges : [],
      }),
    );

    const rawHeight = Math.max(
      1,
      Number(ocrData._rasterHeight) ||
        Math.max(...lines.map((item) => item.y1), 1),
    );
    const [left, top, right, bottom] = pageBounds;
    const pageWidth = right - left;
    const equationGroups = detected.equationRanges || [];
    for (const group of equationGroups) {
      const pageEquationText = group.latex || group.text || "";
      const pageBBox = [
        left + pageWidth * 0.065,
        geometryYFromRaw(group.y0, pageBounds, rawHeight),
        right - pageWidth * 0.065,
        geometryYFromRaw(group.y1, pageBounds, rawHeight),
      ];
      const crop = cropPage(page, pageBBox, 2.6);
      const candidate = buildEquationCandidate(
        pageNumber,
        { kind: "equation", bbox: pageBBox, y: pageBBox[1], text: pageEquationText },
        crop,
        pageEquationText.includes("\\") ? "native" : "raster",
        pageEquationText,
      );
      ocrCandidates.push(candidate);
      reviewItems.push({
        id: candidate.sourceAsset?.id || candidate.id || `p${pageNumber}-equation-${reviewItems.length + 1}`,
        page: pageNumber,
        kind: "equation",
        sourceAsset: candidate.sourceAsset,
        candidate: {
          id: candidate.id,
          kind: "equation",
          latex: pageEquationText,
          normalized: pageEquationText,
          provider: candidate.sourceType || "raster",
          version: "browser-local",
          confidence: candidate.confidence,
          modelHash: candidate.sourceAsset?.provenance?.modelHash || null,
        },
        validation: {
          parseSuccess: false,
          renderSuccess: false,
          semanticEquivalent: false,
          confidencePass: candidate.disposition === "accepted",
          mandatoryPassed: false,
          sourcePreserved: true,
          notes: [candidate.evidence?.reason || "equation candidate detected"],
        },
        manifest: {
          kind: "equation",
          sourceAsset: candidate.sourceAsset,
          reconstruction: {
            format: "semantic-ir",
            source: {
              kind: candidate.disposition,
              recognizer: {
                name: candidate.sourceType || "unknown",
                version: "browser-local",
                preprocessVersion: "1",
              },
            },
          },
          provenance: {
            producer: "extract-worker",
            validationEvidence: {
              level: candidate.disposition === "accepted" ? "high" : candidate.disposition === "review" ? "medium" : "low",
              notes: [candidate.evidence?.reason || "equation candidate detected"],
            },
          },
        },
        disposition: candidate.disposition,
        status: candidate.disposition,
      });
    }
    for (const item of lines) {
      if (item.y0 <= rawHeight * 0.09) edges.headers.push(item.text);
      if (item.y1 >= rawHeight * 0.92) edges.footers.push(item.text);
    }
  }

  for (const block of (ocrApplied ? [] : blocks).sort(
    (a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0],
  )) {
    const text = joinWrapped(block.lines);
    if (!text) continue;
    const topEdge = block.bbox[1] <= pageBounds[1] + pageHeight * 0.09;
    const bottomEdge = block.bbox[3] >= pageBounds[3] - pageHeight * 0.08;
    if (topEdge) edges.headers.push(text);
    if (bottomEdge) edges.footers.push(text);
    if (
      (topEdge || bottomEdge) &&
      /^\s*(?:\d{1,5}|[ivxlcdm]{1,10})\s*$/i.test(text)
    )
      continue;
    const table = options.detectTables ? tableFor(block, bodySize) : null;
    const heading = options.detectHeadings
      ? headingFor(text, block.maxSize, bodySize)
      : null;
    let markdown;
    if (table) markdown = markdownTable(table);
    else if (
      options.extractEquations &&
      isEquation(text, block, pageBounds, bodySize)
    )
      markdown = `$$\n${latexMarkdown(text)}\n$$`;
    else if (heading) markdown = `${"#".repeat(heading)} ${escapeMd(text)}`;
    else if (
      block.size < bodySize * 0.82 &&
      block.bbox[1] > pageBounds[1] + pageHeight * 0.55
    )
      markdown = /^(\d{1,3})\s+(.+)/.test(text)
        ? text.replace(/^(\d{1,3})\s+(.+)/, "> [^$1]: $2")
        : `> ${escapeMd(text)}`;
    else markdown = escapeMd(text);
    entries.push({ y: block.bbox[1], markdown });
  }

  if (options.preserveVisuals !== false) {
    const pageArea = (pageBounds[2] - pageBounds[0]) * pageHeight;
    for (const [index, value] of images.entries()) {
      const area =
        (value.bbox[2] - value.bbox[0]) * (value.bbox[3] - value.bbox[1]);
      if (
        area / pageArea < 0.0025 ||
        (area / pageArea > 0.82 && blocks.length > 2) ||
        textHeavyRegion(blocks, value.bbox)
      ) {
        value.image.destroy?.();
        continue;
      }
      try {
        const bbox = paddedBbox(
          value.bbox,
          pageBounds,
          Math.max(4, bodySize * 0.55),
        );
        const rendered = cropPage(page, bbox, 2.25);
        const caption = captionFor(blocks, bbox, bodySize);
        const recoveredTable = await tableMarkdownForVisual(
          rendered,
          caption,
          options,
          ocrPaths,
          pageNumber,
        );
        if (recoveredTable) {
          entries.push({ y: bbox[1], markdown: recoveredTable });
        } else {
          const asset = {
            id: `p${pageNumber}-image-${index + 1}`,
            kind: /^table\b/i.test(caption) ? "table-image" : "image",
            bbox,
            caption,
            ...rendered,
          };
          assets.push(asset);
          entries.push({ y: bbox[1], markdown: sourceMarker(pageNumber, asset) });
        }
      } catch {
        /* text extraction remains usable when an image cannot be rendered */
      }
      value.image.destroy?.();
    }

    if (options.flows !== false)
      for (const candidate of vectorGraphicCandidates(
        vectors,
        pageBounds,
        bodySize,
      )) {
        if (
          assets.some(
            (asset) =>
              asset.bbox[1] < candidate.bbox[3] &&
              asset.bbox[3] > candidate.bbox[1],
          )
        )
          continue;
        if (textHeavyRegion(blocks, candidate.bbox)) continue;
        try {
          const bbox = paddedBbox(
            candidate.bbox,
            pageBounds,
            Math.max(4, bodySize * 0.55),
          );
          const rendered = cropPage(page, bbox, 2.25);
          const caption = captionFor(blocks, bbox, bodySize);
          const recoveredTable = await tableMarkdownForVisual(
            rendered,
            caption,
            options,
            ocrPaths,
            pageNumber,
          );
          if (recoveredTable) {
            entries.push({ y: candidate.y, markdown: recoveredTable });
            continue;
          }
          const asset = {
            id: `p${pageNumber}-graphic-${
              assets.filter((item) => item.kind === "graphic").length + 1
            }`,
            ...candidate,
            kind: /^table\b/i.test(caption) ? "table-image" : candidate.kind,
            bbox,
            caption,
            ...rendered,
          };
          assets.push(asset);
          entries.push({ y: candidate.y, markdown: sourceMarker(pageNumber, asset) });
        } catch {
          /* reported through raw vector counts */
        }
      }

    for (const candidate of ocrCandidates) {
      if (candidate.kind === "equation") continue;
      if (
        assets.some(
          (asset) =>
            asset.kind !== "source-page" &&
            asset.bbox[1] < candidate.bbox[3] &&
            asset.bbox[3] > candidate.bbox[1],
        )
      )
        continue;
      try {
        const bbox = paddedBbox(candidate.bbox, pageBounds, 4);
        const rendered = cropPage(
          page,
          bbox,
          candidate.kind === "equation" ? 2.6 : 2.25,
        );
        const recoveredTable = await tableMarkdownForVisual(
          rendered,
          candidate.caption || "",
          options,
          ocrPaths,
          pageNumber,
        );
        if (recoveredTable) {
          entries.push({ y: candidate.y, markdown: recoveredTable });
          continue;
        }
        const fallbackKind = /^table\b/i.test(candidate.caption || "")
          ? "table-image"
          : candidate.kind;
        const count = assets.filter((item) => item.kind === fallbackKind).length + 1;
        const asset = {
          id: `p${pageNumber}-${fallbackKind}-${count}`,
          ...candidate,
          kind: fallbackKind,
          bbox,
          caption: candidate.caption || "",
          ...rendered,
        };
        assets.push(asset);
        entries.push({ y: candidate.y, markdown: sourceMarker(pageNumber, asset) });
      } catch {
        /* OCR text remains available even if a local visual crop fails */
      }
    }
  }

  entries.sort((a, b) => a.y - b.y);
  const text = entries.map((entry) => entry.markdown).join("\n\n");
  const quality = {
    characters: text.length,
    textBlocks: blocks.length,
    images: images.length,
    vectors: vectors.length,
    equations: (text.match(/^\$\$/gm) || []).length / 2,
    preservedVisuals: assets.length,
    preservedEquationFallbacks: (text.match(/^\$\$/gm) || []).length / 2,
    suspiciousGaps: 0,
    ocrApplied,
  };
  return { text, bodySize, assets, edges, quality, reviewItems };
}

function geometryYFromRaw(rawY, pageBounds, rawHeight) {
  const [left, top, right, bottom] = pageBounds;
  const pageHeight = bottom - top;
  const normalized = Math.max(0, Math.min(1, rawY / Math.max(1, rawHeight)));
  return top + normalized * pageHeight;
}

if (typeof self !== "undefined")
  self.onmessage = async ({ data: rawData }) => {
    let data;
    try {
      data = validateExtractionRequest(rawData, { baseUrl: self.location.href });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: `Rejected extraction request: ${error?.message || String(error)}`,
      });
      return;
    }
    let document;
    try {
      self.postMessage({ type: "worker-started" });
      await loadMupdf();
      self.postMessage({ type: "engine-ready", engine: "mupdf-wasm" });
      document = mupdf.Document.openDocument(
        new Uint8Array(data.buffer),
        "application/pdf",
      );
      if (
        document.needsPassword() &&
        !document.authenticatePassword(data.password || "")
      )
        throw new Error("The PDF password is missing or incorrect.");
      for (let index = 0; index < data.pages.length; index += 1) {
        const pageNumber = data.pages[index];
        let page;
        try {
          self.postMessage({ type: "page-start", page: pageNumber });
          page = document.loadPage(pageNumber - 1);
          const result = await pageMarkdown(
            page,
            pageNumber,
            data.options,
            data.ocrPaths,
          );
          if (!result.text.trim() && data.options.placeholders)
            result.text = `[VISUAL_PLACEHOLDER page=${pageNumber} reason="No recoverable text or visual content"]`;
          self.postMessage(
            {
              type: "page",
              page: pageNumber,
              index,
              total: data.pages.length,
              engine: "mupdf-wasm",
              ...result,
            },
            result.assets.map((asset) => asset.data.buffer),
          );
        } catch (error) {
          self.postMessage({
            type: "page-error",
            page: pageNumber,
            message: error?.message || String(error),
          });
          if (data.options.strict) throw error;
        } finally {
          page?.destroy?.();
        }
      }
      self.postMessage({
        type: "done",
        total: data.pages.length,
        engine: "mupdf-wasm",
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error?.message || String(error),
      });
    } finally {
      try {
        document?.destroy?.();
      } catch {
        /* ignore cleanup failures */
      }
    }
  };
