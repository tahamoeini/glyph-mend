import {
  AlignmentType,
  Document,
  HeadingLevel,
  Math as WordMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const headingMap = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};
function inlineRuns(text) {
  const runs = [];
  const re =
    /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`|<sup>(.*?)<\/sup>|<sub>(.*?)<\/sub>|<u>(.*?)<\/u>)/gi;
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
function mathComponents(source) {
  let text = source.trim(),
    match;
  if ((match = /^\\frac\{([^{}]+)\}\{([^{}]+)\}$/.exec(text)))
    return [
      new MathFraction({
        numerator: mathComponents(match[1]),
        denominator: mathComponents(match[2]),
      }),
    ];
  if ((match = /^\\sqrt\{([^{}]+)\}$/.exec(text)))
    return [new MathRadical({ children: mathComponents(match[1]) })];
  if ((match = /^(.+?)_\{?([^{}]+)\}?$/.exec(text)))
    return [
      new MathSubScript({
        children: mathComponents(match[1]),
        subScript: mathComponents(match[2]),
      }),
    ];
  if ((match = /^(.+?)\^\{?([^{}]+)\}?$/.exec(text)))
    return [
      new MathSuperScript({
        children: mathComponents(match[1]),
        superScript: mathComponents(match[2]),
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
export async function markdownToDocx(markdown, title = "Document") {
  const blocks = [];
  const lines = markdown.split("\n");
  let inMath = false,
    math = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      trim = line.trim();
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
    if (trim)
      blocks.push(
        new Paragraph({ children: inlineRuns(trim), spacing: { after: 120 } }),
      );
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
