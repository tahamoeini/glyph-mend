export type TableDisposition = "reconstructed" | "reconstructed-with-source" | "preserved-source" | "needs-review" | "unsupported";
export type TableDiagnosticSeverity = "info" | "warning" | "error";

export interface TableDiagnostic {
  code: string;
  severity: TableDiagnosticSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface TableSource {
  kind: string;
  spanIds: string[];
  objectIds: string[];
  cropIds: string[];
  extra?: Record<string, unknown>;
}

export interface TableCell {
  id: string;
  rowIndex: number;
  columnIndex: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  children?: unknown[];
  observedEmpty?: boolean;
  bbox: number[] | null;
  confidence: number | null;
  source: TableSource;
  diagnostics: TableDiagnostic[];
}

export interface TableRow {
  id: string;
  index: number;
  bbox: number[] | null;
  cells: string[];
  confidence: number | null;
}

export interface TableColumn {
  id: string;
  index: number;
  bbox: number[] | null;
  alignment: "left" | "center" | "right" | "mixed" | "unknown";
  confidence: number | null;
}

export interface TableIR {
  schema: "glyphmend.table-ir";
  schemaVersion: 1;
  tableId: string;
  sourcePage: number | null;
  bbox: number[] | null;
  coordinateSpace: string;
  columns: TableColumn[];
  rows: TableRow[];
  cells: TableCell[];
  confidence: {
    detection: number | null;
    structure: number | null;
    content: number | null;
    export: number | null;
  };
  source: TableSource;
  detectedRules: unknown[];
  alignment: Record<string, unknown>;
  method?: string;
  caption?: string;
  unresolvedCellDiagnostics: TableDiagnostic[];
  diagnostics: TableDiagnostic[];
  disposition: TableDisposition;
  reconstructionVersion: number;
  emptyCellPolicy: "unresolved";
}

export function createTableIR(input?: Record<string, unknown>, options?: { allowMissingVersion?: boolean }): TableIR;
export function tableIRFromRows(input?: Record<string, unknown>): TableIR;
export function validateTableIR(value: unknown): TableIR;
export function serializeTableIR(value: unknown): string;
export function deserializeTableIR(value: string): TableIR;
export function compareTableIR(left: unknown, right: unknown): boolean;
export function tableIRCanExportMarkdown(value: unknown): { markdown: boolean; issues: TableDiagnostic[] };
export function tableIRToMarkdown(value: unknown): string | null;
export function tableIRToHtml(value: unknown): string;
export function detectTableIR(options?: Record<string, unknown>): TableIR | null;
