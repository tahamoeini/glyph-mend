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
  "max",
  "min",
  "arg",
  "mathrm",
  "mathbf",
  "mathit",
  "mathcal",
  "mathbb",
  "mathsf",
  "text",
  "operatorname",
  "left",
  "right",
  "times",
  "cdot",
  "div",
  "pm",
  "leq",
  "geq",
  "neq",
  "approx",
  "equiv",
  "sim",
  "propto",
  "in",
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
  "bmatrix",
  "smallmatrix",
  "array",
  "quad",
  "qquad",
]);

const SYMBOL_COMMANDS = new Set([
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
  "infty",
]);

const FUNCTION_COMMANDS = new Set([
  "sin",
  "cos",
  "tan",
  "log",
  "ln",
  "exp",
  "max",
  "min",
  "arg",
]);

const OPERATOR_COMMANDS = new Map([
  ["times", "times"],
  ["cdot", "times"],
  ["div", "divide"],
  ["pm", "plus-minus"],
  ["leq", "less-equal"],
  ["geq", "greater-equal"],
  ["neq", "not-equal"],
  ["approx", "approximately"],
  ["equiv", "equivalent"],
  ["sim", "similar"],
  ["propto", "proportional"],
  ["in", "in"],
  ["to", "to"],
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
      if (text[index] === "\\") {
        index += 1;
        tokens.push({ type: "command", value: "linebreak", raw: "\\\\" });
        continue;
      }
      let command = "";
      while (index < text.length && /[A-Za-z]/.test(text[index])) {
        command += text[index];
        index += 1;
      }
      if (!command) {
        if (index < text.length && /\s/.test(text[index])) {
          command = "space";
          index += 1;
        } else if (index < text.length) {
          command = text[index];
          index += 1;
        }
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

function groupFromItems(items) {
  if (items.length === 1) return items[0];
  return buildBinaryExpression(items, {
    equals: "equation",
    plus: "sum",
    minus: "difference",
    times: "product",
    divide: "quotient",
  }) || { type: "group", children: items };
}

function parseGroup(tokens, indexRef, stopDelimeter = "}") {
  const items = [];
  let closed = false;
  while (indexRef.index < tokens.length) {
    const token = tokens[indexRef.index];
    if (token && token.type === "delimiter" && token.value === stopDelimeter) {
      indexRef.index += 1;
      closed = true;
      break;
    }
    if (
      token &&
      token.type === "delimiter" &&
      ")]}".includes(token.value) &&
      token.value !== stopDelimeter
    ) {
      indexRef.errors.push(
        `Mismatched math group; expected ${stopDelimeter} but found ${token.value}.`,
      );
      indexRef.index += 1;
      break;
    }
    const item = parseAtomWithScripts(tokens, indexRef);
    if (!item) break;
    items.push(item);
  }
  if (!closed && indexRef.index >= tokens.length)
    indexRef.errors.push(`Unclosed math group; expected ${stopDelimeter}.`);
  return items;
}

function parseScriptOperand(tokens, indexRef) {
  const token = tokens[indexRef.index];
  if (!token) return null;
  if (token.type === "delimiter" && token.value === "{") {
    indexRef.index += 1;
    return groupFromItems(parseGroup(tokens, indexRef, "}"));
  }
  if (token.type === "delimiter" && token.value === "[") {
    indexRef.index += 1;
    return groupFromItems(parseGroup(tokens, indexRef, "]"));
  }
  return parseAtom(tokens, indexRef);
}

function parseScript(tokens, indexRef) {
  const token = tokens[indexRef.index];
  if (!token || token.type !== "operator" || (token.value !== "_" && token.value !== "^")) return null;
  const marker = token.value;
  indexRef.index += 1;
  const next = parseScriptOperand(tokens, indexRef);
  if (!next) {
    indexRef.errors.push(`Missing operand for ${marker} script.`);
    return null;
  }
  return { type: marker === "_" ? "subscript" : "superscript", value: next };
}

function parseLimitScripts(tokens, indexRef) {
  let lower = null;
  let upper = null;
  while (
    tokens[indexRef.index]?.type === "operator" &&
    ["_", "^"].includes(tokens[indexRef.index].value)
  ) {
    const script = parseScript(tokens, indexRef);
    if (!script) continue;
    if (script.type === "subscript") lower = script.value;
    else upper = script.value;
  }
  return { lower, upper };
}

function parseIntegralDifferential(tokens, indexRef) {
  const first = parseAtomWithScripts(tokens, indexRef);
  if (!first) return null;
  const firstText = textValue(first);
  // TeX commonly writes the differential as `dx` or `\mathrm{d}x`. Keep both
  // operands together so the integral does not leave the variable outside its
  // semantic body when the source uses the latter spelling.
  if (/^d$/i.test(firstText)) {
    const next = parseAtomWithScripts(tokens, indexRef);
    if (next) return { type: "sequence", children: [first, next] };
  }
  return first;
}

function readGroupText(tokens, indexRef) {
  const token = tokens[indexRef.index];
  if (!token || token.type !== "delimiter" || token.value !== "{") return "";
  indexRef.index += 1;
  let depth = 1;
  const values = [];
  while (indexRef.index < tokens.length) {
    const current = tokens[indexRef.index++];
    if (current.type === "delimiter" && current.value === "{") {
      depth += 1;
      values.push("{");
    } else if (current.type === "delimiter" && current.value === "}") {
      depth -= 1;
      if (depth === 0) break;
      values.push("}");
    } else {
      values.push(current.value ?? current.raw ?? "");
    }
  }
  if (depth !== 0) indexRef.errors.push("Unclosed command argument group.");
  return values.join("").trim();
}

function delimiterValue(token) {
  if (!token) return "";
  if (token.type === "command") return token.value === "space" ? " " : token.value;
  return String(token.value ?? "");
}

function parseAtom(tokens, indexRef) {
  if (indexRef.index >= tokens.length) return null;
  const token = tokens[indexRef.index];

  if (token.type === "delimiter" && token.value === "{") {
    indexRef.index += 1;
    const children = parseGroup(tokens, indexRef, "}");
    return groupFromItems(children);
  }

  if (token.type === "delimiter" && token.value === "[") {
    indexRef.index += 1;
    const children = parseGroup(tokens, indexRef, "]");
    return groupFromItems(children);
  }

  if (token.type === "delimiter" && token.value === "(") {
    indexRef.index += 1;
    const children = parseGroup(tokens, indexRef, ")");
    return groupFromItems(children);
  }

  if (token.type === "command") {
    const command = token.value;
    indexRef.index += 1;

    if (!SUPPORTED_COMMANDS.has(command)) {
      return { type: "unsupported", command };
    }

    if (command === "frac") {
      const numerator = parseScriptOperand(tokens, indexRef);
      const denominator = parseScriptOperand(tokens, indexRef);
      if (!numerator || !denominator) {
        indexRef.errors.push("\\frac requires numerator and denominator operands.");
        return { type: "unsupported", command, raw: "\\frac" };
      }
      return { type: "fraction", numerator, denominator };
    }

    if (command === "sqrt") {
      let index = null;
      if (tokens[indexRef.index]?.type === "delimiter" && tokens[indexRef.index]?.value === "[") {
        indexRef.index += 1;
        index = groupFromItems(parseGroup(tokens, indexRef, "]"));
      }
      const value = parseScriptOperand(tokens, indexRef);
      if (!value) {
        indexRef.errors.push("\\sqrt requires a radicand operand.");
        return { type: "unsupported", command, raw: "\\sqrt" };
      }
      return { type: "root", index, value };
    }

    if (SUPPORTED_COMMANDS.has(command) &&
      ["mathrm", "mathbf", "mathit", "mathcal", "mathbb", "mathsf", "text"].includes(command)) {
      const value = parseScriptOperand(tokens, indexRef);
      return {
        type: "text",
        value: textValue(value),
        style: command === "text" ? undefined : command,
      };
    }

    if (["hat", "bar", "vec", "dot", "tilde"].includes(command)) {
      const value = parseScriptOperand(tokens, indexRef);
      if (!value) {
        indexRef.errors.push(`\\${command} requires an operand.`);
        return { type: "unsupported", command, raw: `\\${command}` };
      }
      return { type: "accent", accent: command, value };
    }

    if (command === "int") {
      const limits = parseLimitScripts(tokens, indexRef);
      const body = parseAtomWithScripts(tokens, indexRef);
      const differential = parseIntegralDifferential(tokens, indexRef);
      if (!body) indexRef.errors.push("\\int requires an integrand operand.");
      return {
        type: "integral",
        lower: limits.lower,
        upper: limits.upper,
        body,
        differential,
      };
    }

    if (command === "sum" || command === "prod") {
      const limits = parseLimitScripts(tokens, indexRef);
      const body = parseAtomWithScripts(tokens, indexRef);
      if (!body) indexRef.errors.push(`\\${command} requires a body operand.`);
      return {
        type: command,
        lower: limits.lower,
        upper: limits.upper,
        body,
      };
    }

    if (SYMBOL_COMMANDS.has(command)) {
      return { type: "symbol", symbol: command };
    }

    if (FUNCTION_COMMANDS.has(command)) {
      const argument = parseAtomWithScripts(tokens, indexRef);
      if (!argument) indexRef.errors.push(`\\${command} requires an argument.`);
      return {
        type: "function",
        name: { type: "text", value: command },
        argument,
      };
    }

    if (OPERATOR_COMMANDS.has(command))
      return { type: "operator", value: OPERATOR_COMMANDS.get(command) };

    if (command === "operatorname")
      return { type: "text", value: readGroupText(tokens, indexRef) };

    if (command === "linebreak") return { type: "linebreak" };
    if (["space", "quad", "qquad", ",", ";", ":", "!"].includes(command))
      return { type: "text", value: " " };

    if (command === "begin") {
      const environment = readGroupText(tokens, indexRef) || "plain";
      const body = [];
      while (indexRef.index < tokens.length) {
        const next = tokens[indexRef.index];
        if (next?.type === "command" && next.value === "end") {
          indexRef.index += 1;
          readGroupText(tokens, indexRef);
          break;
        }
        const item = parseAtomWithScripts(tokens, indexRef);
        if (!item) break;
        body.push(item);
      }
      return {
        type: "environment",
        environment,
        body: groupFromItems(body),
      };
    }

    if (command === "end") {
      return { type: "environment-end" };
    }

    if (command === "right") {
      const delimiter = tokens[indexRef.index];
      if (delimiter) indexRef.index += 1;
      const value = delimiterValue(delimiter);
      return value === "." ? { type: "text", value: "" } : { type: "text", value };
    }

    if (command === "left") {
      const openingToken = tokens[indexRef.index];
      if (openingToken) indexRef.index += 1;
      const opening = delimiterValue(openingToken);
      const children = opening === "." ? [] : [{ type: "text", value: opening }];
      let closed = false;
      while (indexRef.index < tokens.length) {
        const next = tokens[indexRef.index];
        if (next?.type === "command" && next.value === "right") {
          indexRef.index += 1;
          const closingToken = tokens[indexRef.index];
          if (closingToken) indexRef.index += 1;
          const closing = delimiterValue(closingToken);
          if (closing !== ".") children.push({ type: "text", value: closing });
          closed = true;
          break;
        }
        const child = parseAtomWithScripts(tokens, indexRef);
        if (!child) break;
        children.push(child);
      }
      if (!closed) indexRef.errors.push("Unclosed \\left delimiter.");
      return groupFromItems(children);
    }

    if (["cases", "pmatrix", "bmatrix", "smallmatrix", "array"].includes(command)) {
      const value = parseScriptOperand(tokens, indexRef);
      return { type: "environment", environment: command, body: value };
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
    if (value === "&") return { type: "operator", value: "separator" };
    if (value === "<") return { type: "operator", value: "less-than" };
    if (value === ">") return { type: "operator", value: "greater-than" };
    return { type: "operator", value };
  }

  if (token.type === "delimiter" && token.value === "}") return null;

  indexRef.index += 1;
  return { type: "text", value: token.value };
}

function parseAtomWithScripts(tokens, indexRef) {
  const base = parseAtom(tokens, indexRef);
  if (!base) return null;
  let result = base;
  while (tokens[indexRef.index]?.type === "operator" &&
    ["_", "^"].includes(tokens[indexRef.index].value)) {
    const script = parseScript(tokens, indexRef);
    if (!script) break;
    result = {
      type: script.type,
      base: result,
      value: script.value,
    };
  }
  return result;
}

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value.type === "identifier" || value.type === "number" || value.type === "text")
    return String(value.value ?? "");
  if (value.type === "symbol") return String(value.symbol ?? "");
  if (value.type === "operator") return String(value.value ?? "");
  if (Array.isArray(value.children)) return value.children.map(textValue).join("");
  if (value.type === "sequence" || value.type === "group")
    return (value.children || []).map(textValue).join("");
  return "";
}

function buildBinaryExpression(items, operatorMap) {
  if (!items.length) return null;
  const operatorIndexes = items
    .map((item, index) => (item && item.type === "operator" ? index : -1))
    .filter((index) => index >= 0);

  if (!operatorIndexes.length) {
    return items.length > 1 ? { type: "sequence", children: items } : items[0];
  }

  const alternatesOperators = items.every((item, index) =>
    index % 2 === 0 ? item?.type !== "operator" : item?.type === "operator",
  );
  if (!alternatesOperators) return { type: "sequence", children: items };

  let tree = items[0];
  for (let index = 1; index < items.length; index += 2) {
    const operator = items[index];
    const right = items[index + 1];
    if (!operator || operator.type !== "operator" || !right) break;
    const mappedType = operatorMap[operator.value];
    tree = {
      type: mappedType || "binary",
      left: tree,
      right,
      ...(mappedType ? {} : { value: operator.value }),
    };
  }
  return tree;
}

function hasMissingOperatorOperand(items) {
  return (
    !items.length ||
    items[0]?.type === "operator" ||
    items.at(-1)?.type === "operator" ||
    items.some(
      (item, index) =>
        item?.type === "operator" &&
        (items[index - 1]?.type === "operator" ||
          items[index + 1]?.type === "operator"),
    )
  );
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
    const item = parseAtomWithScripts(tokens, indexRef);
    if (!item) break;
    items.push(item);
    const operator = tokens[indexRef.index];
    if (operator && operator.type === "operator" &&
      !["_", "^"].includes(operator.value)) {
      items.push(parseOperator(operator));
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
    const leftItems = items.slice(0, seenEquals);
    const rightItems = items.slice(seenEquals + 1);
    if (
      hasMissingOperatorOperand(leftItems) ||
      hasMissingOperatorOperand(rightItems) ||
      items.filter((item) => item?.type === "operator" && item.value === "equals").length > 1
    ) {
      indexRef.errors.push("Equation relation requires exactly two non-empty operands.");
    }
    const left = buildBinaryExpression(leftItems, { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    const right = buildBinaryExpression(rightItems, { plus: "sum", minus: "difference", times: "product", divide: "quotient" });
    return { type: "equation", left: left || items[0], right: right || items[items.length - 1] };
  }

  if (hasMissingOperatorOperand(items))
    indexRef.errors.push("Expression operator requires operands on both sides.");
  return buildBinaryExpression(items, { plus: "sum", minus: "difference", times: "product", divide: "quotient" }) || items[0];
}

function parseOperator(token) {
  const value = token?.value;
  if (value === "+") return { type: "operator", value: "plus" };
  if (value === "-") return { type: "operator", value: "minus" };
  if (value === "=") return { type: "operator", value: "equals" };
  if (value === "*") return { type: "operator", value: "times" };
  if (value === "/") return { type: "operator", value: "divide" };
  if (value === "&") return { type: "operator", value: "separator" };
  if (value === "<") return { type: "operator", value: "less-than" };
  if (value === ">") return { type: "operator", value: "greater-than" };
  return { type: "operator", value };
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
    if (item.style !== undefined) record.style = item.style;
    if (item.numerator !== undefined) record.numeratorId = `${currentId}-num`;
    if (item.denominator !== undefined) record.denominatorId = `${currentId}-den`;
    if (item.body !== undefined) record.bodyId = `${currentId}-body`;
    if (item.lower !== undefined) record.lowerId = `${currentId}-lower`;
    if (item.upper !== undefined) record.upperId = `${currentId}-upper`;
    if (item.base !== undefined) record.baseId = `${currentId}-base`;
    if (item.index !== undefined) record.indexId = `${currentId}-index`;
    if (item.name !== undefined) record.nameId = `${currentId}-name`;
    if (item.argument !== undefined) record.argumentId = `${currentId}-argument`;
    if (item.differential !== undefined)
      record.differentialId = `${currentId}-differential`;
    if (item.value && isPlainObject(item.value))
      record.valueId = `${currentId}-value`;
    nodes.push(record);

    if (item.left) visit(item.left, `${currentId}-left`);
    if (item.right) visit(item.right, `${currentId}-right`);
    if (item.base) visit(item.base, `${currentId}-base`);
    if (item.numerator) visit(item.numerator, `${currentId}-num`);
    if (item.denominator) visit(item.denominator, `${currentId}-den`);
    if (item.body) visit(item.body, `${currentId}-body`);
    if (item.lower) visit(item.lower, currentId + "-lower");
    if (item.upper) visit(item.upper, currentId + "-upper");
    if (item.index) visit(item.index, `${currentId}-index`);
    if (item.name) visit(item.name, `${currentId}-name`);
    if (item.argument) visit(item.argument, `${currentId}-argument`);
    if (item.differential)
      visit(item.differential, `${currentId}-differential`);
    if (item.value && isPlainObject(item.value)) visit(item.value, `${currentId}-value`);
    if (Array.isArray(item.children)) {
      record.childrenIds = item.children.map((_, index) => currentId + "-child-" + index);
      item.children.forEach((child, index) => visit(child, `${currentId}-child-${index}`));
    }
  };

  visit(value, idPrefix);
  return nodes;
}

function buildLatexAst(input = "") {
  const text = stripLeadingDollars(input);
  if (!text) return { type: "empty", value: "" };
  const tokens = tokenizeLatex(text);
  const indexRef = { index: 0, errors: [] };
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
    if (node.base) walk(node.base);
    if (node.index) walk(node.index);
    if (node.name) walk(node.name);
    if (node.argument) walk(node.argument);
    if (node.differential) walk(node.differential);
    if (node.value && isPlainObject(node.value)) walk(node.value);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(tree);
  if (indexRef.index < tokens.length)
    indexRef.errors.push(`Unparsed math token near position ${indexRef.index}.`);
  return { ...tree, unsupported, parseErrors: indexRef.errors };
}

export function parseLatexToMathIR(input = "") {
  const ast = buildLatexAst(input);
  const unsupported = ast.unsupported || [];
  const parseErrors = ast.parseErrors || [];
  const hasErrors = unsupported.length > 0 || parseErrors.length > 0;
  const nodes = flattenAst(ast, "root");
  const errors = [
    ...unsupported.map((item) => `Unsupported math command: ${item.command}`),
    ...parseErrors,
  ];
  const confidence = {
    recognition: unsupported.length ? 0.56 : parseErrors.length ? 0.42 : 0.94,
    parseValidity: hasErrors ? 0.2 : 0.96,
    overall: hasErrors ? 0.35 : 0.97,
  };

  const result = parseMathIR({
    schemaVersion: 1,
    id: "mathir-root",
    kind: "equation",
    rootId: "root",
    nodes,
    provenance: {
      producer: "mathir-parser",
      version: "0.2.0",
      algorithmVersion: "step-07",
      validationEvidence: {
        level: hasErrors ? "low" : "high",
        notes: ["latex-to-mathir adapter"],
      },
    },
    confidence,
    disposition: hasErrors ? "preserved" : "accepted",
    warnings: hasErrors
      ? ["Equation was preserved with explicit parser fallback evidence."]
      : [],
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
