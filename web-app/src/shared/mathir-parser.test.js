import { expect, it } from "vitest";
import { parseLatexToMathIR, parseLatexToAst } from "./mathir-parser.js";

it("parses a simple inline equation into MathIR", () => {
  const ir = parseLatexToMathIR("x + 1 = 2");
  expect(ir.kind).toBe("equation");
  expect(ir.rootId).toBe("root");
  expect(ir.nodes.length).toBeGreaterThan(0);
  expect(ir.disposition).toBe("accepted");
});

it("stores binary MathIR relationships as bounded graph references", () => {
  const ir = parseLatexToMathIR("x + 1 = 2");
  const root = ir.nodes.find((node) => node.id === ir.rootId);
  expect(root.leftId).toBe("root-left");
  expect(root.rightId).toBe("root-right");
  expect(ir.nodes.find((node) => node.id === root.leftId)?.type).toBe("sum");
});

it("accepts normalized relation commands emitted by the extractor", () => {
  const ir = parseLatexToMathIR("p \\leq q + 1");
  expect(ir.errors).toEqual([]);
  expect(ir.nodes.length).toBeGreaterThan(0);
  expect(ir.nodes.find((node) => node.type === "binary")?.value).toBe(
    "less-equal",
  );
});

it("preserves distinct non-equality relation operators in MathIR", () => {
  const less = parseLatexToMathIR("x \\leq y");
  const greater = parseLatexToMathIR("x \\geq y");
  expect(less.nodes.find((node) => node.type === "binary")?.value).toBe(
    "less-equal",
  );
  expect(greater.nodes.find((node) => node.type === "binary")?.value).toBe(
    "greater-equal",
  );
});

it("recognizes supported named function commands", () => {
  const ir = parseLatexToMathIR("\\max x");
  expect(ir.errors || []).toHaveLength(0);
  expect(ir.nodes.some((node) => node.type === "function")).toBe(true);
});

it("parses nested fraction structure and preserves semantic structure", () => {
  const ast = parseLatexToAst("\\frac{1}{1 + \\frac{1}{x}}");
  expect(ast.type).toBe("fraction");
  expect(ast.numerator.value).toBe(1);
  expect(ast.denominator.type).toBe("sum");
  expect(ast.denominator.right.type).toBe("fraction");
});

it("stores graph references without embedding the recursive AST in every node", () => {
  const ir = parseLatexToMathIR("\\frac{1}{1 + \\frac{1}{x}}");
  const nestedObjects = ir.nodes.flatMap((node) =>
    Object.values(node).filter((value) => value && typeof value === "object" && !Array.isArray(value)),
  );

  expect(nestedObjects).toHaveLength(0);
  expect(ir.nodes.some((node) => node.denominatorId)).toBe(true);
});

it("keeps a long candidate bounded instead of expanding duplicate MathIR nodes", () => {
  const source = Array.from({ length: 100 }, (_, index) => `x_${index}`).join(" + ");
  const ir = parseLatexToMathIR(source);

  expect(ir.nodes.length).toBeLessThan(8192);
  expect(JSON.stringify(ir).length).toBeLessThan(256 * 1024);
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
