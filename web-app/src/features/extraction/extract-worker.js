import { createWorker as createOcrWorker } from "tesseract.js";
import { headingFor, normalizeText } from "./cleanup.js";
import { ocrMarkdownEntries } from "./ocr-layout.js";

const MATH_SYMBOLS = /[=<>+−×÷≠≤≥≈∑∏∫√∂∇∈∉⊂⊆∞α-ωΑ-Ω]/gu;
const FORMULA_CUE =
  /(?:as follows|given by|defined by|equal to|is then|is therefore|we have|condition(?:s)?|constraint(?:s)?|objective|profit function|demand function|probability is|solution is)\s*[:.]?$/i;
let ocrWorker;
let mupdf;
let ocrProgressPage;

async function loadMupdf() {
  if (mupdf) return mupdf;
  const module = await import("mupdf");
  mupdf = module.default ?? module;
  return mupdf;
}

function rect(value) {
  if (Array.isArray(value)) return value;
  return [value.x, value.y, value.x + value.w, value.y + value.h];
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function escapeMd(value) {
  return value.replace(/([\\`*{}\[\]<>])/g, "\\$1");
}

function joinWrapped(lines) {
  return normalizeText(
    lines.reduce((result, line) => {
      const value = line.text.trim();
      if (!value) return result;
      if (!result) return value;
      if (/-$/.test(result) && /^\p{Ll}/u.test(value))
        return `${result.slice(0, -1)}${value}`;
      return `${result} ${value}`;
    }, ""),
  );
}

function mathScore(text) {
  const symbols = (text.match(MATH_SYMBOLS) || []).length;
  const words = (text.match(/\p{L}{3,}/gu) || []).length;
  const variables = (text.match(/(?:^|\s)[A-Za-z](?:[_^]\S+)?(?:\s|$)/g) || [])
    .length;
  const prose =
    /\b(?:the|and|that|this|with|from|where|which|then|than|for|are|was|were|have|has)\b/i.test(
      text,
    );
  return symbols * 3 + variables * 2 - words - (prose ? 5 : 0);
}

function isEquation(text, block, pageBounds, bodySize) {
  if (
    !text ||
    text.length > 260 ||
    /^(?:figure|table|source|note|chapter)\b/i.test(text)
  )
    return false;
  const [pageLeft, , pageRight] = pageBounds;
  const [left, , right] = block.bbox;
  const centered =
    Math.abs((left + right) / 2 - (pageLeft + pageRight) / 2) <
    (pageRight - pageLeft) * 0.13;
  const compact = text.split(/\s+/).length <= 18;
  return (
    compact &&
    (mathScore(text) >= 4 ||
      (centered && mathScore(text) >= 2 && block.maxSize <= bodySize * 1.35))
  );
}

function splitCells(line, bodySize) {
  const chars = line.chars.filter((item) => item.value.trim());
  if (chars.length < 2) return [line.text.trim()];
  const cells = [];
  let cell = chars[0].value;
  let previous = chars[0];
  for (const current of chars.slice(1)) {
    const gap = current.x0 - previous.x1;
    if (gap > bodySize * 1.7) {
      cells.push(cell.trim());
      cell = current.value;
    } else {
      if (
        gap > bodySize * 0.16 &&
        !/\s$/.test(cell) &&
        !/^\s/.test(current.value)
      )
        cell += " ";
      cell += current.value;
    }
    previous = current;
  }
  cells.push(cell.trim());
  return cells.filter(Boolean);
}

function tableFor(block, bodySize) {
  if (block.lines.length < 3 || block.lines.length > 60) return null;
  const rows = block.lines.map((line) => splitCells(line, bodySize));
  const columns = median(rows.map((row) => row.length));
  if (
    columns < 2 ||
    columns > 8 ||
    rows.filter((row) => row.length === columns).length / rows.length < 0.8
  )
    return null;
  const cells = rows.flat();
  const shortRatio =
    cells.filter((cell) => cell.split(/\s+/).length <= 8).length / cells.length;
  const numericRatio =
    cells.filter((cell) => /\d/.test(cell)).length / cells.length;
  const proseRatio =
    cells.filter((cell) =>
      /\b(?:the|and|that|with|from|which|this)\b/i.test(cell),
    ).length / cells.length;
  if (shortRatio < 0.65 || (numericRatio < 0.12 && proseRatio > 0.28))
    return null;
  return rows;
}

function markdownTable(rows) {
  const normalized = rows.map((row) =>
    row.map((value) => escapeMd(normalizeText(value).replace(/\|/g, "\\|"))),
  );
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${normalized[0].map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function readStructuredPage(page) {
  const blocks = [];
  const images = [];
  const vectors = [];
  let block = null;
  let line = null;
  const structured = page.toStructuredText(
    "preserve-images,preserve-spans,segment",
  );
  structured.walk({
    beginTextBlock(bbox) {
      block = { bbox: rect(bbox), lines: [], sizes: [] };
    },
    beginLine(bbox) {
      line = { bbox: rect(bbox), text: "", chars: [], sizes: [] };
    },
    onChar(value, _origin, _font, size, quad) {
      const points = Array.isArray(quad) ? quad : [];
      const xs = points.filter((_, index) => index % 2 === 0);
      line.text += value;
      line.sizes.push(size);
      line.chars.push({ value, x0: Math.min(...xs), x1: Math.max(...xs) });
    },
    endLine() {
      line.text = normalizeText(line.text);
      if (line.text) {
        line.size = median(line.sizes);
        block.lines.push(line);
        block.sizes.push(...line.sizes);
      }
      line = null;
    },
    endTextBlock() {
      if (block.lines.length) {
        block.maxSize = Math.max(...block.sizes);
        block.size = median(block.sizes);
        blocks.push(block);
      }
      block = null;
    },
    onImageBlock(bbox, _transform, image) {
      images.push({ bbox: rect(bbox), image });
    },
    onVector(bbox, flags) {
      vectors.push({ bbox: rect(bbox), flags });
    },
  });
  structured.destroy?.();
  const device = new mupdf.Device({
    fillPath(path, _evenOdd, ctm) {
      try {
        vectors.push({
          bbox: rect(path.getBounds(null, ctm)),
          flags: { filled: true },
        });
      } catch {
        /* ignore malformed paths */
      }
    },
    strokePath(path, stroke, ctm) {
      try {
        vectors.push({
          bbox: rect(path.getBounds(stroke, ctm)),
          flags: { stroked: true },
        });
      } catch {
        /* ignore malformed paths */
      }
    },
  });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } catch {
    /* text extraction is still usable */
  }
  return { blocks, images, vectors };
}

function cropPage(page, bbox, scale = 2) {
  const target = bbox.map((value) => Math.round(value * scale));
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, target, false);
  pixmap.clear(255);
  const device = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pixmap);
  page.run(device, mupdf.Matrix.identity);
  device.close();
  const data = new Uint8Array(pixmap.asPNG());
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  pixmap.destroy?.();
  return { data, width, height };
}

function gapFormulaCandidates(blocks, vectors, pageBounds, bodySize) {
  const lines = blocks
    .flatMap((value) => value.lines)
    .sort((a, b) => a.bbox[1] - b.bbox[1]);
  const [left, top, right, bottom] = pageBounds;
  const candidates = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const before = lines[index];
    const after = lines[index + 1];
    const gap = after.bbox[1] - before.bbox[3];
    if (gap < bodySize * 1.45 || gap > (bottom - top) * 0.18) continue;
    const y0 = before.bbox[3] + 1;
    const y1 = after.bbox[1] - 1;
    if (y0 < top + (bottom - top) * 0.08 || y1 > bottom - (bottom - top) * 0.08)
      continue;
    const vector = vectors.some(
      (item) =>
        item.bbox[1] < y1 &&
        item.bbox[3] > y0 &&
        item.bbox[2] - item.bbox[0] > bodySize,
    );
    const cue =
      FORMULA_CUE.test(before.text) ||
      (/^(?:where|for\b|subject to\b|if\b)/i.test(after.text) &&
        mathScore(before.text) > 0);
    if (!vector && !cue) continue;
    const bbox = [
      left + (right - left) * 0.08,
      Math.max(top, y0 - bodySize * 0.35),
      right - (right - left) * 0.08,
      Math.min(bottom, y1 + bodySize * 0.35),
    ];
    if (!candidates.some((item) => Math.abs(item.bbox[1] - bbox[1]) < bodySize))
      candidates.push({ bbox, y: (y0 + y1) / 2, kind: "equation" });
  }
  return candidates;
}

function vectorGraphicCandidates(vectors, pageBounds, bodySize) {
  const groups = [];
  for (const vector of vectors) {
    if (!vector.bbox.every(Number.isFinite)) continue;
    let group = groups.find(
      (item) =>
        !(
          vector.bbox[2] < item.bbox[0] - bodySize ||
          vector.bbox[0] > item.bbox[2] + bodySize ||
          vector.bbox[3] < item.bbox[1] - bodySize ||
          vector.bbox[1] > item.bbox[3] + bodySize
        ),
    );
    if (!group) {
      group = { bbox: [...vector.bbox], count: 0 };
      groups.push(group);
    }
    group.count += 1;
    group.bbox = [
      Math.min(group.bbox[0], vector.bbox[0]),
      Math.min(group.bbox[1], vector.bbox[1]),
      Math.max(group.bbox[2], vector.bbox[2]),
      Math.max(group.bbox[3], vector.bbox[3]),
    ];
  }
  const pageArea =
    (pageBounds[2] - pageBounds[0]) * (pageBounds[3] - pageBounds[1]);
  return groups
    .filter((group) => {
      const width = group.bbox[2] - group.bbox[0],
        height = group.bbox[3] - group.bbox[1],
        area = width * height;
      return (
        group.count >= 4 &&
        area / pageArea >= 0.004 &&
        area / pageArea < 0.65 &&
        width > (pageBounds[2] - pageBounds[0]) * 0.12 &&
        height > (pageBounds[3] - pageBounds[1]) * 0.025
      );
    })
    .slice(0, 10)
    .map((group) => ({ ...group, y: group.bbox[1], kind: "graphic" }));
}

function sourceMarker(pageNumber, asset) {
  const box = asset.bbox.map((value) => Math.round(value * 10) / 10).join(",");
  return `[SOURCE_VISUAL page=${pageNumber} id="${asset.id}" kind="${asset.kind}" bbox="${box}"]`;
}

async function recognizePage(page, options, paths) {
  if (!ocrWorker) {
    ocrWorker = await createOcrWorker(options.ocrLanguage || "eng", 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
      logger: (event) =>
        self.postMessage({
          type: "ocr-progress",
          page: ocrProgressPage,
          status: event.status,
          progress: event.progress,
        }),
    });
  }
  const image = cropPage(
    page,
    rect(page.getBounds()),
    Math.max(1, Math.min(600, Number(options.ocrDpi) || 300)) / 72,
  );
  ocrProgressPage = options.page;
  const result = await ocrWorker.recognize(image.data, {}, { text: true, blocks: true });
  return result.data;
}

export async function pageMarkdown(page, pageNumber, options, ocrPaths) {
  const pageBounds = rect(page.getBounds());
  const { blocks, images, vectors } = readStructuredPage(page);
  const bodySize = median(
    blocks
      .flatMap((block) => block.sizes)
      .filter((size) => size > 4 && size < 40),
  );
  const pageHeight = pageBounds[3] - pageBounds[1];
  const assets = [];
  const entries = [];
  const edges = { headers: [], footers: [] };

  let ocrApplied = false;
  if (
    options.forceOcr ||
    (options.useOcr &&
      blocks.reduce(
        (count, value) => count + joinWrapped(value.lines).length,
        0,
      ) < 40)
  ) {
    const ocrData = await recognizePage(
      page,
      { ...options, page: pageNumber },
      ocrPaths,
    );
    ocrApplied = true;
    entries.push(...ocrMarkdownEntries(ocrData, escapeMd));
  }

  for (const block of (ocrApplied ? [] : blocks).sort(
    (a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0],
  )) {
    const text = joinWrapped(block.lines);
    if (!text) continue;
    const topEdge = block.bbox[1] <= pageBounds[1] + pageHeight * 0.09;
    const bottomEdge = block.bbox[3] >= pageBounds[3] - pageHeight * 0.08;
    if (topEdge) edges.headers.push(text);
    if (bottomEdge) edges.footers.push(text);
    if (
      (topEdge || bottomEdge) &&
      /^\s*(?:\d{1,5}|[ivxlcdm]{1,10})\s*$/i.test(text)
    )
      continue;
    const table = options.detectTables ? tableFor(block, bodySize) : null;
    const heading = options.detectHeadings
      ? headingFor(text, block.maxSize, bodySize)
      : null;
    let markdown;
    if (table) markdown = markdownTable(table);
    else if (
      options.extractEquations &&
      isEquation(text, block, pageBounds, bodySize)
    )
      markdown = `$$\n${text}\n$$`;
    else if (heading) markdown = `${"#".repeat(heading)} ${escapeMd(text)}`;
    else if (
      block.size < bodySize * 0.82 &&
      block.bbox[1] > pageBounds[1] + pageHeight * 0.55
    )
      markdown = /^(\d{1,3})\s+(.+)/.test(text)
        ? text.replace(/^(\d{1,3})\s+(.+)/, "> [^$1]: $2")
        : `> ${escapeMd(text)}`;
    else markdown = escapeMd(text);
    entries.push({ y: block.bbox[1], markdown });
  }

  if (options.preserveVisuals !== false) {
    const pageArea = (pageBounds[2] - pageBounds[0]) * pageHeight;
    for (const [index, value] of images.entries()) {
      const area =
        (value.bbox[2] - value.bbox[0]) * (value.bbox[3] - value.bbox[1]);
      if (
        area / pageArea < 0.0025 ||
        (area / pageArea > 0.82 && blocks.length > 2)
      ) {
        value.image.destroy?.();
        continue;
      }
      try {
        const pixmap = value.image.toPixmap();
        const asset = {
          id: `p${pageNumber}-image-${index + 1}`,
          kind: "image",
          bbox: value.bbox,
          data: new Uint8Array(pixmap.asPNG()),
          width: pixmap.getWidth(),
          height: pixmap.getHeight(),
        };
        pixmap.destroy?.();
        assets.push(asset);
        entries.push({
          y: value.bbox[1],
          markdown: sourceMarker(pageNumber, asset),
        });
      } catch {
        /* Text extraction remains usable when an exotic image cannot be decoded. */
      }
      value.image.destroy?.();
    }
    for (const candidate of gapFormulaCandidates(
      blocks,
      vectors,
      pageBounds,
      bodySize,
    )) {
      try {
        const rendered = cropPage(page, candidate.bbox);
        const asset = {
          id: `p${pageNumber}-equation-${assets.filter((item) => item.kind === "equation").length + 1}`,
          ...candidate,
          ...rendered,
        };
        assets.push(asset);
        entries.push({
          y: candidate.y,
          markdown: sourceMarker(pageNumber, asset),
        });
      } catch {
        /* The quality report records an unpreserved suspicious gap. */
      }
    }
    if (options.flows !== false)
      for (const candidate of vectorGraphicCandidates(
        vectors,
        pageBounds,
        bodySize,
      )) {
        if (
          assets.some(
            (asset) =>
              asset.bbox[1] < candidate.bbox[3] &&
              asset.bbox[3] > candidate.bbox[1],
          )
        )
          continue;
        try {
          const rendered = cropPage(page, candidate.bbox);
          const asset = {
            id: `p${pageNumber}-graphic-${assets.filter((item) => item.kind === "graphic").length + 1}`,
            ...candidate,
            ...rendered,
          };
          assets.push(asset);
          entries.push({
            y: candidate.y,
            markdown: sourceMarker(pageNumber, asset),
          });
        } catch {
          /* Reported through raw vector counts. */
        }
      }
  }

  entries.sort((a, b) => a.y - b.y);
  const text = entries.map((entry) => entry.markdown).join("\n\n");
  const candidates = gapFormulaCandidates(
    blocks,
    vectors,
    pageBounds,
    bodySize,
  );
  const quality = {
    characters: text.length,
    textBlocks: blocks.length,
    images: images.length,
    vectors: vectors.length,
    equations: (text.match(/^\$\$/gm) || []).length / 2,
    preservedVisuals: assets.length,
    preservedEquationFallbacks: assets.filter(
      (asset) => asset.kind === "equation",
    ).length,
    suspiciousGaps: candidates.length,
    ocrApplied,
  };
  return { text, bodySize, assets, edges, quality };
}

if (typeof self !== "undefined")
  self.onmessage = async ({ data }) => {
    if (data.type !== "extract") return;
    let document;
    try {
      self.postMessage({ type: "worker-started" });
      await loadMupdf();
      self.postMessage({ type: "engine-ready", engine: "mupdf-wasm" });
      document = mupdf.Document.openDocument(
        new Uint8Array(data.buffer),
        "application/pdf",
      );
      if (
        document.needsPassword() &&
        !document.authenticatePassword(data.password || "")
      )
        throw new Error("The PDF password is missing or incorrect.");
      for (let index = 0; index < data.pages.length; index += 1) {
        const pageNumber = data.pages[index];
        let page;
        try {
          self.postMessage({ type: "page-start", page: pageNumber });
          page = document.loadPage(pageNumber - 1);
          const result = await pageMarkdown(
            page,
            pageNumber,
            data.options,
            data.ocrPaths,
          );
          if (!result.text.trim() && data.options.placeholders)
            result.text = `[VISUAL_PLACEHOLDER page=${pageNumber} reason="No recoverable text or visual content"]`;
          self.postMessage(
            {
              type: "page",
              page: pageNumber,
              index,
              total: data.pages.length,
              engine: "mupdf-wasm",
              ...result,
            },
            result.assets.map((asset) => asset.data.buffer),
          );
        } catch (error) {
          self.postMessage({
            type: "page-error",
            page: pageNumber,
            message: error?.message || String(error),
          });
          if (data.options.strict) throw error;
        } finally {
          page?.destroy?.();
        }
      }
      self.postMessage({
        type: "done",
        total: data.pages.length,
        engine: "mupdf-wasm",
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error?.message || String(error),
      });
    } finally {
      await ocrWorker?.terminate?.();
      ocrWorker = null;
      document?.destroy?.();
    }
  };
