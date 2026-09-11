import { parseVisualIR } from "./semantic-ir.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MERMAID_DIRECTIONS = new Set(["LR", "RL", "TD", "BT"]);
const VISIBLE_NODE_SHAPES = new Set(["box", "rounded-box", "ellipse", "diamond"]);
const UML_NOTATIONS = new Set(["uml-class", "uml-sequence", "uml-state", "uml-package"]);

const SAFE_SVG_TAGS = new Set([
  "svg",
  "title",
  "desc",
  "defs",
  "marker",
  "g",
  "path",
  "line",
  "rect",
  "ellipse",
  "polygon",
  "polyline",
  "text",
  "tspan",
]);

const SAFE_SVG_ATTRS = new Set([
  "xmlns:xlink",
  "role",
  "aria-labelledby",
  "viewBox",
  "width",
  "height",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "marker-end",
  "refX",
  "refY",
  "orient",
  "id",
  "d",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "rx",
  "ry",
  "points",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "data-kind",
  "data-node-id",
  "data-edge-id",
  "preserveAspectRatio",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeMermaidLabel(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>|`;]/g, " ")
    .replace(/&/g, " and ")
    .replace(/"/g, "'")
    .replace(/\\/g, "\\\\")
    .replace(/\s+/g, " ")
    .trim() || "node";
}

function normalizeDirection(value, fallback = "LR") {
  const text = String(value || fallback).toUpperCase();
  return MERMAID_DIRECTIONS.has(text) ? text : fallback;
}

function normalizeNotation(value) {
  return String(value || "").trim().toLowerCase();
}

function visualNotation(visualIR) {
  return normalizeNotation(
    visualIR?.styles?.diagram?.notation ||
      visualIR?.styles?.diagram?.format ||
      visualIR?.provenance?.notation ||
      visualIR?.provenance?.diagramNotation ||
      visualIR?.notation ||
      "",
  );
}

function supportedUmlNotation(visualIR) {
  return UML_NOTATIONS.has(visualNotation(visualIR));
}

function safeIdentifier(value, fallback = "Item") {
  return String(value || fallback)
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function sanitizePlantUmlLabel(value) {
  return String(value ?? "")
    .replace(/[<>\r\n]/g, " ")
    .replace(/[|@!]/g, " ")
    .replace(/:/g, " - ")
    .replace(/\s+/g, " ")
    .trim() || "Item";
}

function detectUmlKind(visualIR) {
  const notation = visualNotation(visualIR);
  if (notation === "uml-class") return "class";
  if (notation === "uml-sequence") return "sequence";
  if (notation === "uml-state") return "state";
  if (notation === "uml-package") return "package";
  return null;
}

function validatePlantUmlSubset(visualIR) {
  const notation = visualNotation(visualIR);
  const kind = detectUmlKind(visualIR);
  if (!kind || !UML_NOTATIONS.has(notation)) {
    return { ok: false, reason: "VisualIR has no explicit UML notation hint." };
  }

  const nodes = Array.isArray(visualIR?.nodes) ? visualIR.nodes : [];
  const edges = Array.isArray(visualIR?.edges) ? visualIR.edges : [];
  if (!nodes.length) return { ok: false, reason: "PlantUML subset requires at least one node." };
  if (kind === "class") {
    const invalidNode = nodes.find((node) => !node?.label || typeof node.label !== "string");
    if (invalidNode) return { ok: false, reason: "Class diagrams require explicit class labels." };
    const invalidEdge = edges.find((edge) => !edge?.source || !edge?.target);
    if (invalidEdge) return { ok: false, reason: "Class diagrams require explicit relationships." };
    return { ok: true, kind };
  }
  if (kind === "sequence") {
    const invalidNode = nodes.find((node) => !node?.label || typeof node.label !== "string");
    if (invalidNode) return { ok: false, reason: "Sequence diagrams require explicit participant labels." };
    return { ok: true, kind };
  }
  if (kind === "state") {
    return { ok: true, kind };
  }
  if (kind === "package") {
    return { ok: true, kind };
  }
  return { ok: false, reason: "Unsupported UML notation." };
}

function plantUmlClassDiagram(visualIR) {
  const nodes = [...(Array.isArray(visualIR?.nodes) ? visualIR.nodes : [])].sort(compareNodeKeys);
  const edges = [...(Array.isArray(visualIR?.edges) ? visualIR.edges : [])].sort(compareEdgeKeys);
  const lines = ["@startuml", "skinparam shadowing false", "hide empty members"];
  for (const node of nodes) {
    const name = safeIdentifier(node.id, "Class");
    const label = sanitizePlantUmlLabel(node.label || node.id);
    lines.push(`class \"${label}\" as ${name}`);
  }
  for (const edge of edges) {
    const source = safeIdentifier(edge.source || edge.from, "Class");
    const target = safeIdentifier(edge.target || edge.to, "Class");
    const label = edge.label ? ` : ${sanitizePlantUmlLabel(edge.label)}` : "";
    lines.push(`${source} --> ${target}${label}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

function plantUmlSequenceDiagram(visualIR) {
  const nodes = [...(Array.isArray(visualIR?.nodes) ? visualIR.nodes : [])].sort(compareNodeKeys);
  const edges = [...(Array.isArray(visualIR?.edges) ? visualIR.edges : [])].sort(compareEdgeKeys);
  const lines = ["@startuml"];
  for (const node of nodes) {
    lines.push(`participant \"${sanitizePlantUmlLabel(node.label || node.id)}\" as ${safeIdentifier(node.id, "Actor")}`);
  }
  for (const edge of edges) {
    const source = safeIdentifier(edge.source || edge.from, "Actor");
    const target = safeIdentifier(edge.target || edge.to, "Actor");
    const label = sanitizePlantUmlLabel(edge.label || "message");
    const arrow = edge.directed === false ? "--" : "->";
    lines.push(`${source} ${arrow} ${target} : ${label}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

function plantUmlStateDiagram(visualIR) {
  const nodes = [...(Array.isArray(visualIR?.nodes) ? visualIR.nodes : [])].sort(compareNodeKeys);
  const edges = [...(Array.isArray(visualIR?.edges) ? visualIR.edges : [])].sort(compareEdgeKeys);
  const lines = ["@startuml", "[*] --> " + safeIdentifier(nodes[0]?.id || "Start", "State")];
  for (const node of nodes) {
    const name = safeIdentifier(node.id, "State");
    const label = sanitizePlantUmlLabel(node.label || node.id);
    lines.push(`state \"${label}\" as ${name}`);
  }
  for (const edge of edges) {
    const source = safeIdentifier(edge.source || edge.from, "State");
    const target = safeIdentifier(edge.target || edge.to, "State");
    const label = edge.label ? ` : ${sanitizePlantUmlLabel(edge.label)}` : "";
    lines.push(`${source} --> ${target}${label}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

function plantUmlPackageDiagram(visualIR) {
  const nodes = [...(Array.isArray(visualIR?.nodes) ? visualIR.nodes : [])].sort(compareNodeKeys);
  const edges = [...(Array.isArray(visualIR?.edges) ? visualIR.edges : [])].sort(compareEdgeKeys);
  const lines = ["@startuml"];
  for (const node of nodes) {
    const name = safeIdentifier(node.id, "Package");
    const label = sanitizePlantUmlLabel(node.label || node.id);
    lines.push(`package \"${label}\" as ${name}`);
  }
  for (const edge of edges) {
    const source = safeIdentifier(edge.source || edge.from, "Package");
    const target = safeIdentifier(edge.target || edge.to, "Package");
    const label = edge.label ? ` : ${sanitizePlantUmlLabel(edge.label)}` : "";
    lines.push(`${source} ..> ${target}${label}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

export function visualIRToPlantUML(visualIR) {
  const parsed = parseVisualIR(visualIR);
  const validation = validatePlantUmlSubset(parsed);
  if (!validation.ok) throw new TypeError(validation.reason);
  if (validation.kind === "class") return plantUmlClassDiagram(parsed);
  if (validation.kind === "sequence") return plantUmlSequenceDiagram(parsed);
  if (validation.kind === "state") return plantUmlStateDiagram(parsed);
  if (validation.kind === "package") return plantUmlPackageDiagram(parsed);
  throw new TypeError("Unsupported PlantUML subset.");
}

export function routeVisualOutput(visualIR) {
  const parsed = parseVisualIR(visualIR);
  const plantUml = validatePlantUmlSubset(parsed);
  if (plantUml.ok) {
    return {
      format: "plantuml",
      reason: `explicit ${visualNotation(parsed)} notation`,
      output: visualIRToPlantUML(parsed),
    };
  }
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const ordinaryFlowchart =
    parsed.kind === "flowchart" ||
    (parsed.kind === "diagram" && Array.isArray(parsed.edges) && parsed.edges.length > 0 &&
      nodes.length > 0 &&
      nodes.every((node) => VISIBLE_NODE_SHAPES.has(String(node.shape || "").toLowerCase())));
  if (ordinaryFlowchart) {
    return {
      format: "mermaid",
      reason: "ordinary flow/process graph",
      output: visualIRToMermaid(parsed),
    };
  }
  return {
    format: "source",
    reason: "unknown or freeform visual",
    output: parsed,
  };
}

function bboxForNode(node) {
  const bbox = node?.geometry?.bbox;
  if (Array.isArray(bbox) && bbox.length === 4) return bbox.map(Number);
  return [0, 0, 0, 0];
}

function compareNodeKeys(left, right) {
  const leftBox = bboxForNode(left);
  const rightBox = bboxForNode(right);
  const keys = [leftBox[1], leftBox[0], leftBox[3], leftBox[2], left.id].map(String);
  const other = [rightBox[1], rightBox[0], rightBox[3], rightBox[2], right.id].map(String);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === other[index]) continue;
    return keys[index] < other[index] ? -1 : 1;
  }
  return 0;
}

function compareEdgeKeys(left, right) {
  const leftKey = [left.source, left.target, left.directed ? 0 : 1, left.label || "", left.id || ""].map(String);
  const rightKey = [right.source, right.target, right.directed ? 0 : 1, right.label || "", right.id || ""].map(String);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] === rightKey[index]) continue;
    return leftKey[index] < rightKey[index] ? -1 : 1;
  }
  return 0;
}

function inferDirection(visualIR) {
  const direction = normalizeDirection(visualIR?.geometry?.direction || "LR");
  if (direction === "RL" || direction === "BT") return direction;
  const nodes = Array.isArray(visualIR?.nodes) ? visualIR.nodes : [];
  if (nodes.length < 2) return direction;
  const centers = nodes.map((node) => {
    const bbox = bboxForNode(node);
    return {
      x: (bbox[0] + bbox[2]) / 2,
      y: (bbox[1] + bbox[3]) / 2,
    };
  });
  const xSpread = Math.max(...centers.map((item) => item.x)) - Math.min(...centers.map((item) => item.x));
  const ySpread = Math.max(...centers.map((item) => item.y)) - Math.min(...centers.map((item) => item.y));
  return ySpread > xSpread ? "TD" : "LR";
}

function nodeShapeToMermaid(node) {
  const shape = VISIBLE_NODE_SHAPES.has(node.shape) ? node.shape : "box";
  return shape;
}

function nodeSyntax(nodeId, label, shape) {
  const value = escapeXml(sanitizeMermaidLabel(label));
  if (shape === "rounded-box") return `${nodeId}(\"${value}\")`;
  if (shape === "ellipse") return `${nodeId}((\"${value}\"))`;
  if (shape === "diamond") return `${nodeId}{\"${value}\"}`;
  return `${nodeId}[\"${value}\"]`;
}

function buildNodePosition(index, nodeCount, direction, nodeWidth, nodeHeight, marginX, marginY, nodeGap) {
  if (direction === "TD" || direction === "BT") {
    const top = marginY + index * (nodeHeight + nodeGap);
    return {
      x: marginX,
      y: top,
    };
  }
  const left = marginX + index * (nodeWidth + nodeGap);
  return {
    x: left,
    y: marginY,
  };
}

function shapePath(shape, x, y, width, height) {
  if (shape === "diamond") {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return `${x + halfWidth},${y} ${x + width},${y + halfHeight} ${x + halfWidth},${y + height} ${x},${y + halfHeight}`;
  }
  return null;
}

function endpointFor(direction, position, width, height, isSource) {
  const centerX = position.x + width / 2;
  const centerY = position.y + height / 2;
  if (direction === "TD") {
    return { x: centerX, y: isSource ? position.y + height : position.y };
  }
  if (direction === "BT") {
    return { x: centerX, y: isSource ? position.y : position.y + height };
  }
  if (direction === "RL") {
    return { x: isSource ? position.x : position.x + width, y: centerY };
  }
  return { x: isSource ? position.x + width : position.x, y: centerY };
}

export function validateMermaidFlowchart(mermaidText) {
  const normalized = String(mermaidText || "")
    .replace(/^```mermaid\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new TypeError("Mermaid text must not be empty.");

  const header = /^flowchart\s+(LR|RL|TD|BT)$/.exec(lines[0]);
  if (!header) throw new TypeError("Mermaid flowchart must start with a supported direction.");

  const nodes = new Map();
  const edges = [];
  for (const line of lines.slice(1)) {
    const nodeMatch = /^(n\d+)\s*(\["([^"]+)"\]|\(\("([^"]+)"\)\)|\(\"([^"]+)\"\)|\{"([^"]+)"\})$/.exec(line);
    if (nodeMatch) {
      const id = nodeMatch[1];
      const label = nodeMatch[3] || nodeMatch[4] || nodeMatch[5] || nodeMatch[6] || "node";
      const shape = nodeMatch[3]
        ? "box"
        : nodeMatch[4]
          ? "ellipse"
          : nodeMatch[5]
            ? "rounded-box"
            : "diamond";
      if (nodes.has(id)) throw new TypeError(`Duplicate Mermaid node id: ${id}`);
      nodes.set(id, { id, label, shape });
      continue;
    }
    const edgeMatch = /^(n\d+)\s*(-->|---)(?:\|([^|]+)\|)?\s*(n\d+)$/.exec(line);
    if (edgeMatch) {
      edges.push({
        source: edgeMatch[1],
        target: edgeMatch[4],
        directed: edgeMatch[2] === "-->",
        label: edgeMatch[3] ? edgeMatch[3].trim() : "",
      });
      continue;
    }
    throw new TypeError(`Unsupported Mermaid flowchart line: ${line}`);
  }

  if (!nodes.size) throw new TypeError("Mermaid flowchart must include at least one node.");
  for (const edge of edges) {
    if (!nodes.has(edge.source)) throw new TypeError(`Mermaid edge source is unknown: ${edge.source}`);
    if (!nodes.has(edge.target)) throw new TypeError(`Mermaid edge target is unknown: ${edge.target}`);
  }

  return {
    direction: header[1],
    nodes: [...nodes.values()],
    edges,
  };
}

export function visualIRToMermaid(visualIR) {
  const parsed = parseVisualIR(visualIR);
  const nodes = [...parsed.nodes].sort(compareNodeKeys);
  const edges = [...parsed.edges].sort(compareEdgeKeys);
  const nodeIds = new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
  const direction = inferDirection(parsed);

  const lines = [`flowchart ${direction}`];
  for (const node of nodes) {
    const mermaidId = nodeIds.get(node.id);
    const label = node.label || node.id;
    lines.push(`  ${nodeSyntax(mermaidId, label, nodeShapeToMermaid(node))}`);
  }
  for (const edge of edges) {
    const source = nodeIds.get(edge.source);
    const target = nodeIds.get(edge.target);
    if (!source || !target) continue;
    const connector = edge.directed ? "-->" : "---";
    const label = edge.label ? `|${sanitizeMermaidLabel(edge.label)}|` : "";
    const connectorText = label ? `${connector}${label}` : connector;
    lines.push(`  ${source} ${connectorText} ${target}`);
  }
  const output = lines.join("\n");
  validateMermaidFlowchart(output);
  return output;
}

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function isSafeSvgAttributeValue(name, value) {
  const text = String(value);
  if (/[\u0000-\u001f\u007f]/.test(text)) return false;
  if (/\b(?:javascript|vbscript|data|https?|file):/i.test(text) || /^\/\//.test(text.trim())) return false;
  if (/url\s*\(/i.test(text)) return /^url\(#[A-Za-z][A-Za-z0-9_.:-]*\)$/.test(text.trim());
  if (name === "id") return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(text);
  return text.length <= 16_384;
}

function setSafeAttributes(node, attributes) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === "") continue;
    if (!SAFE_SVG_ATTRS.has(key)) continue;
    if (!isSafeSvgAttributeValue(key, value)) continue;
    node.setAttribute(key, String(value));
  }
}

function appendText(parent, text, x, y, options = {}) {
  const node = createSvgElement("text");
  setSafeAttributes(node, {
    x,
    y,
    fill: options.fill || "currentColor",
    "font-family": options.fontFamily || "ui-sans-serif, system-ui, sans-serif",
    "font-size": options.fontSize || 14,
    "font-weight": options.fontWeight || 600,
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

export function sanitizeGeneratedSvgMarkup(svgText) {
  if (typeof document === "undefined" || typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    throw new ReferenceError("SVG sanitization requires a browser DOM environment.");
  }
  if (typeof svgText !== "string" || svgText.length > 8 * 1024 * 1024) {
    throw new RangeError("Generated SVG is empty, non-text, or exceeds the 8 MiB markup limit.");
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new TypeError("Generated SVG is invalid.");
  const sourceRoot = doc.documentElement;
  if (!sourceRoot || sourceRoot.tagName.toLowerCase() !== "svg") throw new TypeError("SVG root is missing.");

  const cleanDoc = document.implementation.createDocument(SVG_NS, "svg", null);
  const cleanRoot = cleanDoc.documentElement;

  function copyNode(source, targetParent) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        targetParent.appendChild(cleanDoc.createTextNode(child.textContent || ""));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (!SAFE_SVG_TAGS.has(tag)) continue;
      const next = cleanDoc.createElementNS(SVG_NS, tag);
      for (const attribute of child.attributes) {
        if (!SAFE_SVG_ATTRS.has(attribute.name)) continue;
        if (/^on/i.test(attribute.name)) continue;
        if (!isSafeSvgAttributeValue(attribute.name, attribute.value)) continue;
        next.setAttribute(attribute.name, attribute.value);
      }
      targetParent.appendChild(next);
      copyNode(child, next);
    }
  }

  for (const attribute of sourceRoot.attributes) {
    if (!SAFE_SVG_ATTRS.has(attribute.name)) continue;
    if (!isSafeSvgAttributeValue(attribute.name, attribute.value)) continue;
    cleanRoot.setAttribute(attribute.name, attribute.value);
  }
  copyNode(sourceRoot, cleanRoot);
  return new XMLSerializer().serializeToString(cleanRoot);
}

export function mermaidFlowchartToSvg(mermaidText, { title = "GlyphMend visual reconstruction", description = "Deterministic SVG rendering of a supported Mermaid flowchart." } = {}) {
  const graph = validateMermaidFlowchart(mermaidText);
  const direction = graph.direction;
  const orderedNodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const layout = new Map();
  const sizes = new Map();
  const nodeGap = 84;
  const margin = 28;
  const baseline = 14;

  for (const [index, node] of orderedNodes.entries()) {
    const width = Math.max(108, Math.min(240, 28 + node.label.length * 7));
    const height = node.shape === "diamond" ? 72 : node.shape === "ellipse" ? 60 : 52;
    sizes.set(node.id, { width, height });
    layout.set(node.id, buildNodePosition(index, orderedNodes.length, direction, width, height, margin, margin, nodeGap));
  }

  const canvasWidth = direction === "TD" || direction === "BT"
    ? Math.max(...orderedNodes.map((node) => sizes.get(node.id).width)) + margin * 2
    : orderedNodes.reduce((total, node, index) => total + sizes.get(node.id).width + (index ? nodeGap : 0), 0) + margin * 2;
  const canvasHeight = direction === "TD" || direction === "BT"
    ? orderedNodes.reduce((total, node, index) => total + sizes.get(node.id).height + (index ? nodeGap : 0), 0) + margin * 2
    : Math.max(...orderedNodes.map((node) => sizes.get(node.id).height)) + margin * 2;

  if (typeof document === "undefined" || typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    throw new ReferenceError("SVG rendering requires a browser DOM environment.");
  }

  const svg = createSvgElement("svg");
  setSafeAttributes(svg, {
    xmlns: SVG_NS,
    role: "img",
    "aria-labelledby": "glyphmend-visual-title glyphmend-visual-desc",
    viewBox: `0 0 ${Math.ceil(canvasWidth)} ${Math.ceil(canvasHeight)}`,
    width: Math.ceil(canvasWidth),
    height: Math.ceil(canvasHeight),
    preserveAspectRatio: "xMidYMid meet",
  });

  const titleNode = createSvgElement("title");
  titleNode.id = "glyphmend-visual-title";
  titleNode.textContent = title;
  svg.appendChild(titleNode);

  const descNode = createSvgElement("desc");
  descNode.id = "glyphmend-visual-desc";
  descNode.textContent = description;
  svg.appendChild(descNode);

  const defs = createSvgElement("defs");
  const marker = createSvgElement("marker");
  setSafeAttributes(marker, {
    id: "glyphmend-arrow",
    markerWidth: 10,
    markerHeight: 7,
    refX: 9,
    refY: 3.5,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  const arrowPath = createSvgElement("path");
  setSafeAttributes(arrowPath, {
    d: "M0,0 L10,3.5 L0,7 z",
    fill: "currentColor",
  });
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const edgeLayer = createSvgElement("g");
  setSafeAttributes(edgeLayer, { "data-kind": "edges" });
  for (const edge of graph.edges) {
    const source = orderedNodes.find((node) => node.id === edge.source);
    const target = orderedNodes.find((node) => node.id === edge.target);
    if (!source || !target) continue;
    const sourceBox = sizes.get(source.id);
    const targetBox = sizes.get(target.id);
    const sourcePos = layout.get(source.id);
    const targetPos = layout.get(target.id);
    const start = endpointFor(direction, sourcePos, sourceBox.width, sourceBox.height, true);
    const end = endpointFor(direction, targetPos, targetBox.width, targetBox.height, false);
    const line = createSvgElement("line");
    setSafeAttributes(line, {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.6,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "marker-end": edge.directed ? "url(#glyphmend-arrow)" : undefined,
      "data-edge-id": edge.id || "",
    });
    edgeLayer.appendChild(line);
    if (edge.label) {
      const label = createSvgElement("text");
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2 - 6;
      setSafeAttributes(label, {
        x: midX,
        y: midY,
        fill: "currentColor",
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 12,
        "text-anchor": "middle",
        "dominant-baseline": "ideographic",
        "data-edge-id": edge.id || "",
      });
      label.textContent = edge.label;
      edgeLayer.appendChild(label);
    }
  }
  svg.appendChild(edgeLayer);

  const nodeLayer = createSvgElement("g");
  setSafeAttributes(nodeLayer, { "data-kind": "nodes" });
  for (const node of orderedNodes) {
    const { width, height } = sizes.get(node.id);
    const { x, y } = layout.get(node.id);
    const group = createSvgElement("g");
    setSafeAttributes(group, { "data-node-id": node.id });
    if (node.shape === "ellipse") {
      const ellipse = createSvgElement("ellipse");
      setSafeAttributes(ellipse, {
        cx: x + width / 2,
        cy: y + height / 2,
        rx: width / 2,
        ry: height / 2,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.6,
      });
      group.appendChild(ellipse);
    } else if (node.shape === "diamond") {
      const polygon = createSvgElement("polygon");
      setSafeAttributes(polygon, {
        points: shapePath("diamond", x, y, width, height),
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.6,
      });
      group.appendChild(polygon);
    } else {
      const rect = createSvgElement("rect");
      setSafeAttributes(rect, {
        x,
        y,
        width,
        height,
        rx: node.shape === "rounded-box" ? 14 : 8,
        ry: node.shape === "rounded-box" ? 14 : 8,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.6,
      });
      group.appendChild(rect);
    }
    appendText(group, node.label, x + width / 2, y + height / 2 + (node.shape === "diamond" ? -baseline / 8 : 0));
    nodeLayer.appendChild(group);
  }
  svg.appendChild(nodeLayer);

  return sanitizeGeneratedSvgMarkup(new XMLSerializer().serializeToString(svg));
}

export function visualIRToSvg(visualIR, options) {
  return mermaidFlowchartToSvg(visualIRToMermaid(visualIR), options);
}
