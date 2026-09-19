import { describe, expect, it } from "vitest";
import {
  compareEquationIR,
  createEquationIR,
  deserializeEquationIR,
  equationFromLatex,
  equationToMarkdown,
  serializeEquationIR,
} from "./equation-ir.js";
import { EQUATION_IR_FIXTURES } from "./equation-ir.fixtures.js";

function source(overrides = {}) {
  return {
    kind: "vector",
    page: 2,
    bbox: [10, 20, 220, 64],
    coordinateSpace: "pdf-user-space",
    spanIds: ["span-7", "span-8"],
    regionIds: ["block-3"],
    objectIds: [],
    cropIds: ["p2-equation-10-20"],
    cropAvailable: true,
    ...overrides,
  };
}

function make(latex, mode = "display", overrides = {}) {
  return equationFromLatex({
    id: `fixture-${mode}`,
    page: 2,
    bbox: [10, 20, 220, 64],
    mode,
    latex,
    source: source(),
    confidence: {
      detection: 0.95,
      recognition: 0.94,
      structure: 0.93,
      validation: 0.92,
      reconstruction: 0.91,
      export: 0.96,
    },
    ...overrides,
  });
}

describe("EquationIR v1", () => {
  it("creates structural MathIR for the supported fixture families", () => {
    for (const fixture of EQUATION_IR_FIXTURES.filter((item) => !item.sourceOnly)) {
      const equation = make(fixture.latex, fixture.mode);
      expect(equation.type).toBe("equation");
      expect(equation.mode).toBe(fixture.mode);
      expect(equation.mathIR?.nodes.length).toBeGreaterThan(0);
      expect(equation.source.spanIds).toEqual(["span-7", "span-8"]);
      expect(equation.source.cropIds).toEqual(["p2-equation-10-20"]);
    }
  });

  it("serializes, deserializes, and compares deterministically", () => {
    const equation = make("\\frac{1}{x + 1}");
    const first = serializeEquationIR(equation);
    const second = serializeEquationIR({ ...equation, confidence: { ...equation.confidence } });
    expect(first).toBe(second);
    expect(compareEquationIR(equation, deserializeEquationIR(first))).toBe(true);
  });

  it("uses explicit inline and display Markdown forms", () => {
    expect(equationToMarkdown(make("E = mc^2", "inline"))).toBe("$E = mc^2$");
    expect(equationToMarkdown(make("E = mc^2", "display"))).toBe("$$\nE = mc^2\n$$");
  });

  it("retains source evidence after editable reconstruction", () => {
    const equation = make("\\sqrt{x}");
    expect(equation.disposition).toBe("reconstructed-with-source");
    expect(equation.source.cropIds).toContain("p2-equation-10-20");
    expect(equation.source.spanIds).toContain("span-7");
  });

  it("does not turn an incomplete formula into editable mathematics", () => {
    const equation = make("x =", "display", {
      confidence: {
        detection: 0.99,
        recognition: 0.99,
        structure: 0.99,
        validation: 0.99,
        reconstruction: 0.99,
        export: 0.99,
      },
    });
    expect(equation.disposition).toBe("needs-review");
    expect(equationToMarkdown(equation)).toBeNull();
    expect(equation.diagnostics).toContain("mathir-validation-errors");
  });

  it("keeps image-only equations source-preserved", () => {
    const equation = createEquationIR({
      id: "image-equation-1",
      page: 4,
      bbox: [0, 0, 100, 40],
      mode: "display",
      source: source({ kind: "raster", page: 4, cropIds: ["image-1"] }),
      confidence: {
        detection: 0.9,
        recognition: 0.2,
        structure: 0.1,
        validation: 0.1,
        reconstruction: 0.1,
        export: 0.2,
      },
      disposition: "preserved-source",
    });
    expect(equation.mathIR).toBeNull();
    expect(equationToMarkdown(equation)).toBeNull();
    expect(equation.source.cropIds).toEqual(["image-1"]);
  });
});
