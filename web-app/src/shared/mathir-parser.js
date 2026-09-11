import { parseMathIR, serializeMathIR } from "./semantic-ir.js";

const SUPPORTED_COMMANDS = new Set([
  "frac",
  "sqrt",
  "sum",
  "prod",
  "int",
  "sin",
  "cos",
  "tan",
  "log",
  "ln",
  "exp",
  "mathrm",
  "mathbf",
  "mathit",
  "text",
  "left",
  "right",
  "times",
  "cdot",
  "pm",
  "leq",
  "geq",
  "neq",
  "approx",
  "infty",
  "to",
  "alpha",
  "beta",
  "gamma",
  "theta",
  "lambda",
  "mu",
  "pi",
  "sigma",
  "phi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Sigma",
  "Phi",
  "Omega",
  "hat",
  "bar",
  "vec",
  "dot",
  "tilde",
  "begin",
  "end",
  "cases",
  "pmatrix",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stripLeadingDollars(value = "") {
  const text = String(value ?? "").trim();
  if (text.startsWith("$$") && text.endsWith("$$")) return text.slice(2, -2).trim();
  if (text.startsWith("$") && text.endsWith("$")) return text.slice(1, -1).trim();
  return text;
}

function tokenizeLatex(value) {
  const text = stripLeadingDollars(value);
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "\\") {
      const start = index;
      index += 1;
      let command = "";
      while (index < text.length && /[A-Za-z]/.test(text[index])) {
        command += text[index];
        index += 1;
      }
      if (!command && index < text.length && text[index] !== " ") {
        command = text[index];
        index += 1;
      }
      tokens.push({ type: "command", value: command, raw: text.slice(start, index) });
      continue;
    }

    if ("{}()[]".includes(char)) {
      tokens.push({ type: "delimiter", value: char });
      index += 1;
      continue;
    }

    if ("=+-*/^_&<>".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    let chunk = "";
    while (
      index < text.length &&
      !/\s/.test(text[index]) &&
      !"\\{}()[]^_&=+-*/<>".includes(text[index])
    ) {
      chunk += text[index];
      index += 1;
    }
    if (chunk) tokens.push({ type: "symbol", value: chunk });
  }

  return tokens;
}

function parseGroup(tokens, indexRef, stopDelimeter = "}") {
  const items = [];
  while (indexRef.index < tokens.length) {
    const token = tokens[indexRef.index];
    if (token && token.type === "delimiter" && token.value === stopDelimeter) {
      indexRef.index += 1;
      break;
    }
    const item = parseAtom(tokens, indexRef);
    if (!item) break;
    items.push(item);
  }
  return items;
}

function parseScript(tokens, indexRef) {
  const token = tokens[indexRef.index];
  if (!token || token.type !== "operator" || (token.value !== "_" && token.value !== "^")) return null;
  const marker = token.value;
  indexRef.index += 1;
  const next = parseAtom(tokens, indexRef);
  if (!next) return null;
  return { type: marker === "_" ? "subscript" : "superscript", value: next };
}

function parseAtom(tokens, indexRef) {
  if (indexRef.index >= tokens.length) return null;
  const token = tokens[indexRef.index];

  if (token.type === "delimiter" && token.value === "{") {
    indexRef.index += 1;
    const children = parseGroup(tokens, indexRef, "}");
    if (children.length === 1) return children[0];
    const expression = buildBinaryExpression(children, { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    return expression || { type: "group", children };
  }

  if (token.type === "delimiter" && token.value === "[") {
    indexRef.index += 1;
    const children = parseGroup(tokens, indexRef, "]");
    if (children.length === 1) return children[0];
    const expression = buildBinaryExpression(children, { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    return expression || { type: "group", children };
  }

  if (token.type === "delimiter" && token.value === "(") {
    indexRef.index += 1;
    const children = parseGroup(tokens, indexRef, ")");
    if (children.length === 1) return children[0];
    const expression = buildBinaryExpression(children, { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    return expression || { type: "group", children };
  }

  if (token.type === "command") {
    const command = token.value;
    indexRef.index += 1;

    if (!SUPPORTED_COMMANDS.has(command)) {
      return { type: "unsupported", command };
    }

    if (command === "frac") {
      const numerator = parseAtom(tokens, indexRef);
      const denominator = parseAtom(tokens, indexRef);
      return { type: "fraction", numerator, denominator };
    }

    if (command === "sqrt") {
      const value = parseAtom(tokens, indexRef);
      return { type: "root", value };
    }

    if (command === "mathrm" || command === "mathbf" || command === "mathit" || command === "text") {
      const value = parseAtom(tokens, indexRef);
      return { type: "text", value: value?.value ?? value?.text ?? value ?? "" };
    }

    if (command === "hat" || command === "bar" || command === "vec" || command === "dot" || command === "tilde") {
      const value = parseAtom(tokens, indexRef);
      return { type: "accent", accent: command, value };
    }

    if (command === "int") {
      const lower = parseScript(tokens, indexRef);
      const upper = parseScript(tokens, indexRef);
      const body = parseAtom(tokens, indexRef);
      const differential = parseAtom(tokens, indexRef);
      return { type: "integral", lower: lower?.value ?? null, upper: upper?.value ?? null, body, differential };
    }

    if (command === "sum" || command === "prod") {
      const lower = parseScript(tokens, indexRef);
      const upper = parseScript(tokens, indexRef);
      const body = parseAtom(tokens, indexRef);
      return { type: command, lower: lower?.value ?? null, upper: upper?.value ?? null, body };
    }

    if (command in { alpha: 1, beta: 1, gamma: 1, theta: 1, lambda: 1, mu: 1, pi: 1, sigma: 1, phi: 1, omega: 1, Gamma: 1, Delta: 1, Theta: 1, Lambda: 1, Sigma: 1, Phi: 1, Omega: 1 }) {
      return { type: "symbol", symbol: command };
    }

    if (command === "begin") {
      const env = parseAtom(tokens, indexRef);
      const body = parseGroup(tokens, indexRef, "}");
      return { type: "environment", environment: env?.value ?? env?.symbol ?? "plain", body };
    }

    if (command === "end") {
      return { type: "environment-end" };
    }

    if (command === "left" || command === "right") {
      return null;
    }

    return { type: "unsupported", command };
  }

  if (token.type === "symbol") {
    const value = token.value;
    indexRef.index += 1;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return { type: "number", value: numeric };
    return { type: "identifier", value };
  }

  if (token.type === "operator") {
    const value = token.value;
    indexRef.index += 1;
    if (value === "+") return { type: "operator", value: "plus" };
    if (value === "-") return { type: "operator", value: "minus" };
    if (value === "=") return { type: "operator", value: "equals" };
    if (value === "*") return { type: "operator", value: "times" };
    if (value === "/") return { type: "operator", value: "divide" };
    return { type: "operator", value };
  }

  if (token.type === "delimiter" && token.value === "}") return null;

  indexRef.index += 1;
  return { type: "text", value: token.value };
}

function buildBinaryExpression(items, operatorMap) {
  if (!items.length) return null;
  const operatorIndexes = items
    .map((item, index) => (item && item.type === "operator" ? index : -1))
    .filter((index) => index >= 0);

  if (!operatorIndexes.length) {
    return items.length > 1 ? { type: "sequence", children: items } : items[0];
  }

  let tree = items[0];
  for (let index = 1; index < items.length; index += 2) {
    const operator = items[index];
    const right = items[index + 1];
    if (!operator || operator.type !== "operator" || !right) break;
    tree = { type: operatorMap[operator.value] || "binary", left: tree, right };
  }
  return tree;
}

function parseExpression(tokens, indexRef, stop = null) {
  const items = [];
  while (indexRef.index < tokens.length) {
    const next = tokens[indexRef.index];
    if (stop && next && next.type === "delimiter" && next.value === stop) {
      break;
    }
    if (next && next.type === "delimiter" && "}])".includes(next.value)) {
      break;
    }
    const item = parseAtom(tokens, indexRef);
    if (!item) break;
    items.push(item);
    const operator = tokens[indexRef.index];
    if (operator && operator.type === "operator") {
      items.push(operator);
      indexRef.index += 1;
    }
  }

  if (!items.length) return { type: "group", children: [] };

  const operatorCount = items.filter((item) => item && item.type === "operator").length;
  if (!operatorCount) {
    return items.length > 1 ? { type: "sequence", children: items } : items[0];
  }

  const seenEquals = items.findIndex((item) => item && item.type === "operator" && item.value === "equals");
  if (seenEquals >= 0) {
    const left = buildBinaryExpression(items.slice(0, seenEquals), { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    const right = buildBinaryExpression(items.slice(seenEquals + 1), { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    return { type: "equation", left: left || items[0], right: right || items[items.length - 1] };
  }

  return buildBinaryExpression(items, { plus: "sum", minus: "difference", times: "product", divide: "quotient" }) || items[0];
}

function flattenAst(value, idPrefix = "root") {
  const nodes = [];
  const visit = (item, currentId) => {
    if (!isPlainObject(item)) {
      nodes.push({ id: currentId, type: "literal", value: String(item) });
      return;
    }
    const record = {
      id: currentId,
      type: item.type || "unknown",
    };
    if (item.value !== undefined) record.value = item.value;
    if (item.symbol !== undefined) record.symbol = item.symbol;
    if (item.command !== undefined) record.command = item.command;
    if (item.accent !== undefined) record.accent = item.accent;
    if (item.environment !== undefined) record.environment = item.environment;
    if (item.numerator !== undefined) record.numeratorId = `${currentId}-num`;
    if (item.denominator !== undefined) record.denominatorId = `${currentId}-den`;
    if (item.body !== undefined) record.bodyId = `${currentId}-body`;
    if (item.lower !== undefined) record.lowerId = `${currentId}-lower`;
    if (item.upper !== undefined) record.upperId = `${currentId}-upper`;
    nodes.push(record);

    if (item.left) visit(item.left, `${currentId}-left`);
    if (item.right) visit(item.right, `${currentId}-right`);
    if (item.numerator) visit(item.numerator, `${currentId}-num`);
    if (item.denominator) visit(item.denominator, `${currentId}-den`);
    if (item.body) visit(item.body, `${currentId}-body`);
    if (item.value && isPlainObject(item.value)) visit(item.value, `${currentId}-value`);
    if (Array.isArray(item.children)) {
      item.children.forEach((child, index) => visit(child, `${currentId}-child-${index}`));
    }
    if (item.type === "sequence" && Array.isArray(item.children)) {
      item.children.forEach((child, index) => visit(child, `${currentId}-${index}`));
    }
  };

  visit(value, idPrefix);
  return nodes;
}

function buildLatexAst(input = "") {
  const text = stripLeadingDollars(input);
  if (!text) return { type: "empty", value: "" };
  const tokens = tokenizeLatex(text);
  const indexRef = { index: 0 };
  const tree = parseExpression(tokens, indexRef);
  const unsupported = [];
  const walk = (node) => {
    if (!isPlainObject(node)) return;
    if (node.type === "unsupported") unsupported.push(node);
    if (node.left) walk(node.left);
    if (node.right) walk(node.right);
    if (node.numerator) walk(node.numerator);
    if (node.denominator) walk(node.denominator);
    if (node.body) walk(node.body);
    if (node.value && isPlainObject(node.value)) walk(node.value);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(tree);
  return { ...tree, unsupported };
}

export function parseLatexToMathIR(input = "") {
  const ast = buildLatexAst(input);
  const unsupported = ast.unsupported || [];
  const nodes = flattenAst(ast, "root");
  const errors = unsupported.map((item) => `Unsupported math command: ${item.command}`);
  const confidence = {
    recognition: unsupported.length ? 0.56 : 0.94,
    parseValidity: unsupported.length ? 0.66 : 0.96,
    overall: unsupported.length ? 0.58 : 0.97,
  };

  const result = parseMathIR({
    schemaVersion: 1,
    id: "mathir-root",
    kind: "equation",
    rootId: "root",
    nodes,
    provenance: {
      producer: "mathir-parser",
      version: "0.1.0",
      algorithmVersion: "step-06",
      validationEvidence: {
        level: unsupported.length ? "medium" : "high",
        notes: ["latex-to-mathir adapter"],
      },
    },
    confidence,
    disposition: unsupported.length ? "preserved" : "accepted",
    warnings: unsupported.length ? ["Unsupported command preserved as explicit fallback evidence."] : [],
    errors,
  });

  return result;
}

export function parseLatexToAst(input = "") {
  return buildLatexAst(input);
}

export function parseLatexToSemanticAst(input = "") {
  return buildLatexAst(input);
}

export function serializeMathIRForTests(input = "") {
  return serializeMathIR(parseLatexToMathIR(input));
}
