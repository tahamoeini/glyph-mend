export type EquationMode = "inline" | "display";
export type EquationDisposition =
  | "reconstructed"
  | "reconstructed-with-source"
  | "preserved-source"
  | "needs-review"
  | "unsupported"
  | "omitted-decoration";

export interface EquationSource {
  kind: string;
  page: number;
  bbox: [number, number, number, number];
  coordinateSpace: string;
  spanIds: string[];
  regionIds: string[];
  objectIds: string[];
  cropIds: string[];
  cropAvailable: boolean;
}

export interface EquationConfidence {
  detection: number;
  recognition: number;
  structure: number;
  validation: number;
  reconstruction: number;
  export: number;
}

export interface EquationIR {
  schemaVersion: 1;
  id: string;
  type: "equation";
  mode: EquationMode;
  page: number;
  bbox: [number, number, number, number];
  coordinateSpace: string;
  latex: string;
  mathIR: Record<string, unknown> | null;
  source: EquationSource;
  confidence: EquationConfidence;
  disposition: EquationDisposition;
  reconstructionVersion: number;
  diagnostics: string[];
}

export declare const EQUATION_IR_SCHEMA_VERSION: 1;
export declare const EQUATION_MODES: readonly EquationMode[];
export declare const EQUATION_DISPOSITIONS: readonly EquationDisposition[];
export declare const EQUATION_CONFIDENCE_DIMENSIONS: readonly (keyof EquationConfidence)[];
export declare function deterministicEquationId(input?: Partial<EquationIR>): string;
export declare function parseEquationIR(value: unknown): EquationIR;
export declare function createEquationIR(input?: Record<string, unknown>): EquationIR;
export declare function equationFromLatex(input?: Record<string, unknown>): EquationIR;
export declare function equationToMarkdown(value: unknown): string | null;
export declare function equationForDocx(value: unknown): Record<string, unknown> | null;
export declare function serializeEquationIR(value: unknown): string;
export declare function deserializeEquationIR(value: string): EquationIR;
export declare function compareEquationIR(left: unknown, right: unknown): boolean;
export declare function serializeEquationMathIR(value: unknown): string;
