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

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function collectTextBlocks(nodes, result = []) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "text") result.push(node);
    collectTextBlocks(node.blocks, result);
    collectTextBlocks(node.children, result);
  }
  return result;
}

function lineText(line) {
  return String(line?.text || "").replace(/\s+/g, " ").trim();
}

function lineSize(line) {
  const box = rect(line?.bbox);
  return Number(line?.font?.size) || (box ? Math.max(6, box[3] - box[1]) : 10);
}

function lineBounds(lines) {
  const boxes = lines.map((line) => rect(line.bbox)).filter(Boolean);
  if (!boxes.length) return [0, 0, 1, 1];
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function titleLike(text) {
  if (!text || text.length > 140 || /[.!?,;:]$/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 16) return false;
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return false;
  const uppercase =
    letters.filter((char) => char === char.toUpperCase()).length / letters.length;
  return uppercase > 0.72;
}

function structuralLine(text, size, bodySize, font = null) {
  if (!text) return false;
  if (/^(?:figure|fig\.|table)\s+\d+(?:\.\d+)*(?:[.:]|\b)/i.test(text))
    return true;
  if (/^(?:chapter|appendix)\s+(?:\d+|[ivxlcdm]+|[a-z])\b/i.test(text))
    return true;
  if (/^(?:contents|table of contents|list of (?:figures|tables)|preface|acknowledg(?:e)?ments|references|bibliography|index)$/i.test(text))
    return true;
  if (/^\d+(?:\.\d+){1,5}\.?\s+\S/.test(text)) return true;
  const bold = /bold|semibold|demi/i.test(
    `${font?.weight || ""} ${font?.name || ""}`,
  );
  return titleLike(text) && (size >= bodySize * 1.12 || bold);
}

function normalizedJsonBlocks(data) {
  const source = collectTextBlocks(data?.blocks);
  const allLines = source.flatMap((block) => block.lines || []).filter((line) => lineText(line));
  const bodySize = median(
    allLines.map(lineSize).filter((size) => size > 4 && size < 40),
  );
  const result = [];
  for (const block of source) {
    const lines = (block.lines || []).filter((line) => lineText(line));
    let body = [];
    const flush = () => {
      if (!body.length) return;
      result.push({ bbox: lineBounds(body), lines: body });
      body = [];
    };
    for (const line of lines) {
      const text = lineText(line);
      if (structuralLine(text, lineSize(line), bodySize, line.font)) {
        flush();
        result.push({ bbox: rect(line.bbox) || rect(block.bbox), lines: [line] });
      } else {
        body.push(line);
      }
    }
    flush();
  }
  return result.filter((block) => block.lines.length);
}

function syntheticChars(line) {
  const text = lineText(line);
  const box = rect(line.bbox) || [0, 0, Math.max(1, text.length), 10];
  const size = lineSize(line);
  const width = Math.max(1, box[2] - box[0]);
  const advance = width / Math.max(1, [...text].length);
  return [...text].map((character, index) => {
    const x0 = box[0] + index * advance;
    const x1 = box[0] + (index + 1) * advance;
    return [
      character,
      [x0, box[3]],
      line.font || null,
      size,
      [x0, box[1], x1, box[1], x1, box[3], x0, box[3]],
    ];
  });
}

function replayJson(walker, blocks) {
  for (const block of blocks) {
    walker.beginTextBlock?.(block.bbox || lineBounds(block.lines));
    for (const line of block.lines) {
      const box = rect(line.bbox) || block.bbox;
      walker.beginLine?.(box);
      for (const args of syntheticChars(line)) walker.onChar?.(...args);
      walker.endLine?.();
    }
    walker.endTextBlock?.();
  }
}

function replayCaptured(walker, blocks) {
  for (const block of blocks) {
    walker.beginTextBlock?.(...block.beginArgs);
    for (const line of block.lines) {
      walker.beginLine?.(...line.beginArgs);
      for (const args of line.chars) walker.onChar?.(...args);
      walker.endLine?.();
    }
    walker.endTextBlock?.();
  }
}

export function installFinalStructuredFidelity(mupdf) {
  const prototype = mupdf?.StructuredText?.prototype;
  if (!prototype?.walk || prototype.__glyphMendFinalStructuredFidelity) return mupdf;
  const original = prototype.walk;

  prototype.walk = function finalizedWalk(walker = {}) {
    if (typeof walker.beginTextBlock !== "function") return original.call(this, walker);

    let data = null;
    try {
      data = JSON.parse(this.asJSON?.() || "null");
    } catch {
      data = null;
    }
    const jsonBlocks = normalizedJsonBlocks(data);
    const jsonLineCount = jsonBlocks.reduce((count, block) => count + block.lines.length, 0);

    const captured = [];
    const images = [];
    let block = null;
    let line = null;
    const proxy = {
      ...walker,
      beginTextBlock(...args) {
        block = { beginArgs: args, lines: [] };
      },
      beginLine(...args) {
        line = { beginArgs: args, chars: [] };
      },
      onChar(...args) {
        if (line) line.chars.push(args);
      },
      endLine() {
        if (block && line && line.chars.length) block.lines.push(line);
        line = null;
      },
      endTextBlock() {
        if (block?.lines.length) captured.push(block);
        block = null;
      },
      onImageBlock(...args) {
        images.push(args);
      },
    };

    const result = original.call(this, proxy);
    const capturedLineCount = captured.reduce(
      (count, value) => count + value.lines.length,
      0,
    );
    const preferJson =
      capturedLineCount <= 1 &&
      jsonLineCount > capturedLineCount &&
      jsonBlocks.length >= 2;

    if (preferJson) replayJson(walker, jsonBlocks);
    else replayCaptured(walker, captured);
    for (const args of images) walker.onImageBlock?.(...args);
    return result;
  };

  Object.defineProperty(prototype, "__glyphMendFinalStructuredFidelity", {
    value: true,
    configurable: true,
  });
  return mupdf;
}
