import { visualIRToMermaid } from "../../shared/visual-rendering.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [0, 0, 0, 0];
  return bbox.map((value) => Number(value) || 0);
}

function boxArea(bbox) {
  const [x0, y0, x1, y1] = normalizeBBox(bbox);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function center(bbox) {
  const [x0, y0, x1, y1] = normalizeBBox(bbox);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function overlap(a, b) {
  const [a0, a1, a2, a3] = normalizeBBox(a);
  const [b0, b1, b2, b3] = normalizeBBox(b);
  const left = Math.max(a0, b0);
  const top = Math.max(a1, b1);
  const right = Math.min(a2, b2);
  const bottom = Math.min(a3, b3);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function sharedEdge(a, b) {
  const [a0, a1, a2, a3] = normalizeBBox(a);
  const [b0, b1, b2, b3] = normalizeBBox(b);
  const verticalOverlap = Math.min(a3, b3) - Math.max(a1, b1);
  const horizontalOverlap = Math.min(a2, b2) - Math.max(a0, b0);
  return {
    horizontalGap: Math.max(0, Math.max(a0, b0) - Math.min(a2, b2)),
    verticalGap: Math.max(0, Math.max(a1, b1) - Math.min(a3, b3)),
    verticalOverlap,
    horizontalOverlap,
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleTextScore(text) {
  const value = normalizeText(text);
  if (!value) return 0;
  const symbolMatches = value.match(/[=<>≤≥≠≈+−×÷∑∏∫√]/g) || [];
  const wordCount = value.split(/\s+/).length;
  return symbolMatches.length * 2 + Math.max(0, 6 - wordCount);
}

function buildDiagnostics(stage, details) {
  return {
    stage,
    ...details,
  };
}

function candidateLabel(text) {
  return normalizeText(text).replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
}

function nodeId(index) {
  return `n${index + 1}`;
}

function directionFromCenters(nodes) {
  if (nodes.length < 2) return "LR";
  const xs = nodes.map((node) => center(node.bbox).x);
  const ys = nodes.map((node) => center(node.bbox).y);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  return ySpread > xSpread ? "TD" : "LR";
}

function deriveEdges(nodes, diagnostics) {
  const edges = [];
  const ambiguous = [];
  const lineLike = nodes.filter((node) => node.kind === "connector");
  const nodeRects = nodes.filter((node) => node.kind === "node");

  for (const connector of lineLike) {
    const endpoints = connector.endpoints || [];
    const hits = endpoints
      .map((point) => {
        let best = null;
        let bestDistance = Infinity;
        for (const node of nodeRects) {
          const box = node.bbox;
          const dx = Math.max(box[0] - point.x, 0, point.x - box[2]);
          const dy = Math.max(box[1] - point.y, 0, point.y - box[3]);
          const distance = Math.hypot(dx, dy);
          if (distance < bestDistance) {
            best = node;
            bestDistance = distance;
          }
        }
        return { node: best, distance: bestDistance, point };
      })
      .filter((hit) => hit.node && hit.distance <= 24);

    if (hits.length < 2 || hits[0].node.id === hits[1].node.id) {
      ambiguous.push({ connector: connector.id, reason: "connector is not anchored to two distinct nodes" });
      continue;
    }

    const left = hits[0].node;
    const right = hits[1].node;
    const leftCenter = center(left.bbox);
    const rightCenter = center(right.bbox);
    const connectorCenter = center(connector.bbox);
    const horizontal = Math.abs(leftCenter.x - rightCenter.x) >= Math.abs(leftCenter.y - rightCenter.y);
    const direction = horizontal
      ? leftCenter.x <= rightCenter.x
        ? "forward"
        : "backward"
      : leftCenter.y <= rightCenter.y
        ? "forward"
        : "backward";
    const arrowheads = connector.arrowheads || { start: false, end: false };
    const reversed = arrowheads.start && !arrowheads.end;
    const directed = arrowheads.start || arrowheads.end;
    const source = reversed ? right.id : left.id;
    const target = reversed ? left.id : right.id;

    if (!directed && connector.score < 0.4) {
      ambiguous.push({ connector: connector.id, reason: "connector direction is ambiguous" });
      continue;
    }

    edges.push({
      id: connector.id || `e${edges.length + 1}`,
      from: source,
      to: target,
      direction: directed ? direction : "forward",
      directed,
      label: connector.label || "",
      sourcePoint: connectorCenter,
      targetPoint: connectorCenter,
    });
  }

  diagnostics.push(buildDiagnostics("connectors", {
    count: lineLike.length,
    edgeCount: edges.length,
    ambiguousCount: ambiguous.length,
  }));

  return { edges, ambiguous };
}

function buildVisualIrFromCandidate(candidate, diagnostics) {
  const nodes = (candidate.nodes || [])
    .filter((node) => isPlainObject(node) && Array.isArray(node.bbox))
    .map((node, index) => ({
      id: node.id || nodeId(index),
      label: candidateLabel(node.label || node.text || node.id || `Node ${index + 1}`),
      shape: node.shape || "box",
      bbox: normalizeBBox(node.bbox),
      geometry: { bbox: normalizeBBox(node.bbox) },
      provenance: { source: "raster-flowchart", stage: "node-association" },
    }))
    .sort((left, right) => (left.bbox[1] - right.bbox[1]) || (left.bbox[0] - right.bbox[0]));

  const edges = (candidate.edges || [])
    .filter((edge) => isPlainObject(edge) && edge.from && edge.to)
    .map((edge, index) => ({
      id: edge.id || `e${index + 1}`,
      from: edge.from,
      to: edge.to,
      source: edge.from,
      target: edge.to,
      directed: edge.direction !== "backward",
      direction: edge.direction || "forward",
      label: normalizeText(edge.label) || `edge ${index + 1}`,
      geometry: { bbox: normalizeBBox(edge.bbox || [0, 0, 0, 0]) },
      provenance: { source: "raster-flowchart", stage: "edge-association" },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const box = nodes.reduce((acc, node) => {
    if (!acc) return [...node.bbox];
    return [
      Math.min(acc[0], node.bbox[0]),
      Math.min(acc[1], node.bbox[1]),
      Math.max(acc[2], node.bbox[2]),
      Math.max(acc[3], node.bbox[3]),
    ];
  }, null) || [0, 0, 0, 0];

  const direction = directionFromCenters(nodes);
  const density = candidate.raster?.density || 0;
  const confidence = {
    overall: clamp(0.45 + nodes.length * 0.08 + edges.length * 0.1 + density * 0.2, 0, 0.95),
    structural: clamp(0.46 + nodes.length * 0.07, 0, 0.9),
    topology: clamp(0.44 + edges.length * 0.12, 0, 0.92),
  };

  return {
    schemaVersion: 1,
    id: candidate.id || `raster-${candidate.page || 1}`,
    kind: "flowchart",
    nodes,
    edges,
    geometry: { bbox: box, direction },
    provenance: {
      producer: "visual-worker",
      source: "raster-flowchart",
      diagnostics,
    },
    confidence,
    disposition:
      nodes.length >= 2 && edges.length >= 1 && confidence.overall >= 0.72
        ? "accepted"
        : nodes.length >= 2
          ? "review"
          : "preserved",
    warnings: candidate.warnings || [],
    errors: candidate.errors || [],
    candidate: {
      page: candidate.page || 1,
      sourceType: candidate.sourceType || "raster",
      text: normalizeText(candidate.text || ""),
    },
  };
}

function conservativeRejection(candidate, diagnostics, reason) {
  return {
    schemaVersion: 1,
    id: candidate.id || `raster-${candidate.page || 1}`,
    kind: "flowchart",
    nodes: [],
    edges: [],
    geometry: { bbox: normalizeBBox(candidate.bbox || [0, 0, 0, 0]), direction: "LR" },
    provenance: {
      producer: "visual-worker",
      source: "raster-flowchart",
      diagnostics,
    },
    confidence: { overall: 0.12, structural: 0.08, topology: 0.08 },
    disposition: "preserved",
    warnings: [...(candidate.warnings || []), reason],
    errors: candidate.errors || [],
    candidate: {
      page: candidate.page || 1,
      sourceType: candidate.sourceType || "raster",
      text: normalizeText(candidate.text || ""),
    },
  };
}

export function analyzeRasterFlowchart(candidate = {}, { ocrTextRegions = [], ocr = null, cv = null } = {}) {
  const diagnostics = [];
  diagnostics.push(buildDiagnostics("normalize", {
    bbox: normalizeBBox(candidate.bbox || [0, 0, 0, 0]),
    page: candidate.page || 1,
    sourceType: candidate.sourceType || "raster",
  }));

  const bbox = normalizeBBox(candidate.bbox || [0, 0, 0, 0]);
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const aspect = width > 0 && height > 0 ? width / height : 0;
  const raster = candidate.raster || {};
  const entropy = Number(raster.entropy) || 0;
  const lineCount = Array.isArray(raster.lines) ? raster.lines.length : 0;
  const contourCount = Array.isArray(raster.contours) ? raster.contours.length : 0;
  const textRegions = Array.isArray(ocrTextRegions) ? ocrTextRegions : [];

  diagnostics.push(buildDiagnostics("raster-quality", {
    aspect,
    entropy,
    lineCount,
    contourCount,
    textRegionCount: textRegions.length,
  }));

  const simpleEnough =
    width > 0 &&
    height > 0 &&
    aspect >= 0.3 &&
    aspect <= 6.5 &&
    lineCount <= 120 &&
    contourCount <= 60 &&
    entropy <= 9;

  if (!simpleEnough) {
    diagnostics.push(buildDiagnostics("rejection", { reason: "not a simple flowchart" }));
    return conservativeRejection(candidate, diagnostics, "not a simple flowchart");
  }

  const shapes = Array.isArray(raster.shapes) ? raster.shapes : [];
  const connectors = Array.isArray(raster.connectors) ? raster.connectors : [];
  const ocrNodes = textRegions.map((region, index) => ({
    id: region.id || `ocr-${index + 1}`,
    label: candidateLabel(region.text),
    bbox: normalizeBBox(region.bbox || region.region || [0, 0, 0, 0]),
    kind: "text",
  }));

  diagnostics.push(buildDiagnostics("shape-candidates", { count: shapes.length }));
  diagnostics.push(buildDiagnostics("connector-candidates", { count: connectors.length }));
  diagnostics.push(buildDiagnostics("ocr-text-regions", { count: ocrNodes.length }));

  const nodeCandidates = shapes
    .map((shape, index) => {
      const bbox = normalizeBBox(shape.bbox || shape.bounds || [0, 0, 0, 0]);
      const region = ocrNodes.find((entry) => overlap(entry.bbox, bbox) > 0 || sharedEdge(entry.bbox, bbox).horizontalGap <= 12 || sharedEdge(entry.bbox, bbox).verticalGap <= 12);
      return {
        id: shape.id || region?.id || `shape-${index + 1}`,
        label: region?.label || candidateLabel(shape.label || shape.text || shape.id || `Node ${index + 1}`),
        shape: shape.kind || shape.type || "box",
        bbox,
        kind: "node",
      };
    })
    .filter((node) => boxArea(node.bbox) > 0);

  const connectorCandidates = connectors
    .map((connector, index) => ({
      id: connector.id || `connector-${index + 1}`,
      bbox: normalizeBBox(connector.bbox || connector.bounds || [0, 0, 0, 0]),
      endpoints: (connector.endpoints || connector.points || []).map((point) => ({ x: Number(point.x || point[0] || 0), y: Number(point.y || point[1] || 0) })),
      arrowheads: connector.arrowheads || { start: !!connector.arrowStart, end: !!connector.arrowEnd },
      label: normalizeText(connector.label || ""),
      score: Number(connector.score) || simpleTextScore(connector.label || ""),
      kind: "connector",
    }))
    .filter((connector) => boxArea(connector.bbox) > 0);

  diagnostics.push(buildDiagnostics("association", {
    nodeCandidates: nodeCandidates.length,
    connectorCandidates: connectorCandidates.length,
  }));

  const derived = deriveEdges([...nodeCandidates, ...connectorCandidates], diagnostics);
  const candidateText = normalizeText(candidate.text || "");
  const hasNegativeEvidence = /photo|diagram|illustration|scatter|chart|map|complex|network/i.test(candidateText);
  if (hasNegativeEvidence || (nodeCandidates.length < 2 && connectorCandidates.length === 0)) {
    diagnostics.push(buildDiagnostics("rejection", { reason: "not a simple flowchart" }));
    return conservativeRejection(candidate, diagnostics, "not a simple flowchart");
  }

  const visualIrCandidate = buildVisualIrFromCandidate(
    {
      ...candidate,
      nodes: nodeCandidates.length ? nodeCandidates : ocrNodes.map((node, index) => ({ ...node, id: node.id || nodeId(index), shape: "box" })),
      edges: derived.edges,
      raster: {
        ...raster,
        density: clamp((lineCount + contourCount + derived.edges.length) / 24, 0, 1),
      },
    },
    diagnostics,
  );

  if (derived.ambiguous.length) {
    visualIrCandidate.disposition = visualIrCandidate.nodes.length >= 2 ? "review" : "preserved";
    visualIrCandidate.warnings = [...visualIrCandidate.warnings, ...derived.ambiguous.map((item) => item.reason)];
  }

  visualIrCandidate.provenance.diagnostics = diagnostics.slice(0, 12);
  visualIrCandidate.mermaid = visualIRToMermaid(visualIrCandidate);
  return visualIrCandidate;
}

export function visualWorkerRecognize(input = {}, context = {}) {
  const ocrTextRegions = Array.isArray(input.ocrTextRegions) ? input.ocrTextRegions : [];
  return analyzeRasterFlowchart(input, {
    ocrTextRegions,
    ocr: context.ocr || null,
    cv: context.cv || null,
  });
}
