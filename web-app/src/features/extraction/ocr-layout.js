import { normalizeText } from "./cleanup.js";
import { inlineMathMarkdown } from "./math-markdown.js";

function lineText(line) {
  return normalizeText(line?.text || "").replace(/\n+/g, " ").trim();
}

function lineBox(line) {
  const box = line?.bbox || {};
  return {
    x0: Number(box.x0 ?? box.left ?? 0),
    y0: Number(box.y0 ?? box.top ?? 0),
    x1: Number(box.x1 ?? box.right ?? box.x0 ?? box.left ?? 0),
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
    x0: 0,
    y0: index * 2,
    x1: 0,
    y1: index * 2 + 1,
    confidence: null,
  }));
}

function upperRatio(text) {
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  return (
    letters.filter((character) => character === character.toUpperCase()).length /
    Math.max(1, letters.length)
  );
}

function isShortAllCaps(text) {
  return /^(?:[A-Z]\.){2,}$|^[A-Z]{1,3}\.?$/.test(text);
}

function hasShortHeadingEvidence(line, lines, medianHeight, minX, maxX) {
  if (!isShortAllCaps(line.text) || !(line.x1 > line.x0 && line.y1 > line.y0))
    return false;

  const index = lines.indexOf(line);
  const previous = index > 0 ? lines[index - 1] : null;
  const next = index >= 0 && index < lines.length - 1 ? lines[index + 1] : null;
  const lineHeight = Math.max(1, line.y1 - line.y0);
  const pageWidth = Math.max(1, maxX - minX);
  const lineWidth = Math.max(1, line.x1 - line.x0);
  const pageCenter = (minX + maxX) / 2;
  const lineCenter = (line.x0 + line.x1) / 2;
  const centered = Math.abs(lineCenter - pageCenter) <= pageWidth * 0.16;
  const compact = lineWidth <= pageWidth * 0.45;
  const enlarged = lineHeight >= medianHeight * 1.18;
  const gapBefore = previous ? line.y0 - previous.y1 : Number.POSITIVE_INFINITY;
  const gapAfter = next ? next.y0 - line.y1 : Number.POSITIVE_INFINITY;
  const isolated =
    gapBefore >= medianHeight * 0.9 && gapAfter >= medianHeight * 0.9;

  // Short all-caps tokens are ambiguous in OCR: "RM." can be a cropped body
  // fragment while "API" can be a real heading. Promote them only when the OCR
  // supplied real geometry and that geometry provides heading evidence.
  return enlarged || (centered && compact && isolated);
}

function headingLevel(text, allowShort = false) {
  const numbered = /^(\d+(?:\.\d+){0,5})\.?\s+(.+)$/.exec(text);
  if (numbered) {
    const number = numbered[1];
    const title = numbered[2].trim();
    const titleWithoutPage = title.replace(/\s+\d{1,4}\s*$/, "").trim();
    const words = titleWithoutPage.split(/\s+/);
    if (
      !titleWithoutPage ||
      titleWithoutPage.length > 130 ||
      words.length > 16 ||
      /[.!?;:]$/.test(titleWithoutPage) ||
      /^[^:]{1,55}:\s+\S/.test(titleWithoutPage)
    )
      return null;

    // A single leading integer is also normal numbered-list syntax. Treat it as
    // a heading only when the title itself carries strong chapter-title evidence.
    // A bare number introduces both lists and headings. Do not promote a sentence-like
    // list item merely because OCR put it on its own line.
    if (!number.includes(".") && upperRatio(titleWithoutPage) < 0.72) return null;
    if (
      /[.!?;:]$/.test(titleWithoutPage) ||
      /\b(?:is|are|was|were|has|have|will|should|must|include)\b/i.test(
        titleWithoutPage,
      )
    )
      return null;
    return Math.min(6, number.split(".").length);
  }
  if (/^(?:chapter|appendix)\s+(?:\d+|[ivxlcdm]+)\b/i.test(text)) return 1;
  if (/^(?:contents|list of (?:figures|tables)|preface|references|index)$/i.test(text))
    return 1;
  // Preserve the conservative 4f86 behavior for text-only OCR. Very short
  // all-caps fragments become headings only when real OCR geometry supports it.
  if (isShortAllCaps(text)) return allowShort ? 1 : null;
  return text.length <= 90 && text.split(/\s+/).length <= 14 && upperRatio(text) > 0.82
    ? 1
    : null;
}

function joinLines(lines) {
  return normalizeText(
    lines.reduce((text, line) => {
      const value = line.text;
      if (!text) return value;
      // A line-ending hyphen followed by a lowercase continuation is OCR/layout
      // wrapping, not a semantic hyphen. Keep true compounds such as "X-ray".
      if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(value))
        return `${text.slice(0, -1)}${value}`;
      return `${text} ${value}`;
    }, ""),
  );
}

function escapeOcr(text, escapeMarkdown) {
  // OCR is not a mathematical parser. In particular, isolated dollar signs can
  // otherwise turn OCR noise into Markdown display-math delimiters.
  return escapeMarkdown(text).replace(/\$/g, "\\$");
}

function looksLikeContents(lines) {
  const entries = lines.filter((line) =>
    /^\d+(?:\.\d+){0,5}\.?\s+.+\s+\d{1,4}$/.test(line.text),
  ).length;
  return lines.some((line) => /^contents$/i.test(line.text)) && entries >= 4;
}

function isExcluded(line, ranges) {
  return (ranges || []).some((range) => {
    const overlaps = line.y0 < range.y1 && line.y1 > range.y0;
    if (!overlaps) return false;
    if (
      range.keepCaption &&
      /^(?:figure|fig\.|table)\s+\d+(?:\.\d+)*(?:[.:]|\b)/i.test(line.text)
    )
      return false;
    return true;
  });
}

export function ocrLines(data) {
  const structuredLines = flattenLines(data?.blocks)
    .map((line) => ({
      text: lineText(line),
      ...lineBox(line),
      confidence: Number.isFinite(Number(line?.confidence))
        ? Number(line.confidence)
        : null,
    }))
    .filter((line) => line.text);
  return (structuredLines.length ? structuredLines : fallbackLines(data?.text))
    .filter((line) => line.text)
    .sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);
}

export function ocrMarkdownEntries(data, escapeMarkdown, options = {}) {
  const allLines = ocrLines(data);
  if (!allLines.length) return [];
  const lines = allLines.filter((line) => !isExcluded(line, options.excludeRanges));
  if (!lines.length) return [];

  const heights = allLines.map((line) => Math.max(1, line.y1 - line.y0));
  const medianHeight = [...heights].sort((a, b) => a - b)[
    Math.floor(heights.length / 2)
  ];
  const minX = Math.min(...allLines.map((line) => line.x0));
  const maxX = Math.max(...allLines.map((line) => line.x1));
  const measuredBottom = Math.max(...allLines.map((line) => line.y1), 1);
  const measuredTop = Math.min(...allLines.map((line) => line.y0), 0);
  const suppliedHeight = Number(options.rawHeight);
  const rawTop = Number.isFinite(suppliedHeight) && suppliedHeight > 0 ? 0 : measuredTop;
  const rawBottom = Number.isFinite(suppliedHeight) && suppliedHeight > 0
    ? suppliedHeight
    : measuredBottom;
  const rawHeight = Math.max(1, rawBottom - rawTop);
  const pageBounds = options.pageBounds;
  const mapY = (value) => {
    if (!Array.isArray(pageBounds)) return value;
    return (
      pageBounds[1] +
      ((value - rawTop) / rawHeight) * (pageBounds[3] - pageBounds[1])
    );
  };
  const pageWidth = Math.max(1, maxX - minX);
  const tocLike = looksLikeContents(allLines);
  const equationRanges = options.equationRanges || [];
  const entries = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = joinLines(paragraph);
    const withMath = inlineMathMarkdown(text);
    entries.push({
      y: mapY(paragraph[0].y0),
      markdown:
        withMath === text
          ? escapeOcr(text, escapeMarkdown)
          : escapeMarkdown(withMath),
    });
    paragraph = [];
  };

  for (const line of lines) {
    const equation = equationRanges.find(
      (range) => line.y0 >= range.y0 && line.y1 <= range.y1,
    );
    if (equation) {
      flushParagraph();
      if (equation.emit !== false && !equation.emitted) {
        equation.emitted = true;
        entries.push({
          y: mapY(equation.y0),
          markdown: `$$\n${equation.latex}\n$$`,
        });
      }
      continue;
    }
    const allowShortHeading = hasShortHeadingEvidence(
      line,
      allLines,
      medianHeight,
      minX,
      maxX,
    );
    const level = headingLevel(line.text, allowShortHeading);
    const previous = paragraph.at(-1);
    const numberedList = /^\d+[.)]\s+\S/.test(line.text) && !level;
    const suppressTocHeading =
      tocLike && /^\d+(?:\.\d+){0,5}\.?\s+.+\s+\d{1,4}$/.test(line.text);

    if (level && !suppressTocHeading) {
      flushParagraph();
      entries.push({
        y: mapY(line.y0),
        markdown: `${"#".repeat(level)} ${escapeOcr(line.text, escapeMarkdown)}`,
      });
      continue;
    }

    if (numberedList && paragraph.length) flushParagraph();

    const first = paragraph[0];
    const columnShift =
      first && Math.abs(line.x0 - first.x0) > Math.max(medianHeight * 3, pageWidth * 0.16);
    if (
      previous &&
      (line.y0 - previous.y1 > medianHeight * 0.9 || columnShift)
    )
      flushParagraph();

    paragraph.push(line);
  }
  flushParagraph();
  return entries;
}
