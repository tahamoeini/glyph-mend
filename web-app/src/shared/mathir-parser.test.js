import { expect, it } from "vitest";
import { parseLatexToMathIR, parseLatexToAst } from "./mathir-parser.js";

it("parses a simple inline equation into MathIR", () => {
  const ir = parseLatexToMathIR("x + 1 = 2");
  expect(ir.kind).toBe("equation");
  expect(ir.rootId).toBe("root");
  expect(ir.nodes.length).toBeGreaterThan(0);
  expect(ir.disposition).toBe("accepted");
});

it("parses nested fraction structure and preserves semantic structure", () => {
  const ast = parseLatexToAst("\\frac{1}{1 + \\frac{1}{x}}");
  expect(ast.type).toBe("fraction");
  expect(ast.numerator.value).toBe(1);
  expect(ast.denominator.type).toBe("sum");
  expect(ast.denominator.right.type).toBe("fraction");
});

it("parses a definite integral with limits and returns MathIR", () => {
  const ir = parseLatexToMathIR("\\int_0^1 x^2 \\mathrm{d}x");
  expect(ir.errors || []).toHaveLength(0);
  expect(ir.confidence.overall).toBeGreaterThan(0.7);
});

it("reports unsupported commands explicitly instead of silently stripping them", () => {
  const ir = parseLatexToMathIR("\\unknown{1}");
  expect(ir.errors).toEqual(expect.arrayContaining([expect.stringMatching(/unsupported|unknown/i)]));
  expect(ir.disposition).toBe("preserved");
});
