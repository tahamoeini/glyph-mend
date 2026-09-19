import { assertSafeStructuredValue } from "./security-boundaries.js";

/**
 * TableIR is intentionally smaller than the document IR. It is the evidence
 * contract for one table and can therefore be validated before it is attached
 * to a semantic document node.
 */
export const TABLE_IR_SCHEMA = "glyphmend.table-ir";
export const TABLE_IR_SCHEMA_VERSION = 1;
export const TABLE_IR_DISPOSITIONS = Object.freeze([
  "reconstructed",
  "reconstructed-with-source",
  "preserved-source",
  "needs-review",
  "unsupported",
]);

const DISPOSITIONS = new Set(TABLE_IR_DISPOSITIONS);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new TypeError(`${label} must be a non-empty string.`);
  return result;
}

function number(value, label, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || (integer && !Number.isInteger(result)) || result < min || result > max)
    throw new TypeError(`${label} must be a finite number in [${min}, ${max}].`);
  return result;
}

function confidence(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return number(value, label, { min: 0, max: 1 });
}

function bbox(value, label = "bbox") {
  if (value === null || value === undefined) return null;
  let result;
  if (Array.isArray(value) && value.length === 4) result = value.map(Number);
  else if (isRecord(value) && ["x0", "y0", "x1", "y1"].every((key) => value[key] !== undefined))
    result = [value.x0, value.y0, value.x1, value.y1].map(Number);
  else throw new TypeError(`${label} must be [x0,y0,x1,y1].`);
  if (!result.every(Number.isFinite) || result[2] < result[0] || result[3] < result[1])
    throw new TypeError(`${label} must contain a valid non-negative rectangle.`);
  return result;
}

function idArray(value, label) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item, index) => requiredString(item, `${label}[${index}]`)))].sort();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function diagnostic(code, severity, message, details = {}) {
  return { code, severity, message, details };
}

function normalizeDiagnostics(value, label = "diagnostics") {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`${label}[${index}] must be an object.`);
    const output = {
      code: requiredString(item.code || "UNSPECIFIED", `${label}[${index}].code`),
      severity: ["info", "warning", "error"].includes(item.severity) ? item.severity : "warning",
      message: requiredString(item.message || "No diagnostic message.", `${label}[${index}].message`),
    };
    if (item.details !== undefined) {
      assertSafeStructuredValue(item.details, `${label}[${index}].details`);
      output.details = structuredClone(item.details);
    }
    return output;
  });
}

function normalizeSource(value, fallbackKind = "unknown") {
  const source = isRecord(value) ? value : {};
  const fallback = isRecord(fallbackKind) ? fallbackKind : {};
  const output = {
    kind: String(source.kind || fallback.kind || fallbackKind),
    spanIds: idArray(source.spanIds ?? source.spanId ?? fallback.spanIds ?? fallback.spanId, "source.spanIds"),
    objectIds: idArray(source.objectIds ?? source.objectId ?? fallback.objectIds ?? fallback.objectId, "source.objectIds"),
    cropIds: idArray(source.cropIds ?? source.cropId ?? fallback.cropIds ?? fallback.cropId, "source.cropIds"),
  };
  const extra = source.extra ?? fallback.extra;
  if (extra !== undefined) {
    assertSafeStructuredValue(extra, "source.extra");
    output.extra = structuredClone(extra);
  }
  return output;
}

function normalizeConfidence(value, fallback = 0.5) {
  const input = typeof value === "number" ? { structure: value } : (isRecord(value) ? value : {});
  return {
    detection: confidence(input.detection ?? input.detected ?? fallback, "confidence.detection"),
    structure: confidence(input.structure ?? input.structural ?? fallback, "confidence.structure"),
    content: confidence(input.content ?? input.cells ?? null, "confidence.content"),
    export: confidence(input.export ?? input.exportability ?? null, "confidence.export"),
  };
}

function normalizeCell(value, identity, defaultSource) {
  const input = typeof value === "string" || typeof value === "number" ? { text: String(value) } : (isRecord(value) ? value : {});
  const text = input.text === undefined || input.text === null ? "" : String(input.text);
  const children = Array.isArray(input.children) ? input.children.map((child) => structuredClone(child)) : [];
  const source = normalizeSource(input.source || input.provenance, defaultSource);
  const id = requiredString(input.id || `cell-${hash(canonicalJson({ identity, text, source, bbox: input.bbox }))}`, "cell.id");
  const diagnostics = normalizeDiagnostics(input.diagnostics, `cell ${id}.diagnostics`);
  return {
    id,
    rowIndex: number(input.rowIndex ?? identity.rowIndex, `cell ${id}.rowIndex`, { integer: true, min: 0 }),
    columnIndex: number(input.columnIndex ?? identity.columnIndex, `cell ${id}.columnIndex`, { integer: true, min: 0 }),
    rowSpan: number(input.rowSpan ?? 1, `cell ${id}.rowSpan`, { integer: true, min: 1 }),
    colSpan: number(input.colSpan ?? 1, `cell ${id}.colSpan`, { integer: true, min: 1 }),
    text,
    ...(children.length ? { children } : {}),
    ...(input.observedEmpty ? { observedEmpty: true } : {}),
    bbox: bbox(input.bbox, `cell ${id}.bbox`),
    confidence: confidence(input.confidence, `cell ${id}.confidence`),
    source,
    diagnostics,
  };
}

function normalizeColumn(value, index, fallback) {
  const input = isRecord(value) ? value : {};
  return {
    id: requiredString(input.id || `column-${index + 1}`, `columns[${index}].id`),
    index,
    bbox: bbox(input.bbox, `columns[${index}].bbox`),
    alignment: ["left", "center", "right", "mixed", "unknown"].includes(input.alignment) ? input.alignment : "unknown",
    confidence: confidence(input.confidence ?? fallback, `columns[${index}].confidence`),
  };
}

function normalizeRow(value, index, cellsById, fallback) {
  const input = isRecord(value) ? value : {};
  const cellIds = Array.isArray(input.cells) ? input.cells.map(String) : [];
  cellIds.forEach((id) => {
    if (!cellsById.has(id)) throw new TypeError(`rows[${index}] references unknown cell ${id}.`);
  });
  return {
    id: requiredString(input.id || `row-${index + 1}`, `rows[${index}].id`),
    index,
    bbox: bbox(input.bbox, `rows[${index}].bbox`),
    cells: cellIds,
    confidence: confidence(input.confidence ?? fallback, `rows[${index}].confidence`),
  };
}

function rowValues(row) {
  if (Array.isArray(row)) return row;
  return Array.isArray(row?.cells) ? row.cells : [];
}

function representability(value) {
  const table = value?.schema === TABLE_IR_SCHEMA ? value : createTableIR(value);
  const columns = table.columns.length;
  const rows = table.rows;
  const issues = [...table.diagnostics, ...table.unresolvedCellDiagnostics];
  const sufficientGrid = Boolean(columns) && rows.length >= 2;
  if (!sufficientGrid) issues.push(diagnostic("insufficient-grid", "warning", "At least two rows and one column are required."));
  for (const row of rows) {
    const cells = row.cells.map((id) => table.cells.find((cell) => cell.id === id)).filter(Boolean);
    if (cells.length !== columns || cells.some((cell) => cell.rowSpan !== 1 || cell.colSpan !== 1 || (!cell.text.trim() && !cell.observedEmpty)))
      issues.push(diagnostic("markdown-grid-not-representable", "warning", "Rows are sparse, spanning, or contain non-text cells."));
  }
  return {
    markdown: sufficientGrid && !issues.some((item) => item.severity === "error") && table.confidence.structure !== null && table.confidence.structure >= 0.82 && !issues.some((item) => item.code === "markdown-grid-not-representable"),
    issues,
  };
}

export function createTableIR(input = {}, { allowMissingVersion = false } = {}) {
  if (!isRecord(input)) throw new TypeError("TableIR must be an object.");
  assertSafeStructuredValue(input, "TableIR");
  if (input.schema !== undefined && input.schema !== TABLE_IR_SCHEMA)
    throw new TypeError(`TableIR schema must be ${TABLE_IR_SCHEMA}.`);
  if (!allowMissingVersion && input.schemaVersion !== TABLE_IR_SCHEMA_VERSION)
    throw new TypeError(`TableIR schemaVersion must be ${TABLE_IR_SCHEMA_VERSION}.`);
  const source = normalizeSource(input.source, input.sourceKind || "unknown");
  const confidence = normalizeConfidence(input.confidence ?? input.tableConfidence, 0.5);
  const rawCells = Array.isArray(input.cells) ? input.cells : [];
  const rawRows = Array.isArray(input.rows) ? input.rows : [];
  const rowCellInputs = rawRows.map(rowValues);
  const cells = [];
  const cellsById = new Map();
  const rowCellReferences = rowCellInputs.map((row) => row.map((value) => typeof value === "string" && rawCells.some((cell) => cell?.id === value) ? value : null));
  rowCellInputs.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const reference = rowCellReferences[rowIndex][columnIndex];
    if (reference) return;
    const inputCell = isRecord(value) ? value : { text: value };
    const cell = normalizeCell({ ...inputCell, rowIndex: inputCell.rowIndex ?? rowIndex, columnIndex: inputCell.columnIndex ?? columnIndex }, { rowIndex, columnIndex }, source);
    if (cellsById.has(cell.id)) throw new TypeError(`TableIR reuses cell id ${cell.id}.`);
    cells.push(cell);
    cellsById.set(cell.id, cell);
  }));
  rawCells.forEach((value, index) => {
    const cell = normalizeCell(value, { rowIndex: index, columnIndex: 0 }, source);
    if (!cellsById.has(cell.id)) {
      cells.push(cell);
      cellsById.set(cell.id, cell);
    }
  });
  const maxColumn = Math.max(-1, ...cells.map((cell) => cell.columnIndex + cell.colSpan - 1));
  const columnInputs = Array.isArray(input.columns) ? input.columns : [];
  const columnCount = Math.max(Number.isInteger(input.columnCount) ? input.columnCount : 0, maxColumn + 1, columnInputs.length);
  const columns = Array.from({ length: columnCount }, (_, index) => normalizeColumn(columnInputs[index], index, confidence.structure));
  const rows = rowCellInputs.map((row, index) => normalizeRow({
    ...(isRecord(rawRows[index]) ? rawRows[index] : {}),
    cells: row.map((value, columnIndex) => rowCellReferences[index][columnIndex] || cells.find((cell) => cell.rowIndex === index && cell.columnIndex === (isRecord(value) ? value.columnIndex ?? columnIndex : columnIndex))?.id).filter(Boolean),
  }, index, cellsById, confidence.structure));
  const diagnostics = normalizeDiagnostics(input.diagnostics, "TableIR diagnostics");
  const unresolved = normalizeDiagnostics(input.unresolvedCellDiagnostics, "TableIR unresolvedCellDiagnostics");
  for (const row of rows) {
    const covered = row.cells.reduce((sum, id) => sum + (cellsById.get(id)?.colSpan || 1), 0);
    if (covered < columns.length) unresolved.push(diagnostic("missing-cell", "warning", "The source evidence leaves one or more grid positions unresolved.", { rowIndex: row.index, covered, columns: columns.length }));
    row.cells.forEach((id) => {
      const cell = cellsById.get(id);
      if (cell && !cell.text.trim() && !cell.observedEmpty)
        unresolved.push(diagnostic("empty-cell-unresolved", "warning", "A grid position has no observed text; the exporter must not invent a value.", { rowIndex: row.index, columnIndex: cell.columnIndex, cellId: cell.id }));
    });
  }
  const uniqueUnresolved = [];
  const unresolvedKeys = new Set();
  for (const item of unresolved) {
    const key = canonicalJson(item);
    if (!unresolvedKeys.has(key)) {
      unresolvedKeys.add(key);
      uniqueUnresolved.push(item);
    }
  }
  unresolved.length = 0;
  unresolved.push(...uniqueUnresolved);
  if (unresolved.length && confidence.structure !== null)
    confidence.structure = Math.min(confidence.structure, 0.61);
  const disposition = DISPOSITIONS.has(input.disposition)
    ? input.disposition
    : confidence.structure !== null && confidence.structure >= 0.82
      ? "reconstructed"
      : confidence.structure !== null && confidence.structure >= 0.62
        ? "reconstructed-with-source"
        : "preserved-source";
  const tableId = requiredString(input.tableId || input.id || `table-${hash(canonicalJson({ source, bbox: input.bbox, rows: rows.map((row) => row.cells), columns: columns.length }))}`, "tableId");
  return {
    schema: TABLE_IR_SCHEMA,
    schemaVersion: TABLE_IR_SCHEMA_VERSION,
    tableId,
    sourcePage: input.sourcePage === undefined || input.sourcePage === null ? null : number(input.sourcePage, "sourcePage", { integer: true, min: 1 }),
    bbox: bbox(input.bbox),
    coordinateSpace: String(input.coordinateSpace || (input.bbox ? "page-points" : "unknown")),
    columns,
    rows,
    cells,
    confidence,
    source,
    detectedRules: Array.isArray(input.detectedRules) ? input.detectedRules.map((rule) => structuredClone(rule)) : [],
    alignment: isRecord(input.alignment) ? structuredClone(input.alignment) : { method: "unknown", confidence: null },
    ...(input.method ? { method: String(input.method) } : {}),
    caption: input.caption ? String(input.caption) : undefined,
    unresolvedCellDiagnostics: unresolved,
    diagnostics,
    disposition,
    reconstructionVersion: number(input.reconstructionVersion ?? 1, "reconstructionVersion", { integer: true, min: 1 }),
    emptyCellPolicy: "unresolved",
  };
}

export function tableIRFromRows(input = {}) {
  return createTableIR({
    ...input,
    schema: TABLE_IR_SCHEMA,
    schemaVersion: TABLE_IR_SCHEMA_VERSION,
  });
}

export function validateTableIR(value) {
  return createTableIR(value);
}

export function serializeTableIR(value) {
  return canonicalJson(validateTableIR(value));
}

export function deserializeTableIR(value) {
  if (typeof value !== "string") throw new TypeError("Serialized TableIR must be a string.");
  return validateTableIR(JSON.parse(value));
}

export function compareTableIR(left, right) {
  return serializeTableIR(left) === serializeTableIR(right);
}

export function tableIRCanExportMarkdown(value) {
  return representability(value);
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/gu, "<br>");
}

export function tableIRToMarkdown(value) {
  const table = validateTableIR(value);
  if (!representability(table).markdown) return null;
  const rows = table.rows.map((row) => row.cells
    .map((id) => table.cells.find((cell) => cell.id === id))
    .filter(Boolean)
    .sort((a, b) => a.columnIndex - b.columnIndex)
    .map((cell) => markdownEscape(cell.text)));
  return [
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function tableIRToHtml(value) {
  const table = validateTableIR(value);
  const body = table.rows.map((row) => {
    const cells = row.cells
      .map((id) => table.cells.find((cell) => cell.id === id))
      .filter(Boolean)
      .sort((a, b) => a.columnIndex - b.columnIndex)
      .map((cell) => `<td data-cell-id="${htmlEscape(cell.id)}"${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ""}${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ""}>${htmlEscape(cell.text)}</td>`)
      .join("");
    return `<tr data-row-index="${row.index}">${cells}</tr>`;
  }).join("");
  return `<table data-table-id="${htmlEscape(table.tableId)}"><tbody>${body}</tbody></table>`;
}

function rect(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) ? [...value] : null;
}

function median(values, fallback = 10) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback;
}

function lineText(line) {
  if (typeof line?.text === "string") return line.text.replace(/\s+/gu, " ").trim();
  return (line?.chars || line?.spans || []).map((char) => char?.value ?? char?.text ?? "").join("").replace(/\s+/gu, " ").trim();
}

function lineBox(line) {
  return rect(line?.bbox) || [0, 0, 0, 0];
}

function lineCells(line, gap) {
  if (Array.isArray(line?.cells) && line.cells.length) return line.cells;
  const chars = (line?.chars || []).map((char) => ({
    text: String(char?.value ?? char?.text ?? ""),
    x0: Number(char?.x0 ?? char?.bbox?.[0]),
    x1: Number(char?.x1 ?? char?.bbox?.[2]),
    bbox: rect(char?.bbox),
  })).filter((char) => char.text && Number.isFinite(char.x0) && Number.isFinite(char.x1));
  if (!chars.length) return [{ text: lineText(line), bbox: lineBox(line) }];
  const cells = [];
  let current = null;
  for (const char of chars) {
    if (!current || char.x0 - current.x1 > gap) {
      if (current) cells.push(current);
      current = { text: char.text, x0: char.x0, x1: char.x1, bbox: char.bbox || [char.x0, lineBox(line)[1], char.x1, lineBox(line)[3]] };
    } else {
      current.text += char.text;
      current.x1 = Math.max(current.x1, char.x1);
      current.bbox = [Math.min(current.bbox[0], char.x0), Math.min(current.bbox[1], lineBox(line)[1]), Math.max(current.bbox[2], char.x1), Math.max(current.bbox[3], lineBox(line)[3])];
    }
  }
  if (current) cells.push(current);
  return cells.map((cell) => ({ text: cell.text.trim(), bbox: cell.bbox })).filter((cell) => cell.text);
}

function cluster(values, tolerance) {
  const groups = [];
  for (const value of values.filter(Number.isFinite).sort((a, b) => a - b)) {
    const group = groups.at(-1);
    if (!group || value - group.at(-1) > tolerance) groups.push([value]);
    else group.push(value);
  }
  return groups.map((group) => median(group));
}

function objectRules(vectors = [], bodySize = 10, pageBounds = [0, 0, 612, 792]) {
  const pageWidth = pageBounds[2] - pageBounds[0];
  const pageHeight = pageBounds[3] - pageBounds[1];
  const rules = [];
  for (const [index, vector] of vectors.entries()) {
    const box = rect(vector?.bbox);
    if (!box) continue;
    const width = box[2] - box[0];
    const height = box[3] - box[1];
    const orientation = width >= pageWidth * 0.15 && height <= Math.max(2, bodySize * 0.55)
      ? "horizontal"
      : height >= pageHeight * 0.03 && width <= Math.max(2, bodySize * 0.55)
        ? "vertical"
        : null;
    if (orientation) rules.push({ id: String(vector.id || `rule-${index + 1}`), orientation, bbox: box, sourceObjectIds: [String(vector.id || `rule-${index + 1}`)] });
  }
  return rules;
}

/**
 * Detect a conservative TableIR from native/OCR line geometry. It does not
 * fill unobserved grid positions. Missing positions are diagnostics and lower
 * structure confidence; callers decide whether a source crop is required.
 */
export function detectTableIR({ blocks = [], vectors = [], page = null, pageBounds = [0, 0, 612, 792], caption = "", sourceKind = "native-text", source = {}, bodySize = 10 } = {}) {
  const lines = blocks.flatMap((block) => block?.lines || [])
    .map((line, index) => ({
      line,
      text: lineText(line),
      bbox: lineBox(line),
      y: (lineBox(line)[1] + lineBox(line)[3]) / 2,
      index,
    }))
    .filter((item) => item.text && item.bbox[2] > item.bbox[0] && item.bbox[3] > item.bbox[1]);
  if (lines.length < 3) return null;
  const tolerance = Math.max(2.5, median(lines.map((item) => item.bbox[3] - item.bbox[1]), bodySize) * 0.8);
  const rows = [];
  for (const item of lines.sort((a, b) => a.y - b.y || a.bbox[0] - b.bbox[0])) {
    const row = rows.at(-1);
    if (!row || Math.abs(item.y - row.y) > tolerance) rows.push({ y: item.y, items: [item] });
    else {
      row.items.push(item);
      row.y = row.items.reduce((sum, value) => sum + value.y, 0) / row.items.length;
    }
  }
  const rowCells = rows.map((row) => ({ ...row, cells: row.items.flatMap((item) => lineCells(item.line, Math.max(bodySize * 1.45, 3))).sort((a, b) => a.bbox[0] - b.bbox[0]) })).filter((row) => row.cells.length);
  if (rowCells.length < 3 || Math.max(...rowCells.map((row) => row.cells.length)) < 2) return null;
  const allCells = rowCells.flatMap((row) => row.cells);
  const width = pageBounds[2] - pageBounds[0];
  const xTolerance = Math.max(bodySize * 1.8, width * 0.018);
  const xStarts = cluster(allCells.map((cell) => cell.bbox[0]), xTolerance);
  const repeatedStarts = xStarts.filter((start) => allCells.filter((cell) => Math.abs(cell.bbox[0] - start) <= xTolerance).length >= Math.max(2, Math.ceil(rowCells.length * 0.45)));
  if (repeatedStarts.length < 2) return null;
  const rules = objectRules(vectors, bodySize, pageBounds);
  const horizontalRules = rules.filter((rule) => rule.orientation === "horizontal");
  const verticalRules = rules.filter((rule) => rule.orientation === "vertical");
  const whitespaceGaps = rowCells.flatMap((row) => row.cells.slice(1).map((cell, index) => cell.bbox[0] - row.cells[index].bbox[2]));
  const whitespaceEvidence = whitespaceGaps.filter((gap) => gap >= Math.max(bodySize * 1.45, 3)).length >= Math.max(2, rowCells.length - 1);
  const observedColumns = repeatedStarts.length;
  const rawRows = rowCells.map((row, rowIndex) => row.cells.map((cell, columnIndex) => ({
    text: cell.text,
    bbox: cell.bbox,
    rowIndex,
    columnIndex: Math.max(0, repeatedStarts.findIndex((start) => Math.abs(start - cell.bbox[0]) <= xTolerance)),
    confidence: 0.75,
    source: { kind: sourceKind },
  })));
  const tableBox = [
    Math.min(...allCells.map((cell) => cell.bbox[0])),
    Math.min(...allCells.map((cell) => cell.bbox[1])),
    Math.max(...allCells.map((cell) => cell.bbox[2])),
    Math.max(...allCells.map((cell) => cell.bbox[3])),
  ];
  const rectangularRows = rawRows.filter((row) => row.length === observedColumns);
  const rowConsistency = rectangularRows.length / Math.max(1, rawRows.length);
  const signals = ["repeated-x-starts", "repeated-y-bands", "cell-like-boxes", "repeated-row-patterns"];
  if (whitespaceEvidence) signals.push("whitespace-grid");
  if (horizontalRules.length || verticalRules.length) signals.push("vector-rules");
  if (String(caption || "").trim()) signals.push("nearby-caption");
  const alignment = repeatedStarts.length >= 2 ? { method: "repeated-x-starts", tolerance: xTolerance, confidence: Math.min(1, repeatedStarts.length / observedColumns), signals } : { method: "unknown", confidence: 0, signals };
  const diagnostics = [];
  if (rectangularRows.length !== rawRows.length) diagnostics.push(diagnostic("unresolved-cell", "warning", "Some rows do not expose every expected cell; no values were inserted.", { rows: rawRows.length, alignedRows: rectangularRows.length, columns: observedColumns }));
  if (verticalRules.length === 0) diagnostics.push(diagnostic("borderless-evidence", "info", "No vertical vector rules were observed; table structure is based on repeated text alignment."));
  const structure = Math.min(0.98, 0.45 + rowConsistency * 0.3 + Math.min(0.2, repeatedStarts.length * 0.04) + (horizontalRules.length >= 3 ? 0.08 : 0));
  const content = Math.min(0.99, averageCellConfidence(rawRows));
  return tableIRFromRows({
    tableId: `p${page ?? "unknown"}-table-${hash(`${sourceKind}|${tableBox.join(",")}|${rawRows.flat().map((cell) => cell.text).join("|")}`)}`,
    sourcePage: page,
    bbox: tableBox,
    coordinateSpace: "page-points",
    columnCount: observedColumns,
    rows: rawRows,
    confidence: { detection: Math.min(0.98, 0.55 + (repeatedStarts.length >= 2 ? 0.18 : 0) + (horizontalRules.length ? 0.15 : 0)), structure, content, export: structure >= 0.82 && rowConsistency === 1 ? 0.9 : 0.45 },
    source: { ...source, kind: sourceKind },
    detectedRules: rules,
    alignment,
    caption,
    diagnostics,
    disposition: structure >= 0.82 && rowConsistency === 1 ? "reconstructed" : structure >= 0.62 ? "reconstructed-with-source" : "preserved-source",
  });
}

function averageCellConfidence(rows) {
  const cells = rows.flat();
  return cells.length ? cells.reduce((sum, cell) => sum + (Number(cell.confidence) || 0), 0) / cells.length : null;
}
