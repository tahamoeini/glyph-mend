import { parseLatexToMathIR, parseLatexToAst } from './src/shared/mathir-parser.js';
const raw = '\\frac{1}{1 + \\frac{1}{x}}\\sum_{i=1}^n i^2\\sqrt{x^2 + 1}';
const ast = parseLatexToAst(raw);
console.log('AST', JSON.stringify(ast, null, 2));
const ir = parseLatexToMathIR(raw);
console.log('IR', JSON.stringify(ir, null, 2));
