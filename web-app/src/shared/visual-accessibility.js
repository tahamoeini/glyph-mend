import { parseVisualIR } from "./semantic-ir.js";

function accessibleText(value, fallback) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function bboxForNode(node) {
  const bbox = node?.geometry?.bbox;
  return Array.isArray(bbox) && bbox.length === 4 ? bbox.map(Number) : [0, 0, 0, 0];
}

function compareNodes(left, right) {
  const a = bboxForNode(left);
  const b = bboxForNode(right);
  return [a[1], a[0], a[3], a[2], left.id]
    .map(String)
    .join("\u0000")
    .localeCompare([b[1], b[0], b[3], b[2], right.id].map(String).join("\u0000"));
}

function compareEdges(left, right) {
  return [left.source, left.target, left.directed ? 0 : 1, left.label || "", left.id || ""]
    .map(String)
    .join("\u0000")
    .localeCompare([right.source, right.target, right.directed ? 0 : 1, right.label || "", right.id || ""].map(String).join("\u0000"));
}

function accessibleShape(value) {
  return {
    box: "rectangle",
    rect: "rectangle",
    "rounded-box": "rounded rectangle",
    ellipse: "ellipse",
    diamond: "diamond",
  }[String(value || "box").toLowerCase()] || "shape";
}

export function visualIRToAccessibleDescription(visualIR) {
  const parsed = parseVisualIR(visualIR);
  const nodes = [...(Array.isArray(parsed.nodes) ? parsed.nodes : [])].sort(compareNodes);
  const edges = [...(Array.isArray(parsed.edges) ? parsed.edges : [])].sort(compareEdges);
  const labels = new Map(
    nodes.map((node) => [node.id, accessibleText(node.label, accessibleText(node.id, "unlabeled node"))]),
  );
  const nodeDescription = nodes.length
    ? nodes.map((node, index) => `${index + 1}. ${labels.get(node.id)} (${accessibleShape(node.shape)})`).join("; ")
    : "none identified";
  const edgeDescription = edges.length
    ? edges.map((edge) => {
        const source = labels.get(edge.source) || accessibleText(edge.source, "unknown source");
        const target = labels.get(edge.target) || accessibleText(edge.target, "unknown target");
        const relation = edge.directed === false ? "connects to" : "leads to";
        const label = accessibleText(edge.label, "");
        return `${source} ${relation} ${target}${label ? ` (${label})` : ""}`;
      }).join("; ")
    : "none identified";
  const kind = accessibleText(parsed.kind, "diagram");
  return `${kind} with ${nodes.length} ${nodes.length === 1 ? "node" : "nodes"} and ${edges.length} ${edges.length === 1 ? "connection" : "connections"}. Nodes: ${nodeDescription}. Connections: ${edgeDescription}.`;
}
