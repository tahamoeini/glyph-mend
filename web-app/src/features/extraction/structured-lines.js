function rect(value) {
  if (Array.isArray(value) && value.length >= 4)
    return value.slice(0, 4).map(Number);
  if (!value || typeof value !== "object") return null;
  if ([value.x, value.y, value.w, value.h].every(Number.isFinite))
    return [value.x, value.y, value.x + value.w, value.y + value.h];
  if ([value.x0, value.y0, value.x1, value.y1].every(Number.isFinite))
    return [value.x0, value.y0, value.x1, value.y1];
  return null;
}

function lineBox(line) {
  return rect(line?.bbox) || rect(line?.beginArgs?.[0]);
}

function charValue(value) {
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value?.value ?? "");
}

function lineValue(line) {
  if (typeof line?.text === "string") return line.text;
  return (line?.chars || []).map(charValue).join("");
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function lineSize(line) {
  const charSizes = (line?.chars || [])
    .map((value) => Number(Array.isArray(value) ? value[3] : value?.size))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (charSizes.length) return median(charSizes);
  const declared = Number(line?.size ?? line?.font?.size ?? line?.font);
  if (Number.isFinite(declared) && declared > 0) return declared;
  const box = lineBox(line);
  return box ? Math.max(6, box[3] - box[1]) : 10;
}

function verticalOverlap(a, b) {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const smaller = Math.min(a[3] - a[1], b[3] - b[1]);
  return smaller > 0 ? Math.max(0, overlap) / smaller : 0;
}

function horizontalGap(a, b) {
  return Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
}

function sameVisualLine(left, right) {
  const a = lineBox(left);
  const b = lineBox(right);
  if (!a || !b || b[0] + Math.max(2, lineSize(right) * 0.45) < a[0])
    return false;

  const size = Math.max(6, Math.min(lineSize(left), lineSize(right)));
  const gap = horizontalGap(a, b);
  const allowedGap = Math.max(3, size * 0.85);
  const baselineGap = Math.abs(a[3] - b[3]);
  return (
    (verticalOverlap(a, b) >= 0.2 && gap <= allowedGap) ||
    (baselineGap <= size * 0.42 && gap <= allowedGap)
  );
}

function unionRect(left, right) {
  const a = lineBox(left) || rect(left?.bbox) || [0, 0, 0, 0];
  const b = lineBox(right) || rect(right?.bbox) || [0, 0, 0, 0];
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function lineSizes(line) {
  const declared = (line?.sizes || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (declared.length) return declared;
  const chars = (line?.chars || [])
    .map((value) => Number(Array.isArray(value) ? value[3] : value?.size))
    .filter((value) => Number.isFinite(value) && value > 0);
  return chars.length ? chars : [lineSize(line)];
}

function appendLineText(left, right, separatorMode = "auto") {
  const leftText = lineValue(left);
  const rightText = lineValue(right);
  if (!leftText) return rightText;
  if (!rightText) return leftText;
  const gap = horizontalGap(lineBox(left) || [0, 0, 0, 0], lineBox(right) || [0, 0, 0, 0]);
  const separator =
    separatorMode === "space"
      ? " "
      : /\s$/u.test(leftText) || /^\s/u.test(rightText) || gap <= 1
        ? ""
        : " ";
  return `${leftText}${separator}${rightText}`;
}

function mergeLineRecords(left, right, separatorMode = "auto") {
  const bbox = unionRect(left, right);
  const chars = [...(left?.chars || []), ...(right?.chars || [])];
  const sizes = [...lineSizes(left), ...lineSizes(right)];
  return {
    ...left,
    bbox,
    beginArgs: [bbox],
    text: appendLineText(left, right, separatorMode),
    chars,
    sizes,
    size: median(sizes),
    font: left?.font ?? right?.font,
  };
}

function blockText(block) {
  return (block?.lines || [])
    .map(lineValue)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function blockBox(block) {
  return rect(block?.bbox) || null;
}

function overlapRatio(left, right) {
  const a = blockBox(left);
  const b = blockBox(right);
  if (!a || !b) return 0;
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const height = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const smaller = Math.min(
    (a[2] - a[0]) * (a[3] - a[1]),
    (b[2] - b[0]) * (b[3] - b[1]),
  );
  return smaller > 0 ? intersection / smaller : 0;
}

function rebuildBlock(block, lines) {
  const boxes = [blockBox(block), ...lines.map(lineBox)].filter(Boolean);
  const bbox = boxes.length
    ? [
        Math.min(...boxes.map((box) => box[0])),
        Math.min(...boxes.map((box) => box[1])),
        Math.max(...boxes.map((box) => box[2])),
        Math.max(...boxes.map((box) => box[3])),
      ]
    : block?.bbox;
  const sizes = lines.flatMap(lineSizes);
  return {
    ...block,
    bbox,
    lines,
    sizes,
    maxSize: Math.max(...sizes, 10),
    size: median(sizes),
  };
}

function mergeBlocks(left, right) {
  return rebuildBlock(
    { ...left, bbox: unionRect(left, right) },
    coalesceStructuredLines([...(left.lines || []), ...(right.lines || [])]),
  );
}

function blocksShareLine(left, right) {
  return (left?.lines || []).some((leftLine) =>
    (right?.lines || []).some((rightLine) => sameVisualLine(leftLine, rightLine)),
  );
}

export function coalesceStructuredLines(lines = []) {
  const result = [];
  for (const source of lines) {
    if (!lineValue(source).trim()) continue;
    const line = { ...source, bbox: lineBox(source) || source?.bbox };
    const previous = result.at(-1);
    if (previous && sameVisualLine(previous, line))
      result[result.length - 1] = mergeLineRecords(previous, line);
    else result.push(line);
  }
  return result;
}

export function mergeAdjacentStructuredLines(
  lines = [],
  shouldMerge = () => false,
  separatorMode = "auto",
) {
  const result = [];
  for (const line of lines) {
    const previous = result.at(-1);
    if (previous && shouldMerge(previous, line))
      result[result.length - 1] = mergeLineRecords(
        previous,
        line,
        separatorMode,
      );
    else result.push(line);
  }
  return result;
}

export function dedupeStructuredBlocks(blocks = []) {
  const result = [];
  const seen = new Map();
  for (const source of blocks) {
    const block = rebuildBlock(source, coalesceStructuredLines(source?.lines || []));
    const key = blockText(block);
    const duplicate = key && seen.get(key)?.some((existing) => overlapRatio(existing, block) >= 0.94);
    if (duplicate) continue;
    result.push(block);
    if (key) seen.set(key, [...(seen.get(key) || []), block]);
  }
  return result;
}

export function coalesceStructuredBlocks(blocks = []) {
  const result = [];
  for (const source of dedupeStructuredBlocks(blocks)) {
    const block = rebuildBlock(source, coalesceStructuredLines(source.lines || []));
    const previous = result.at(-1);
    if (previous && blocksShareLine(previous, block))
      result[result.length - 1] = mergeBlocks(previous, block);
    else result.push(block);
  }
  return result;
}

export function structuredLineText(line) {
  return lineValue(line).replace(/\s+/g, " ").trim();
}
