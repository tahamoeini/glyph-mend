const PAGE_MARKER = /<!--\s*page:\s*\d+\s*-->/gu;
const SOURCE_MARKER = /\[SOURCE_VISUAL\s+[^\]\n]+\]/gu;
const FENCE = /^\s*(?:```|~~~)(?:[A-Za-z0-9_-]+)?\s*$/u;

export function normalizeExportMarkdown(markdown = "", { pageBreaks = false } = {}) {
  const output = [];
  let fenced = false;
  for (const line of String(markdown).split(/\r?\n/u)) {
    if (!fenced) {
      const pageNormalized = pageBreaks
        ? line.replace(PAGE_MARKER, "\n$&\n")
        : line.replace(PAGE_MARKER, " ");
      output.push(...pageNormalized.replace(SOURCE_MARKER, "\n$&\n").split("\n"));
    } else output.push(line);
    if (FENCE.test(line.trim())) fenced = !fenced;
  }
  return output.join("\n").replace(/\n{4,}/gu, "\n\n\n");
}
