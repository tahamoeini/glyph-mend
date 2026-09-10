const PAGE = /^\s*<!--\s*page:\s*(\d+)\s*-->\s*$/;
const STRUCTURAL =
  /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|\$\$|\[(?:VISUAL_|SOURCE_))/;

export function normalizeText(value = "") {
  return value
    .normalize("NFC")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u00ad/g, "")
    .replace(
      /[ﬀﬁﬂﬃﬄ]/g,
      (c) => ({ ﬀ: "ff", ﬁ: "fi", ﬂ: "fl", ﬃ: "ffi", ﬄ: "ffl" })[c],
    )
    .replace(/(?<=[\p{L}\p{N}\])}*_])‚(?=\s|[\p{L}\p{N}(\["“])/gu, ",")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function parsePageRange(input, total) {
  if (!input?.trim()) throw new Error("Enter a page range.");
  const pages = new Set();
  for (const token of input.split(",")) {
    const part = token.trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid page range: ${part}`);
    const start = Number(match[1]);
    const end = Number(match[2] || start);
    if (start < 1 || end < start || end > total)
      throw new Error(`Page range must be between 1 and ${total}.`);
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function plainMarkdownLine(line) {
  return String(line || "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function signature(line) {
  let value = plainMarkdownLine(line)
    .replace(/^\s*(?:page\s*)?(?:[ivxlcdm]{1,10}|\d{1,5})(?:\s*[·|:—–-]\s*|\s+)/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const trailing = /^(.*?)\s+(?:page\s*)?(?:\d{1,5}|[ivxlcdm]{1,10})$/i.exec(value);
  if (trailing && trailing[1].length >= 3) value = trailing[1].trim();
  return value.toLowerCase();
}

function selectedEdges(page, headers, footers) {
  const lines = String(page.text || "").split("\n").filter(Boolean);
  if (page.edges) {
    return {
      headers: headers ? (page.edges.headers || []).filter(Boolean) : [],
      footers: footers ? (page.edges.footers || []).filter(Boolean) : [],
    };
  }
  const depth = lines.length >= 8 ? 2 : 1;
  return {
    headers: headers ? lines.slice(0, depth) : [],
    footers: footers ? lines.slice(-depth) : [],
  };
}

function repeatedEdgeSignatures(pages, headers, footers) {
  const counts = new Map();
  for (const page of pages) {
    const edges = selectedEdges(page, headers, footers);
    const keys = new Set(
      [...edges.headers, ...edges.footers]
        .map(signature)
        .filter((value) => value.length >= 3 && value.length <= 160),
    );
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const threshold =
    pages.length <= 2
      ? 2
      : Math.min(3, Math.max(2, Math.ceil(pages.length * 0.25)));
  return new Set(
    [...counts].filter(([, count]) => count >= threshold).map(([key]) => key),
  );
}

function normalizeEdgeToken(token) {
  const value = String(token || "")
    .replace(/^[_*`]+|[_*`]+$/g, "")
    .replace(/\\([.!])/g, "$1")
    .toLowerCase();
  return /^(?:page)?\d{1,5}$/.test(value) || /^[ivxlcdm]{1,10}$/i.test(value)
    ? "<page>"
    : value;
}

function edgeLine(page, fromStart) {
  const lines = String(page.text || "").split("\n").filter((line) => line.trim());
  if (!lines.length) return "";
  return plainMarkdownLine(fromStart ? lines[0] : lines.at(-1));
}

function commonEdgeTokens(pages, fromStart) {
  if (pages.length < 2) return null;
  const tokenRows = pages
    .map((page) => edgeLine(page, fromStart).split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length >= 2);
  if (tokenRows.length !== pages.length) return null;
  const oriented = fromStart
    ? tokenRows
    : tokenRows.map((tokens) => [...tokens].reverse());
  const max = Math.min(12, ...oriented.map((tokens) => tokens.length));
  let count = 0;
  for (; count < max; count += 1) {
    const expected = normalizeEdgeToken(oriented[0][count]);
    if (!oriented.every((tokens) => normalizeEdgeToken(tokens[count]) === expected))
      break;
  }
  if (count < 2) return null;
  const sample = (fromStart
    ? tokenRows[0].slice(0, count)
    : tokenRows[0].slice(-count)
  ).join(" ");
  if (sample.length < 6 || sample.length > 160) return null;
  if (/[.!?]$/.test(sample) && count > 5) return null;
  return { count, sample };
}

function stripCommonEdgeTokens(text, fragment, fromStart) {
  if (!fragment) return text;
  const lines = String(text || "").split("\n");
  const indexes = lines
    .map((line, index) => (line.trim() ? index : -1))
    .filter((index) => index >= 0);
  if (!indexes.length) return text;
  const index = fromStart ? indexes[0] : indexes.at(-1);
  const line = lines[index];
  const prefixMatch = /^(\s*(?:#{1,6}\s+|>\s?)?)(.*)$/.exec(line);
  const prefix = prefixMatch?.[1] || "";
  const body = prefixMatch?.[2] || line;
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < fragment.count) return text;
  const candidate = (fromStart
    ? tokens.slice(0, fragment.count)
    : tokens.slice(-fragment.count)
  ).map(normalizeEdgeToken);
  const expected = fragment.sample.split(/\s+/).map(normalizeEdgeToken);
  if (candidate.length !== expected.length || candidate.some((value, i) => value !== expected[i]))
    return text;
  const remaining = fromStart
    ? tokens.slice(fragment.count)
    : tokens.slice(0, -fragment.count);
  lines[index] = remaining.length ? `${prefix}${remaining.join(" ")}` : "";
  return lines.join("\n");
}

function isPageLabel(value) {
  return /^\s*(?:page\s*)?(?:\d{1,5}|[ivxlcdm]{1,10})\s*$/i.test(
    plainMarkdownLine(value),
  );
}

function stripEdgeFragment(line, candidates, repeated, fromStart) {
  let result = line;
  for (const candidate of candidates) {
    if (isPageLabel(candidate)) continue;
    const key = signature(candidate);
    if (!repeated.has(key)) continue;
    const plainCandidate = plainMarkdownLine(candidate);
    if (!plainCandidate) continue;
    const escaped = plainCandidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = fromStart
      ? new RegExp(
          `^(\\s*(?:#{1,6}\\s+|>\\s?)?)${escaped}(?:\\s*[·|:—–-]\\s*|\\s+)?`,
          "i",
        )
      : new RegExp(
          `(?:\\s*[·|:—–-]\\s*|\\s+)?${escaped}\\s*$`,
          "i",
        );
    if (!pattern.test(result)) continue;
    result = result.replace(pattern, fromStart ? "$1" : "").trimEnd();
    if (/^\s*(?:#{1,6}|>)?\s*$/.test(result)) return "";
  }
  return result;
}

export function removeRunningMatter(
  pages,
  { headers = true, footers = true } = {},
) {
  const repeated = repeatedEdgeSignatures(pages, headers, footers);
  const commonHeader = headers ? commonEdgeTokens(pages, true) : null;
  const commonFooter = footers ? commonEdgeTokens(pages, false) : null;
  return pages.map((page) => {
    const edges = selectedEdges(page, headers, footers);
    const pageHeaderKeys = new Set(edges.headers.map(signature));
    const pageFooterKeys = new Set(edges.footers.map(signature));
    let source = String(page.text || "");
    if (commonHeader) source = stripCommonEdgeTokens(source, commonHeader, true);
    if (commonFooter) source = stripCommonEdgeTokens(source, commonFooter, false);
    const lines = source.split("\n");
    const cleaned = lines
      .map((line) => {
        let value = line;
        if (headers)
          value = stripEdgeFragment(value, edges.headers, repeated, true);
        if (footers)
          value = stripEdgeFragment(value, edges.footers, repeated, false);
        return value;
      })
      .filter((line) => {
        const key = signature(line);
        if (!key && !plainMarkdownLine(line)) return false;
        const headerMatch =
          headers && pageHeaderKeys.has(key) && repeated.has(key);
        const footerMatch =
          footers && pageFooterKeys.has(key) && repeated.has(key);
        if (headerMatch || footerMatch) return false;
        if (isPageLabel(line)) {
          const raw = plainMarkdownLine(line);
          const headerLabel =
            headers &&
            edges.headers.some((edge) => plainMarkdownLine(edge) === raw);
          const footerLabel =
            footers &&
            edges.footers.some((edge) => plainMarkdownLine(edge) === raw);
          if (headerLabel || footerLabel) return false;
        }
        return true;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { ...page, text: cleaned };
  });
}

export function headingFor(line, fontSize, bodySize) {
  const value = line.trim();
  const words = value.split(/\s+/);
  if (
    !value ||
    value.length > 140 ||
    words.length > 16 ||
    /[.!?,;:]$/.test(value) ||
    /^\d{4}\b/.test(value)
  )
    return null;
  const letters = [...value].filter((char) => /\p{L}/u.test(char));
  const uppercase =
    letters.filter((char) => char === char.toUpperCase()).length /
    Math.max(1, letters.length);
  const numbered = /^(\d+(?:\.\d+){0,5})\.?\s+\S/.exec(value);
  if (numbered) {
    const title = value.slice(numbered[1].length).replace(/^\.\s*/, "").trim();
    const level = numbered[1].split(".").length;
    const numberedTitle =
      /^[A-Z]/.test(title) &&
      !/[.!?;:]$/.test(title) &&
      !/\b(?:is|are|was|were|has|have|will|should|must|include)\b/i.test(
        title,
      );
    if (
      numberedTitle &&
      (level > 1 || fontSize >= bodySize * 1.12 || uppercase > 0.72)
    )
      return Math.min(6, level);
    return null;
  }
  if (/^chapter\s+(?:\d+|[ivxlcdm]+)\b/i.test(value)) return 1;
  if (
    /^(?:contents|table of contents|list of (?:figures|tables)|preface|acknowledg(?:e)?ments|references|bibliography|index)$/i.test(
      value,
    )
  )
    return fontSize >= bodySize * 1.05 || uppercase > 0.72 ? 1 : null;
  if (/^appendix(?:\s+[A-Z0-9]+)?(?:\s+.+)?$/i.test(value))
    return fontSize >= bodySize * 1.05 || uppercase > 0.72 ? 1 : null;
  const titleLike =
    uppercase > 0.72 ||
    words.every((word) =>
      /^(?:[A-Z][\p{L}'’&-]*|(?:and|of|the|to|in|for|a|an))$/u.test(word),
    );
  if (!titleLike) return null;
  if (fontSize >= bodySize * 1.45 && words.length <= 14) return 1;
  if (fontSize >= bodySize * 1.22 && words.length <= 16) return 2;
  return null;
}

export function normalizeHeadingHierarchy(markdown) {
  let previousLevel = null;
  let previousText = "";
  const result = [];
  for (const line of String(markdown || "").split("\n")) {
    const match = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) {
      result.push(line);
      continue;
    }
    const text = match[2].replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (key === previousText) continue;
    let level = match[1].length;
    const numbered = /^(\d+(?:\.\d+){0,5})\.?\s+\S/.exec(text);
    if (numbered) level = Math.min(6, numbered[1].split(".").length);
    else if (/^chapter\s+(?:\d+|[ivxlcdm]+)\b/i.test(text)) level = 1;
    else if (previousLevel && level > previousLevel + 1)
      level = previousLevel + 1;
    result.push(`${"#".repeat(level)} ${text}`);
    previousLevel = level;
    previousText = key;
  }
  return result.join("\n");
}

export function joinPageParagraphs(markdown) {
  return markdown.replace(
    /([^\n]+)\n\n(<!-- page: \d+ -->)\n\n([^\n]+)/g,
    (all, left, marker, right) => {
      const a = left.trim(),
        b = right.trim();
      if (
        STRUCTURAL.test(a) ||
        STRUCTURAL.test(b) ||
        a.length < 35 ||
        /[.!?:;]$/.test(a) ||
        !/^\p{Ll}/u.test(b)
      )
        return all;
      if (/-$/.test(a) && /^[a-z]/.test(b))
        return `${a.slice(0, -1)}${marker}${b}`;
      return `${a} ${marker} ${b}`;
    },
  );
}

export function cleanupDocument(rawPages, options = {}) {
  let pages = rawPages.map((p) => ({ ...p, text: normalizeText(p.text) }));
  if (options.removeHeaders || options.removeFooters)
    pages = removeRunningMatter(pages, {
      headers: options.removeHeaders,
      footers: options.removeFooters,
    });
  let markdown = pages
    .map(
      (p) =>
        `${options.preserveMarkers ? `<!-- page: ${p.page} -->\n\n` : ""}${p.text}`,
    )
    .join("\n\n");
  if (options.detectHeadings !== false)
    markdown = normalizeHeadingHierarchy(markdown);
  if (options.joinParagraphs) markdown = joinPageParagraphs(markdown);
  if (options.extractEquations === false)
    markdown = markdown.replace(/^\$\$\s*$[\s\S]*?^\$\$\s*$/gm, "");
  if (options.taskLists)
    markdown = markdown
      .replace(/^\s*[☐□]\s+/gm, "- [ ] ")
      .replace(/^\s*[☑✓✔]\s+/gm, "- [x] ");
  if (options.flows === false)
    markdown = markdown.replace(/^```mermaid\s*$[\s\S]*?^```\s*$/gm, "");
  if (options.placeholders === false)
    markdown = markdown.replace(/^\[VISUAL_PLACEHOLDER[^\n]*\]\s*$/gm, "");
  return normalizeText(markdown);
}

export function plainText(markdown) {
  return markdown
    .replace(/<!--.*?-->/gs, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/gm, "")
    .replace(/\|/g, "\t")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function documentMetrics(markdown) {
  return {
    words: (plainText(markdown).match(/[\p{L}\p{N}]+/gu) || []).length,
    headings: (markdown.match(/^#{1,6}\s/gm) || []).length,
    tables: (markdown.match(/^\|.*\|\n\|[-: |]+\|/gm) || []).length,
    equations: Math.floor((markdown.match(/^\$\$/gm) || []).length / 2),
    visuals: (markdown.match(/\[(?:VISUAL_PLACEHOLDER|SOURCE_VISUAL)/g) || [])
      .length,
    sourceVisuals: (markdown.match(/\[SOURCE_VISUAL/g) || []).length,
  };
}

export function qualityAudit(pages, markdown, warnings = []) {
  const metrics = documentMetrics(markdown);
  const issues = [];
  const empty = pages
    .filter((page) => (page.quality?.characters ?? page.text?.length ?? 0) < 20)
    .map((page) => page.page);
  const suspicious = pages
    .filter(
      (page) =>
        (page.quality?.suspiciousGaps || 0) >
        (page.quality?.preservedEquationFallbacks || 0),
    )
    .map((page) => page.page);
  const substantialTextPages = pages.filter(
    (page) =>
      !page.quality?.ocrApplied &&
      (page.quality?.characters ?? page.text?.length ?? 0) >= 250,
  );
  const collapsedStructure = substantialTextPages.filter(
    (page) => (page.quality?.textBlocks ?? Number.POSITIVE_INFINITY) <= 1,
  );
  const damagedHyphens = (
    markdown.match(
      /\p{L}{2,}-\n+(?:<!--\s*page:[^>]+-->\s*)?\p{Ll}{2,}/gu,
    ) || []
  ).length;
  const leakedRunning = (
    markdown.match(
      /^(?:#{1,6}\s+)?(?:\d+\s+)?(?:the theory and practice of revenue management|[A-Z][A-Za-z &-]+\s+\d{1,4})$/gim,
    ) || []
  ).length;
  if (empty.length)
    issues.push({
      code: "LOW_TEXT_PAGES",
      severity: "warning",
      count: empty.length,
      pages: empty.slice(0, 50),
      message: "Pages contain little or no recoverable text.",
    });
  if (suspicious.length)
    issues.push({
      code: "UNPRESERVED_GAPS",
      severity: "error",
      count: suspicious.length,
      pages: suspicious.slice(0, 50),
      message:
        "Possible equations or graphics were detected but not preserved.",
    });
  if (
    substantialTextPages.length >= 10 &&
    collapsedStructure.length / substantialTextPages.length >= 0.7 &&
    metrics.words > 1000
  )
    issues.push({
      code: "STRUCTURE_COLLAPSE",
      severity: "error",
      count: collapsedStructure.length,
      pages: collapsedStructure.slice(0, 50).map((page) => page.page),
      message:
        "Most substantial text pages collapsed to one structured block; headings, paragraphs, tables, or equations may have been flattened.",
    });
  const technicalCues = (
    markdown.match(
      /\b(?:equation|theorem|proof|function|probability|optimization|constraint|formula|figure|table)\b/gi,
    ) || []
  ).length;
  const technicalObjects =
    metrics.equations + metrics.tables + metrics.sourceVisuals;
  if (metrics.words > 10000 && technicalCues > 20 && technicalObjects === 0)
    issues.push({
      code: "NO_TECHNICAL_OBJECTS",
      severity: "warning",
      count: 1,
      message:
        "A technical document contains no equations, tables, or preserved source visuals; inspect the source/output comparison.",
    });
  else if (
    metrics.words > 10000 &&
    technicalCues > 20 &&
    technicalObjects < Math.max(2, Math.ceil(pages.length / 50))
  )
    issues.push({
      code: "LOW_TECHNICAL_OBJECTS",
      severity: "warning",
      count: technicalObjects,
      message:
        "Very few equations, tables, or source visuals were recovered for a technical document; inspect representative source pages.",
    });
  if (damagedHyphens > 20)
    issues.push({
      code: "WRAP_HYPHENS",
      severity: "warning",
      count: damagedHyphens,
      message: "Many probable line-wrap hyphens remain.",
    });
  if (leakedRunning)
    issues.push({
      code: "RUNNING_MATTER",
      severity: "warning",
      count: leakedRunning,
      message: "Probable running headers or page labels remain.",
    });
  const ocrOnly = pages.filter(
    (page) =>
      page.quality?.ocrApplied &&
      (page.quality?.textBlocks ?? 0) === 0,
  );
  if (ocrOnly.length)
    issues.push({
      code: "OCR_ONLY_PAGES",
      severity: "warning",
      count: ocrOnly.length,
      pages: ocrOnly.slice(0, 50).map((page) => page.page),
      message:
        "These pages required OCR; review complex tables, formulas, and layout against the source.",
    });
  const ocrPages = pages.filter((page) => page.quality?.ocrApplied).length;
  if (pages.length && ocrPages === pages.length)
    issues.push({
      code: "OCR_ONLY_DOCUMENT",
      severity: "warning",
      count: ocrPages,
      message:
        "Every page required OCR; review headings, tables, equations, and figures against the source.",
    });
  const failedPages = [
    ...new Set(
      warnings
        .filter((warning) => warning?.type === "page-error")
        .map((warning) => warning.page)
        .filter(Number.isInteger),
    ),
  ];
  if (failedPages.length)
    issues.push({
      code: "PAGE_EXTRACTION_ERRORS",
      severity: "error",
      count: failedPages.length,
      pages: failedPages.slice(0, 50),
      message: "One or more selected pages could not be extracted.",
    });
  return {
    status: issues.some((issue) => issue.severity === "error")
      ? "needs-review"
      : issues.length
        ? "warnings"
        : "pass",
    issues,
  };
}
