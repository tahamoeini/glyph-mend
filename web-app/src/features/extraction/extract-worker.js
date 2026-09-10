import { createWorker as createOcrWorker } from "tesseract.js";
import { headingFor, normalizeText } from "./cleanup.js";
import { ocrLines, ocrMarkdownEntries } from "./ocr-layout.js";

const MATH_SYMBOLS = /[=<>+−×÷≠≤≥≈∑∏∫√∂∇∈∉⊂⊆∞α-ωΑ-Ω]/gu;
const FORMULA_CUE =
  /(?:as follows|given by|defined by|equal to|is then|is therefore|we have|equation(?: is| follows)?|condition(?:s)?|constraint(?:s)?|objective|profit function|demand function|probability is|solution is)\s*[:.]?$/i;
let ocrWorker;
let mupdf;
let ocrProgressPage;

const LATEX_SYMBOLS = new Map([
  ["≤", "\\leq"], ["≥", "\\geq"], ["≠", "\\neq"], ["≈", "\\approx"],
  ["×", "\\times"], ["÷", "\\div"], ["∑", "\\sum"], ["∏", "\\prod"],
  ["∫", "\\int"], ["√", "\\sqrt"], ["∞", "\\infty"], ["α", "\\alpha"],
  ["β", "\\beta"], ["γ", "\\gamma"], ["δ", "\\delta"], ["λ", "\\lambda"],
  ["μ", "\\mu"], ["π", "\\pi"], ["σ", "\\sigma"], ["θ", "\\theta"],
]);

export function latexMarkdown(text) {
  let value = normalizeText(text)
    .replace(/½/g, "\\frac{1}{2}")
    .replace(/¼/g, "\\frac{1}{4}")
    .replace(/¾/g, "\\frac{3}{4}");
  for (const [symbol, latex] of LATEX_SYMBOLS) value = value.split(symbol).join(`${latex} `);
  return value.replace(/\s+/g, " ").trim();
}

async function loadMupdf() {
  if (mupdf) return mupdf;
  const module = await import("mupdf");
  mupdf = module.default ?? module;
  return mupdf;
}

function rect(value) {
  if (Array.isArray(value)) return value;
  return [value.x, value.y, value.x + value.w, value.y + value.h];
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function escapeMd(value) {
  return value.replace(/([\\`*{}\[\]<>])/g, "\\$1");
}

function joinWrapped(lines) {
  return normalizeText(
    lines.reduce((result, line) => {
      const value = line.text.trim();
      if (!value) return result;
      if (!result) return value;
      if (/-$/.test(result) && /^\p{Ll}/u.test(value))
        return `${result.slice(0, -1)}${value}`;
      return `${result} ${value}`;
    }, ""),
  );
}

function mathScore(text) {
  const symbols = (text.match(MATH_SYMBOLS) || []).length;
  const words = (text.match(/\p{L}{3,}/gu) || []).length;
  const variables = (text.match(/(?:^|\s)[A-Za-z](?:[_^]\S+)?(?:\s|$)/g) || [])
    .length;
  const prose =
    /\b(?:the|and|that|this|with|from|where|which|then|than|for|are|was|were|have|has)\b/i.test(
      text,
    );
  return symbols * 3 + variables * 2 - words - (prose ? 5 : 0);
}

function isEquation(text, block, pageBounds, bodySize) {
  if (
    !text ||
    text.length > 260 ||
    /^(?:figure|table|source|note|chapter)\b/i.test(text)
  )
    return false;
  const [pageLeft, , pageRight] = pageBounds;
  const [left, , right] = block.bbox;
  const centered =
    Math.abs((left + right) / 2 - (pageLeft + pageRight) / 2) <
    (pageRight - pageLeft) * 0.13;
  const compact = text.split(/\s+/).length <= 18;
  return (
    compact &&
    (mathScore(text) >= 4 ||
      (centered && mathScore(text) >= 2 && block.maxSize <= bodySize * 1.35))
  );
}

function splitCells(line, bodySize) {
  const chars = line.chars.filter((item) => item.value.trim());
  if (chars.length < 2) return [line.text.trim()];
  const cells = [];
  let cell = chars[0].value;
  let previous = chars[0];
  for (const current of chars.slice(1)) {
    const gap = current.x0 - previous.x1;
    if (gap > bodySize * 1.7) {
      cells.push(cell.trim());
      cell = current.value;
    } else {
      if (
        gap > bodySize * 0.16 &&
        !/\s$/.test(cell) &&
        !/^\s/.test(current.value)
      )
        cell += " ";
      cell += current.value;
    }
    previous = current;
  }
  cells.push(cell.trim());
  return cells.filter(Boolean);
}

function tableFor(block, bodySize) {
  if (block.lines.length < 3 || block.lines.length > 60) return null;
  const rows = block.lines.map((line) => splitCells(line, bodySize));
  const columns = median(rows.map((row) => row.length));
  if (
    columns < 2 ||
    columns > 8 ||
    rows.filter((row) => row.length === columns).length / rows.length < 0.8
  )
    return null;
  const cells = rows.flat();
  const shortRatio =
    cells.filter((cell) => cell.split(/\s+/).length <= 8).length / cells.length;
  const numericRatio = cells.filter((cell) => /\d/.test(cell)).length / cells.length;
  const proseRatio = cells.filter((cell) =>
    /\b(?:the|and|that|with|from|which|this)\b/i.test(cell),
  ).length / cells.length;
  if (shortRatio < 0.65 || (numericRatio < 0.12 && proseRatio > 0.28))
    return null;
  return rows;
}

function markdownTable(rows) {
  const normalized = rows.map((row) =>
    row.map((value) => escapeMd(normalizeText(value).replace(/\|/g, "\\|"))),
  );
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${normalized[0].map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
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
      }
    };
    collectTextBlocks(data.blocks);
    return textBlocks
      .filter((value) => value.type === "text")
      .map((value) => {
        const lines = (value.lines || [])
          .map((item) => {
            const text = normalizeText(item.text || "");
            if (!text) return null;
            const bbox = rect(item.bbox || value.bbox);
            const size =
              Number(item.font?.size) || Math.max(6, bbox[3] - bbox[1]);
            const width = Math.max(1, bbox[2] - bbox[0]);
            const characters = [...text];
            const advance = width / Math.max(1, characters.length);
            return {
              bbox,
              text,
              size,
              sizes: [size],
              chars: characters.map((character, index) => ({
                value: character,
                x0: bbox[0] + index * advance,
                x1: bbox[0] + (index + 1) * advance,
              })),
            };
          })
          .filter(Boolean);
        if (!lines.length) return null;
        const sizes = lines.flatMap((item) => item.sizes);
        return {
          bbox: value.bbox
            ? rect(value.bbox)
            : [
                Math.min(...lines.map((item) => item.bbox[0])),
                Math.min(...lines.map((item) => item.bbox[1])),
                Math.max(...lines.map((item) => item.bbox[2])),
                Math.max(...lines.map((item) => item.bbox[3])),
              ],
          lines,
          sizes,
          maxSize: Math.max(...sizes),
          size: median(sizes),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function textFallbackBlocks(structured) {
  try {
    const lines = structured
      .asText()
      .split(/\r?\n/)
      .map((value, index) => ({
        text: normalizeText(value),
        bbox: [0, index * 12, 1, index * 12 + 10],
        size: 10,
        sizes: [10],
        chars: [],
      }))
      .filter((line) => line.text);
    if (!lines.length) return [];
    return [
      {
        bbox: [0, lines[0].bbox[1], 1, lines.at(-1).bbox[3]],
        lines,
        sizes: lines.flatMap((line) => line.sizes),
        maxSize: 10,
        size: 10,
      },
    ];
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
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, target, false);
  pixmap.clear(255);
  const device = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pixmap);
  page.run(device, mupdf.Matrix.identity);
  device.close();
  const data = new Uint8Array(pixmap.asPNG());
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  pixmap.destroy?.();
  return { data, width, height };
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

export function captionFor(blocks, bbox, bodySize) {
  const caption = blocks
    .flatMap((block) => block.lines)
    .map((line) => ({ text: joinWrapped([line]), bbox: line.bbox }))
    .find(
      (line) =>
        /^(?:figure|fig\.|table)\s+\d+(?:\.\d+)*(?:[.:]|\b)/i.test(line.text) &&
        line.bbox[1] >= bbox[3] - bodySize &&
        line.bbox[1] <= bbox[3] + bodySize * 5,
    );
  return caption?.text || "";
}

function textHeavyRegion(blocks, bbox) {
  const lines = blocks
    .flatMap((block) => block.lines)
    .filter((line) => line.bbox[1] < bbox[3] && line.bbox[3] > bbox[1]);
  const words = lines.reduce((count, line) => count + joinWrapped([line]).split(/\s+/).length, 0);
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
    if (looksLikeOcrEquation(item.text) || (cued && !/[=<>≤≥≠≈+−×÷]\s*$/u.test(item.text)))
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
    candidates.push({
      kind: "equation",
      bbox,
      y: bbox[1],
      rawY0,
      rawY1,
    });
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

async function recognizePage(page, options, paths) {
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
  const image = cropPage(
    page,
    rect(page.getBounds()),
    Math.max(1, Math.min(600, Number(options.ocrDpi) || 300)) / 72,
  );
  ocrProgressPage = options.page;
  const result = await ocrWorker.recognize(image.data, {}, { text: true, blocks: true });
  result.data._rasterWidth = image.width;
  result.data._rasterHeight = image.height;
  return result.data;
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
        const asset = {
          id: `p${pageNumber}-image-${index + 1}`,
          kind: "image",
          bbox,
          caption: captionFor(blocks, bbox, bodySize),
          ...rendered,
        };
        assets.push(asset);
        entries.push({ y: bbox[1], markdown: sourceMarker(pageNumber, asset) });
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
          const asset = {
            id: `p${pageNumber}-graphic-${assets.filter((item) => item.kind === "graphic").length + 1}`,
            ...candidate,
            bbox,
            caption: captionFor(blocks, bbox, bodySize),
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
        const count =
          assets.filter((item) => item.kind === candidate.kind).length + 1;
        const asset = {
          id: `p${pageNumber}-${candidate.kind}-${count}`,
          ...candidate,
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
  return { text, bodySize, assets, edges, quality };
}

if (typeof self !== "undefined")
  self.onmessage = async ({ data }) => {
    if (data.type !== "extract") return;
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
      await ocrWorker?.terminate?.();
      ocrWorker = null;
      document?.destroy?.();
    }
  };
