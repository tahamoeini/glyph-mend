import {
  AlignmentType,
  ImageRun,
  ImportedXmlComponent,
  Paragraph,
  TextRun,
} from "docx";

import { parseVisualIR } from "../../shared/semantic-ir.js";
import {
  mermaidFlowchartToSvg,
  routeVisualOutput,
  visualIRToSvg,
} from "../../shared/visual-rendering.js";

export const DOCX_VISUAL_EXPORT_TIERS = Object.freeze({
  semanticSource: "semantic-source",
  svg: "svg",
  native: "native-drawingml",
});

const MAX_VISUAL_WIDTH = 500;
const MAX_VISUAL_HEIGHT = 620;
const EMU_PER_PIXEL = 9525;
const NATIVE_SHAPES = new Set([
  "box",
  "rectangle",
  "rounded-box",
  "rounded-rectangle",
  "ellipse",
  "diamond",
  "text",
  "text-box",
  "textbox",
]);
const NATIVE_CONNECTORS = new Set(["straight", "line", "elbow"]);

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(asFiniteNumber);
  if (numbers.some((number) => number === null)) return null;
  const [left, top, right, bottom] = numbers;
  if (right <= left || bottom <= top) return null;
  return [left, top, right, bottom];
}

function geometryBox(value) {
  return normalizedBox(value?.bbox) || normalizedBox(value?.geometry?.bbox);
}

function nonEmptyObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function point(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = asFiniteNumber(value[0]);
    const y = asFiniteNumber(value[1]);
    return x === null || y === null ? null : { x, y };
  }
  if (value && typeof value === "object") {
    const x = asFiniteNumber(value.x);
    const y = asFiniteNumber(value.y);
    return x === null || y === null ? null : { x, y };
  }
  return null;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function round(value) {
  return Math.max(1, Math.round(value));
}

function emu(value) {
  return round(value * EMU_PER_PIXEL);
}

function textBoxXml(label) {
  return `<wps:txbx><w:txbxContent><w:p>` +
    `<w:pPr><w:jc w:val="center"/></w:pPr><w:r>` +
    `<w:rPr><w:sz w:val="18"/><w:color w:val="17211D"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(label)}</w:t>` +
    `</w:r></w:p></w:txbxContent></wps:txbx>` +
    `<wps:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"/>`;
}

function lineXml(directed) {
  const arrow = directed ? `<a:headEnd type="triangle" w="med" len="med"/>` : "";
  return `<a:noFill/><a:ln w="12700">` +
    `<a:solidFill><a:srgbClr val="3B4B45"/></a:solidFill>` +
    `<a:prstDash val="solid"/>${arrow}</a:ln>`;
}

function nodeXml(node, box, groupBox, scale) {
  const shape = String(node.shape || "box").toLowerCase();
  const preset = shape === "ellipse"
    ? "ellipse"
    : shape === "diamond"
      ? "diamond"
      : shape === "rounded-box" || shape === "rounded-rectangle"
        ? "roundRect"
        : "rect";
  const isTextBox = shape === "text" || shape === "text-box" || shape === "textbox";
  const x = emu((box[0] - groupBox[0]) * scale);
  const y = emu((box[1] - groupBox[1]) * scale);
  const width = emu((box[2] - box[0]) * scale);
  const height = emu((box[3] - box[1]) * scale);
  const outline = isTextBox ? "<a:noFill/>" : lineXml(false);
  return `<wps:wsp>` +
    `<wps:cNvSpPr txBox="${isTextBox ? "1" : "0"}"/>` +
    `<wps:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${outline}</wps:spPr>` +
    textBoxXml(node.label || node.id) +
    `</wps:wsp>`;
}

function connectorXml(start, end, groupBox, scale, directed) {
  const startX = (start.x - groupBox[0]) * scale;
  const startY = (start.y - groupBox[1]) * scale;
  const endX = (end.x - groupBox[0]) * scale;
  const endY = (end.y - groupBox[1]) * scale;
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.max(1, Math.abs(endX - startX));
  const height = Math.max(1, Math.abs(endY - startY));
  const flipH = endX < startX ? ' flipH="1"' : "";
  const flipV = endY < startY ? ' flipV="1"' : "";
  return `<wps:wsp>` +
    `<wps:cNvSpPr txBox="0"/>` +
    `<wps:spPr><a:xfrm${flipH}${flipV}><a:off x="${emu(left)}" y="${emu(top)}"/>` +
    `<a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm>` +
    `<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(directed)}</wps:spPr>` +
    `<wps:txbx><w:txbxContent/></wps:txbx><wps:bodyPr/></wps:wsp>`;
}

function visualDrawingXml(children, width, height, id) {
  const groupWidth = emu(width);
  const groupHeight = emu(height);
  return `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
    `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<w:drawing><wp:inline><wp:extent cx="${groupWidth}" cy="${groupHeight}"/>` +
    `<wp:docPr id="${id}" name="GlyphMend native visual" descr="Editable native DrawingML subset"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">` +
    `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm>` +
    `<a:off x="0" y="0"/><a:ext cx="${groupWidth}" cy="${groupHeight}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${groupWidth}" cy="${groupHeight}"/>` +
    `</a:xfrm></wpg:grpSpPr>${children}</wpg:wgp>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function connectorPoints(edge, sourceBox, targetBox) {
  const geometry = edge.geometry || {};
  const explicit = geometry.points || edge.points;
  if (explicit !== undefined) {
    if (!Array.isArray(explicit) || explicit.length < 2 || explicit.length > 4) return null;
    const points = explicit.map(point);
    return points.some((value) => !value) ? null : points;
  }
  const sourceCenter = { x: (sourceBox[0] + sourceBox[2]) / 2, y: (sourceBox[1] + sourceBox[3]) / 2 };
  const targetCenter = { x: (targetBox[0] + targetBox[2]) / 2, y: (targetBox[1] + targetBox[3]) / 2 };
  const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  const source = horizontal
    ? { x: targetCenter.x >= sourceCenter.x ? sourceBox[2] : sourceBox[0], y: sourceCenter.y }
    : { x: sourceCenter.x, y: targetCenter.y >= sourceCenter.y ? sourceBox[3] : sourceBox[1] };
  const target = horizontal
    ? { x: targetCenter.x >= sourceCenter.x ? targetBox[0] : targetBox[2], y: targetCenter.y }
    : { x: targetCenter.x, y: targetCenter.y >= sourceCenter.y ? targetBox[1] : targetBox[3] };
  return [source, target];
}

function nativeFailure(reason) {
  return { ok: false, tier: DOCX_VISUAL_EXPORT_TIERS.svg, reason };
}

export function mapVisualIRToDrawingML(value) {
  let visualIR;
  try {
    visualIR = parseVisualIR(value);
  } catch (error) {
    return nativeFailure(`VisualIR validation failed: ${error.message}`);
  }
  if (visualIR.disposition !== "accepted") return nativeFailure("Native export requires accepted VisualIR.");
  if (Number(visualIR.confidence?.overall || 0) < 0.85)
    return nativeFailure("Native export requires at least 0.85 overall confidence.");
  if (visualIR.warnings?.length || visualIR.errors?.length)
    return nativeFailure("Native export does not approximate visuals with warnings or errors.");
  if (!new Set(["flowchart", "diagram"]).has(visualIR.kind))
    return nativeFailure("Native export only supports flow/process diagrams.");
  if (visualIR.groups?.length || visualIR.unresolved?.length || visualIR.labels?.some((label) => label?.geometry?.path))
    return nativeFailure("Grouping or unresolved visual primitives require SVG/source preservation.");
  if (nonEmptyObject(visualIR.styles)) return nativeFailure("Unmapped visual styles require SVG/source preservation.");

  const nodeRecords = [];
  const boxes = new Map();
  for (const node of visualIR.nodes) {
    const shape = String(node.shape || "box").toLowerCase();
    const box = geometryBox(node);
    if (!NATIVE_SHAPES.has(shape)) return nativeFailure(`Unsupported native node shape: ${shape}.`);
    if (!box) return nativeFailure(`Node ${node.id} has no usable bounding box.`);
    if (nonEmptyObject(node.style)) return nativeFailure(`Node ${node.id} has unmapped styling.`);
    if (!String(node.label || "").trim()) return nativeFailure(`Node ${node.id} has no safe editable label.`);
    boxes.set(node.id, box);
    nodeRecords.push({ node, box });
  }

  const segments = [];
  for (const edge of visualIR.edges) {
    const sourceBox = boxes.get(edge.source);
    const targetBox = boxes.get(edge.target);
    if (!sourceBox || !targetBox) return nativeFailure(`Connector ${edge.id || "unknown"} references an unknown node.`);
    if (edge.label) return nativeFailure("Labeled connectors require SVG/source preservation.");
    if (nonEmptyObject(edge.style)) return nativeFailure(`Connector ${edge.id || "unknown"} has unmapped styling.`);
    const type = String(edge.geometry?.type || edge.connectorType || edge.type || "straight").toLowerCase();
    if (!NATIVE_CONNECTORS.has(type)) return nativeFailure(`Unsupported native connector type: ${type}.`);
    const points = connectorPoints(edge, sourceBox, targetBox);
    if (!points || (type === "elbow" && (points.length < 3 || points.length > 4)))
      return nativeFailure(`Connector ${edge.id || "unknown"} has ambiguous geometry.`);
    if (type === "straight" || type === "line") {
      if (points.length !== 2) return nativeFailure("Straight connectors require exactly two points.");
      segments.push({ points, directed: edge.directed === true });
    } else {
      for (let index = 1; index < points.length; index += 1) {
        segments.push({
          points: [points[index - 1], points[index]],
          directed: edge.directed === true && index === points.length - 1,
        });
      }
    }
  }

  const allPoints = nodeRecords.flatMap(({ box }) => [
    { x: box[0], y: box[1] },
    { x: box[2], y: box[3] },
  ]).concat(segments.flatMap(({ points }) => points));
  const groupBox = [
    Math.min(...allPoints.map((item) => item.x)),
    Math.min(...allPoints.map((item) => item.y)),
    Math.max(...allPoints.map((item) => item.x)),
    Math.max(...allPoints.map((item) => item.y)),
  ];
  const sourceWidth = Math.max(1, groupBox[2] - groupBox[0]);
  const sourceHeight = Math.max(1, groupBox[3] - groupBox[1]);
  const scale = Math.min(MAX_VISUAL_WIDTH / sourceWidth, MAX_VISUAL_HEIGHT / sourceHeight, 1);
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  let shapeId = 1;
  const connectorXmlText = segments
    .map(({ points, directed }) => connectorXml(points[0], points[1], groupBox, scale, directed))
    .join("");
  const nodeXmlText = nodeRecords
    .map(({ node, box }) => nodeXml(node, box, groupBox, scale))
    .join("");
  return {
    ok: true,
    tier: DOCX_VISUAL_EXPORT_TIERS.native,
    width,
    height,
    xml: visualDrawingXml(connectorXmlText + nodeXmlText, width, height, shapeId),
  };
}

function parseSvgSize(svg) {
  const viewBox = /\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
  const width = /\bwidth\s*=\s*["']\s*([\d.]+)/i.exec(svg);
  const height = /\bheight\s*=\s*["']\s*([\d.]+)/i.exec(svg);
  return {
    width: asFiniteNumber(width?.[1]) || asFiniteNumber(viewBox?.[1]) || 500,
    height: asFiniteNumber(height?.[1]) || asFiniteNumber(viewBox?.[2]) || 300,
  };
}

function visualSize(asset, svg) {
  const size = svg ? parseSvgSize(svg) : {};
  const width = asFiniteNumber(asset?.width) || size.width || 1;
  const height = asFiniteNumber(asset?.height) || size.height || 1;
  const ratio = Math.min(MAX_VISUAL_WIDTH / width, MAX_VISUAL_HEIGHT / height, 1);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function isSvgAsset(asset) {
  return typeof asset?.svg === "string" || asset?.format === "svg" || asset?.mimeType === "image/svg+xml";
}

function svgData(asset) {
  if (typeof asset?.svg === "string") return asset.svg;
  if (asset?.format === "svg" || asset?.mimeType === "image/svg+xml") {
    if (typeof asset.data === "string") return asset.data;
    if (asset.data instanceof Uint8Array) return new TextDecoder().decode(asset.data);
  }
  return null;
}

function rasterFallback(asset) {
  const fallback = asset?.fallback || asset?.rasterFallback;
  if (fallback?.data) return fallback;
  if (asset?.fallbackData) return { data: asset.fallbackData, type: asset.fallbackType || "png" };
  if (!isSvgAsset(asset) && asset?.data) return { data: asset.data, type: asset.type || "png" };
  return null;
}

function svgDataUri(svg) {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "data:image/svg+xml;base64," + btoa(binary);
}

async function svgToPng(svg, width, height) {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  if (typeof URL?.createObjectURL !== "function") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext?.("2d");
  if (!context) return null;
  canvas.width = width;
  canvas.height = height;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = await new Promise((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error("SVG fallback rasterization failed."));
      value.src = url;
    });
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function svgParagraph(svg, asset = {}, sourceDescription = "SVG visual") {
  const size = visualSize(asset, svg);
  const fallback = rasterFallback(asset) || {
    data: await svgToPng(svg, size.width, size.height),
    type: "png",
  };
  if (!fallback.data) return null;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 140 },
    children: [new ImageRun({
      type: "svg",
      data: svgDataUri(svg),
      transformation: size,
      fallback: { type: fallback.type || "png", data: fallback.data },
      altText: {
        title: sourceDescription,
        description: asset.description || "Vector visual preserved by GlyphMend",
        name: asset.id || "glyphmend-svg-visual",
      },
    })],
  });
}

function sourceParagraph(source, language = "visual") {
  return new Paragraph({
    spacing: { before: 100, after: 140 },
    children: [new TextRun({
      text: `[${language} source preserved]\n${source}`,
      font: "Courier New",
      color: "666666",
    })],
  });
}

function preservedParagraph(fields) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `Source ${fields.kind || "visual"} preserved on PDF page ${fields.page}.`,
      italics: true,
      color: "666666",
    })],
  });
}

export async function visualParagraph(fields, assets, options = {}) {
  const asset = assets?.get?.(fields.id) || assets?.[fields.id] || {};
  if (options.nativeVisuals !== false && asset.visualIR) {
    const native = mapVisualIRToDrawingML(asset.visualIR);
    if (native.ok) {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 140 },
        children: [ImportedXmlComponent.fromXmlString(native.xml)],
      });
    }
  }

  let svg = svgData(asset);
  let description = `Source ${fields.kind || "visual"}`;
  if (!svg && asset.visualIR) {
    try {
      const route = routeVisualOutput(asset.visualIR);
      if (route.format === "mermaid") {
        svg = visualIRToSvg(asset.visualIR, { description });
        description = "Mermaid-compatible VisualIR rendered as SVG";
      }
    } catch {
      /* The source crop remains the faithful fallback when SVG rendering is unavailable. */
    }
  }
  if (svg) {
    const paragraph = await svgParagraph(svg, asset, description);
    if (paragraph) return paragraph;
  }
  if (asset.data && !isSvgAsset(asset)) {
    const size = visualSize(asset);
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 140 },
      children: [new ImageRun({
        type: asset.type || "png",
        data: asset.data,
        transformation: size,
        altText: {
          title: description,
          description: `Preserved from PDF page ${fields.page}`,
          name: fields.id,
        },
      })],
    });
  }
  return preservedParagraph(fields);
}

export async function fencedVisualParagraph(language, source, options = {}) {
  const normalized = language.toLowerCase();
  if (normalized === "mermaid") {
    try {
      const svg = mermaidFlowchartToSvg(source);
      const paragraph = await svgParagraph(svg, options.mermaidAsset, "Mermaid visual rendered as SVG");
      if (paragraph) return paragraph;
    } catch {
      /* Keep the accepted semantic source visible when this browser cannot rasterize the SVG fallback. */
    }
  }
  return sourceParagraph(source, normalized);
}