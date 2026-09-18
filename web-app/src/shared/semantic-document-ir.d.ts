export const SEMANTIC_DOCUMENT_IR_SCHEMA: "glyphmend.semantic-document-ir";
export const SEMANTIC_DOCUMENT_IR_SCHEMA_VERSION: 2;

export type SemanticDocumentNodeType =
  | "heading"
  | "paragraph"
  | "quote"
  | "list"
  | "list-item"
  | "table"
  | "equation"
  | "figure"
  | "chart"
  | "caption"
  | "footnote"
  | "header-footer"
  | "metadata"
  | "unresolved-visual";

export type SemanticDocumentDisposition =
  | "reconstructed"
  | "reconstructed-with-source"
  | "preserved-source"
  | "needs-review"
  | "unsupported"
  | "omitted-decoration";

export type SemanticDocumentSourceKind =
  | "native-text"
  | "ocr-text"
  | "image"
  | "vector"
  | "mixed"
  | "table-lines"
  | "source-crop"
  | "derived"
  | "metadata"
  | "legacy"
  | "unknown";

export type SemanticDocumentCoordinateSpace =
  | "page-points"
  | "normalized-page"
  | "crop-pixels"
  | "document-points"
  | "unknown";

export interface SemanticBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SemanticConfidence {
  extraction: number | null;
  structure: number | null;
  reconstruction: number | null;
  export: number | null;
  /** Compatibility trace only; never use this as the quality decision. */
  legacyOverall?: number;
}

export interface SemanticSourceRefs {
  kind: SemanticDocumentSourceKind;
  spanIds: string[];
  objectIds: string[];
  cropIds: string[];
  extra?: Record<string, unknown>;
}

export interface SemanticDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  details?: Record<string, unknown> | unknown[];
}

export interface SemanticNodeContent {
  markdown?: string;
  text?: string;
  caption?: string;
  table?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SemanticDocumentNode {
  id: string;
  type: SemanticDocumentNodeType;
  content: SemanticNodeContent;
  children: SemanticDocumentNode[];
  sourcePage: number;
  bbox: SemanticBBox | null;
  coordinateSpace: SemanticDocumentCoordinateSpace;
  sourceKind: SemanticDocumentSourceKind;
  source: SemanticSourceRefs;
  confidence: SemanticConfidence;
  disposition: SemanticDocumentDisposition;
  reconstructionVersion: number;
  diagnostics: SemanticDiagnostic[];
  parentId?: string;
  label?: string;
}

export interface SemanticDocumentPage {
  id: string;
  pageNumber: number;
  sourcePage: number;
  bbox: SemanticBBox | null;
  coordinateSpace: SemanticDocumentCoordinateSpace;
  nodes: SemanticDocumentNode[];
  relationships: SemanticDocumentRelationship[];
  diagnostics: SemanticDiagnostic[];
  layout?: Record<string, unknown>;
  source?: Record<string, unknown>;
}

export interface SemanticDocumentRelationship {
  type: string;
  from: string;
  to: string;
}

export interface SemanticDocumentIR {
  schema: "glyphmend.semantic-document-ir";
  schemaVersion: 2;
  documentId: string;
  metadata: Record<string, unknown>;
  pages: SemanticDocumentPage[];
  diagnostics: SemanticDiagnostic[];
  quality?: Record<string, unknown>;
}

export interface SemanticDocumentQualityReport {
  schema: "glyphmend.semantic-document-ir";
  schemaVersion: 2;
  documentId: string;
  pages: number;
  nodes: number;
  nodeTypes: Record<string, number>;
  dispositions: Record<string, number>;
  confidence: Record<string, {
    known: number;
    unknown: number;
    minimum: number | null;
    maximum: number | null;
    mean: number | null;
  }>;
  provenance: {
    nodesWithBbox: number;
    nodesWithSourceSpan: number;
    nodesWithSourceObject: number;
    nodesWithSourceCrop: number;
  };
  diagnostics: Record<string, number>;
}

export function createSemanticDocumentIR(input?: Partial<SemanticDocumentIR> & Record<string, unknown>): SemanticDocumentIR;
export function validateSemanticDocumentIR(value: unknown): SemanticDocumentIR;
export function serializeSemanticDocumentIR(value: unknown): string;
export function deserializeSemanticDocumentIR(value: string): SemanticDocumentIR;
export function compareSemanticDocumentIR(left: unknown, right: unknown): boolean;
export function semanticDocumentFromLegacyDocumentIR(legacy: unknown, metadata?: Record<string, unknown>): SemanticDocumentIR;
export function legacyDocumentIRFromSemanticDocument(value: unknown): Record<string, unknown>;
export function semanticDocumentToMarkdown(value: unknown, options?: { preserveMarkers?: boolean }): string;
export function semanticDocumentToDocxMarkdown(value: unknown, options?: { preserveMarkers?: boolean }): string;
export function semanticDocumentQualityReport(value: unknown): SemanticDocumentQualityReport;
