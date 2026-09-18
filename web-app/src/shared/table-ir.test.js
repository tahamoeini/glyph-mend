import { expect, it } from "vitest";
import {
  compareTableIR,
  detectTableIR,
  deserializeTableIR,
  serializeTableIR,
  tableIRFromRows,
  tableIRToHtml,
  tableIRToMarkdown,
  validateTableIR,
} from "./table-ir.js";
import {
  borderedDigitalTable,
  borderlessTable,
  financialRows,
  malformedScannedTable,
  mergedHeaderRows,
  scientificRows,
  splitPageSegments,
} from "./table-ir.fixtures.js";

function detected(fixture) {
  return detectTableIR({
    ...fixture,
    bodySize: 10,
    sourceKind: "native-text",
  });
}

it("detects bordered digital tables with ordered cells and vector provenance", () => {
  const table = detected(borderedDigitalTable);
  expect(table).not.toBeNull();
  expect(table.columns).toHaveLength(3);
  expect(table.rows.map((row) => row.cells.map((id) => table.cells.find((cell) => cell.id === id).text))).toEqual([
    ["Item", "Units", "Amount"],
    ["A", "12", "450"],
    ["B", "8", "320"],
  ]);
  expect(table.detectedRules).toHaveLength(6);
  expect(table.sourcePage).toBe(2);
  expect(table.alignment.signals).toEqual(expect.arrayContaining([
    "repeated-x-starts",
    "repeated-y-bands",
    "cell-like-boxes",
    "repeated-row-patterns",
    "whitespace-grid",
    "vector-rules",
  ]));
  expect(table.bbox).toEqual([10, 20, 190, 70]);
  expect(tableIRToMarkdown(table)).toContain("| Item | Units | Amount |");
});

it("detects borderless tables from repeated x positions without requiring rules", () => {
  const table = detected(borderlessTable);
  expect(table).not.toBeNull();
  expect(table.alignment.method).toBe("repeated-x-starts");
  expect(table.diagnostics.some((item) => item.code === "borderless-evidence")).toBe(true);
  expect(table.detectedRules).toEqual([]);
  expect(tableIRToMarkdown(table)).toContain("| Method | Mean | Std |");
});

it("preserves merged headers and refuses a lossy Markdown projection", () => {
  const table = tableIRFromRows({
    tableId: "merged-header",
    columnCount: 3,
    rows: mergedHeaderRows,
    confidence: { detection: 0.96, structure: 0.95, content: 0.98, export: 0.4 },
    sourcePage: 5,
    source: { kind: "native-text", spanIds: ["span-1", "span-2"] },
  });
  expect(table.cells.find((cell) => cell.text === "Metric")).toMatchObject({ colSpan: 2 });
  expect(tableIRToMarkdown(table)).toBeNull();
  expect(tableIRToHtml(table)).toContain('colspan="2"');
  expect(table.cells[0].source.spanIds).toEqual(["span-1", "span-2"]);
});

it("keeps numeric financial and scientific cell text deterministic", () => {
  const financial = tableIRFromRows({
    tableId: "financial",
    rows: financialRows,
    confidence: { detection: 0.95, structure: 0.94, content: 0.99, export: 0.92 },
    source: { kind: "native-text", objectIds: ["table-rule-1"] },
  });
  const scientific = tableIRFromRows({
    tableId: "scientific",
    rows: scientificRows,
    confidence: { detection: 0.91, structure: 0.9, content: 0.88, export: 0.9 },
    source: { kind: "native-text" },
  });
  expect(tableIRToMarkdown(financial)).toContain("1,250");
  expect(tableIRToMarkdown(scientific)).toContain("μ");
  expect(serializeTableIR(financial)).toBe(serializeTableIR(deserializeTableIR(serializeTableIR(financial))));
  expect(compareTableIR(financial, deserializeTableIR(serializeTableIR(financial)))).toBe(true);
});

it("keeps page-split segments separate until stitching evidence exists", () => {
  const segments = splitPageSegments.map((segment, index) => tableIRFromRows({
    tableId: `split-${index + 1}`,
    sourcePage: segment.page,
    rows: segment.rows,
    confidence: { detection: 0.86, structure: 0.84, content: 0.9, export: 0.84 },
    source: { kind: "native-text", extra: { multiPageKey: "split-table-1" } },
  }));
  expect(segments.map((table) => table.sourcePage)).toEqual([7, 8]);
  expect(segments.map((table) => table.source.extra.multiPageKey)).toEqual(["split-table-1", "split-table-1"]);
  expect(segments[0].cells.some((cell) => cell.text === "B")).toBe(false);
  expect(segments[1].cells.some((cell) => cell.text === "A")).toBe(false);
});

it("does not invent missing or unreadable cells in malformed scanned evidence", () => {
  const table = detected(malformedScannedTable);
  expect(table).not.toBeNull();
  expect(table.unresolvedCellDiagnostics.some((item) => item.code === "missing-cell")).toBe(true);
  expect(table.disposition).toBe("reconstructed-with-source");
  expect(tableIRToMarkdown(table)).toBeNull();
  expect(table.cells.some((cell) => cell.text === "")).toBe(false);
});

it("treats an empty position as unresolved unless the source explicitly observes it", () => {
  const unresolved = tableIRFromRows({
    rows: [[{ text: "A", bbox: [0, 0, 20, 10] }, { text: "", bbox: [20, 0, 40, 10] }], ["1", "2"]],
    confidence: { detection: 0.95, structure: 0.95, content: 0.8, export: 0.4 },
  });
  expect(unresolved.unresolvedCellDiagnostics.some((item) => item.code === "empty-cell-unresolved")).toBe(true);
  expect(unresolved.confidence.structure).toBe(0.61);
  expect(tableIRToMarkdown(unresolved)).toBeNull();

  const observed = tableIRFromRows({
    rows: [[{ text: "A", bbox: [0, 0, 20, 10] }, { text: "", bbox: [20, 0, 40, 10], observedEmpty: true }], ["1", "2"]],
    confidence: { detection: 0.95, structure: 0.95, content: 0.8, export: 0.9 },
  });
  expect(observed.unresolvedCellDiagnostics).toEqual([]);
  expect(tableIRToMarkdown(observed)).toContain("| A |  |");
});

it("gates low-confidence export while preserving a structured source fallback", () => {
  const table = tableIRFromRows({
    tableId: "partial-scan",
    rows: [["Header", "Value"], ["A", "12"]],
    confidence: { detection: 0.5, structure: 0.4, content: 0.45, export: 0.2 },
    disposition: "preserved-source",
    source: { kind: "image", cropIds: ["crop-p4-table"] },
  });
  expect(validateTableIR(table)).toEqual(table);
  expect(tableIRToMarkdown(table)).toBeNull();
  expect(tableIRToHtml(table)).toContain('data-table-id="partial-scan"');
  expect(table.source.cropIds).toEqual(["crop-p4-table"]);
});
