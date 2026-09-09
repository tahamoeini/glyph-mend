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

function signature(line) {
  let value = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:[ivxlcdm]{1,10}|\d{1,5})\s+/i, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const trailing = /^(.*?)\s+(?:\d{1,5}|[ivxlcdm]{1,10})$/i.exec(value);
  if (trailing && trailing[1].length >= 10) value = trailing[1];
  return value.toLowerCase();
}

export function removeRunningMatter(
  pages,
  { headers = true, footers = true } = {},
) {
  const counts = new Map();
  pages.forEach((page) => {
    const lines = page.text.split("\n").filter(Boolean);
    const edge = page.edges
      ? [
          ...(headers ? page.edges.headers : []),
          ...(footers ? page.edges.footers : []),
        ]
      : [
          ...(headers ? lines.slice(0, 3) : []),
          ...(footers ? lines.slice(-3) : []),
        ];
    new Set(
      edge.map(signature).filter((s) => s.length >= 3 && s.length <= 120),
    ).forEach((s) => counts.set(s, (counts.get(s) || 0) + 1));
  });
  const repeated = new Set(
    [...counts]
      .filter(
        ([, n]) =>
          n >= Math.min(3, Math.max(2, Math.ceil(pages.length * 0.35))),
      )
      .map(([s]) => s),
  );
  const preservedHeadings = new Set();
  return pages.map((page) => {
    const lines = page.text.split("\n");
    return {
      ...page,
      text: lines
        .filter((line) => {
          const plain = line.trim();
          if (/^\s*(?:\d{1,5}|[ivxlcdm]{1,10})\s*$/i.test(plain)) return false;
          const key = signature(line);
          if (!repeated.has(key)) return true;
          if (/^#{1,6}\s/.test(plain) && !preservedHeadings.has(key)) {
            preservedHeadings.add(key);
            return true;
          }
          return false;
        })
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    };
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
  const numbered = /^(\d+(?:\.\d+){0,5})\.?\s+\S/.exec(value);
  if (numbered) return Math.min(6, numbered[1].split(".").length);
  if (/^chapter\s+(?:\d+|[ivxlcdm]+)\b/i.test(value)) return 1;
  const letters = [...value].filter((char) => /\p{L}/u.test(char));
  const uppercase =
    letters.filter((char) => char === char.toUpperCase()).length /
    Math.max(1, letters.length);
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
  const damagedHyphens = (
    markdown.match(/\p{L}{2,}-\s*(?:<!--\s*page:[^>]+-->\s*)?\p{Ll}{2,}/gu) ||
    []
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
  const technicalCues = (
    markdown.match(
      /\b(?:equation|theorem|proof|function|probability|optimization|constraint|formula|figure|table)\b/gi,
    ) || []
  ).length;
  if (
    metrics.equations === 0 &&
    metrics.sourceVisuals === 0 &&
    metrics.words > 10000 &&
    technicalCues > 20
  )
    issues.push({
      code: "NO_TECHNICAL_OBJECTS",
      severity: "warning",
      count: 1,
      message:
        "A technical document contains no equations or preserved source visuals; inspect the source/output comparison.",
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
        "These scanned pages use OCR. Their source-page renditions are retained for layout fidelity; review complex tables and formulas.",
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
  const failedPages = warnings
    .filter((warning) => warning?.type === "page-error")
    .map((warning) => warning.page)
    .filter(Number.isInteger);
  if (failedPages.length)
    issues.push({
      code: "PAGE_EXTRACTION_ERRORS",
      severity: "error",
      count: failedPages.length,
      pages: [...new Set(failedPages)].slice(0, 50),
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
