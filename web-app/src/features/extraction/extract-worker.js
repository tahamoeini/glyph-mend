import { createWorker as createOcrWorker } from "tesseract.js";
import { headingFor, normalizeText } from "./cleanup.js";
import { ocrLines, ocrMarkdownEntries } from "./ocr-layout.js";
import { coalesceStructuredBlocks } from "./structured-lines.js";
import { analyzePageLayout, layoutEntries } from "./layout-layer.js";
import {
  inlineEquationCandidates,
  inlineMathMarkdown,
  splitEquationProse,
} from "./math-markdown.js";
import { validateEquationCandidate } from "../recognition/math-validation.js";
import { equationFromLatex, equationToMarkdown } from "../../shared/equation-ir.js";
import { documentIRToMarkdown, pageDocumentIR } from "./document-ir.js";
import { semanticDocumentFromLegacyDocumentIR } from "../../shared/semantic-document-ir.js";
import {
  tableIRFromRows,
  tableIRToMarkdown,
} from "../../shared/table-ir.js";
import {
  ACTIVE_FORMAT_LIMITS,
  validateExtractionRequest,
} from "../../shared/security-boundaries.js";
import { classifyVisualEvidence, createVisualIR } from "../../shared/visual-ir.js";

const FORMULA_CUE =
  /(?:equation|formula|expression|defined by|given by|satisfies|we have|becomes|therefore|hence|where|as follows|satisfying|express(?:ed)?|condition(?: reduces)? to|is the (?:largest|smallest)|at (?:a )?price|is given by|reduces to|is equal to)\s*:?\s*$/i;
const DISPLAY_MATH = String.fromCharCode(36).repeat(2);
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

function average(values) {
  const usable = values.map(Number).filter(Number.isFinite);
  return usable.length
    ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(3))
    : null;
}

function normalizeTextLine(value = "") {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function escapeMd(value, { protectBlockStart = true, table = false } = {}) {
  // Intraword underscores are literal in CommonMark and escaping them makes
  // identifiers such as REENROLL_REQUIRED look like damaged source text.
  // Braces, brackets, underscores, and dollar signs are literal in the
  // CommonMark emitted by this app. Escaping them made source code and
  // identifiers look corrupted in the editor and in DOCX export.
  let text = String(value ?? "").replace(/([`*])/g, "\\$1");
  if (table) text = text.replace(/\|/g, "\\|");
  if (
    protectBlockStart &&
    /^(?:\s*(?:#{1,6}\s|[-+*]\s|>\s|```|~~~))/.test(text)
  )
    text = text.replace(/^(\s*)(?=\S)/, "$1\\");
  return text;
}

function joinWrapped(lines) {
  return lines
    .map((line) => String(line?.text ?? ""))
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
      let x0 = null;
      let x1 = null;
      for (const char of line.chars || []) {
        if (
          previous &&
          char.value.trim() &&
          previous.value.trim() &&
          char.x0 - previous.x1 > bodySize * 1.55
        ) {
          if (current.trim()) cells.push({ text: current.trim(), bbox: [x0, line.bbox?.[1] ?? 0, x1, line.bbox?.[3] ?? 0] });
          current = "";
          x0 = null;
          x1 = null;
        }
        if (x0 === null) x0 = Number(char.x0);
        current += char.value;
        x1 = Number(char.x1);
        previous = char;
      }
      if (current.trim()) cells.push({ text: current.trim(), bbox: [x0, line.bbox?.[1] ?? 0, x1, line.bbox?.[3] ?? 0] });
      return cells;
    })
    .filter((cells) => cells.length >= 2);
  if (rows.length < 3) return null;
  const columns = Math.round(median(rows.map((row) => row.length)));
  if (columns < 2 || columns > 8) return null;
  const consistent = rows.filter((row) => row.length === columns);
  // A Markdown table cannot represent an uncertain row shape without either
  // dropping source cells or inventing empty ones. Keep the block editable
  // only when every recovered row agrees on its column count.
  if (consistent.length !== rows.length) return null;
  const confidence = Number(
    Math.min(0.99, 0.72 + (consistent.length >= 4 ? 0.12 : 0.06)).toFixed(3),
  );
  const tableIR = tableIRFromRows({
    bbox: block.bbox,
    rows: consistent,
    confidence: {
      detection: confidence,
      structure: confidence,
      content: confidence,
      export: confidence >= 0.82 ? 0.9 : 0.45,
    },
    source: {
      kind: "native-text",
      spanIds: block.sourceSpanIds || [],
      objectIds: block.sourceObjectIds || [],
    },
  });
  return {
    rows: consistent.map((row) => row.map((cell) => cell.text)),
    confidence,
    tableIR,
  };
}

export function pageTableFromBlocks(blocks, bodySize, pageBounds) {
  const lines = blocks
    .flatMap((block) => block.lines || [])
    .map((line) => {
      const bbox = line.bbox;
      return {
        line,
        text: joinWrapped([line]),
        bbox,
        y: bbox?.length === 4 ? (bbox[1] + bbox[3]) / 2 : NaN,
      };
    })
    .filter(
      (item) =>
        item.text &&
        item.bbox?.length === 4 &&
        item.bbox[2] > item.bbox[0] &&
        item.bbox[3] > item.bbox[1] &&
        !isDiagramLike(item.text),
    )
    .sort((a, b) => a.y - b.y || a.bbox[0] - b.bbox[0]);
  if (lines.length < 6) return null;

  const rowTolerance = Math.max(2.5, bodySize * 0.72);
  const rows = [];
  for (const item of lines) {
    const row = rows.at(-1);
    if (!row || Math.abs(item.y - row.y) > rowTolerance) {
      rows.push({ y: item.y, items: [item] });
      continue;
    }
    row.items.push(item);
    row.y =
      row.items.reduce((sum, value) => sum + value.y, 0) / row.items.length;
  }

  const pageWidth = pageBounds[2] - pageBounds[0];
  const cellRows = rows
    .map((row) => ({
      ...row,
      items: row.items.sort((a, b) => a.bbox[0] - b.bbox[0]),
    }))
    .filter(
      (row) =>
        row.items.length >= 2 &&
        row.items.length <= 8 &&
        row.items.every(
          (item) =>
            item.text.length <= 90 &&
            item.text.split(/\s+/).length <= 12 &&
            !/[{}]/u.test(item.text),
        ),
    );
  if (cellRows.length < 3) return null;

  const alignmentTolerance = Math.max(bodySize * 2.2, pageWidth * 0.035);
  let best = null;
  for (let start = 0; start < cellRows.length; start += 1) {
    const columns = cellRows[start].items.length;
    const starts = cellRows[start].items.map((item) => item.bbox[0]);
    const run = [cellRows[start]];
    for (let index = start + 1; index < cellRows.length; index += 1) {
      const row = cellRows[index];
      const previous = run.at(-1);
      if (
        row.items.length !== columns ||
        row.y - previous.y > Math.max(bodySize * 4.8, 52) ||
        row.items.some(
          (item, column) =>
            Math.abs(item.bbox[0] - starts[column]) > alignmentTolerance,
        )
      )
        break;
      run.push(row);
    }
    if (!best || run.length > best.length) best = run;
  }
  if (!best || best.length < 3) return null;

  const values = best.map((row) => row.items.map((item) => item.text));
  const textCells = values.flat();
  const sentenceLike = textCells.filter(
    (value) =>
      value.split(/\s+/).length > 10 ||
      /\b(?:the|and|that|this|with|from|which|because|therefore)\b/i.test(
        value,
      ),
  ).length;
  if (sentenceLike / textCells.length > 0.28) return null;

  const rowConsistency = Math.min(1, best.length / Math.max(1, cellRows.length));
  // Every row in `best` passed the column-start tolerance above. The run is
  // therefore already the aligned subset; no second OCR-only alignment pass
  // is needed here.
  const alignmentConfidence = 1;
  const confidence = Number(
    Math.min(0.99, 0.45 + rowConsistency * 0.25 + alignmentConfidence * 0.3).toFixed(3),
  );
  if (confidence < 0.82) return null;

  const tableBox = [
    Math.min(...best.flatMap((row) => row.items.map((item) => item.bbox[0]))),
    Math.min(...best.flatMap((row) => row.items.map((item) => item.bbox[1]))),
    Math.max(...best.flatMap((row) => row.items.map((item) => item.bbox[2]))),
    Math.max(...best.flatMap((row) => row.items.map((item) => item.bbox[3]))),
  ];
  const tableRows = best.map((row) => row.items.map((item) => ({
    text: item.text,
    bbox: item.bbox,
    confidence,
  })));
  const tableIR = tableIRFromRows({
    bbox: tableBox,
    rows: tableRows,
    confidence: {
      detection: confidence,
      structure: confidence,
      content: confidence,
      export: 0.9,
    },
    source: {
      kind: "native-text",
      spanIds: best.flatMap((row) => row.items.flatMap((item) => item.line?.sourceSpanIds || [])),
      objectIds: best.flatMap((row) => row.items.flatMap((item) => item.line?.sourceObjectIds || [])),
    },
    alignment: { method: "repeated-x-starts", confidence: alignmentConfidence },
  });
  return {
    markdown: tableIRToMarkdown(tableIR),
    lines: new Set(best.flatMap((row) => row.items.map((item) => item.line))),
    y: best[0].y,
    confidence,
    rows: values.length,
    columns: best[0].items.length,
    tableIR,
    bbox: tableBox,
  };
}

function clusterCoordinates(values, tolerance) {
  const clusters = [];
  for (const value of [...values].filter(Number.isFinite).sort((a, b) => a - b)) {
    const current = clusters.at(-1);
    if (!current || value - current.at(-1) > tolerance) clusters.push([value]);
    else current.push(value);
  }
  return clusters.map(
    (cluster) => cluster.reduce((sum, value) => sum + value, 0) / cluster.length,
  );
}

function vectorRuleBox(value) {
  const bbox = value?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite))
    return null;
  const [x0, y0, x1, y1] = bbox;
  return x1 > x0 && y1 > y0 ? bbox : null;
}

function textLinesForTable(blocks) {
  return blocks
    .flatMap((block) => block.lines || [])
    .map((line) => ({
      line,
      text: joinWrapped([line]),
      bbox: line.bbox,
    }))
    .filter(
      (item) =>
        item.text &&
        Array.isArray(item.bbox) &&
        item.bbox.length === 4 &&
        item.bbox.every(Number.isFinite) &&
        item.bbox[2] > item.bbox[0] &&
        item.bbox[3] > item.bbox[1] &&
        !isDiagramLike(item.text),
    );
}

function tableCellForLine(line, boundaries, rowBounds) {
  const center = (line.bbox[0] + line.bbox[2]) / 2;
  const tolerance = Number(rowBounds?.tolerance) || 0;
  let column = boundaries.findIndex(
    (boundary, index) =>
      index < boundaries.length - 1 &&
      center >= boundary &&
      center <= boundaries[index + 1],
  );
  if (column < 0) column = center < boundaries[0] ? 0 : boundaries.length - 2;
  const firstCrossed = boundaries.findIndex(
    (boundary, index) =>
      index > 0 &&
      index < boundaries.length - 1 &&
      line.bbox[0] < boundary - tolerance &&
      line.bbox[2] > boundary + tolerance,
  );
  const lastCrossed = [...boundaries]
    .map((boundary, index) => ({ boundary, index }))
    .reverse()
    .find(
      ({ boundary, index }) =>
        index > 0 &&
        index < boundaries.length - 1 &&
        line.bbox[0] < boundary - tolerance &&
        line.bbox[2] > boundary + tolerance,
    )?.index;
  return {
    column,
    span:
      firstCrossed >= 0 && lastCrossed >= firstCrossed
        ? {
            row: rowBounds.index,
            column: Math.max(0, column),
            rowSpan: 1,
            colSpan: lastCrossed - firstCrossed + 2,
            bbox: [...line.bbox],
          }
        : null,
  };
}

/**
 * Reconstructs a table only when the PDF itself supplies a stable rule grid.
 * This intentionally rejects sparse/merged rows: Markdown has no native span
 * model, and filling those gaps would fabricate cells. The vector graphic
 * path then preserves the original region as an image instead.
 */
export function pageTableFromVectors(blocks, vectors, bodySize, pageBounds) {
  const pageWidth = pageBounds[2] - pageBounds[0];
  const pageHeight = pageBounds[3] - pageBounds[1];
  if (pageWidth <= 0 || pageHeight <= 0) return null;
  const ruleTolerance = Math.max(0.8, bodySize * 0.28);
  const horizontal = vectors
    .map(vectorRuleBox)
    .filter(Boolean)
    .filter((bbox) => {
      const width = bbox[2] - bbox[0];
      const height = bbox[3] - bbox[1];
      return width >= pageWidth * 0.25 && height <= Math.max(2, bodySize * 0.45);
    });
  if (horizontal.length < 3) return null;

  const horizontalY = clusterCoordinates(
    horizontal.map((bbox) => (bbox[1] + bbox[3]) / 2),
    ruleTolerance,
  );
  const horizontalRules = horizontalY
    .map((y) => {
      const members = horizontal.filter(
        (bbox) => Math.abs((bbox[1] + bbox[3]) / 2 - y) <= ruleTolerance,
      );
      return {
        y,
        left: Math.min(...members.map((bbox) => bbox[0])),
        right: Math.max(...members.map((bbox) => bbox[2])),
      };
    })
    .filter((rule) => rule.right - rule.left >= pageWidth * 0.25);
  if (horizontalRules.length < 3) return null;

  // A table uses aligned broad rules. Keeping the largest aligned span makes
  // decorative rules and unrelated chart axes fail closed instead of becoming
  // invented tables.
  const spanTolerance = Math.max(bodySize * 2, pageWidth * 0.035);
  let bestRules = [];
  for (const start of horizontalRules) {
    const run = horizontalRules.filter(
      (rule) =>
        Math.abs(rule.left - start.left) <= spanTolerance &&
        Math.abs(rule.right - start.right) <= spanTolerance,
    );
    if (run.length > bestRules.length) bestRules = run;
  }
  bestRules.sort((a, b) => a.y - b.y);
  if (bestRules.length < 3) return null;

  const left = Math.min(...bestRules.map((rule) => rule.left));
  const right = Math.max(...bestRules.map((rule) => rule.right));
  const firstRule = bestRules[0].y;
  const lastRule = bestRules.at(-1).y;
  const vertical = vectors
    .map(vectorRuleBox)
    .filter(Boolean)
    .filter((bbox) => {
      const width = bbox[2] - bbox[0];
      const height = bbox[3] - bbox[1];
      const center = (bbox[0] + bbox[2]) / 2;
      return (
        width <= Math.max(2, bodySize * 0.45) &&
        height >= Math.max(2, bodySize * 0.7) &&
        center > left + ruleTolerance &&
        center < right - ruleTolerance &&
        bbox[3] >= firstRule - bodySize * 4 &&
        bbox[1] <= lastRule + bodySize * 4
      );
    });
  const verticalX = clusterCoordinates(
    vertical.map((bbox) => (bbox[0] + bbox[2]) / 2),
    ruleTolerance,
  ).filter((value) => {
    const coverage = vertical
      .filter(
        (bbox) =>
          Math.abs((bbox[0] + bbox[2]) / 2 - value) <= ruleTolerance,
      )
      .reduce((total, bbox) => total + bbox[3] - bbox[1], 0);
    return coverage >= Math.max(bodySize * 2, (lastRule - firstRule) * 0.45);
  });
  const boundaries = [
    left,
    ...verticalX.filter((value) => value > left + ruleTolerance && value < right - ruleTolerance),
    right,
  ].sort((a, b) => a - b);
  if (boundaries.length < 3) return null;

  const alignedVertical = vertical.filter((bbox) =>
    verticalX.some(
      (value) => Math.abs((bbox[0] + bbox[2]) / 2 - value) <= ruleTolerance,
    ),
  );
  const top = Math.min(
    firstRule,
    ...alignedVertical
      .filter((bbox) => bbox[1] < firstRule && firstRule - bbox[1] <= bodySize * 4)
      .map((bbox) => bbox[1]),
  );
  const bottom = Math.max(
    lastRule,
    ...alignedVertical
      .filter((bbox) => bbox[3] > lastRule && bbox[3] - lastRule <= bodySize * 4)
      .map((bbox) => bbox[3]),
  );
  const yBoundaries = clusterCoordinates(
    [top, ...bestRules.map((rule) => rule.y), bottom],
    ruleTolerance,
  );
  if (yBoundaries.length < 4) return null;

  const textLines = textLinesForTable(blocks);
  const rows = [];
  const usedLines = new Set();
  const spans = [];
  for (let index = 0; index < yBoundaries.length - 1; index += 1) {
    const rowTop = yBoundaries[index];
    const rowBottom = yBoundaries[index + 1];
    const rowLines = textLines
      .filter((item) => {
        const center = (item.bbox[1] + item.bbox[3]) / 2;
        return center > rowTop + ruleTolerance && center < rowBottom - ruleTolerance;
      })
      .sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
    const cells = Array.from({ length: boundaries.length - 1 }, () => ({
      text: [],
      bbox: null,
      rowSpan: 1,
      colSpan: 1,
    }));
    for (const item of rowLines) {
      const placement = tableCellForLine(item, boundaries, {
        index,
        tolerance: ruleTolerance,
      });
      if (placement.span) spans.push(placement.span);
      const cell = cells[placement.column];
      cell.text.push(item.text);
      cell.bbox = cell.bbox
        ? [
            Math.min(cell.bbox[0], item.bbox[0]),
            Math.min(cell.bbox[1], item.bbox[1]),
            Math.max(cell.bbox[2], item.bbox[2]),
            Math.max(cell.bbox[3], item.bbox[3]),
          ]
        : [...item.bbox];
      usedLines.add(item.line);
    }
    const occupied = cells.filter((cell) => cell.text.length);
    // A row with only one occupied cell is usually a merged heading, section
    // marker, or a figure row. Do not turn it into empty invented cells.
    if (occupied.length < 2) return null;
    rows.push(
      cells.map((cell, column) => ({
        ...cell,
        text: cell.text.join(" ").trim(),
        bbox:
          cell.bbox ||
          [boundaries[column], rowTop, boundaries[column + 1], rowBottom],
      })),
    );
  }
  if (rows.length < 3 || spans.length) return null;

  const values = rows.map((row) => row.map((cell) => cell.text));
  const filled = rows.flat().filter((cell) => cell.text).length;
  const possible = rows.length * (boundaries.length - 1);
  const coverage = filled / Math.max(1, possible);
  if (coverage < 0.35) return null;
  const confidence = Number(
    Math.min(0.98, 0.72 + Math.min(0.18, coverage * 0.18)).toFixed(3),
  );
  const tableIR = tableIRFromRows({
    bbox: [left, top, right, bottom],
    rows,
    confidence: {
      detection: confidence,
      structure: confidence,
      content: confidence,
      export: spans.length ? 0.45 : 0.9,
    },
    source: {
      kind: "table-lines",
      objectIds: vectors.map((vector, index) => String(vector.id || `vector-${index + 1}`)),
    },
    detectedRules: vectors.map((vector, index) => ({
      id: String(vector.id || `vector-${index + 1}`),
      bbox: vector.bbox,
    })),
    alignment: { method: "vector-rule-grid", confidence },
    method: "pdf-vector-grid",
  });
  return {
    markdown: tableIRToMarkdown(tableIR),
    lines: usedLines,
    y: top,
    confidence,
    rows: rows.length,
    columns: boundaries.length - 1,
    bbox: [left, top, right, bottom],
    tableIR,
  };
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
        let current = {
          text: words[0].text,
          x0: words[0].bbox[0],
          x1: words[0].bbox[2],
          y0: words[0].bbox[1],
          y1: words[0].bbox[3],
          confidence: words[0].confidence,
        };
        let previous = words[0];
        for (const word of words.slice(1)) {
          const gap = word.bbox[0] - previous.bbox[2];
          if (gap > gapThreshold) {
            cells.push(current);
            current = {
              text: word.text,
              x0: word.bbox[0],
              x1: word.bbox[2],
              y0: word.bbox[1],
              y1: word.bbox[3],
              confidence: word.confidence,
            };
          } else {
            current.text = `${current.text} ${word.text}`.trim();
            current.x1 = word.bbox[2];
            current.y0 = Math.min(current.y0, word.bbox[1]);
            current.y1 = Math.max(current.y1, word.bbox[3]);
            current.confidence = Math.min(current.confidence, word.confidence);
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

function ocrTableModel(data) {
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
  const ocrCells = aligned.flatMap((row) => row.cells);
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

  const values = aligned.map((row) => row.cells.map((cell) => cell.text));
  const confidence = Number(
    Math.min(0.96, 0.68 + (aligned.length / Math.max(1, rows.length)) * 0.2).toFixed(3),
  );
  const tableIR = tableIRFromRows({
    bbox: [
      tableLeft,
      Math.min(...aligned.map((row) => row.y0)),
      tableRight,
      Math.max(...aligned.map((row) => row.y1)),
    ],
    coordinateSpace: "ocr-raster",
    columnCount: columns,
    rows: aligned.map((row, rowIndex) => row.cells.map((cell, columnIndex) => ({
      text: cell.text,
      bbox: [cell.x0, cell.y0, cell.x1, cell.y1],
      rowIndex,
      columnIndex,
      confidence: cell.confidence / 100,
      source: { kind: "ocr-text" },
    }))),
    confidence: {
      detection: confidence,
      structure: confidence,
      content: ocrCells.reduce((sum, cell) => sum + (Number(cell.confidence) || 0) / 100, 0) / Math.max(1, ocrCells.length),
      export: 0.85,
    },
    source: { kind: "ocr-text" },
    alignment: { method: "ocr-word-grid", tolerance, confidence: aligned.length / consistent.length },
  });
  return { rows: values, columns, confidence, tableIR };
}

export function ocrTableMarkdown(data) {
  const model = ocrTableModel(data);
  return model ? tableIRToMarkdown(model.tableIR) : null;
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

export function isDiagramLike(text) {
  const value = String(text || "").trim();
  if (!value || value.length > 180) return false;
  const compact = value.replace(/\s+/g, "");
  if (/^[|+_\-v^<>]+$/u.test(compact)) return true;
  if (/^\|(?:\s+[^|]+)?$/u.test(value) && !/[.!?;:]$/u.test(value))
    return true;
  if (/^[|+\-]*[-=]*>+\s+/u.test(value)) return true;
  if (/(?:\+[-=]{3,}\+|[-=]{4,}|_{4,}|\|.*\|)/u.test(value)) return true;
  const drawing = (compact.match(/[|+_\-]/gu) || []).length;
  return drawing >= 4 && drawing / Math.max(1, compact.length) > 0.35;
}

export function isEquation(text, block, pageBounds, bodySize) {
  const split = splitEquationProse(text);
  const mathText = split?.equation || text;
  if (!text || text.length > 240 || mathText.split(/\s+/).length > 28) return false;
  if (/^(?:figure|fig\.|table|chapter|source|note|proof|theorem|lemma|proposition|corollary|example)\b/i.test(text)) return false;
  if (isDiagramLike(text)) return false;
  if (/^\s*[|>]/u.test(text)) return false;
  if (/\b(?:GET|POST|PUT|PATCH|DELETE|HTTP|HTTPS|JSON|API|URL|status|command(?:Id)?|type|version|endpoint|token|certificate|websocket|public\s+key)\b/i.test(text))
    return false;
  if (/[?]/u.test(text)) return false;
  const score = mathScore(mathText);
  const hasRelation = /[=<>≤≥≠≈]/u.test(mathText);
  const hasMathCommand = /\\(?:frac|sqrt|sum|prod|int|sin|cos|tan|log|ln|exp)\b/u.test(mathText);
  const hasScript = /(?:\b[A-Za-z]\s*_\s*[A-Za-z0-9({\[]|\^\s*[A-Za-z0-9({\[])/u.test(mathText);
  const hasNumeric = /\d/u.test(mathText);
  const hasOperator = /[+*/^_×÷∑∏∫√]/u.test(mathText) ||
    /(?:^|\s)-(?=\s|[A-Za-z0-9({\[])/u.test(mathText);
  const identifiers = mathText.match(/[A-Za-z]+/gu) || [];
  const compactFormula = identifiers.length > 0 && identifiers.every((value) => value.length <= 3);
  if (!hasRelation && !hasMathCommand && !hasScript) return false;
  if (score < 2) return false;
  if (
    hasRelation &&
    !hasMathCommand &&
    !hasScript &&
    !hasOperator &&
    !compactFormula
  )
    return false;
  const prose =
    /\b(?:the|and|that|this|with|from|where|which|then|than|for|are|was|were|have|has|into|when)\b/i.test(
      mathText,
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

export function embeddedTextNeedsOcr(blocks = []) {
  const text = blocks
    .flatMap((block) => block?.lines || [])
    .map((line) => String(line?.text || ""))
    .join(" ");
  // U+FFFD means the PDF font encoding could not be mapped to Unicode. OCR
  // should replace that damaged text; emitting replacement glyphs into a
  // Markdown/DOCX export permanently loses the source characters.
  return (text.match(/\uFFFD/gu) || []).length > 0;
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
          font: value.lines?.find((line) => line.font)?.font || null,
          maxSize: Math.max(...sizes, 10),
          size: median(sizes),
        };
      })
      .filter((block) => block.lines.length);
  } catch {
    return [];
  }
}

function readStructuredPage(page, pageNumber = 1) {
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
      block = { bbox: rect(bbox), lines: [], sizes: [], font: null };
    },
    beginLine(bbox) {
      line = { bbox: rect(bbox), text: "", chars: [], sizes: [], font: null };
    },
    onChar(value, origin, font, size, quad) {
      const points = Array.isArray(quad) ? quad : [];
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      const charBox = ys.length && xs.length
        ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
        : line.bbox;
      line.text += value;
      line.font ||= font || null;
      block.font ||= font || null;
      line.sizes.push(size);
      line.chars.push({
        value,
        x0: xs.length ? Math.min(...xs) : line.bbox[0],
        x1: xs.length ? Math.max(...xs) : line.bbox[2],
        bbox: charBox,
        baseline: Array.isArray(origin) ? Number(origin[1]) : undefined,
        font: font || null,
        size,
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
      images.push({
        id: `p${pageNumber}-image-object-${images.length + 1}`,
        bbox: rect(bbox),
        image,
      });
    },
    onVector(bbox, flags) {
      vectors.push({
        id: `p${pageNumber}-vector-object-${vectors.length + 1}`,
        bbox: rect(bbox),
        flags,
      });
    },
  });

  if (!blocks.length) blocks.push(...jsonFallbackBlocks(structured));
  if (!blocks.length) blocks.push(...textFallbackBlocks(structured));
  const stableBlocks = coalesceStructuredBlocks(blocks);
  structured.destroy?.();

  const device = new mupdf.Device({
    fillPath(path, _evenOdd, ctm) {
      try {
        vectors.push({
          id: `p${pageNumber}-vector-path-${vectors.length + 1}`,
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
          id: `p${pageNumber}-vector-stroke-${vectors.length + 1}`,
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
  return { blocks: stableBlocks, images, vectors };
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
      source: sourceType === "raster" ? "ocr-layout-text" : "pdf-structure-text",
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
    sourceSpanIds: Array.isArray(candidate?.sourceSpanIds) ? [...candidate.sourceSpanIds] : [],
    sourceRegionIds: Array.isArray(candidate?.sourceRegionIds) ? [...candidate.sourceRegionIds] : [],
    sourceObjectIds: Array.isArray(candidate?.sourceObjectIds) ? [...candidate.sourceObjectIds] : [],
    mode: candidate?.mode || "display",
    disposition,
    cropAsset: sourceAsset,
  };
}

function validateEquationReconstruction(
  pageNumber,
  bbox,
  text,
  crop,
  sourceType = "raster",
  metadata = {},
) {
  const provider = sourceType === "raster" ? "tesseract-ocr" : "mupdf-structured-text";
  const candidate = buildEquationCandidate(
    pageNumber,
    { kind: "equation", bbox, y: bbox[1], text, ...metadata },
    crop,
    sourceType,
    text,
  );
  const validation = validateEquationCandidate(
    {
      latex: text,
      normalized: text,
      confidence: candidate.confidence,
      provider,
      version: "browser-local",
    },
    candidate.sourceAsset,
  );
  candidate.validation = validation.validation;
  candidate.manifest = validation.manifest;
  candidate.output = validation.output;
  candidate.equationIR = validation.output.equationIR;
  candidate.disposition = validation.disposition;

  const sourceEvidenceAsset = crop.data?.byteLength
    ? {
        id: candidate.sourceAsset.id,
        page: pageNumber,
        kind: "equation",
        bbox,
        sourceType: "raster",
        caption: "Equation preserved for review",
        ...crop,
      }
    : null;
  const fallbackAsset = !validation.accepted ? sourceEvidenceAsset : null;
  return {
    candidate,
    validation,
    sourceEvidenceAsset,
    fallbackAsset,
    fallbackMarker: fallbackAsset
      ? sourceMarker(pageNumber, fallbackAsset)
      : validation.accepted
        ? ""
        : escapeMd(text, { protectBlockStart: false }),
    provider,
  };
}

function equationReviewItem(candidate, validation, provider) {
  return {
    id: candidate.sourceAsset?.id || candidate.id || "equation-unknown",
    page: candidate.page,
    kind: "equation",
    sourceAsset: candidate.sourceAsset,
    candidate: {
      id: candidate.id,
      kind: "equation",
      latex: validation.output.latex || candidate.text || "",
      normalized: validation.output.normalized || candidate.text || "",
      provider,
      version: "browser-local",
      confidence: candidate.confidence,
      modelHash: candidate.sourceAsset?.provenance?.modelHash || null,
    },
    validation: validation.validation,
    equationIR: validation.output.equationIR,
    mode: validation.output.equationIR?.mode || candidate.mode || "display",
    manifest: validation.manifest,
    disposition: candidate.disposition,
    status: candidate.disposition,
  };
}

export function paddedBbox(bbox, pageBounds, padding = 0) {
  const [left, top, right, bottom] = pageBounds;
  return [
    Math.max(left, bbox[0] - padding),
    Math.max(top, bbox[1] - padding),
    Math.min(right, bbox[2] + padding),
    Math.min(bottom, bbox[3] + padding),
  ];
}

function vectorGraphicCandidates(vectors, pageBounds, bodySize) {
  const proximity = Math.max(
    bodySize * 2.4,
    Math.min(pageBounds[2] - pageBounds[0], pageBounds[3] - pageBounds[1]) * 0.018,
  );
  const groups = [];
  for (const vector of vectors) {
    if (!vector.bbox.every(Number.isFinite)) continue;
    let group = groups.find(
      (item) =>
        !(
          vector.bbox[2] < item.bbox[0] - proximity ||
          vector.bbox[0] > item.bbox[2] + proximity ||
          vector.bbox[3] < item.bbox[1] - proximity ||
          vector.bbox[1] > item.bbox[3] + proximity
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

function visualBboxIntersects(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 4 || right.length !== 4)
    return false;
  return left[0] < right[2] && left[2] > right[0] && left[1] < right[3] && left[3] > right[1];
}

function classifyPageVisualAssets(assets, { page, pageBounds, images, vectors } = {}) {
  const pageArea = Math.max(1, (pageBounds?.[2] - pageBounds?.[0]) * (pageBounds?.[3] - pageBounds?.[1]));
  return assets.map((asset) => {
    if (asset.visualIRv2) return asset;
    const assetVectors = (vectors || []).filter((item) => visualBboxIntersects(item.bbox, asset.bbox));
    const assetImages = (images || []).filter((item) => visualBboxIntersects(item.bbox, asset.bbox));
    const sourceKind = asset.kind === "source-page"
      ? "source-page"
      : asset.kind === "graphic"
        ? "vector"
        : asset.sourceType === "vector"
          ? "vector"
          : asset.sourceType === "pdf-page"
            ? "source-page"
            : "raster";
    const classHint = asset.kind === "equation-source" || asset.kind === "equation"
      ? "equation-image"
      : asset.kind === "source-page"
        ? "background"
        : asset.kind === "image"
          ? undefined
          : asset.kind;
    const sourceObjectIds = asset.sourceObjectIds || assetVectors.map((item) => item.id).filter(Boolean);
    const sourceCropIds = asset.sourceCropIds || [asset.id].filter(Boolean);
    try {
      const visualIRv2 = classifyVisualEvidence({
        id: asset.id,
        page,
        bbox: asset.bbox,
        coordinateSpace: "page-points",
        sourceKind,
        assetId: asset.id,
        cropId: asset.id,
        classHint,
        caption: asset.caption,
        text: asset.caption,
        images: assetImages,
        vectors: assetVectors,
        sourceSpanIds: asset.sourceSpanIds || [],
        sourceObjectIds,
        sourceCropIds,
        pageArea,
        sourceAsset: {
          assetId: asset.id,
          cropIds: sourceCropIds,
          format: asset.format || asset.type || "raster",
          preserved: true,
        },
      });
      return { ...asset, visualIRv2 };
    } catch (error) {
      const visualIRv2 = createVisualIR({
        id: asset.id,
        class: "unresolved-visual",
        page,
        bbox: asset.bbox,
        coordinateSpace: "page-points",
        source: {
          kind: sourceKind,
          assetId: asset.id,
          objectIds: sourceObjectIds,
          cropIds: sourceCropIds,
        },
        sourceAsset: { assetId: asset.id, cropIds: sourceCropIds, preserved: true },
        confidence: { detection: 0.2, classification: 0.1, structure: 0.1, reconstruction: null, export: 0.9 },
        disposition: "preserved-source",
        warnings: ["Visual classification failed closed; source asset retained."],
        diagnostics: [{ code: "visual-classification-failed", severity: "error", message: String(error?.message || error) }],
      });
      return { ...asset, visualIRv2 };
    }
  });
}

export function dedupeNearbyEquationEntries(entries = [], bodySize = 10) {
  const result = [];
  const seen = new Map();
  const distanceLimit = Math.max(12, bodySize * 3.2);
  for (const entry of entries) {
    if (!/^equation(?:-fallback)?$/.test(entry?.kind || "") || !entry?.markdown) {
      result.push(entry);
      continue;
    }
    const previous = seen.get(entry.markdown);
    if (
      previous &&
      Math.abs(Number(entry.y) - Number(previous.y)) <= distanceLimit
    )
      continue;
    seen.set(entry.markdown, entry);
    result.push(entry);
  }
  return result;
}

function headingLikeText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 140 || /[.!?,;:]$/u.test(text)) return false;
  if (/^(?:\d{1,4}[/-]){2}\d{1,4}\b|^https?:\/\//i.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 16) return false;
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return false;
  const uppercase =
    letters.filter((char) => char === char.toUpperCase()).length /
    letters.length;
  const wordLike = words.filter((word) => /\p{L}/u.test(word));
  return (
    uppercase > 0.72 ||
    wordLike.length > 0 &&
    wordLike.every((word) =>
      /^(?:[A-Z][\p{L}'’&-]*|(?:and|of|the|to|in|for|a|an))$/u.test(word),
    )
  );
}

function headingLevel(markdown) {
  const match = /^(#{1,6})\s+/.exec(String(markdown || ""));
  return match ? match[1].length : 1;
}

function mergeWrappedHeadingEntries(entries, bodySize) {
  const gapLimit = Math.max(22, bodySize * 3.2);
  const result = [];
  for (const entry of entries) {
    const previous = result.at(-1);
    const previousText = previous?.rawText;
    const currentText = entry.rawText;
    const previousHeading = /^#{1,6}\s+/.test(previous?.markdown || "");
    const currentHeading = /^#{1,6}\s+/.test(entry.markdown || "");
    const sameHeadingLevel =
      previousHeading &&
      currentHeading &&
      headingLevel(previous.markdown) === headingLevel(entry.markdown);
    const canMerge =
      previous?.kind === "text" &&
      entry.kind === "text" &&
      typeof previousText === "string" &&
      typeof currentText === "string" &&
      previousText.length + currentText.length <= 160 &&
      Math.abs(Number(entry.y) - Number(previous.y)) <= gapLimit &&
      ((sameHeadingLevel &&
        headingLikeText(previousText) &&
        headingLikeText(currentText)) ||
        (previousHeading && !currentHeading && headingLikeText(currentText)) ||
        (!previousHeading && currentHeading && headingLikeText(previousText)));
    if (canMerge) {
      const text = `${previousText} ${currentText}`.replace(/\s+/g, " ").trim();
      const level = Math.min(
        headingLevel(previous.markdown),
        headingLevel(entry.markdown),
      );
      result[result.length - 1] = {
        ...previous,
        markdown: `${"#".repeat(level)} ${escapeMd(text, {
          protectBlockStart: false,
        })}`,
        rawText: text,
      };
      continue;
    }
    result.push(entry);
  }

  // Chat export pages can place the message title above an identical, larger
  // Markdown heading. Keep the semantic heading and discard only that exact
  // duplicate at the top of the page.
  for (let index = 0; index < Math.min(result.length, 8); index += 1) {
    const candidate = result[index];
    if (
      candidate?.kind !== "text" ||
      typeof candidate.rawText !== "string" ||
      /^#{1,6}\s+/.test(candidate.markdown || "") ||
      !headingLikeText(candidate.rawText)
    )
      continue;
    const firstText = candidate.rawText.replace(/\s+/g, " ").trim();
    const duplicateIndex = result.findIndex(
      (entry, entryIndex) =>
        entryIndex > index &&
        entryIndex <= index + 3 &&
        /^#{1,6}\s+/.test(entry.markdown || "") &&
        typeof entry.rawText === "string" &&
        entry.rawText.replace(/\s+/g, " ").trim().toLowerCase() ===
          firstText.toLowerCase(),
    );
    if (duplicateIndex >= 0) {
      result.splice(index, 1);
      break;
    }
  }
  return result;
}

function isDiagramLabel(text) {
  const value = String(text || "").trim();
  if (!value || value.length > 90 || /[.!?;:]$/u.test(value)) return false;
  if (
    /^(?:https?:\/\/|www\.)/iu.test(value) ||
    /^\d{1,4}\/\d{1,4}$/u.test(value) ||
    /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/iu.test(value)
  )
    return false;
  if (/^(?:the|a|an|this|that|for|when|instead|once|if|use)\b/i.test(value))
    return false;
  const words = value.split(/\s+/);
  const letters = value.match(/[A-Za-z]/gu) || [];
  const upperCaseLetters = value.match(/[A-Z]/gu) || [];
  const statusLabel =
    letters.length > 0 &&
    upperCaseLetters.length / letters.length >= 0.78 &&
    words.length <= 6 &&
    !/[=,]/u.test(value);
  const flowLabel = /^(?:network interruption|same certificate|reconciliation|approaching expiry|generate new key \+ CSR|certificate generation \d+|generation \d+\s+(?:ACTIVE|RETIRED)|Hub issues generation \d+)$/iu.test(value);
  return (
    words.length <= 8 &&
    (statusLabel ||
      flowLabel ||
      /(?:\/|→|←|↔|\b(?:WSS|HTTPS|mTLS|Hub|Server|Channel)\b)/iu.test(value))
  );
}

function renderDiagramLine(entry, left, bodySize) {
  const value = String(entry.rawText || "").replace(/[ \t]+$/u, "").trimStart();
  const x = Number(entry.x);
  const column = Math.max(4, bodySize * 0.58);
  const indent = Number.isFinite(x)
    ? Math.max(0, Math.round((x - left) / column))
    : 0;
  return `${" ".repeat(indent)}${value}`;
}

function mergeDiagramEntries(entries, bodySize) {
  const result = [];
  const gapLimit = Math.max(28, bodySize * 4.2);
  for (let index = 0; index < entries.length; index += 1) {
    const first = entries[index];
    if (
      first.kind !== "text" ||
      (!isDiagramLike(first.rawText) && !isDiagramLabel(first.rawText))
    ) {
      result.push(first);
      continue;
    }

    const run = [first];
    let anchors = isDiagramLike(first.rawText) ? 1 : 0;
    while (index + 1 < entries.length) {
      const next = entries[index + 1];
      const previous = run.at(-1);
      if (
        next.kind !== "text" ||
        (!isDiagramLike(next.rawText) && !isDiagramLabel(next.rawText)) ||
        next.y - previous.y > gapLimit
      )
        break;
      run.push(next);
      if (isDiagramLike(next.rawText)) anchors += 1;
      index += 1;
    }

    if (run.length && anchors >= 2 && result.at(-1)?.kind === "text") {
      const previous = result.at(-1);
      if (
        isDiagramLabel(previous.rawText) &&
        first.y - previous.y <= gapLimit
      ) {
        run.unshift(result.pop());
      }
    }

    if (run.length < 2 || anchors < 2) {
      result.push(...run);
      continue;
    }

    const xValues = run.map((entry) => Number(entry.x)).filter(Number.isFinite);
    const left = xValues.length ? Math.min(...xValues) : 0;
    const boxes = run.filter((entry) => Array.isArray(entry.bbox)).map((entry) => entry.bbox);
    const bbox = boxes.length
      ? [
          Math.min(...boxes.map((box) => box[0])),
          Math.min(...boxes.map((box) => box[1])),
          Math.max(...boxes.map((box) => box[2])),
          Math.max(...boxes.map((box) => box[3])),
        ]
      : first.bbox;
    result.push({
      ...first,
      kind: "diagram",
      rawText: undefined,
      bbox,
      x: bbox?.[0] ?? first.x,
      y: bbox?.[1] ?? first.y,
      markdown: [
        "```diagram",
        ...run.map((entry) => renderDiagramLine(entry, left, bodySize)),
        "```",
      ].join("\n"),
    });
  }
  return result;
}

function codeSignal(text) {
  const value = String(text || "").trim();
  if (!value || value.length > 180) return 0;
  if (/^[{}[\],]+$/u.test(value)) return 2;
  if (/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/iu.test(value))
    return 2;
  if (/^[A-Za-z][\w.-]*\s*(?:=|:)\s*.+$/u.test(value)) return 2;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(value)) return 1;
  if (/^[A-Za-z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+$/.test(value)) return 1;
  if (/^[A-Za-z][\w.-]*,?$/.test(value) && value.length <= 42) return 1;
  return 0;
}

function mergeCodeEntries(entries, bodySize) {
  const result = [];
  const gapLimit = Math.max(22, bodySize * 3.1);
  for (let index = 0; index < entries.length; index += 1) {
    const first = entries[index];
    const firstSignal =
      first.kind === "text" ? codeSignal(first.rawText) : 0;
    if (!firstSignal) {
      result.push(first);
      continue;
    }

    const run = [first];
    let anchors = firstSignal >= 2 ? 1 : 0;
    while (index + 1 < entries.length) {
      const next = entries[index + 1];
      const signal = next.kind === "text" ? codeSignal(next.rawText) : 0;
      const previous = run.at(-1);
      if (!signal || next.y - previous.y > gapLimit) break;
      run.push(next);
      if (signal >= 2) anchors += 1;
      index += 1;
    }

    if (run.length < 2 || anchors < 2) {
      result.push(...run);
      continue;
    }

    result.push({
      ...first,
      kind: "code",
      rawText: undefined,
      markdown: [
        "```text",
        ...run.map((entry) => String(entry.rawText || "").replace(/[ \t]+$/u, "").trim()),
        "```",
      ].join("\n"),
    });
  }
  return result;
}

export function orderPageEntries(entries = [], pageBounds = [0, 0, 612, 792], bodySize = 10) {
  const analysis = layoutEntries(entries, pageBounds, { bodySize, flows: true });
  const ordered = analysis.orderedBlocks
    .map((block) => entries[block.sourceIndex])
    .filter(Boolean);
  return ordered.length === entries.length
    ? ordered
    : [...entries].sort(
        (a, b) => Number(a.y || 0) - Number(b.y || 0) || Number(a.x || 0) - Number(b.x || 0),
      );
}

function twoColumnSignature(
  entries = [],
  pageBounds = [0, 0, 612, 792],
  bodySize = 10,
) {
  const textEntries = entries.filter(
    (entry) => entry?.kind === "text" && Number.isFinite(Number(entry.x)),
  );
  const pageWidth = Math.max(1, Number(pageBounds[2]) - Number(pageBounds[0]));
  if (textEntries.length < 4) return null;
  if (textEntries.filter((entry) => isDiagramLike(entry.rawText)).length >= 2)
    return null;

  const xValues = [...new Set(textEntries.map((entry) => Number(entry.x)))].sort(
    (a, b) => a - b,
  );
  let splitAt = -1;
  let largestGap = 0;
  for (let index = 1; index < xValues.length; index += 1) {
    const gap = xValues[index] - xValues[index - 1];
    if (gap > largestGap) {
      largestGap = gap;
      splitAt = index;
    }
  }
  const minimumColumnGap = Math.max(bodySize * 8, pageWidth * 0.14);
  if (splitAt < 0 || largestGap < minimumColumnGap) return null;
  const pivot = (xValues[splitAt - 1] + xValues[splitAt]) / 2;
  const leftCount = textEntries.filter((entry) => Number(entry.x) < pivot).length;
  const rightCount = textEntries.length - leftCount;
  if (leftCount < 2 || rightCount < 2) return null;
  return { pivot, leftCount, rightCount, gap: largestGap };
}

export function pageLayoutSummary(
  entries = [],
  pageBounds = [0, 0, 612, 792],
  bodySize = 10,
  { flows = true, analysis = null } = {},
) {
  const usable = entries.filter((entry) => Array.isArray(entry?.bbox));
  const layout = analysis || (flows ? layoutEntries(entries, pageBounds, { bodySize, flows }) : null);
  const columns = flows
    ? layout?.columns?.count === 2
      ? layout.columns
      : twoColumnSignature(entries, pageBounds, bodySize)
    : null;
  return {
    orderMethod: !flows
      ? "y-x-geometry"
      : columns
        ? "two-column-geometry"
        : "vertical-geometry",
    columns: columns ? 2 : 1,
    confidence: columns
      ? 0.9
      : usable.length >= 2
        ? 0.78
        : entries.length
          ? 0.55
          : 0.35,
    direction: "top-to-bottom",
    writingDirection: layout?.direction || "ltr",
    layerVersion: layout?.version || "legacy",
    diagnostics: layout?.diagnostics || [],
    metrics: layout?.metrics || {},
  };
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
  if (/^\s*[|>]/u.test(text)) return false;
  if (/\b(?:GET|POST|PUT|PATCH|DELETE|HTTP|HTTPS|JSON|API|URL|status|command(?:Id)?|type|version|endpoint|token|certificate|websocket)\b/i.test(text))
    return false;
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
      x0: Math.min(...group.map((item) => item.x0)),
      x1: Math.max(...group.map((item) => item.x1)),
      latex: latexMarkdown(group.map((item) => item.text).join(" ")),
    })),
  };
}

export function ocrProgressMessage(pageNumber, event = {}) {
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > ACTIVE_FORMAT_LIMITS.maxPageNumber
  )
    return null;
  const progress = Number(event.progress);
  return {
    type: "ocr-progress",
    page: pageNumber,
    status: typeof event.status === "string" ? event.status : "",
    progress: Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress))
      : 0,
  };
}

async function ensureOcrWorker(options, paths) {
  if (!ocrWorker) {
    ocrWorker = await createOcrWorker(options.ocrLanguage || "eng", 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
      gzip: false,
      // The language bundle is served locally. Avoid a stale IndexedDB copy
      // from a previous app version causing TessBaseAPI.Init to fail.
      cacheMethod: "none",
      logger: (event) => {
        const message = ocrProgressMessage(ocrProgressPage, event);
        if (message) self.postMessage(message);
      },
    });
  }
  return ocrWorker;
}

async function recognizeRaster(image, options, paths, pageNumber) {
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > ACTIVE_FORMAT_LIMITS.maxPageNumber
  )
    throw new TypeError(
      `OCR page must be an integer from 1 to ${ACTIVE_FORMAT_LIMITS.maxPageNumber}.`,
    );

  ocrProgressPage = pageNumber;
  try {
    const worker = await ensureOcrWorker(options, paths);
    const result = await worker.recognize(image.data, {}, { text: true, blocks: true });
    result.data._rasterWidth = image.width;
    result.data._rasterHeight = image.height;
    return result.data;
  } finally {
    if (ocrProgressPage === pageNumber) ocrProgressPage = undefined;
  }
}

async function recognizePage(page, options, paths, pageNumber) {
  const image = cropPage(
    page,
    rect(page.getBounds()),
    Math.max(1, Math.min(600, Number(options.ocrDpi) || 300)) / 72,
  );
  return recognizeRaster(image, options, paths, pageNumber);
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
      options,
      paths,
      pageNumber,
    );
    const model = ocrTableModel(data);
    if (!model) return null;
    return {
      markdown: tableIRToMarkdown(model.tableIR),
      confidence: model.confidence,
      tableIR: model.tableIR,
    };
  } catch {
    return null;
  }
}

export function equationImageCandidatesFor(images, blocks, pageBounds, bodySize) {
  const [left, top, right, bottom] = pageBounds;
  const pageArea = Math.max(1, (right - left) * (bottom - top));
  const maxGap = Math.max(18, bodySize * 3.5);
  const lines = blocks
    .flatMap((block) => block.lines || [])
    .filter(
      (line) =>
        line?.bbox?.length === 4 &&
        line.bbox.every(Number.isFinite) &&
        String(line.text || "").trim(),
    )
    .map((line) => ({ ...line, text: normalizeTextLine(line.text) }));
  return images
    .map((value, sourceImageIndex) => {
      const bbox = value?.bbox;
      if (
        !bbox?.every(Number.isFinite) ||
        bbox[2] <= bbox[0] ||
        bbox[3] <= bbox[1]
      )
        return null;
      const width = bbox[2] - bbox[0];
      const height = bbox[3] - bbox[1];
      const ratio = (width * height) / pageArea;
      if (
        ratio < 0.0004 ||
        ratio > 0.12 ||
        width < Math.max(18, bodySize * 3) ||
        height > Math.max(28, bodySize * 7.5)
      )
        return null;
      const cue = lines
        .map((line) => {
          const verticalGap =
            line.bbox[3] <= bbox[1]
              ? bbox[1] - line.bbox[3]
              : line.bbox[1] >= bbox[3]
                ? line.bbox[1] - bbox[3]
                : 0;
          return { line, verticalGap };
        })
        .filter(
          ({ line, verticalGap }) =>
            verticalGap <= maxGap &&
            horizontalAffinity(line.bbox, bbox, bodySize) &&
            FORMULA_CUE.test(line.text),
        )
        .sort((a, b) => a.verticalGap - b.verticalGap)[0];
      if (!cue) return null;
      const caption = captionFor(blocks, bbox, bodySize);
      if (/^(?:figure|fig\.|table)\b/i.test(caption)) return null;
      return {
        ...value,
        kind: "equation-image",
        sourceImageIndex,
        y: bbox[1],
        cueText: cue.line.text,
        reason: "nearby-formula-cue",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y || a.sourceImageIndex - b.sourceImageIndex)
    .slice(0, 4);
}

export async function pageMarkdown(page, pageNumber, options, ocrPaths) {
  const pageBounds = rect(page.getBounds());
  const { blocks, images, vectors } = readStructuredPage(page, pageNumber);
  const layoutAnalysis = analyzePageLayout({
    blocks,
    objects: [...images, ...vectors],
    page: pageNumber,
    pageBounds,
  });
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
  const embeddedTextCorrupt = embeddedTextNeedsOcr(blocks);
  const preserveSourcePage =
    embeddedTextCorrupt && options.preserveVisuals !== false;
  let sourcePageFallbackFailed = false;

  const pageTable =
    !options.forceOcr && !embeddedTextCorrupt && options.detectTables
      ? pageTableFromVectors(blocks, vectors, bodySize, pageBounds) ||
        pageTableFromBlocks(blocks, bodySize, pageBounds)
      : null;
  let pageTableLines = pageTable?.lines || new Set();
  if (pageTable) {
    let tableMarkdown = pageTable.markdown;
    let tableIR = pageTable.tableIR;
    if (!tableMarkdown && options.preserveVisuals !== false) {
      try {
        const bbox = paddedBbox(pageTable.bbox, pageBounds, Math.max(4, bodySize * 0.55));
        const rendered = cropPage(page, bbox, 2.25);
        const asset = {
          id: `p${pageNumber}-table-source`,
          kind: "table-image",
          bbox,
          ...rendered,
        };
        assets.push(asset);
        tableIR = tableIRFromRows({
          ...tableIR,
          source: { ...tableIR.source, cropIds: [...(tableIR.source.cropIds || []), asset.id] },
          disposition: "preserved-source",
        });
        tableMarkdown = sourceMarker(pageNumber, asset);
      } catch {
        // Keep the original lines in the normal text path if source recovery fails.
        pageTableLines = new Set();
      }
    } else if (!tableMarkdown) {
      pageTableLines = new Set();
    }
    if (tableMarkdown)
      entries.push({
        y: pageTable.y,
        x: pageBounds[0],
        bbox: pageTable.bbox,
        markdown: tableMarkdown,
        kind: "table",
        confidence: { overall: pageTable.confidence, structure: tableIR.confidence.structure },
        tableIR,
        extractionMethod: tableMarkdown === pageTable.markdown ? "validated-table-geometry" : "source-preservation",
        provenance: {
          source: "pdf-geometry-table",
          rows: pageTable.rows,
          columns: pageTable.columns,
        },
      });
  }

  let ocrApplied = false;
  if (
    options.forceOcr ||
    (options.useOcr &&
      embeddedTextCorrupt) ||
    (options.useOcr &&
      blocks.reduce(
        (count, value) => count + joinWrapped(value.lines).length,
        0,
      ) < 40)
  ) {
    const ocrData = await recognizePage(
      page,
      options,
      ocrPaths,
      pageNumber,
    );
    const lines = ocrLines(ocrData);
    const detectedVisuals = ocrVisualCandidates(ocrData, lines, pageBounds);
    const detected =
      options.preserveVisuals === false
        ? {
            candidates: [],
            excludeRanges: [],
            equationRanges: options.extractEquations
              ? detectedVisuals.equationRanges
              : [],
          }
        : detectedVisuals;
    ocrCandidates = detected.candidates;
    ocrApplied = true;

    const rawHeight = Math.max(
      1,
      Number(ocrData._rasterHeight) ||
        Math.max(...lines.map((item) => item.y1), 1),
    );
    const [left, top, right, bottom] = pageBounds;
    const pageWidth = right - left;
    const equationGroups = options.extractEquations
      ? detected.equationRanges || []
      : [];
    const validatedEquationRanges = [];
    for (const group of equationGroups) {
      const pageEquationText = group.latex || group.text || "";
      const pageBBox = [
        left + pageWidth * 0.065,
        geometryYFromRaw(group.y0, pageBounds, rawHeight),
        right - pageWidth * 0.065,
        geometryYFromRaw(group.y1, pageBounds, rawHeight),
      ];
      let crop = { data: new Uint8Array(), width: 0, height: 0 };
      try {
        crop = cropPage(page, pageBBox, 2.6);
      } catch {
        /* the textual candidate remains reviewable if its crop is unavailable */
      }
      const reconstruction = validateEquationReconstruction(
        pageNumber,
        pageBBox,
        pageEquationText,
        crop,
        "raster",
      );
      const { candidate, validation, fallbackAsset, sourceEvidenceAsset } = reconstruction;
      if (fallbackAsset) assets.push(fallbackAsset);
      else if (sourceEvidenceAsset) assets.push(sourceEvidenceAsset);
      validatedEquationRanges.push({
        ...group,
        latex: validation.output.latex || pageEquationText,
        fallbackMarker: reconstruction.fallbackMarker,
        equationIR: validation.output.equationIR,
      });
      ocrCandidates.push(candidate);
      reviewItems.push(equationReviewItem(candidate, validation, "tesseract-ocr"));
    }
    entries.push(
      ...ocrMarkdownEntries(ocrData, escapeMd, {
        pageBounds,
        rawHeight: ocrData._rasterHeight,
        excludeRanges: detected.excludeRanges,
        equationRanges: validatedEquationRanges,
      }).map((entry) => ({
        ...entry,
        extractionMethod: entry.extractionMethod || "tesseract-ocr",
      })),
    );
    for (const item of lines) {
      if (item.y0 <= rawHeight * 0.12) edges.headers.push(item.text);
      if (item.y1 >= rawHeight * 0.88) edges.footers.push(item.text);
    }
  }

  const imageEquationCandidates =
    options.extractEquations && !ocrApplied
      ? equationImageCandidatesFor(images, blocks, pageBounds, bodySize)
      : [];
  const recoveredEquationImageIndexes = new Set();
  for (const candidate of imageEquationCandidates) {
    try {
      const bbox = paddedBbox(
        candidate.bbox,
        pageBounds,
        Math.max(2, bodySize * 0.35),
      );
      const rendered = cropPage(page, bbox, 2.8);
      const ocrData = await recognizeRaster(
        rendered,
        options,
        ocrPaths,
        pageNumber,
      );
      const recognizedText = joinWrapped(ocrLines(ocrData));
      if (!looksLikeOcrEquation(recognizedText)) continue;
      const equationText = latexMarkdown(recognizedText);
      const reconstruction = validateEquationReconstruction(
        pageNumber,
        bbox,
        equationText,
        rendered,
        "raster",
        {
          mode: "display",
          sourceObjectIds: [`p${pageNumber}-image-${candidate.sourceImageIndex}`],
          sourceRegionIds: [`p${pageNumber}-equation-image-${candidate.sourceImageIndex}`],
        },
      );
      if (reconstruction.fallbackAsset) assets.push(reconstruction.fallbackAsset);
      else if (reconstruction.sourceEvidenceAsset) assets.push(reconstruction.sourceEvidenceAsset);
      if (reconstruction.validation.accepted) {
        entries.push({
          y: candidate.y,
          x: candidate.bbox[0],
          bbox: candidate.bbox,
          markdown: equationToMarkdown(reconstruction.validation.output.equationIR) ||
            (DISPLAY_MATH + "\n" + reconstruction.validation.output.latex + "\n" + DISPLAY_MATH),
          kind: "equation",
          equationIR: reconstruction.validation.output.equationIR,
          mode: reconstruction.validation.output.equationIR?.mode || "display",
          extractionMethod: "tesseract-equation-image",
        });
      } else {
        entries.push({
          y: candidate.y,
          x: candidate.bbox[0],
          bbox: candidate.bbox,
          markdown: reconstruction.fallbackMarker,
          kind: "equation-fallback",
          equationIR: reconstruction.validation.output.equationIR,
          mode: reconstruction.validation.output.equationIR?.mode || "display",
          extractionMethod: "source-preservation",
        });
      }
      reviewItems.push(
        equationReviewItem(
          reconstruction.candidate,
          reconstruction.validation,
          "tesseract-equation-image",
        ),
      );
      recoveredEquationImageIndexes.add(candidate.sourceImageIndex);
    } catch {
      /* Preserve the image through the normal visual path if focused OCR fails. */
    }
  }

  for (const block of (ocrApplied ? [] : layoutAnalysis.orderedBlocks)) {
    const remainingLines = block.lines.filter((line) => !pageTableLines.has(line));
    if (!remainingLines.length) continue;
    const text = joinWrapped(remainingLines);
    if (!text) continue;
    const topEdge = block.bbox[1] <= pageBounds[1] + pageHeight * 0.12;
    const bottomEdge = block.bbox[3] >= pageBounds[3] - pageHeight * 0.12;
    if (topEdge) edges.headers.push(text);
    if (bottomEdge) edges.footers.push(text);
    if (
      (topEdge || bottomEdge) &&
      /^\s*(?:\d{1,5}|[ivxlcdm]{1,10})\s*$/i.test(text)
    )
      continue;
    const table =
      options.detectTables && remainingLines.length === block.lines.length
        ? tableFor({ ...block, lines: remainingLines }, bodySize)
        : null;
    const heading = options.detectHeadings
      ? block.type === "heading"
        ? block.headingLevel
        : headingFor(text, block.maxSize, bodySize, block.font)
      : null;
    const rawVisualText =
      remainingLines.length === 1
        ? String(remainingLines[0]?.text || text).replace(/[ \t]+$/u, "")
        : text;
    let markdown;
    let entryKind = "text";
    let rawText = rawVisualText;
    let equationIR = null;
    if (table) {
      markdown = tableIRToMarkdown(table.tableIR);
      entryKind = "table";
    }
    else if (options.extractEquations && isEquation(text, block, pageBounds, bodySize)) {
      const equationParts = splitEquationProse(text);
      const equationText = latexMarkdown(equationParts?.equation || text);
      let crop = { data: new Uint8Array(), width: 0, height: 0 };
      try {
        crop = cropPage(page, block.bbox, 2.6);
      } catch {
        /* the equation can still be preserved as text if rasterization fails */
      }
      const reconstruction = validateEquationReconstruction(
        pageNumber,
        block.bbox,
        equationText,
        crop,
        "vector",
        {
          mode: "display",
          sourceSpanIds: block.sourceSpanIds || [],
          sourceRegionIds: block.sourceBlockIds || [],
          sourceObjectIds: block.sourceObjectIds || [],
        },
      );
      if (reconstruction.fallbackAsset) assets.push(reconstruction.fallbackAsset);
      else if (reconstruction.sourceEvidenceAsset) assets.push(reconstruction.sourceEvidenceAsset);
      if (reconstruction.validation.accepted) {
        const equationMarkdown = equationToMarkdown(reconstruction.validation.output.equationIR) ||
          (DISPLAY_MATH + "\n" + reconstruction.validation.output.latex + "\n" + DISPLAY_MATH);
        markdown = [
          equationMarkdown,
          equationParts?.prose
            ? escapeMd(inlineMathMarkdown(equationParts.prose), {
                protectBlockStart: false,
              })
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        entryKind = "equation";
      } else {
        markdown = [
          reconstruction.fallbackMarker,
          equationParts?.prose
            ? escapeMd(inlineMathMarkdown(equationParts.prose), {
                protectBlockStart: false,
              })
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        entryKind = "equation-fallback";
      }
      rawText = undefined;
      equationIR = reconstruction.validation.output.equationIR;
      reviewItems.push(
        equationReviewItem(
          reconstruction.candidate,
          reconstruction.validation,
          "mupdf-structured-text",
        ),
      );
    }
    else if (heading)
      markdown = `${"#".repeat(heading)} ${escapeMd(
        options.extractEquations ? inlineMathMarkdown(text) : text,
        {
        protectBlockStart: false,
        },
      )}`;
    else if (
      block.size < bodySize * 0.82 &&
      block.bbox[1] > pageBounds[1] + pageHeight * 0.55
    )
      markdown = /^(\d{1,3})\s+(.+)/.test(text)
        ? text.replace(/^(\d{1,3})\s+(.+)/, "> [^$1]: $2")
        : `> ${escapeMd(text)}`;
    else
      markdown = escapeMd(
        options.extractEquations ? inlineMathMarkdown(text) : text,
      );
    let inlineEquationIRs = [];
    if (options.extractEquations && !equationIR) {
      const inlineCandidates = inlineEquationCandidates(text);
      if (inlineCandidates.length) {
        let inlineSourceAsset = null;
        if (options.preserveVisuals !== false) {
          try {
            const rendered = cropPage(page, block.bbox, 2.6);
            inlineSourceAsset = {
              id: `p${pageNumber}-inline-equations-${Math.round(block.bbox[0])}-${Math.round(block.bbox[1])}`,
              page: pageNumber,
              kind: "equation-source",
              bbox: block.bbox,
              sourceType: "vector",
              caption: "Inline equation source",
              ...rendered,
            };
            assets.push(inlineSourceAsset);
          } catch {
            // The inline formula remains editable only when the text graph validates.
          }
        }
        inlineEquationIRs = inlineCandidates.map((candidate, index) => equationFromLatex({
          id: `p${pageNumber}-inline-equation-${Math.round(block.bbox[1])}-${index + 1}`,
          mode: "inline",
          page: pageNumber,
          bbox: block.bbox,
          latex: candidate.latex,
          source: {
            kind: "vector",
            page: pageNumber,
            bbox: block.bbox,
            coordinateSpace: "pdf-user-space",
            spanIds: block.sourceSpanIds || [],
            regionIds: block.sourceBlockIds || [],
            objectIds: block.sourceObjectIds || [],
            cropIds: inlineSourceAsset ? [inlineSourceAsset.id] : [],
            cropAvailable: Boolean(inlineSourceAsset?.data?.byteLength),
          },
          confidence: {
            detection: candidate.explicit ? 0.94 : 0.76,
            recognition: 0.9,
            structure: 0.92,
            validation: 0.92,
            reconstruction: candidate.explicit ? 0.9 : 0.78,
            export: 0.96,
          },
        }));
      }
    }
      entries.push({
        y: block.bbox[1],
        x: block.bbox[0],
        bbox: block.bbox,
        markdown,
        kind: entryKind,
        ...(equationIR ? { equationIR, mode: equationIR.mode } : {}),
        ...(inlineEquationIRs.length ? { inlineEquationIRs } : {}),
        ...(equationIR
          ? {
              confidence: {
                overall: equationIR.confidence.detection,
                extraction: equationIR.confidence.detection,
                structure: equationIR.confidence.structure,
                reconstruction: equationIR.confidence.reconstruction,
                export: equationIR.confidence.export,
              },
              reconstructionConfidence: equationIR.confidence.reconstruction,
              exportConfidence: equationIR.confidence.export,
            }
          : {}),
        rawText,
        layoutType: block.type,
        headingLevel: block.headingLevel,
        structureConfidence: block.structureConfidence,
        disposition: block.structureConfidence < 0.6 ? "needs-review" : "reconstructed",
        diagnostics: block.diagnostics,
        sourceBlockIds: block.sourceBlockIds,
        sourceSpanIds: block.sourceSpanIds,
        sourceObjectIds: block.sourceObjectIds,
        extractionMethod:
          entryKind === "table"
            ? "validated-table-geometry"
            : entryKind === "equation"
              ? "mupdf-equation-reconstruction"
              : entryKind === "equation-fallback"
                ? "source-preservation"
                : "mupdf-structured-text",
        ...(table
          ? {
              tableIR: table.tableIR,
              confidence: {
                overall: table.confidence,
                structure: table.confidence,
              },
              provenance: {
                source: "pdf-block-table",
                rows: table.rows.length,
                columns: table.rows[0]?.length || 0,
              },
            }
          : {}),
      });
  }

  if (options.preserveVisuals !== false) {
    const pageArea = (pageBounds[2] - pageBounds[0]) * pageHeight;
    for (const [index, value] of images.entries()) {
      if (preserveSourcePage) {
        value.image.destroy?.();
        continue;
      }
      if (recoveredEquationImageIndexes.has(index)) {
        value.image.destroy?.();
        continue;
      }
      const area =
        (value.bbox[2] - value.bbox[0]) * (value.bbox[3] - value.bbox[1]);
      if (
        area / pageArea < 0.0025 ||
        (area / pageArea > 0.82 && blocks.length > 2)
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
          entries.push({
            y: bbox[1],
            x: bbox[0],
            bbox,
            markdown: recoveredTable.markdown,
            kind: "table",
            extractionMethod: "validated-table-ocr",
            tableIR: recoveredTable.tableIR,
            confidence: {
              overall: recoveredTable.confidence,
              structure: recoveredTable.confidence,
            },
          });
        } else {
          const asset = {
            id: `p${pageNumber}-image-${index + 1}`,
            kind: /^table\b/i.test(caption) ? "table-image" : "image",
            bbox,
            caption,
            ...rendered,
          };
          assets.push(asset);
          entries.push({
            y: bbox[1],
            x: bbox[0],
            bbox,
            markdown: sourceMarker(pageNumber, asset),
            kind: "visual",
            extractionMethod: "source-preservation",
          });
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
        if (preserveSourcePage) continue;
        if (
          assets.some(
            (asset) =>
              asset.bbox[1] < candidate.bbox[3] &&
              asset.bbox[3] > candidate.bbox[1],
          )
        )
          continue;
        if (
          entries.some(
            (entry) =>
              entry.kind === "table" &&
              entry.bbox?.[1] < candidate.bbox[3] &&
              entry.bbox?.[3] > candidate.bbox[1] &&
              entry.bbox?.[0] < candidate.bbox[2] &&
              entry.bbox?.[2] > candidate.bbox[0],
          )
        )
          continue;
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
            entries.push({
              y: candidate.y,
              x: candidate.bbox[0],
              bbox: candidate.bbox,
              markdown: recoveredTable.markdown,
              kind: "table",
              extractionMethod: "validated-table-ocr",
              tableIR: recoveredTable.tableIR,
              confidence: {
                overall: recoveredTable.confidence,
                structure: recoveredTable.confidence,
              },
            });
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
          entries.push({
            y: candidate.y,
            x: candidate.bbox[0],
            bbox,
            markdown: sourceMarker(pageNumber, asset),
            kind: "visual",
          });
        } catch {
          /* reported through raw vector counts */
        }
      }

    for (const candidate of ocrCandidates) {
      if (preserveSourcePage) continue;
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
          entries.push({
            y: candidate.y,
            x: candidate.bbox[0],
            bbox: candidate.bbox,
            markdown: recoveredTable.markdown,
            kind: "table",
            extractionMethod: "validated-table-ocr",
            tableIR: recoveredTable.tableIR,
            confidence: {
              overall: recoveredTable.confidence,
              structure: recoveredTable.confidence,
            },
          });
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
        entries.push({
          y: candidate.y,
          x: candidate.bbox[0],
          bbox,
          markdown: sourceMarker(pageNumber, asset),
          kind: "visual",
          extractionMethod: "source-preservation",
        });
      } catch {
        /* OCR text remains available even if a local visual crop fails */
      }
    }

    if (preserveSourcePage) {
      try {
        const rendered = cropPage(page, pageBounds, 1.25);
        const asset = {
          id: `p${pageNumber}-source-page`,
          page: pageNumber,
          kind: "source-page",
          bbox: [...pageBounds],
          caption:
            "Original page preserved because embedded PDF font encoding was damaged",
          sourceType: "pdf-page",
          provenance: {
            source: "local-pdf-page",
            pageNumber,
            confidence: 1,
            preserved: true,
            reversible: true,
          },
          ...rendered,
        };
        assets.push(asset);
        entries.push({
          y: pageBounds[3] + 1,
          x: pageBounds[0],
          bbox: [...pageBounds],
          markdown: sourceMarker(pageNumber, asset),
          kind: "source-page",
          extractionMethod: "source-preservation",
        });
      } catch {
        sourcePageFallbackFailed = true;
      }
    }
  }

  const visualAssets = classifyPageVisualAssets(assets, {
    page: pageNumber,
    pageBounds,
    images,
    vectors,
  });
  const visualAssetsById = new Map(visualAssets.map((asset) => [asset.id, asset]));
  const orderedEntries = options.flows === false
    ? [...entries].sort((a, b) => a.y - b.y || (a.x || 0) - (b.x || 0))
    : orderPageEntries(entries, pageBounds, bodySize);
  const textEntries = dedupeNearbyEquationEntries(mergeCodeEntries(
    mergeDiagramEntries(
      mergeWrappedHeadingEntries(orderedEntries, bodySize),
      bodySize,
    ),
    bodySize,
  ), bodySize);
  const layout = pageLayoutSummary(textEntries, pageBounds, bodySize, {
    flows: options.flows !== false,
    analysis: layoutAnalysis,
  });
  const pageEquationIRs = textEntries.flatMap((entry) => [
    ...(entry.equationIR ? [entry.equationIR] : []),
    ...(entry.inlineEquationIRs || []),
  ]);
  const equationConfidenceDimensions = Object.fromEntries(
    ["detection", "recognition", "structure", "validation", "reconstruction", "export"].map((dimension) => [
      dimension,
      average(pageEquationIRs.map((equation) => equation.confidence?.[dimension])),
    ]),
  );
  const semanticEntries = textEntries.map((entry) => {
    const marker = /\bid="([^"\\]+)"/u.exec(String(entry.markdown || ""));
    const visualAsset = marker ? visualAssetsById.get(marker[1]) : null;
    return visualAsset?.visualIRv2
      ? { ...entry, assetId: visualAsset.id, visualIR: visualAsset.visualIRv2 }
      : entry;
  });
  const documentIR = pageDocumentIR(
    { page: pageNumber, bbox: pageBounds },
    { blocks: semanticEntries, assets: visualAssets, layout, quality: {} },
  );
  const text = documentIRToMarkdown(documentIR);
  const quality = {
    characters: text.length,
    textBlocks: blocks.length,
    images: images.length,
    vectors: vectors.length,
    equations: (text.match(/^\$\$/gm) || []).length / 2,
    preservedVisuals: visualAssets.length,
    preservedEquationFallbacks: textEntries.filter(
      (entry) => entry.kind === "equation-fallback",
    ).length,
    suspiciousGaps: 0,
    ocrApplied,
    embeddedTextCorrupt,
    sourcePagePreserved: visualAssets.some((asset) => asset.kind === "source-page"),
    sourcePageFallbackFailed,
    layoutConfidence: layout.confidence,
    textConfidence: embeddedTextCorrupt ? 0.55 : ocrApplied ? 0.72 : 0.96,
    tableConfidence: average(
      textEntries
        .filter((entry) => entry.kind === "table")
        .map((entry) => entry.confidence?.overall),
    ),
    equationConfidence: average(
      reviewItems.map((item) => item.candidate?.confidence?.overall),
    ),
    equationConfidenceDimensions,
    equationDispositions: Object.fromEntries(
      [...new Set(pageEquationIRs.map((equation) => equation.disposition))]
        .sort()
        .map((disposition) => [
          disposition,
          pageEquationIRs.filter((equation) => equation.disposition === disposition).length,
        ]),
    ),
    figurePreservation: {
      detected: images.length + vectors.length,
      preserved: visualAssets.filter((asset) => !/^equation/.test(asset.kind || "")).length,
      sourceEvidence: visualAssets.filter((asset) => asset.kind === "source-page").length,
    },
  };
  documentIR.quality = quality;
  const semanticDocument = semanticDocumentFromLegacyDocumentIR({ pages: [documentIR] });
  return {
    text,
    documentIR,
    semanticDocument,
    bodySize,
    assets: visualAssets,
    edges,
    quality,
    reviewItems: [...new Map(reviewItems.map((item) => [item.id, item])).values()],
  };
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
