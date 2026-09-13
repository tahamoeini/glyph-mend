import { describe, expect, it } from "vitest";
import { validateEquationCandidate, createBaselineVisualSimilarity } from "./math-validation.js";

describe("equation validation gating", () => {
  it("accepts a valid equation when parse/render and confidence pass", () => {
    const result = validateEquationCandidate(
      {
        latex: "\\frac{1}{1 + \\frac{1}{x}}",
        confidence: { overall: 0.9, token: 0.9, sequence: 0.9 },
      },
      { id: "source-crop-1", page: 3, bbox: [10, 20, 200, 60] },
      "\\frac{1}{1 + \\frac{1}{x}}",
    );

    expect(result.accepted).toBe(true);
    expect(result.disposition).toBe("accepted");
    expect(result.validation.sourcePreserved).toBe(true);
    expect(result.manifest.sourceAsset.id).toBe("source-crop-1");
  });

  it("rejects semantically wrong equations even when they look similar", () => {
    const result = validateEquationCandidate(
      {
        latex: "\\frac{1}{1 + x}",
        confidence: { overall: 0.82, token: 0.82, sequence: 0.81 },
      },
      { id: "source-crop-2", page: 3, bbox: [10, 20, 200, 60] },
      "\\frac{1}{1 + \\frac{1}{x}}",
    );

    expect(result.accepted).toBe(false);
    expect(["review", "preserved"]).toContain(result.disposition);
    expect(result.validation.renderSuccess).toBe(true);
  });

  it("preserves low-confidence or invalid candidates instead of accepting them", () => {
    const result = validateEquationCandidate(
      {
        latex: "x =",
        confidence: { overall: 0.35, token: 0.4, sequence: 0.3 },
      },
      { id: "source-crop-3", page: 3, bbox: [10, 20, 200, 60] },
      "x =",
    );

    expect(result.disposition).toBe("preserved");
    expect(result.validation.mandatoryPassed).toBe(false);
    expect(result.validation.sourcePreserved).toBe(true);
  });

  it("never accepts a high-confidence candidate with a parse error", () => {
    const result = validateEquationCandidate(
      {
        latex: "x =",
        confidence: { overall: 0.99, token: 0.99, sequence: 0.99 },
      },
      { id: "source-crop-4", page: 3, bbox: [10, 20, 200, 60] },
      "x =",
    );

    expect(result.accepted).toBe(false);
    expect(result.disposition).toBe("preserved");
    expect(result.validation.parseSuccess).toBe(false);
  });

  it("accepts parseable structured PDF text at review confidence without weakening OCR gating", () => {
    const sourceAsset = { id: "source-crop-5", page: 3, bbox: [10, 20, 200, 60] };
    const structured = validateEquationCandidate(
      {
        latex: "x = y",
        provider: "mupdf-structured-text",
        confidence: { overall: 0.7, token: 0.7, sequence: 0.7 },
      },
      sourceAsset,
      "x = y",
    );
    const ocr = validateEquationCandidate(
      {
        latex: "x = y",
        provider: "tesseract-ocr",
        confidence: { overall: 0.7, token: 0.7, sequence: 0.7 },
      },
      sourceAsset,
      "x = y",
    );

    expect(structured.accepted).toBe(true);
    expect(structured.disposition).toBe("accepted");
    expect(ocr.accepted).toBe(false);
    expect(ocr.disposition).toBe("review");
  });

  it("uses a conservative visual similarity fallback for structure-sensitive math", () => {
    const score = createBaselineVisualSimilarity("\\sum_{i=1}^n i", "\\sum_{i=1}^n i^2");
    expect(score.score).toBeLessThan(1);
    expect(score.pass).toBe(false);
  });
});
