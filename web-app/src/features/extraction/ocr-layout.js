import { normalizeText } from "./cleanup.js";

function lineText(line) {
  return normalizeText(line?.text || "").replace(/\n+/g, " ").trim();
}

function lineBox(line) {
  const box = line?.bbox || {};
  return {
    y0: Number(box.y0 ?? box.top ?? 0),
    y1: Number(box.y1 ?? box.bottom ?? box.y0 ?? box.top ?? 0),
  };
}

function flattenLines(blocks) {
  return (Array.isArray(blocks) ? blocks : []).flatMap((block) =>
    (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []),
  );
}

function fallbackLines(text = "") {
  return text.split("\n").map((value, index) => ({
    text: lineText({ text: value }),
    y0: index * 2,
    y1: index * 2 + 1,
  }));
}

function headingLevel(text) {
  const numbered = /^(\d+(?:\.\d+){0,5})\.?\s+\S/.exec(text);
  if (numbered) return Math.min(6, numbered[1].split(".").length);
  if (/^(?:chapter|appendix|part)\s+(?:\d+|[ivxlcdm]+)\b/i.test(text))
    return 1;
  if (/^(?:contents|list of (?:figures|tables)|preface|references|index)$/i.test(text))
    return 1;
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  const upper =
    letters.filter((character) => character === character.toUpperCase()).length /
    Math.max(1, letters.length);
  // OCR commonly returns publisher catalogues and table rows in all caps. Treat
  // only a short, punctuation-free display line as an unnumbered heading.
  return text.length <= 60 &&
    text.split(/\s+/).length <= 7 &&
    !/[,;/:]/.test(text) &&
    upper > 0.9
    ? 1
    : null;
}

function equationText(text) {
  if (text.length > 180 || /\b(?:figure|table|source|note)\b/i.test(text))
    return false;
  const symbols = (text.match(/[=<>+−×÷≠≤≥≈∑∏∫√]/gu) || []).length;
  const words = (text.match(/\p{L}{3,}/gu) || []).length;
  const variables = (text.match(/(?:^|\s)[A-Za-z](?:[_^]\S+)?(?=\s|$)/g) || [])
    .length;
  return (
    text.split(/\s+/).length <= 18 &&
    ((symbols >= 2 && words <= 4) || (symbols >= 1 && variables >= 2 && words <= 2))
  );
}

function joinLines(lines) {
  return lines.reduce((text, line) => {
    const value = line.text;
    if (!text) return value;
    if (/-$/.test(text) && /^\p{Ll}/u.test(value))
      return `${text.slice(0, -1)}${value}`;
    return `${text} ${value}`;
  }, "");
}

export function ocrMarkdownEntries(data, escapeMarkdown, options = {}) {
  const structuredLines = flattenLines(data.blocks)
    .map((line) => ({ text: lineText(line), ...lineBox(line) }))
    .filter((line) => line.text);
  const lines = (structuredLines.length
    ? structuredLines
    : fallbackLines(data.text)
  )
    .filter((line) => line.text)
    .sort((left, right) => left.y0 - right.y0);
  if (!lines.length) return [];

  const heights = lines.map((line) => Math.max(1, line.y1 - line.y0));
  const medianHeight = heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)];
  const entries = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    entries.push({
      y: paragraph[0].y0,
      markdown: escapeMarkdown(joinLines(paragraph)),
    });
    paragraph = [];
  };
  for (const line of lines) {
    const level = headingLevel(line.text);
    const previous = paragraph.at(-1);
    if (options.extractEquations !== false && equationText(line.text)) {
      flushParagraph();
      entries.push({ y: line.y0, markdown: `$$\n${line.text}\n$$` });
      continue;
    }
    if (level) {
      flushParagraph();
      entries.push({ y: line.y0, markdown: `${"#".repeat(level)} ${escapeMarkdown(line.text)}` });
      continue;
    }
    if (previous && line.y0 - previous.y1 > medianHeight * 0.85)
      flushParagraph();
    paragraph.push(line);
  }
  flushParagraph();
  return entries;
}
