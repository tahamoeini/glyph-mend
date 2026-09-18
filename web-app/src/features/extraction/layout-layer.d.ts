export type LayoutCoordinateSpace = "page-points" | "normalized-page" | "ocr-raster" | "unknown";
export type LayoutDirection = "ltr" | "rtl" | "auto";
export type LayoutNodeType = "heading" | "paragraph" | "quote" | "list-item" | "caption" | "footnote" | "equation";

export interface LayoutBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LayoutDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

export interface RawSpan {
  id?: string;
  value?: string;
  text?: string;
  bbox?: number[] | LayoutBBox;
  baseline?: number;
  baselineY?: number;
  size?: number;
  font?: Record<string, unknown> | string;
  [key: string]: unknown;
}

export interface RawLine extends RawSpan {
  chars?: RawSpan[];
  spans?: RawSpan[];
  text?: string;
}

export interface RawBlock {
  id?: string;
  bbox?: number[] | LayoutBBox;
  lines?: RawLine[];
  text?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface LayoutCandidate {
  id: string;
  type: LayoutNodeType;
  headingLevel?: number;
  listLevel?: number;
  text: string;
  bbox: number[];
  normalizedBBox: number[];
  coordinateSpace: LayoutCoordinateSpace;
  sourcePage: number;
  sourceBlockIds: string[];
  sourceSpanIds: string[];
  sourceObjectIds: string[];
  orderIndex: number;
  column: number;
  extractionConfidence: number | null;
  structureConfidence: number | null;
  diagnostics: LayoutDiagnostic[];
  disposition: "reconstructed" | "needs-review";
}

export interface LayoutAnalysis {
  version: string;
  coordinateSpace: LayoutCoordinateSpace;
  page: number;
  pageBounds: number[];
  direction: "ltr" | "rtl";
  columns: { count: number; confidence: number; diagnostics: LayoutDiagnostic[] };
  visualBoundaries: Array<{ id: string; bbox: number[]; kind: string }>;
  candidates: LayoutCandidate[];
  orderedBlocks: RawBlock[];
  diagnostics: LayoutDiagnostic[];
  metrics: {
    blockCount: number;
    lineCount: number;
    columnCount: number;
    ambiguousBlocks: number;
  };
}

export function groupSpansIntoLines(spans: RawSpan[], options?: { page?: number; coordinateSpace?: LayoutCoordinateSpace }): RawLine[];
export function groupLinesIntoBlocks(lines: RawLine[], options?: { page?: number; coordinateSpace?: LayoutCoordinateSpace }): RawBlock[];
export function detectColumns(blocks: RawBlock[], pageBounds?: number[], options?: { direction?: LayoutDirection }): LayoutAnalysis["columns"];
export function analyzePageLayout(options?: { blocks?: RawBlock[]; objects?: unknown[]; page?: number; pageBounds?: number[]; coordinateSpace?: LayoutCoordinateSpace; direction?: LayoutDirection }): LayoutAnalysis;
export function layoutEntries(entries?: Record<string, unknown>[], pageBounds?: number[], options?: { bodySize?: number; flows?: boolean }): LayoutAnalysis;
export function detectRepeatedHeaderFooter(pages?: unknown[], options?: { minimumPageFraction?: number }): Array<{ text: string; position: "header" | "footer"; pages: Array<number | string | undefined> }>;
export function layoutQualityMetrics(expected?: string[], actual?: string[], options?: Record<string, unknown>): Record<string, number>;
