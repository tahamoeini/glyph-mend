const PAGE = /^\s*<!--\s*page:\s*(\d+)\s*-->\s*$/;
const STRUCTURAL =
  /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|\$\$|\[VISUAL_)/;

export function normalizeText(value = "") {
  return value
    .normalize("NFC")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u00ad/g, "")
    .replace(
      /[ﬀﬁﬂﬃﬄ]/g,
      (c) => ({ ﬀ: "ff", ﬁ: "fi", ﬂ: "fl", ﬃ: "ffi", ﬄ: "ffl" })[c],
    )
    .replace(/(?<=[A-Za-z0-9])‚(?=\s|[A-Za-z0-9(])/g, ",")
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
    .replace(/^\s*[ivxlcdm\d]+\s+/i, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutTrailing = value.replace(/\s+(?:\d{1,5}|[ivxlcdm]{1,10})$/i, "");
  if (
    withoutTrailing === withoutTrailing.toUpperCase() &&
    /[A-Z]/.test(withoutTrailing)
  )
    value = withoutTrailing;
  return value.toLowerCase();
}

export function removeRunningMatter(pages) {
  const counts = new Map();
  pages.forEach((page) => {
    const lines = page.text.split("\n").filter(Boolean);
    const edge = [...lines.slice(0, 3), ...lines.slice(-3)];
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
  return pages.map((page) => {
    const lines = page.text.split("\n");
    return {
      ...page,
      text: lines
        .filter((line, i) => {
          if (i > 2 && i < lines.length - 3) return true;
          const plain = line.trim();
          return (
            !/^\s*(?:\d{1,5}|[ivxlcdm]{1,10})\s*$/i.test(plain) &&
            !repeated.has(signature(line))
          );
        })
        .join("\n")
        .trim(),
    };
  });
}

export function headingFor(line, fontSize, bodySize) {
  const value = line.trim();
  if (!value || value.length > 140 || /[.!?;:]$/.test(value)) return null;
  const numbered = /^(\d+(?:\.\d+){0,5})\.?\s+\S/.exec(value);
  if (numbered) return Math.min(6, numbered[1].split(".").length);
  if (fontSize >= bodySize * 1.45 && value.split(/\s+/).length <= 14) return 1;
  if (fontSize >= bodySize * 1.22 && value.split(/\s+/).length <= 16) return 2;
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
  if (options.removeHeaders) pages = removeRunningMatter(pages);
  let markdown = pages
    .map(
      (p) =>
        `${options.preserveMarkers ? `<!-- page: ${p.page} -->\n\n` : ""}${p.text}`,
    )
    .join("\n\n");
  if (options.joinParagraphs) markdown = joinPageParagraphs(markdown);
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
    visuals: (markdown.match(/\[VISUAL_PLACEHOLDER/g) || []).length,
  };
}
