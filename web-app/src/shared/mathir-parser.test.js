import { expect, it } from "vitest";
import { parseLatexToMathIR, parseLatexToAst } from "./mathir-parser.js";

it("parses a simple inline equation into MathIR", () => {
  const ir = parseLatexToMathIR("x + 1 = 2");
  expect(ir.kind).toBe("equation");
  expect(ir.rootId).toBe("root");
  expect(ir.nodes.length).toBeGreaterThan(0);
  expect(ir.disposition).toBe("accepted");
});

it("accepts normalized relation commands emitted by the extractor", () => {
  const ir = parseLatexToMathIR("p \\leq q + 1");
  expect(ir.errors).toEqual([]);
  expect(ir.nodes.length).toBeGreaterThan(0);
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

it("keeps the differential variable inside a definite integral", () => {
  const ast = parseLatexToAst("\\int_0^1 x^2 \\mathrm{d}x");
  expect(ast.type).toBe("integral");
  expect(ast.differential.type).toBe("sequence");
  expect(ast.differential.children.at(-1).value).toBe("x");
});

it("represents scripts as semantic base/value relationships", () => {
  const ast = parseLatexToAst("x_i^2");
  expect(ast.type).toBe("superscript");
  expect(ast.base.type).toBe("subscript");
  expect(ast.base.base.value).toBe("x");
  expect(ast.base.value.value).toBe("i");
  expect(ast.value.value).toBe(2);
});

it("parses limits, functions, and scalable delimiters without fallback errors", () => {
  const ir = parseLatexToMathIR(
    "\\sum_{i=1}^n i^2 + \\sin\\left(x\\right)",
  );
  expect(ir.errors || []).toHaveLength(0);
  expect(ir.nodes.some((node) => node.type === "sum")).toBe(true);
  expect(ir.nodes.some((node) => node.type === "function")).toBe(true);
  expect(ir.nodes.some((node) => node.type === "superscript")).toBe(true);
});

it("reports unsupported commands explicitly instead of silently stripping them", () => {
  const ir = parseLatexToMathIR("\\unknown{1}");
  expect(ir.errors).toEqual(expect.arrayContaining([expect.stringMatching(/unsupported|unknown/i)]));
  expect(ir.disposition).toBe("preserved");
});

it("reports missing operands instead of manufacturing a valid-looking equation", () => {
  const ir = parseLatexToMathIR("x =");
  expect(ir.errors).toEqual(expect.arrayContaining([expect.stringMatching(/operand/i)]));
  expect(ir.disposition).toBe("preserved");
});

it("reports mismatched delimiters explicitly", () => {
  const ir = parseLatexToMathIR("\\frac{1}{x]");
  expect(ir.errors).toEqual(expect.arrayContaining([expect.stringMatching(/mismatched|unclosed/i)]));
  expect(ir.disposition).toBe("preserved");
});
