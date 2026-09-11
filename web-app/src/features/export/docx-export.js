import {
  AlignmentType,
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
  MathSum,
  MathSuperScript,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { parseLatexToMathIR } from "../../shared/mathir-parser.js";

const headingMap = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

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
function visualParagraph(fields, assets) {
  const asset = assets?.get?.(fields.id) || assets?.[fields.id];
  if (!asset?.data)
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Source ${fields.kind || "visual"} preserved on PDF page ${fields.page}.`,
          italics: true,
          color: "666666",
        }),
      ],
    });
  const maxWidth = 500,
    maxHeight = 620,
    ratio = Math.min(maxWidth / asset.width, maxHeight / asset.height, 1);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 140 },
    children: [
      new ImageRun({
        type: "png",
        data: asset.data,
        transformation: {
          width: Math.max(1, Math.round(asset.width * ratio)),
          height: Math.max(1, Math.round(asset.height * ratio)),
        },
        altText: {
          title: `Source ${fields.kind || "visual"}`,
          description: `Preserved from PDF page ${fields.page}`,
          name: fields.id,
        },
      }),
    ],
  });
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
    if (value.type === "operator") return String(value.value ?? "");
    if (value.type === "group") return (value.children || []).map(asMathRunText).join("");
  }
  return String(value);
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
        return [new MathRadical({ children: walk(value) })];
      }
      case "sum":
      case "prod": {
        const body = resolveMathNode(node, nodeMap, "body") || node.body;
        const lower = resolveMathNode(node, nodeMap, "lower") || node.lower;
        const upper = resolveMathNode(node, nodeMap, "upper") || node.upper;
        return [
          new MathSum({
            children: walk(body),
            subScript: lower ? walk(lower) : undefined,
            superScript: upper ? walk(upper) : undefined,
          }),
        ];
      }
      case "integral": {
        const body = resolveMathNode(node, nodeMap, "body") || node.body;
        const lower = resolveMathNode(node, nodeMap, "lower") || node.lower;
        const upper = resolveMathNode(node, nodeMap, "upper") || node.upper;
        return [
          new MathIntegral({
            children: walk(body),
            subScript: lower ? walk(lower) : undefined,
            superScript: upper ? walk(upper) : undefined,
          }),
        ];
      }
      case "subscript": {
        const base = resolveMathNode(node, nodeMap, "base") ?? resolveMathNode(node, nodeMap, "left") ?? node.base ?? node.left;
        const script = resolveMathNode(node, nodeMap, "value") ?? resolveMathNode(node, nodeMap, "right") ?? node.value ?? node.right;
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
        return [
          new MathSuperScript({
            children: walk(base ?? " "),
            superScript: walk(script ?? " "),
          }),
        ];
      }
      case "function": {
        return [
          new MathFunction({
            name: walk(node.name),
            children: walk(node.argument ?? node.children ?? []),
          }),
        ];
      }
      case "identifier":
      case "number":
      case "text":
      case "symbol":
      case "operator":
        return [new MathRun(asMathRunText(node))];
      case "equation":
      case "binary": {
        const left = resolveMathNode(node, nodeMap, "left");
        const right = resolveMathNode(node, nodeMap, "right");
        const parts = [];
        if (left !== null && left !== undefined) parts.push(...walk(left));
        if (right !== null && right !== undefined) parts.push(...walk(right));
        if (!parts.length && Array.isArray(node.children)) parts.push(...walk(node.children));
        return parts.length ? parts : [new MathRun(rawText || " ")];
      }
      case "sequence": {
        const parts = Array.isArray(node.children) ? node.children.flatMap((child) => walk(child)) : [];
        return parts.length ? parts : [new MathRun(rawText || " ")];
      }
      case "group": {
        const items = Array.isArray(node.children) ? node.children : [];
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
    const constructor = text.startsWith("\\sum")
      ? MathSum
      : text.startsWith("\\prod")
        ? MathSum
        : MathIntegral;
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
    return [
      new MathSum({
        children: bodyParts.length ? bodyParts : [new MathRun(body || " ")],
        subScript: lower ? extractMathSequence(lower) : undefined,
        superScript: upper ? extractMathSequence(upper) : undefined,
      }),
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
  const sequence = extractMathSequence(raw);
  if (sequence.length) return sequence;

  const parsed = parseLatexToMathIR(raw);
  const irComponents = mathComponentsFromMathIR(parsed, raw);
  if (irComponents.length && irComponents.some((component) => component && component.constructor && component.constructor.name !== "MathRun")) {
    return irComponents;
  }
  if (parsed.errors?.length || parsed.warnings?.length) {
    return [new MathRun(raw || " ")];
  }
  return legacyMathComponents(raw);
}
export async function markdownToDocx(
  markdown,
  title = "Document",
  options = {},
) {
  const blocks = [];
  const lines = markdown.split("\n");
  let inMath = false,
    math = [];
  const assets = options.assets || new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      trim = line.trim();
    if (/^<!--\s*page:/.test(trim)) {
      if (options.pageBreaks && blocks.length)
        blocks.push(new Paragraph({ children: [new PageBreak()] }));
      continue;
    }
    if (/^<!--/.test(trim)) continue;
    if (trim === "$$") {
      if (inMath) {
        blocks.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new WordMath({ children: mathComponents(math.join(" ")) }),
            ],
          }),
        );
        math = [];
      }
      inMath = !inMath;
      continue;
    }
    if (inMath) {
      math.push(trim);
      continue;
    }
    if (
      /^\|.*\|$/.test(trim) &&
      /^\|?\s*:?-{3,}/.test((lines[i + 1] || "").trim())
    ) {
      const table = [line, lines[++i]];
      while (/^\|.*\|$/.test(lines[i + 1] || "")) table.push(lines[++i]);
      blocks.push(parseTable(table));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trim);
    if (heading) {
      blocks.push(
        new Paragraph({
          heading: headingMap[heading[1].length],
          children: inlineRuns(heading[2]),
        }),
      );
      continue;
    }
    const list = /^[-*+]\s+(.+)$/.exec(trim);
    if (list) {
      blocks.push(
        new Paragraph({ bullet: { level: 0 }, children: inlineRuns(list[1]) }),
      );
      continue;
    }
    const numbered = /^\d+[.)]\s+(.+)$/.exec(trim);
    if (numbered) {
      blocks.push(
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          children: inlineRuns(numbered[1]),
        }),
      );
      continue;
    }
    const visual = sourceVisual(trim);
    if (visual) {
      blocks.push(visualParagraph(visual, assets));
      continue;
    }
    if (/^\[VISUAL_PLACEHOLDER/.test(trim)) {
      blocks.push(
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
        blocks.push(
          new Paragraph({
            children: inlineRuns(text),
            spacing: { after: 120 },
            widowControl: true,
          }),
        );
    }
  }
  const doc = new Document({
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
    sections: [{ properties: {}, children: blocks }],
  });
  return Packer.toBlob(doc);
}
