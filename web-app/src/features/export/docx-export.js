import {
  AlignmentType,
  createMathBase,
  createMathNAryProperties,
  createMathSubScriptElement,
  createMathSuperScriptElement,
  Document,
  HeadingLevel,
  ImageRun,
  Math as WordMath,
  MathFraction,
  MathFunction,
  MathIntegral,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  XmlComponent,
  Packer,
  PageBreak,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { parseLatexToMathIR } from "../../shared/mathir-parser.js";
import { fencedVisualParagraph, visualParagraph } from "./visual-docx.js";
import {
  markdownToStreamingDocx,
  shouldUseStreamingDocx,
} from "./streaming-docx.js";

const headingMap = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

export const DOCX_EXPORT_LIMITS = Object.freeze({
  maxBlocksPerSection: 512,
  maxMathSourceCharacters: 256 * 1024,
});

function notifyExportWarning(options, warning) {
  try {
    options.onWarning?.(warning);
  } catch {
    // Export diagnostics must never turn a recoverable block failure into a
    // document-level failure.
  }
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function safeVisualBlock(factory, source, options, kind) {
  try {
    return await factory();
  } catch (error) {
    notifyExportWarning(options, {
      kind,
      message: error instanceof Error ? error.message : String(error),
      source: String(source || "").slice(0, 512),
    });
    return new Paragraph({
      children: inlineRuns(source || `[GlyphMend preserved ${kind} block]`),
    });
  }
}

function inlineRuns(source) {
  const text = source
    .replace(/<!--.*?-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const runs = [];
  const re =
    /(\*\*([^*]+)\*\*|_([^_<>]+)_|`([^`]+)`|<sup>(.*?)<\/sup>|<sub>(.*?)<\/sub>|<u>(.*?)<\/u>)/gi;
  let last = 0,
    m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    const value = m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || "";
    runs.push(
      new TextRun({
        text: value,
        bold: !!m[2],
        italics: !!m[3],
        font: m[4] ? "Courier New" : undefined,
        superScript: !!m[5],
        subScript: !!m[6],
        underline: m[7] ? {} : undefined,
      }),
    );
    last = re.lastIndex;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs;
}
function joinSoftLines(lines) {
  return lines
    .reduce((text, line) => {
      const value = line.trim();
      if (!text) return value;
      if (/-$/.test(text) && /^\p{Ll}/u.test(value))
        return `${text.slice(0, -1)}${value}`;
      return `${text} ${value}`;
    }, "")
    .replace(/\s+/g, " ")
    .trim();
}
function sourceVisual(line) {
  const match = /^\[SOURCE_VISUAL\s+([^\]]+)\]$/.exec(line);
  if (!match) return null;
  const fields = {};
  for (const item of match[1].matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g))
    fields[item[1]] = item[2] ?? item[3];
  return fields;
}
function parseTable(lines) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: lines
      .filter((_, i) => i !== 1)
      .map(
        (line, i) =>
          new TableRow({
            tableHeader: i === 0,
            children: line
              .replace(/^\||\|$/g, "")
              .split("|")
              .map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: inlineRuns(cell.trim()) }),
                    ],
                  }),
              ),
          }),
      ),
  });
}
function resolveMathNode(node, nodeMap, key) {
  if (!node || !nodeMap) return null;
  const direct = node[key];
  if (direct !== undefined && direct !== null) {
    if (typeof direct === "string") return nodeMap.get(direct) ?? null;
    if (typeof direct === "object") return direct;
  }
  const id = node[`${key}Id`];
  if (typeof id === "string") return nodeMap.get(id) ?? null;
  if (node.id && typeof node.id === "string") {
    const inferred = nodeMap.get(`${node.id}-${key}`);
    if (inferred) return inferred;
  }
  return null;
}

function asMathRunText(value) {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value.type === "number" || value.type === "identifier" || value.type === "text")
      return String(value.value ?? "");
    if (value.type === "symbol") return String(value.symbol ?? "");
    if (value.type === "unsupported") return value.raw || `\\${value.command || "?"}`;
    if (value.type === "operator") return mathOperatorGlyph(value.value);
    if (value.type === "group") return (value.children || []).map(asMathRunText).join("");
  }
  return String(value);
}

function mathOperatorGlyph(value) {
  return (
    {
      plus: "+",
      minus: "−",
      times: "×",
      divide: "÷",
      "plus-minus": "±",
      "less-equal": "≤",
      "greater-equal": "≥",
      "not-equal": "≠",
      approximately: "≈",
      equivalent: "≡",
      similar: "∼",
      proportional: "∝",
      in: "∈",
      to: "→",
      equals: "=",
      "less-than": "<",
      "greater-than": ">",
      separator: "&",
    }[value] ?? String(value ?? "")
  );
}

function resolveMathChildren(node, nodeMap) {
  if (Array.isArray(node?.childrenIds) && nodeMap)
    return node.childrenIds.map((id) => nodeMap.get(id)).filter(Boolean);
  return Array.isArray(node?.children) ? node.children : [];
}

function mathBinaryComponents(node, nodeMap, operator, rawText, walk) {
  const left = resolveMathNode(node, nodeMap, "left");
  const right = resolveMathNode(node, nodeMap, "right");
  const parts = [];
  if (left !== null && left !== undefined) parts.push(...walk(left));
  if (operator) parts.push(new MathRun(operator));
  if (right !== null && right !== undefined) parts.push(...walk(right));
  return parts.length ? parts : [new MathRun(rawText || " ")];
}

function mathNAry(symbol, children, lower, upper) {
  const component = new XmlComponent("m:nary");
  component.addChildElement(
    createMathNAryProperties({
      accent: symbol,
      hasSuperScript: Boolean(upper?.length),
      hasSubScript: Boolean(lower?.length),
      limitLocationVal: "undOvr",
    }),
  );
  if (lower?.length)
    component.addChildElement(createMathSubScriptElement({ children: lower }));
  if (upper?.length)
    component.addChildElement(createMathSuperScriptElement({ children: upper }));
  component.addChildElement(createMathBase({ children }));
  return component;
}

function mathComponentsFromMathIR(ir, rawText = "") {
  if (!ir || !Array.isArray(ir.nodes) || !ir.nodes.length) return [new MathRun(rawText || " ")];
  const nodeMap = new Map(ir.nodes.map((node) => [node.id, node]));
  const root = nodeMap.get(ir.rootId) ?? ir.nodes[0];

  const walk = (node) => {
    if (!node) return [new MathRun(" ")];
    if (Array.isArray(node)) return node.flatMap((entry) => walk(entry));
    if (typeof node === "string") return [new MathRun(node)];
    if (typeof node === "number") return [new MathRun(String(node))];

    switch (node.type) {
      case "fraction": {
        const numerator = resolveMathNode(node, nodeMap, "numerator") ?? resolveMathNode(node, nodeMap, "num") ?? node.numerator;
        const denominator = resolveMathNode(node, nodeMap, "denominator") ?? resolveMathNode(node, nodeMap, "den") ?? node.denominator;
        return [
          new MathFraction({
            numerator: walk(numerator),
            denominator: walk(denominator),
          }),
        ];
      }
      case "root": {
        const value = node.value ?? resolveMathNode(node, nodeMap, "value") ?? node.children;
        const degree = resolveMathNode(node, nodeMap, "index") ?? node.index;
        return [
          new MathRadical({
            children: walk(value),
            degree: degree ? walk(degree) : undefined,
          }),
        ];
      }
      case "sum": {
        const body = resolveMathNode(node, nodeMap, "body") || node.body;
        if (!body && !node.bodyId)
          return mathBinaryComponents(node, nodeMap, "+", rawText, walk);
        const lower = resolveMathNode(node, nodeMap, "lower") || node.lower;
        const upper = resolveMathNode(node, nodeMap, "upper") || node.upper;
        const lowerComponents = lower ? walk(lower) : undefined;
        const upperComponents = upper ? walk(upper) : undefined;
        return [
          new MathSum({
            children: walk(body),
            subScript: lowerComponents,
            superScript: upperComponents,
          }),
        ];
      }
      case "prod": {
        const body = resolveMathNode(node, nodeMap, "body") || node.body;
        if (!body && !node.bodyId)
          return mathBinaryComponents(node, nodeMap, "×", rawText, walk);
        const lower = resolveMathNode(node, nodeMap, "lower") || node.lower;
        const upper = resolveMathNode(node, nodeMap, "upper") || node.upper;
        const children = walk(body);
        const lowerComponents = lower ? walk(lower) : undefined;
        const upperComponents = upper ? walk(upper) : undefined;
        return [
          mathNAry("∏", children, lowerComponents, upperComponents),
        ];
      }
      case "integral": {
        const body = resolveMathNode(node, nodeMap, "body") || node.body;
        const lower = resolveMathNode(node, nodeMap, "lower") || node.lower;
        const upper = resolveMathNode(node, nodeMap, "upper") || node.upper;
        const differential =
          resolveMathNode(node, nodeMap, "differential") || node.differential;
        const children = [
          ...walk(body),
          ...(differential ? walk(differential) : []),
        ];
        return [
          new MathIntegral({
            children,
            subScript: lower ? walk(lower) : undefined,
            superScript: upper ? walk(upper) : undefined,
          }),
        ];
      }
      case "subscript": {
        const base = resolveMathNode(node, nodeMap, "base") ?? resolveMathNode(node, nodeMap, "left") ?? node.base ?? node.left;
        const script = resolveMathNode(node, nodeMap, "value") ?? resolveMathNode(node, nodeMap, "right") ?? node.value ?? node.right;
        if (base?.type === "superscript") {
          const plainBase =
            resolveMathNode(base, nodeMap, "base") ?? base.base;
          const superScript =
            resolveMathNode(base, nodeMap, "value") ?? base.value;
          return [
            new MathSubSuperScript({
              children: walk(plainBase ?? " "),
              subScript: walk(script ?? " "),
              superScript: walk(superScript ?? " "),
            }),
          ];
        }
        return [
          new MathSubScript({
            children: walk(base ?? " "),
            subScript: walk(script ?? " "),
          }),
        ];
      }
      case "superscript": {
        const base = resolveMathNode(node, nodeMap, "base") ?? resolveMathNode(node, nodeMap, "left") ?? node.base ?? node.left;
        const script = resolveMathNode(node, nodeMap, "value") ?? resolveMathNode(node, nodeMap, "right") ?? node.value ?? node.right;
        if (base?.type === "subscript") {
          const plainBase =
            resolveMathNode(base, nodeMap, "base") ?? base.base;
          const subScript =
            resolveMathNode(base, nodeMap, "value") ?? base.value;
          return [
            new MathSubSuperScript({
              children: walk(plainBase ?? " "),
              subScript: walk(subScript ?? " "),
              superScript: walk(script ?? " "),
            }),
          ];
        }
        return [
          new MathSuperScript({
            children: walk(base ?? " "),
            superScript: walk(script ?? " "),
          }),
        ];
      }
      case "function": {
        const name =
          resolveMathNode(node, nodeMap, "name") || node.name || "function";
        const argument =
          resolveMathNode(node, nodeMap, "argument") ||
          node.argument ||
          node.children ||
          [];
        return [
          new MathFunction({
            name: walk(name),
            children: walk(argument),
          }),
        ];
      }
      case "accent": {
        const value =
          resolveMathNode(node, nodeMap, "value") || node.value || " ";
        return [new MathRun(`${node.accent || ""}${asMathRunText(value)}`)];
      }
      case "environment": {
        const body = resolveMathNode(node, nodeMap, "body") || node.body;
        return walk(body);
      }
      case "linebreak":
        return [new MathRun(" ")];
      case "identifier":
      case "number":
      case "text":
      case "symbol":
      case "operator":
        return [new MathRun(asMathRunText(node))];
      case "equation":
        return mathBinaryComponents(node, nodeMap, "=", rawText, walk);
      case "difference":
        return mathBinaryComponents(node, nodeMap, "−", rawText, walk);
      case "product":
        return mathBinaryComponents(node, nodeMap, "×", rawText, walk);
      case "quotient":
        return mathBinaryComponents(node, nodeMap, "÷", rawText, walk);
      case "binary":
        return mathBinaryComponents(
          node,
          nodeMap,
          mathOperatorGlyph(node.value),
          rawText,
          walk,
        );
      case "sequence": {
        const parts = resolveMathChildren(node, nodeMap).flatMap((child) => walk(child));
        return parts.length ? parts : [new MathRun(rawText || " ")];
      }
      case "group": {
        const items = resolveMathChildren(node, nodeMap);
        const parts = items.flatMap((child) => walk(child));
        return parts.length ? parts : [new MathRun(rawText || " ")];
      }
      case "unknown":
        return [new MathRun(rawText || " ")];
      case "unsupported":
        return [new MathRun(rawText || node.raw || `\\${node.command || "?"}`)];
      default:
        if (node.value !== undefined) return [new MathRun(asMathRunText(node.value))];
        return [new MathRun(rawText || " ")];
    }
  };

  const result = walk(root);
  return result.length ? result : [new MathRun(rawText || " ")];
}

function legacyMathComponents(source) {
  let text = source.trim(),
    match;
  if ((match = /^\\(?:sum|prod|int)_(?:\{?([^{}]+)\}?)(?:\^(?:\{?([^{}]+)\}?))?(?:\s*(.+))?$/.exec(text))) {
    const lower = match[1];
    const upper = match[2];
    const body = match[3] || " ";
    if (text.startsWith("\\prod"))
      return [
        mathNAry(
          "∏",
          legacyMathComponents(body),
          lower ? legacyMathComponents(lower) : undefined,
          upper ? legacyMathComponents(upper) : undefined,
        ),
      ];
    const constructor = text.startsWith("\\sum") ? MathSum : MathIntegral;
    return [
      new constructor({
        children: legacyMathComponents(body),
        subScript: lower ? legacyMathComponents(lower) : undefined,
        superScript: upper ? legacyMathComponents(upper) : undefined,
      }),
    ];
  }
  if ((match = /^\\frac\{([^{}]+)\}\{([^{}]+)\}$/.exec(text)))
    return [
      new MathFraction({
        numerator: legacyMathComponents(match[1]),
        denominator: legacyMathComponents(match[2]),
      }),
    ];
  if ((match = /^\\sqrt\{([^{}]+)\}$/.exec(text)))
    return [new MathRadical({ children: legacyMathComponents(match[1]) })];
  if ((match = /^([A-Za-z0-9]+?)_\{?([^{}]+)\}?$/.exec(text)))
    return [
      new MathSubScript({
        children: legacyMathComponents(match[1]),
        subScript: legacyMathComponents(match[2]),
      }),
    ];
  if ((match = /^([A-Za-z0-9]+?)\^\{?([^{}]+)\}?$/.exec(text)))
    return [
      new MathSuperScript({
        children: legacyMathComponents(match[1]),
        superScript: legacyMathComponents(match[2]),
      }),
    ];
  const symbols = {
    alpha: "α",
    beta: "β",
    gamma: "γ",
    delta: "δ",
    theta: "θ",
    lambda: "λ",
    mu: "μ",
    pi: "π",
    sigma: "σ",
    phi: "φ",
    omega: "ω",
    leq: "≤",
    geq: "≥",
    neq: "≠",
    approx: "≈",
    times: "×",
    cdot: "·",
    infty: "∞",
  };
  text = text
    .replace(/\\([A-Za-z]+)/g, (_, name) => symbols[name] || name)
    .replace(/[{}]/g, "");
  return [new MathRun(text)];
}

function readBraceGroup(text, startIndex = 0) {
  const openIndex = text.indexOf("{", startIndex);
  if (openIndex < 0) return null;
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: text.slice(openIndex + 1, index),
          end: index + 1,
        };
      }
    }
  }
  return null;
}

function extractMathSequence(source) {
  const raw = source.trim();
  if (!raw) return [];

  const matchFrac = raw.match(/^\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/);
  if (matchFrac) {
    const numeratorParts = extractMathSequence(matchFrac[1]);
    const denominatorParts = extractMathSequence(matchFrac[2]);
    const remaining = raw.slice(matchFrac[0].length).trim();
    return [
      new MathFraction({
        numerator: numeratorParts.length ? numeratorParts : [new MathRun(matchFrac[1] || " ")],
        denominator: denominatorParts.length ? denominatorParts : [new MathRun(matchFrac[2] || " ")],
      }),
      ...extractMathSequence(remaining),
    ];
  }

  const matchSqrt = raw.match(/^\\sqrt\s*\{([^{}]+)\}/);
  if (matchSqrt) {
    const childParts = extractMathSequence(matchSqrt[1]);
    const remaining = raw.slice(matchSqrt[0].length).trim();
    return [
      new MathRadical({ children: childParts.length ? childParts : [new MathRun(matchSqrt[1] || " ")] }),
      ...extractMathSequence(remaining),
    ];
  }

  const matchSum = raw.match(/^\\(?:sum|prod|int)\s*(?:_\{([^{}]+)\})?(?:\^\{([^{}]+)\})?(.*)$/);
  if (matchSum) {
    const lower = matchSum[1] || "";
    const upper = matchSum[2] || "";
    const body = (matchSum[3] || "").trim();
    const bodyParts = extractMathSequence(body);
    const remaining = raw.slice(matchSum[0].length).trim();
    const lowerParts = lower ? extractMathSequence(lower) : undefined;
    const upperParts = upper ? extractMathSequence(upper) : undefined;
    const operator = raw.startsWith("\\sum")
      ? new MathSum({
          children: bodyParts.length ? bodyParts : [new MathRun(body || " ")],
          subScript: lowerParts,
          superScript: upperParts,
        })
      : raw.startsWith("\\prod")
        ? mathNAry(
            "∏",
            bodyParts.length ? bodyParts : [new MathRun(body || " ")],
            lowerParts,
            upperParts,
          )
        : new MathIntegral({
            children: bodyParts.length ? bodyParts : [new MathRun(body || " ")],
            subScript: lowerParts,
            superScript: upperParts,
          });
    return [
      operator,
      ...extractMathSequence(remaining),
    ];
  }

  const scriptMatch = raw.match(/^([A-Za-z0-9]+)\s*(?:_\{?([^{}]+)\}?|\^\{?([^{}]+)\}?)/);
  if (scriptMatch) {
    const base = scriptMatch[1];
    const sub = scriptMatch[2];
    const sup = scriptMatch[3];
    const remaining = raw.slice(scriptMatch[0].length).trim();
    const parts = [];
    if (sub) parts.push(new MathSubScript({ children: [new MathRun(base)], subScript: [new MathRun(sub)] }));
    if (sup) parts.push(new MathSuperScript({ children: [new MathRun(base)], superScript: [new MathRun(sup)] }));
    if (!sub && !sup) parts.push(new MathRun(base));
    return [...parts, ...extractMathSequence(remaining)];
  }

  const tokenMatch = raw.match(/^([A-Za-z0-9]+|[+-=])/);
  if (tokenMatch) {
    const remaining = raw.slice(tokenMatch[1].length).trim();
    return [new MathRun(tokenMatch[1]), ...extractMathSequence(remaining)];
  }

  return [];
}

function mathComponents(source) {
  const raw = source.trim();
  const parsed = parseLatexToMathIR(raw);
  const irComponents = mathComponentsFromMathIR(parsed, raw);
  if (!parsed.errors?.length && irComponents.length) return irComponents;

  if (parsed.errors?.length || parsed.warnings?.length)
    return [new MathRun(raw || " ")];

  const sequence = extractMathSequence(raw);
  if (sequence.length) return sequence;
  return legacyMathComponents(raw);
}

function equationParagraph(source, options) {
  const raw = String(source || "").trim();
  if (raw.length > DOCX_EXPORT_LIMITS.maxMathSourceCharacters) {
    notifyExportWarning(options, {
      kind: "equation",
      message: `Equation source exceeds the ${DOCX_EXPORT_LIMITS.maxMathSourceCharacters}-character export limit; source text was preserved.`,
    });
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: raw, italics: true })],
    });
  }
  try {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new WordMath({ children: mathComponents(raw) })],
    });
  } catch (error) {
    notifyExportWarning(options, {
      kind: "equation",
      message: error instanceof Error ? error.message : String(error),
      source: raw.slice(0, 512),
      fallback: "source-text",
    });
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: raw, italics: true })],
    });
  }
}

export async function markdownToDocx(
  markdown,
  title = "Document",
  options = {},
) {
  if (shouldUseStreamingDocx(markdown, options))
    return markdownToStreamingDocx(markdown, title, options);

  const maxBlocksPerSection = Math.max(
    32,
    Number(options.maxBlocksPerSection) || DOCX_EXPORT_LIMITS.maxBlocksPerSection,
  );
  let blocks = [];
  let sectionCount = 0;
  let document = null;
  const lines = markdown.split("\n");
  let inMath = false,
    math = [];
  const assets = options.assets || new Map();

  async function pushBlock(block) {
    if (!block) return;
    blocks.push(block);
    if (blocks.length < maxBlocksPerSection) return;
    await flushBlocks();
  }

  async function flushBlocks() {
    if (!blocks.length) return;
    const children = blocks;
    blocks = [];
    const properties = sectionCount ? { type: SectionType.CONTINUOUS } : {};
    if (!document) {
      document = new Document({
        title,
        numbering: {
          config: [
            {
              reference: "numbered",
              levels: [
                {
                  level: 0,
                  format: "decimal",
                  text: "%1.",
                  alignment: AlignmentType.START,
                },
              ],
            },
          ],
        },
        styles: { default: { document: { run: { font: "Aptos", size: 21 } } } },
        sections: [{ properties, children }],
      });
    } else {
      document.addSection({ properties, children });
    }
    sectionCount += 1;
    await options.onProgress?.({ section: sectionCount, blocks: children.length });
    await yieldToBrowser();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      trim = line.trim();
    if (/^<!--\s*page:/.test(trim)) {
      if (options.pageBreaks && (blocks.length || sectionCount))
        await pushBlock(new Paragraph({ children: [new PageBreak()] }));
      continue;
    }
    if (/^<!--/.test(trim)) continue;
    if (trim === "$$") {
      if (inMath) {
        await pushBlock(equationParagraph(math.join(" "), options));
        math = [];
      }
      inMath = !inMath;
      continue;
    }
    if (inMath) {
      math.push(trim);
      continue;
    }
    const fence = /^```([A-Za-z0-9_-]+)\s*$/.exec(trim);
    if (fence) {
      const sourceLines = [];
      while (i + 1 < lines.length && lines[i + 1].trim() !== "```") sourceLines.push(lines[++i]);
      if (lines[i + 1]?.trim() === "```") i += 1;
      await pushBlock(await safeVisualBlock(
        () => fencedVisualParagraph(fence[1], sourceLines.join("\n"), options),
        sourceLines.join("\n"),
        options,
        `fenced-${fence[1]}`,
      ));
      continue;
    }
    if (
      /^\|.*\|$/.test(trim) &&
      /^\|?\s*:?-{3,}/.test((lines[i + 1] || "").trim())
    ) {
      const table = [line, lines[++i]];
      while (/^\|.*\|$/.test(lines[i + 1] || "")) table.push(lines[++i]);
      await pushBlock(parseTable(table));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trim);
    if (heading) {
      await pushBlock(
        new Paragraph({
          heading: headingMap[heading[1].length],
          children: inlineRuns(heading[2]),
        }),
      );
      continue;
    }
    const list = /^[-*+]\s+(.+)$/.exec(trim);
    if (list) {
      await pushBlock(
        new Paragraph({ bullet: { level: 0 }, children: inlineRuns(list[1]) }),
      );
      continue;
    }
    const numbered = /^\d+[.)]\s+(.+)$/.exec(trim);
    if (numbered) {
      await pushBlock(
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          children: inlineRuns(numbered[1]),
        }),
      );
      continue;
    }
    const visual = sourceVisual(trim);
    if (visual) {
      await pushBlock(await safeVisualBlock(
        () => visualParagraph(visual, assets, options),
        trim,
        options,
        "source-visual",
      ));
      continue;
    }
    if (/^\[VISUAL_PLACEHOLDER/.test(trim)) {
      await pushBlock(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: trim.replace(/^\[VISUAL_PLACEHOLDER\s*|\]$/g, ""),
              italics: true,
              color: "666666",
            }),
          ],
        }),
      );
      continue;
    }
    if (trim) {
      const paragraph = [line];
      while (
        i + 1 < lines.length &&
        lines[i + 1].trim() &&
        !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||\$\$|<!--|\[(?:VISUAL_|SOURCE_))/.test(
          lines[i + 1].trim(),
        )
      )
        paragraph.push(lines[++i]);
      const text = joinSoftLines(paragraph);
      if (text)
        await pushBlock(
          new Paragraph({
            children: inlineRuns(text),
            spacing: { after: 120 },
            widowControl: true,
          }),
        );
    }
  }
  await flushBlocks();
  if (!document) {
    document = new Document({
      title,
      sections: [{ properties: {}, children: [new Paragraph("")] }],
    });
  }
  return Packer.toBlob(document);
}
