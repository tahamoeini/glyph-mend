/**
 * Deterministic page-layout analysis.
 *
 * This module deliberately contains no PDF or OCR dependency. It consumes the
 * evidence already produced by MuPDF/Tesseract and returns candidates with
 * their original geometry and source references intact. Thresholds are
 * derived from the page and its observed line statistics rather than being a
 * document-global font-size rule.
 */

export const LAYOUT_LAYER_VERSION = "layout-v1";

const NUMBERING = /^(?:\(?((?:\d+\.)*\d+|[A-Z]\.|[IVXLCDM]+\.)\)?)[.)]?\s+/iu;
const LIST_MARKER = /^(?:[-*+•◦▪]|\(?\d+[.)]|\(?[a-z][.)]|\(?[ivxlcdm]+[.)])\s+/iu;
const CAPTION_MARKER = /^(?:figure|fig\.?|table|chart|illustration)\s+\d+/iu;
const FOOTNOTE_MARKER = /^(?:\[?\d{1,3}\]?\s+|[*†‡]\s+)/u;
const QUOTE_MARKER = /^>\s+/u;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rect(value) {
  if (Array.isArray(value) && value.length >= 4) {
    const box = value.slice(0, 4).map(Number);
    return box.every(Number.isFinite) ? box : null;
  }
  if (!value || typeof value !== "object") return null;
  if ([value.x, value.y, value.w, value.h].every(Number.isFinite))
    return [value.x, value.y, value.x + value.w, value.y + value.h];
  if ([value.x0, value.y0, value.x1, value.y1].every(Number.isFinite))
    return [value.x0, value.y0, value.x1, value.y1];
  return null;
}

function median(values, fallback = 10) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback;
}

function average(values, fallback = 0) {
  const usable = values.filter(Number.isFinite);
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : fallback;
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function lineText(line) {
  if (typeof line?.text === "string") return cleanText(line.text);
  return cleanText((line?.chars || line?.spans || []).map((item) => {
    if (Array.isArray(item)) return item[0] || "";
    return item?.value ?? item?.text ?? "";
  }).join(""));
}

function lineBox(line) {
  return rect(line?.bbox) || rect(line?.box) || rect(line?.beginArgs?.[0]);
}

function lineSize(line) {
  const values = [
    ...(line?.sizes || []),
    ...(line?.chars || []).map((item) => Array.isArray(item) ? item[3] : item?.size),
    ...(line?.spans || []).map((item) => item?.size),
    line?.size,
    line?.font?.size,
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const box = lineBox(line);
  return median(values, box ? Math.max(6, box[3] - box[1]) : 10);
}

function lineBaseline(line) {
  const explicit = Number(line?.baseline ?? line?.baselineY);
  if (Number.isFinite(explicit)) return explicit;
  const box = lineBox(line);
  return box ? box[3] : 0;
}

function fontEvidence(line) {
  const font = line?.font || line?.style || {};
  if (typeof font === "string") return { family: font };
  return {
    family: String(font?.family ?? font?.name ?? font?.fontName ?? ""),
    weight: String(font?.weight ?? font?.flags?.weight ?? ""),
    style: String(font?.style ?? font?.flags?.style ?? ""),
    size: lineSize(line),
  };
}

function boxHeight(box) {
  return Math.max(0, box[3] - box[1]);
}

function boxWidth(box) {
  return Math.max(0, box[2] - box[0]);
}

function verticalOverlap(a, b) {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const smaller = Math.min(boxHeight(a), boxHeight(b));
  return smaller > 0 ? Math.max(0, overlap) / smaller : 0;
}

function horizontalOverlap(a, b) {
  const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const smaller = Math.min(boxWidth(a), boxWidth(b));
  return smaller > 0 ? Math.max(0, overlap) / smaller : 0;
}

function gapBetween(a, b) {
  return Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
}

function unionBoxes(values) {
  const boxes = values.map(rect).filter(Boolean);
  if (!boxes.length) return [0, 0, 0, 0];
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function normalizedBox(box, pageBounds) {
  const width = Math.max(1, pageBounds[2] - pageBounds[0]);
  const height = Math.max(1, pageBounds[3] - pageBounds[1]);
  return [
    (box[0] - pageBounds[0]) / width,
    (box[1] - pageBounds[1]) / height,
    (box[2] - pageBounds[0]) / width,
    (box[3] - pageBounds[1]) / height,
  ].map((value) => Number(value.toFixed(6)));
}

function sourceId(value, prefix, index) {
  return String(value?.id || value?.sourceId || `${prefix}-${index}`);
}

function diagnostic(code, severity, message, details = {}) {
  return { code, severity, message, details };
}

function normalizedLine(line, index, pageNumber = 1) {
  const bbox = lineBox(line) || [0, 0, 0, 0];
  const text = lineText(line);
  const spans = (line?.spans || line?.chars || []).map((span, spanIndex) => ({
    ...span,
    id: sourceId(span, `p${pageNumber}-span`, `${index}-${spanIndex}`),
  }));
  return {
    ...line,
    id: sourceId(line, `p${pageNumber}-line`, index),
    text,
    bbox,
    baseline: lineBaseline(line),
    size: lineSize(line),
    font: fontEvidence(line),
    spans,
    sourceBlockId: line?.sourceBlockId,
    sourceSpanIds: spans.map((span) => span.id),
    sourceObjectIds: (line?.sourceObjectIds || []).map(String),
    sourceIndex: index,
  };
}

function likelyRtl(lines) {
  const rtl = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u;
  const text = lines.map((line) => line.text).join(" ");
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  return letters.length > 0 && letters.filter((character) => rtl.test(character)).length / letters.length > 0.35;
}

function sameLine(left, right, stats) {
  const a = left.bbox;
  const b = right.bbox;
  const size = Math.max(6, Math.min(left.size, right.size, stats.bodySize));
  const baselineDistance = Math.abs(left.baseline - right.baseline);
  const overlap = verticalOverlap(a, b);
  const gap = Math.max(0, b[0] - a[2]);
  return (
    (overlap >= 0.35 || baselineDistance <= size * 0.42) &&
    gap <= Math.max(size * 1.5, stats.medianCharWidth * 3)
  );
}

/** Group span-like records into visual lines without changing their evidence. */
export function groupSpansIntoLines(spans = [], { page = 1, coordinateSpace = "page-points" } = {}) {
  const records = spans.map((span, index) => {
    const bbox = rect(span?.bbox) || [0, 0, 0, 0];
    return normalizedLine({
      ...span,
      bbox,
      text: span?.text ?? span?.value ?? "",
      spans: [span],
      baseline: span?.baseline ?? span?.baselineY ?? bbox[3],
    }, index, page);
  }).filter((line) => line.text);
  const sizes = records.map((line) => line.size);
  const stats = {
    bodySize: median(sizes),
    medianCharWidth: median(records.map((line) => boxWidth(line.bbox)), 10),
  };
  const lines = [];
  for (const record of [...records].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0] || a.sourceIndex - b.sourceIndex)) {
    const candidate = lines.find((line) => sameLine(line, record, stats));
    if (!candidate) {
      lines.push({
        ...record,
        coordinateSpace,
        sourceSpanIds: [...record.sourceSpanIds],
      });
      continue;
    }
    const rtl = likelyRtl([candidate, record]);
    const ordered = rtl
      ? [record, candidate].sort((a, b) => b.bbox[0] - a.bbox[0])
      : [candidate, record].sort((a, b) => a.bbox[0] - b.bbox[0]);
    candidate.text = ordered.map((line) => line.text).join(" ").replace(/\s+/gu, " ").trim();
    candidate.bbox = unionBoxes([candidate.bbox, record.bbox]);
    candidate.baseline = median(ordered.map((line) => line.baseline));
    candidate.size = median(ordered.map((line) => line.size));
    candidate.spans = ordered.flatMap((line) => line.spans || []);
    candidate.sourceSpanIds = candidate.spans.map((span) => span.id);
  }
  return lines.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

function blockFeatures(block) {
  const lines = block.lines || [];
  const first = lines[0] || {};
  const last = lines.at(-1) || first;
  const bbox = unionBoxes([block.bbox, ...lines.map((line) => line.bbox)]);
  return {
    bbox,
    text: cleanText(lines.map(lineText).join(" ") || block.text),
    lines,
    first,
    last,
    size: median(lines.map(lineSize).concat([block.size]).map(Number)),
    font: fontEvidence(first),
    sourceBlockId: sourceId(block, "block", block.sourceIndex ?? 0),
  };
}

function shouldJoinBlocks(left, right, stats) {
  const a = blockFeatures(left);
  const b = blockFeatures(right);
  const gap = b.bbox[1] - a.bbox[3];
  if (gap < -stats.bodySize * 0.2 || gap > stats.lineHeight * 1.85) return false;
  if (CAPTION_MARKER.test(b.text) || LIST_MARKER.test(b.text) || NUMBERING.test(b.text)) return false;
  if (a.text.endsWith("-") && /^[a-z]/u.test(b.text)) return true;
  const indent = Math.abs(b.bbox[0] - a.bbox[0]);
  const lineHeight = Math.max(stats.lineHeight, a.size, b.size);
  const aligned = horizontalOverlap(a.bbox, b.bbox) > 0.25 || indent <= lineHeight * 1.4;
  const continuation = /[,;:]$/u.test(a.text) || /^[a-z(]/u.test(b.text);
  return aligned && (continuation || gap <= stats.lineHeight * 0.85);
}

function mergeBlockRecords(left, right) {
  const leftLines = left.lines || [];
  const rightLines = right.lines || [];
  const hyphenated = /-$/u.test(lineText(leftLines.at(-1)));
  if (hyphenated && /^[a-z]/u.test(lineText(rightLines[0]))) {
    const previous = leftLines.at(-1);
    previous.text = `${lineText(previous).slice(0, -1)}${lineText(rightLines[0])}`;
    rightLines.shift();
  }
  return {
    ...left,
    bbox: unionBoxes([left.bbox, right.bbox]),
    lines: [...leftLines, ...rightLines],
    sourceBlockIds: [...(left.sourceBlockIds || [sourceId(left, "block", 0)]), ...(right.sourceBlockIds || [sourceId(right, "block", 0)])],
    diagnostics: [
      ...(left.diagnostics || []),
      ...(right.diagnostics || []),
      diagnostic("merged-blocks", "info", "Adjacent blocks were joined as a paragraph continuation."),
    ],
  };
}

/** Group already-formed MuPDF lines into conservative paragraph candidates. */
export function groupLinesIntoBlocks(lines = [], { page = 1, coordinateSpace = "page-points" } = {}) {
  const normalized = lines.map((line, index) => normalizedLine(line, index, page)).filter((line) => line.text);
  const sizes = normalized.map((line) => line.size);
  const stats = {
    bodySize: median(sizes),
    lineHeight: median(normalized.map((line) => boxHeight(line.bbox)), median(sizes)),
  };
  const result = [];
  for (const line of normalized.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])) {
    const previous = result.at(-1);
    const candidate = previous && shouldJoinBlocks(previous, { lines: [line], bbox: line.bbox }, stats);
    if (!candidate) {
      result.push({
        id: `p${page}-candidate-${result.length + 1}-${hash(line.text)}`,
        bbox: [...line.bbox],
        lines: [line],
        sourceBlockIds: [line.sourceBlockId || `p${page}-line-${line.sourceIndex}`],
        sourceSpanIds: [...line.sourceSpanIds],
        sourceObjectIds: [...line.sourceObjectIds],
        coordinateSpace,
        diagnostics: [],
      });
    } else {
      result[result.length - 1] = mergeBlockRecords(previous, {
        bbox: line.bbox,
        lines: [line],
        sourceBlockIds: [line.sourceBlockId || `p${page}-line-${line.sourceIndex}`],
      });
    }
  }
  return result.map((block, index) => ({
    ...block,
    sourceBlockIds: [...new Set(block.sourceBlockIds || [])],
    sourceSpanIds: [...new Set(block.lines.flatMap((line) => line.sourceSpanIds || []))],
    sourceObjectIds: [...new Set(block.lines.flatMap((line) => line.sourceObjectIds || []))],
    orderIndex: index,
  }));
}

function lineLikeRecords(blocks = []) {
  return blocks.flatMap((block, blockIndex) => (block.lines || []).map((line, lineIndex) => ({
    ...normalizedLine({ ...line, sourceBlockId: sourceId(block, "block", blockIndex) }, lineIndex, 1),
    sourceBlockIndex: blockIndex,
  })));
}

/** Find a stable gutter from observed text intervals and page margins. */
export function detectColumns(blocks = [], pageBounds = [0, 0, 612, 792], { direction = "auto" } = {}) {
  const [left, top, right, bottom] = pageBounds.map(Number);
  const width = Math.max(1, right - left);
  const records = blocks
    .map(blockFeatures)
    .filter((value) => value.text && boxWidth(value.bbox) > 0 && value.kind !== "source-page");
  const columnRecords = records.filter((value) => boxWidth(value.bbox) < width * 0.72);
  if (columnRecords.length < 4) return { count: 1, columns: [{ index: 0, left, right }], confidence: 0.35, diagnostics: [diagnostic("insufficient-column-evidence", "info", "Fewer than four non-wide text blocks were available.")] };
  const starts = [...new Set(columnRecords.map((value) => Math.round(value.bbox[0] * 10) / 10))].sort((a, b) => a - b);
  let largestGap = 0;
  let splitAt = -1;
  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];
    if (gap > largestGap) {
      largestGap = gap;
      splitAt = index;
    }
  }
  const bodySize = median(records.map((value) => value.size));
  const minimumGutter = Math.max(bodySize * 3.5, width * 0.055);
  if (splitAt < 0 || largestGap < minimumGutter) {
    return { count: 1, columns: [{ index: 0, left, right }], confidence: 0.82, diagnostics: [] };
  }
  const pivot = (starts[splitAt - 1] + starts[splitAt]) / 2;
  const leftRecords = columnRecords.filter((value) => value.bbox[0] < pivot);
  const rightRecords = columnRecords.filter((value) => value.bbox[0] >= pivot);
  const minimumMembers = Math.max(2, Math.floor(columnRecords.length * 0.18));
  if (leftRecords.length < minimumMembers || rightRecords.length < minimumMembers) {
    return { count: 1, columns: [{ index: 0, left, right }], confidence: 0.55, diagnostics: [diagnostic("ambiguous-column-split", "warning", "A candidate gutter did not have balanced text evidence.", { pivot, largestGap })] };
  }
  const leftRight = Math.max(...leftRecords.map((value) => value.bbox[2]));
  const rightLeft = Math.min(...rightRecords.map((value) => value.bbox[0]));
  const overlap = leftRight - rightLeft;
  if (overlap > width * 0.025) {
    return { count: 1, columns: [{ index: 0, left, right }], confidence: 0.48, diagnostics: [diagnostic("overlapping-column-evidence", "warning", "Text intervals overlap at the proposed gutter.", { overlap })] };
  }
  const rtl = direction === "rtl" || (direction === "auto" && likelyRtl(records.map((value) => ({ text: value.text }))));
  const columns = rtl
    ? [{ index: 0, left: pivot, right }, { index: 1, left, right: pivot }]
    : [{ index: 0, left, right: pivot }, { index: 1, left: pivot, right }];
  return {
    count: 2,
    columns,
    pivot,
    gutter: largestGap,
    direction: rtl ? "rtl" : "ltr",
    confidence: clamp(0.62 + Math.min(0.28, largestGap / width)),
    diagnostics: [diagnostic("stable-column-gutter", "info", "Two columns were supported by repeated x-start evidence.", { pivot, gutter: largestGap })],
  };
}

function blockColumn(block, columns) {
  const center = (block.bbox[0] + block.bbox[2]) / 2;
  const containing = columns.find((column) => center >= column.left && center <= column.right);
  return containing?.index ?? 0;
}

function isWide(block, pageBounds) {
  return block.kind !== "source-page" && boxWidth(block.bbox) >= (pageBounds[2] - pageBounds[0]) * 0.72;
}

function orderedByGeometry(blocks, columns, pageBounds) {
  const sourcePages = blocks.filter((block) => block.kind === "source-page");
  const contentBlocks = blocks.filter((block) => block.kind !== "source-page");
  if (columns.length < 2) return [...contentBlocks].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0] || a.sourceIndex - b.sourceIndex).concat(sourcePages);
  const anchors = contentBlocks.filter((block) => isWide(block, pageBounds));
  const result = [];
  let lower = Number.NEGATIVE_INFINITY;
  for (const anchor of [...anchors].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])) {
    result.push(...contentBlocks.filter((block) => block !== anchor && block.bbox[1] >= lower && block.bbox[1] < anchor.bbox[1]).sort((a, b) => blockColumn(a, columns) - blockColumn(b, columns) || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]));
    result.push(anchor);
    lower = anchor.bbox[3];
  }
  result.push(...contentBlocks.filter((block) => !result.includes(block)).sort((a, b) => blockColumn(a, columns) - blockColumn(b, columns) || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]));
  return result.concat(sourcePages);
}

function headingEvidence(block, index, ordered, pageBounds, stats) {
  const text = block.text;
  const numbering = text.match(NUMBERING);
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const whitespaceBefore = previous ? block.bbox[1] - previous.bbox[3] : block.bbox[1] - pageBounds[1];
  const whitespaceAfter = next ? next.bbox[1] - block.bbox[3] : pageBounds[3] - block.bbox[3];
  const relativeSize = block.size / Math.max(1, stats.bodySize);
  const short = text.length <= 180 && !/[.!?]$/u.test(text);
  const styleCue = /bold|semibold|black|title|heading/iu.test(`${block.font.weight} ${block.font.style} ${block.font.family}`);
  const numberingCue = Boolean(numbering);
  const whitespaceCue = whitespaceBefore > stats.lineHeight * 1.35 || whitespaceAfter > stats.lineHeight * 1.1;
  const centeredCue = Math.abs(((block.bbox[0] + block.bbox[2]) / 2) - ((pageBounds[0] + pageBounds[2]) / 2)) < (pageBounds[2] - pageBounds[0]) * 0.08;
  const score = [numberingCue && 0.35, styleCue && 0.2, relativeSize >= 1.12 && 0.16, whitespaceCue && 0.14, short && 0.1, centeredCue && 0.05].filter(Boolean).reduce((sum, value) => sum + value, 0);
  const likely = score >= 0.48;
  const numberingValue = numbering?.[1] || "";
  const level = numberingValue
    ? numberingValue.replace(/[.)]$/u, "").split(".").filter(Boolean).length
    : relativeSize >= 1.55 ? 1 : relativeSize >= 1.3 ? 2 : 3;
  return { likely, level: Math.max(1, Math.min(6, level)), score: clamp(score), evidence: { numbering: numberingCue, style: styleCue, relativeSize: Number(relativeSize.toFixed(3)), whitespaceBefore: Number(whitespaceBefore.toFixed(2)), whitespaceAfter: Number(whitespaceAfter.toFixed(2)), centered: centeredCue } };
}

function classifyBlock(block, index, ordered, pageBounds, stats) {
  const text = block.text;
  const heading = headingEvidence(block, index, ordered, pageBounds, stats);
  let type = "paragraph";
  let structureConfidence = 0.58;
  let listLevel;
  const diagnostics = [...(block.diagnostics || [])];
  if (heading.likely) {
    type = "heading";
    structureConfidence = heading.score;
  } else if (LIST_MARKER.test(text)) {
    type = "list-item";
    structureConfidence = 0.86;
    const listPeers = ordered.slice(0, index).filter((value) => LIST_MARKER.test(value.text));
    const firstList = listPeers[0];
    listLevel = firstList ? Math.max(0, Math.round((block.bbox[0] - firstList.bbox[0]) / Math.max(1, stats.bodySize * 2.2))) : 0;
  } else if (CAPTION_MARKER.test(text)) {
    type = "caption";
    structureConfidence = 0.84;
  } else if (FOOTNOTE_MARKER.test(text) && block.bbox[1] > pageBounds[1] + (pageBounds[3] - pageBounds[1]) * 0.72 && block.size < stats.bodySize * 0.9) {
    type = "footnote";
    structureConfidence = 0.74;
  } else if (QUOTE_MARKER.test(text)) {
    type = "quote";
    structureConfidence = 0.82;
  } else if (/[=<>≤≥≠≈+−×÷∑∏∫√]/u.test(text) && text.length < 160) {
    type = "equation";
    structureConfidence = 0.56;
    diagnostics.push(diagnostic("equation-ambiguous", "warning", "Equation-like symbols were observed but no equation object was supplied."));
  }
  if (type === "paragraph" && heading.score >= 0.32) diagnostics.push(diagnostic("heading-ambiguous", "warning", "Heading signals were mixed; the block remains a paragraph."));
  return {
    ...block,
    type,
    headingLevel: type === "heading" ? heading.level : undefined,
    listLevel,
    text,
    structureConfidence: clamp(structureConfidence),
    headingEvidence: heading.evidence,
    diagnostics,
  };
}

/** Produce ordered semantic candidates while retaining original block evidence. */
export function analyzePageLayout({ blocks = [], objects = [], page = 1, pageBounds = [0, 0, 612, 792], coordinateSpace = "page-points", direction = "auto" } = {}) {
  const original = blocks.map((block, index) => {
    const features = blockFeatures({ ...block, sourceIndex: index });
    const sourceBlockId = features.sourceBlockId;
    const sourceSpanIds = (block.lines || []).flatMap((line, lineIndex) =>
      normalizedLine({ ...line, sourceBlockId }, lineIndex, page).sourceSpanIds,
    );
    return {
      ...block,
      ...features,
      sourceIndex: index,
      sourceBlockIds: [sourceBlockId],
      sourceSpanIds: [...new Set(sourceSpanIds)],
      sourceObjectIds: [...new Set((block.sourceObjectIds || []).map(String))],
      coordinateSpace,
    };
  }).filter((block) => block.text && block.bbox);
  const lineRecords = lineLikeRecords(original);
  const lineHeight = median(lineRecords.map((line) => boxHeight(line.bbox)), 10);
  const bodySize = median(lineRecords.map((line) => line.size), 10);
  const columns = detectColumns(original, pageBounds, { direction });
  const ordered = orderedByGeometry(original, columns.columns, pageBounds);
  const stats = { bodySize, lineHeight };
  const classified = ordered.map((block, index, all) => classifyBlock(block, index, all, pageBounds, stats));
  const visualBoundaries = objects
    .map((object, index) => ({
      id: sourceId(object, `p${page}-object`, index),
      bbox: rect(object?.bbox),
      kind: object?.kind || "visual-boundary",
    }))
    .filter((object) => object.bbox);
  const diagnostics = [
    ...columns.diagnostics,
    ...classified.flatMap((block) => block.diagnostics || []),
    ...visualBoundaries
      .filter((object) => boxWidth(object.bbox) >= (pageBounds[2] - pageBounds[0]) * 0.72)
      .map((object) => diagnostic("visual-boundary-anchor", "info", "A wide image/vector object is available as a reading-order boundary.", { objectId: object.id, bbox: object.bbox })),
  ];
  const candidates = classified.map((block, index) => ({
    id: `p${page}-node-${index + 1}-${hash(`${block.type}|${block.text}|${block.bbox.join(",")}`)}`,
    type: block.type,
    headingLevel: block.headingLevel,
    listLevel: block.listLevel,
    text: block.text,
    bbox: [...block.bbox],
    normalizedBBox: normalizedBox(block.bbox, pageBounds),
    coordinateSpace,
    sourcePage: page,
    sourceBlockIds: [...new Set(block.sourceBlockIds || [])],
    sourceSpanIds: [...new Set(block.sourceSpanIds || [])],
    sourceObjectIds: [...new Set(block.sourceObjectIds)],
    orderIndex: index,
    column: columns.count > 1 ? blockColumn(block, columns.columns) : 0,
    extractionConfidence: 1,
    structureConfidence: columns.diagnostics.some((item) => item.code === "ambiguous-column-split" || item.code === "overlapping-column-evidence")
      ? Math.min(block.structureConfidence, columns.confidence)
      : block.structureConfidence,
    diagnostics: block.diagnostics || [],
    disposition: (columns.diagnostics.some((item) => item.code === "ambiguous-column-split" || item.code === "overlapping-column-evidence")
      ? Math.min(block.structureConfidence, columns.confidence)
      : block.structureConfidence) < 0.6 ? "needs-review" : "reconstructed",
    originalBlock: block,
  }));
  return {
    version: LAYOUT_LAYER_VERSION,
    coordinateSpace,
    page,
    pageBounds: [...pageBounds],
    direction: columns.direction || (direction === "auto" ? "ltr" : direction),
    columns,
    visualBoundaries,
    candidates,
    orderedBlocks: classified,
    diagnostics,
    metrics: {
      blockCount: candidates.length,
      lineCount: lineRecords.length,
      columnCount: columns.count,
      ambiguousBlocks: candidates.filter((candidate) => candidate.structureConfidence < 0.6).length,
    },
  };
}

export function layoutEntries(entries = [], pageBounds = [0, 0, 612, 792], { bodySize = 10, flows = true } = {}) {
  const blocks = entries.map((entry, index) => ({
    ...entry,
    id: entry?.id || `entry-${index}`,
    text: entry?.rawText || entry?.text || entry?.markdown || "",
    bbox: rect(entry?.bbox) || [finite(entry?.x), finite(entry?.y), finite(entry?.x) + bodySize, finite(entry?.y) + bodySize],
    lines: [{ text: entry?.rawText || entry?.text || "", bbox: rect(entry?.bbox) || [finite(entry?.x), finite(entry?.y), finite(entry?.x) + bodySize, finite(entry?.y) + bodySize], size: bodySize }],
  }));
  const analysis = analyzePageLayout({ blocks, pageBounds });
  if (!flows) {
    return {
      ...analysis,
      orderedBlocks: [...analysis.orderedBlocks].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]),
      candidates: [...analysis.candidates].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]),
    };
  }
  return analysis;
}

export function layoutQualityMetrics(expected = [], actual = [], { expectedHeadings = [], actualHeadings = [], expectedParagraphBoundaries = [], actualParagraphBoundaries = [], duplicateHeaderFooterCount = 0, headerFooterCount = 0 } = {}) {
  const expectedText = expected.map(cleanText);
  const actualText = actual.map(cleanText);
  const position = new Map(actualText.map((text, index) => [text, index]));
  const readingOrderAccuracy = expectedText.length
    ? expectedText.filter((text, index) => position.get(text) === index).length / expectedText.length
    : 1;
  const headingLevelAccuracy = expectedHeadings.length
    ? expectedHeadings.filter((heading, index) => actualHeadings[index]?.level === heading.level && cleanText(actualHeadings[index]?.text) === cleanText(heading.text)).length / expectedHeadings.length
    : 1;
  const boundarySet = (values) => new Set(values.map(Number));
  const expectedBoundaries = boundarySet(expectedParagraphBoundaries);
  const actualBoundaries = boundarySet(actualParagraphBoundaries);
  const boundaryUnion = new Set([...expectedBoundaries, ...actualBoundaries]);
  const paragraphBoundaryAccuracy = boundaryUnion.size
    ? [...boundaryUnion].filter((value) => expectedBoundaries.has(value) === actualBoundaries.has(value)).length / boundaryUnion.size
    : 1;
  return {
    readingOrderAccuracy: Number(readingOrderAccuracy.toFixed(3)),
    headingLevelAccuracy: Number(headingLevelAccuracy.toFixed(3)),
    paragraphBoundaryAccuracy: Number(paragraphBoundaryAccuracy.toFixed(3)),
    duplicateHeaderFooterRate: headerFooterCount ? Number((duplicateHeaderFooterCount / headerFooterCount).toFixed(3)) : 0,
  };
}

/** Identify repeated running matter without deciding whether to remove it. */
export function detectRepeatedHeaderFooter(pages = [], { minimumPageFraction = 0.35 } = {}) {
  const occurrences = new Map();
  for (const page of pages) {
    const seenOnPage = new Set();
    for (const candidate of page?.candidates || page?.blocks || []) {
      const text = cleanText(candidate?.text || candidate?.rawText || candidate?.markdown);
      if (!text) continue;
      const bbox = rect(candidate?.bbox);
      const height = page?.pageBounds ? page.pageBounds[3] - page.pageBounds[1] : 792;
      const position = bbox && bbox[1] <= (page?.pageBounds?.[1] ?? 0) + height * 0.14
        ? "header"
        : bbox && bbox[3] >= (page?.pageBounds?.[3] ?? height) - height * 0.14
          ? "footer"
          : null;
      if (!position) continue;
      const key = `${position}:${text.toLocaleLowerCase()}`;
      if (seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      const item = occurrences.get(key) || { text, position, pages: [] };
      item.pages.push(page.page ?? page.pageNumber ?? page.sourcePage);
      occurrences.set(key, item);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * minimumPageFraction));
  return [...occurrences.values()]
    .filter((item) => item.pages.length >= threshold)
    .sort((a, b) => ({ header: 0, footer: 1 }[a.position] - { header: 0, footer: 1 }[b.position] || a.text.localeCompare(b.text)));
}
