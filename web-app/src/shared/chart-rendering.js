import { parseChartIR } from "./semantic-ir.js";

const SUPPORTED_MARK_TYPES = new Set(["bar", "line", "point", "scatter"]);
const SUPPORTED_CHANNELS = new Set(["x", "y", "color", "size", "shape", "tooltip", "column", "row", "detail", "opacity"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsFromChartData(chart) {
  const rows = Array.isArray(chart.data?.rows) ? chart.data.rows : Array.isArray(chart.data?.values) ? chart.data.values : [];
  return rows.map((row, index) => {
    if (!isPlainObject(row)) throw new TypeError(`ChartIR.data row ${index} must be an object.`);
    const values = isPlainObject(row.values) ? row.values : row;
    return {
      ...values,
      ...(row.rowId ? { rowId: row.rowId } : {}),
    };
  });
}

function fieldTypeToVega(field = {}) {
  const type = String(field.type || "").toLowerCase();
  if (type === "number" || type === "integer" || type === "quantitative") return "quantitative";
  if (type === "date" || type === "datetime" || type === "temporal") return "temporal";
  if (type === "boolean" || type === "nominal" || type === "ordinal" || type === "string") return "nominal";
  return "nominal";
}

function extractFieldMap(chart) {
  const fields = Array.isArray(chart.data?.fields) ? chart.data.fields : [];
  return new Map(fields.map((field) => [field.name, field]));
}

function validateChartRows(chart, rows) {
  const fieldMap = extractFieldMap(chart);
  const quantitativeFields = [...fieldMap.values()].filter((field) => fieldTypeToVega(field) === "quantitative");
  const temporalFields = [...fieldMap.values()].filter((field) => fieldTypeToVega(field) === "temporal");

  for (const [index, row] of rows.entries()) {
    for (const field of quantitativeFields) {
      const value = row[field.name];
      if (value === undefined || value === null || value === "") {
        throw new TypeError(`ChartIR row ${index} is missing quantitative field ${field.name}.`);
      }
      if (!Number.isFinite(Number(value))) {
        throw new TypeError(`ChartIR row ${index} has a non-numeric quantitative field ${field.name}.`);
      }
    }
    for (const field of temporalFields) {
      const value = row[field.name];
      if (value === undefined || value === null || value === "") {
        throw new TypeError(`ChartIR row ${index} is missing temporal field ${field.name}.`);
      }
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) {
        throw new TypeError(`ChartIR row ${index} has an invalid temporal field ${field.name}.`);
      }
    }
  }
}

function normalizedChannels(encoding = {}) {
  return Object.entries(encoding)
    .filter(([channel]) => SUPPORTED_CHANNELS.has(channel))
    .map(([channel, value]) => ({ channel, value: isPlainObject(value) ? value : { field: value } }));
}

function supportedChartKind(chart) {
  const kinds = [...new Set((Array.isArray(chart.marks) ? chart.marks : []).map((mark) => String(mark.type || "").toLowerCase()).filter(Boolean))];
  if (kinds.length !== 1) return null;
  const kind = kinds[0] === "scatter" ? "point" : kinds[0];
  if (!SUPPORTED_MARK_TYPES.has(kind)) return null;
  return kind;
}

function buildVegaEncoding(chart) {
  const fieldMap = extractFieldMap(chart);
  const encoding = {};
  for (const { channel, value } of normalizedChannels(chart.encoding)) {
    const fieldName = typeof value.field === "string" ? value.field : null;
    if (!fieldName) continue;
    const field = fieldMap.get(fieldName) || { name: fieldName, type: value.type || "nominal" };
    const channelEncoding = {
      field: field.name,
      type: value.type || fieldTypeToVega(field),
    };
    if (value.aggregate !== undefined) channelEncoding.aggregate = value.aggregate;
    if (value.timeUnit !== undefined) channelEncoding.timeUnit = value.timeUnit;
    if (value.title !== undefined) channelEncoding.title = value.title;
    if (value.sort !== undefined) channelEncoding.sort = value.sort;
    if (value.format !== undefined) channelEncoding.format = value.format;
    if (value.scale !== undefined) channelEncoding.scale = value.scale;
    if (value.axis !== undefined) channelEncoding.axis = value.axis;
    if (value.legend !== undefined) channelEncoding.legend = value.legend;
    if (channelEncoding.type === "nominal" && (channel === "x" || channel === "y") && /bar/i.test(chart.kind || "")) {
      channelEncoding.type = fieldTypeToVega(field);
    }
    encoding[channel] = channelEncoding;
  }
  return encoding;
}

function chartTitle(chart) {
  return normalizeText(chart?.provenance?.validationEvidence?.summary || chart?.geometry?.title || chart?.id || "Chart reconstruction");
}

function toCsv(rows, columns) {
  const header = columns.map(escapeCsv).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","));
  return [header, ...body].join("\n");
}

export function chartIRToVegaLite(chartIR) {
  const chart = parseChartIR(chartIR);
  const markType = supportedChartKind(chart);
  if (!markType) {
    throw new TypeError("ChartIR export only supports a single bar, line, point, or scatter mark type.");
  }
  if (chart.disposition !== "accepted") {
    throw new TypeError("ChartIR export requires accepted disposition.");
  }
  if ((Number(chart.confidence?.overall) || 0) < 0.82) {
    throw new TypeError("ChartIR export requires high confidence.");
  }

  const rows = rowsFromChartData(chart);
  if (!rows.length) throw new TypeError("ChartIR export requires at least one recovered row.");
  validateChartRows(chart, rows);

  const fieldMap = extractFieldMap(chart);
  const columns = [...new Set([
    ...Object.keys(rows[0] || {}),
    ...Object.keys(chart.encoding || {}).flatMap((channel) => {
      const encoding = chart.encoding[channel];
      return isPlainObject(encoding) && encoding.field ? [encoding.field] : [];
    }),
  ])].filter((value) => value !== "rowId");

  const encoding = buildVegaEncoding(chart);
  if (!encoding.x || !encoding.y) {
    throw new TypeError("ChartIR export requires x and y encodings.");
  }

  const spec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    data: { values: rows },
    mark: markType === "scatter" ? { type: "point", filled: true } : markType,
    encoding,
    title: chartTitle(chart),
  };

  if (chart.axes) spec.axis = chart.axes.map((axis) => ({ ...axis }));
  if (chart.legend) spec.legend = { ...chart.legend };
  if (chart.labels) spec.label = chart.labels.map((label) => ({ ...label }));

  return {
    spec,
    json: {
      chart,
      rows,
      fields: [...fieldMap.values()],
    },
    csv: toCsv(rows, columns.length ? columns : Object.keys(rows[0] || {})),
  };
}

export function chartIRExportSidecars(chartIR) {
  const exportResult = chartIRToVegaLite(chartIR);
  return {
    spec: JSON.stringify(exportResult.spec, null, 2),
    json: JSON.stringify(exportResult.json, null, 2),
    csv: exportResult.csv,
  };
}