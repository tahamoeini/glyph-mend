export const VISUAL_IR_SCHEMA: "glyphmend.visual-ir";
export const VISUAL_IR_SCHEMA_VERSION: 2;
export const CHART_IR_SCHEMA: "glyphmend.chart-ir";
export const CHART_IR_SCHEMA_VERSION: 2;

export const VISUAL_CLASSES: readonly [
  "ordinary-image",
  "chart",
  "graph-flowchart",
  "diagram",
  "equation-image",
  "logo",
  "decoration",
  "separator",
  "background",
  "unresolved-visual",
];

export const VISUAL_DISPOSITIONS: readonly [
  "reconstructed",
  "reconstructed-with-source",
  "preserved-source",
  "needs-review",
  "unsupported",
  "omitted-decoration",
];

export type VisualClass = (typeof VISUAL_CLASSES)[number];
export type VisualDisposition = (typeof VISUAL_DISPOSITIONS)[number];
export type VisualConfidence = {
  detection: number | null;
  classification: number | null;
  structure: number | null;
  reconstruction: number | null;
  export: number | null;
};
export type VisualSource = {
  kind: string;
  spanIds: string[];
  objectIds: string[];
  cropIds: string[];
  assetId?: string;
  pageId?: string;
  checksum?: string;
  format?: string;
  provenance?: Record<string, unknown>;
};
export type VisualDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  details?: unknown;
};
export type VisualIR = {
  schema: "glyphmend.visual-ir";
  schemaVersion: 2;
  id: string;
  class: VisualClass;
  page: number;
  bbox: [number, number, number, number];
  coordinateSpace: string;
  source: VisualSource;
  sourceAsset?: Record<string, unknown>;
  content: Record<string, unknown>;
  children?: string[];
  confidence: VisualConfidence;
  disposition: VisualDisposition;
  reconstructionVersion: number;
  reconstructionMetadata: Record<string, unknown>;
  warnings: string[];
  diagnostics: VisualDiagnostic[];
  chartIR?: ChartIR;
};
export type ChartIR = {
  schema: "glyphmend.chart-ir";
  schemaVersion: 2;
  id: string;
  page: number;
  bbox: [number, number, number, number];
  coordinateSpace: string;
  source: VisualSource;
  data: Record<string, unknown>;
  marks: Record<string, unknown>[];
  encoding: Record<string, unknown>;
  geometry?: Record<string, unknown>;
  confidence: VisualConfidence;
  disposition: VisualDisposition;
  reconstructionVersion: number;
  reconstructionMetadata: Record<string, unknown>;
  warnings: string[];
  diagnostics: VisualDiagnostic[];
};

export function stableVisualId(input?: Record<string, unknown>): string;
export function createVisualIR(input?: Record<string, unknown>): VisualIR;
export function validateVisualIR(value: unknown): VisualIR;
export function serializeVisualIR(value: unknown): string;
export function deserializeVisualIR(value: string): VisualIR;
export function compareVisualIR(left: unknown, right: unknown): boolean;
export function createChartIR(input?: Record<string, unknown>): ChartIR;
export function validateChartIR(value: unknown): ChartIR;
export function serializeChartIR(value: unknown): string;
export function deserializeChartIR(value: string): ChartIR;
export function compareChartIR(left: unknown, right: unknown): boolean;
export function chartIRToLegacyChartIR(value: unknown): Record<string, unknown>;
export function legacyVisualIRToV2(value: unknown, context?: Record<string, unknown>): VisualIR;
export function visualIRToLegacyVisualIR(value: unknown): Record<string, unknown>;
export function classifyVisualEvidence(input?: Record<string, unknown>): VisualIR;
export function validateUntrustedVisualSource(value: string, format?: string): string;
