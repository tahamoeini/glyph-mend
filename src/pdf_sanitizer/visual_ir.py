from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

from .sanitize import sanitize_label

BBox = tuple[float, float, float, float]
MERMAID_DIRECTIONS = {"LR", "RL", "TD", "BT"}
MAX_MERMAID_NODES = 500
MAX_MERMAID_EDGES = 2000


@dataclass(frozen=True, slots=True)
class VisualRecovery:
    bbox: BBox
    visual_ir: dict[str, Any]
    warnings: tuple[str, ...] = ()


def rect_area(rect: BBox) -> float:
    return max(0.0, rect[2] - rect[0]) * max(0.0, rect[3] - rect[1])


def intersection_area(a: BBox, b: BBox) -> float:
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    return max(0.0, x1 - x0) * max(0.0, y1 - y0)


def overlap_ratio(a: BBox, b: BBox) -> float:
    base = min(rect_area(a), rect_area(b))
    return intersection_area(a, b) / base if base else 0.0


def merge_bbox(rects: Iterable[BBox]) -> BBox:
    values = list(rects)
    if not values:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        min(r[0] for r in values),
        min(r[1] for r in values),
        max(r[2] for r in values),
        max(r[3] for r in values),
    )


def format_bbox(rect: BBox) -> str:
    return ",".join(str(int(round(v))) for v in rect)


def _as_bbox(value: Any) -> BBox | None:
    try:
        return (float(value[0]), float(value[1]), float(value[2]), float(value[3]))
    except Exception:
        return None


def _point_xy(value: Any) -> tuple[float, float] | None:
    try:
        if hasattr(value, "x") and hasattr(value, "y"):
            return float(value.x), float(value.y)
        return float(value[0]), float(value[1])
    except Exception:
        return None


def _dedupe_rects(rects: list[BBox]) -> list[BBox]:
    out: list[BBox] = []
    for rect in sorted(rects, key=rect_area, reverse=True):
        if any(overlap_ratio(rect, existing) > 0.92 for existing in out):
            continue
        out.append(rect)
    return out


def _point_near_rect(point: tuple[float, float], rect: BBox, tolerance: float) -> bool:
    x, y = point
    dx = max(rect[0] - x, 0.0, x - rect[2])
    dy = max(rect[1] - y, 0.0, y - rect[3])
    return (dx * dx + dy * dy) ** 0.5 <= tolerance


def _point_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return (dx * dx + dy * dy) ** 0.5


def _segment_length(segment: tuple[tuple[float, float], tuple[float, float]]) -> float:
    return _point_distance(segment[0], segment[1])


def _normalize_shape(shape: str | None) -> str:
    return shape if shape in {"box", "rounded-box", "ellipse", "diamond"} else "box"


def _shape_for_rect(rect: BBox) -> str:
    width = max(1.0, rect[2] - rect[0])
    height = max(1.0, rect[3] - rect[1])
    ratio = width / height
    if 0.82 <= ratio <= 1.22:
        return "ellipse"
    if ratio >= 1.35 and ratio <= 3.4:
        return "rounded-box"
    return "box"


def _escape_mermaid_label(value: str) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value))
    text = re.sub(r"%%\{.*?\}%%", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bclick\s+[A-Za-z0-9_.:-]+\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:javascript|vbscript|data|file)\s*:", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"[<>|`;%]", " ", text)
    text = text.replace("&", " and ").replace('"', "'").replace("\\", "\\\\")
    return re.sub(r"\s+", " ", text).strip() or "node"


def _mermaid_node(node: dict[str, Any], node_id: str) -> str:
    label = _escape_mermaid_label(str(node.get("label") or node.get("id") or "node"))
    shape = _normalize_shape(str(node.get("shape") or "box"))
    if shape == "rounded-box":
        return f'    {node_id}("{label}")'
    if shape == "ellipse":
        return f'    {node_id}(("{label}"))'
    if shape == "diamond":
        return f'    {node_id}{{"{label}"}}'
    return f'    {node_id}["{label}"]'


def _mermaid_from_visual_ir(visual_ir: dict[str, Any]) -> str:
    direction = str((visual_ir.get("geometry") or {}).get("direction") or "LR").upper()
    if direction not in MERMAID_DIRECTIONS:
        direction = "LR"
    nodes = list(visual_ir.get("nodes") or [])
    edges = list(visual_ir.get("edges") or [])
    if len(nodes) > MAX_MERMAID_NODES:
        raise ValueError(f"Mermaid reconstruction exceeds the {MAX_MERMAID_NODES}-node limit")
    if len(edges) > MAX_MERMAID_EDGES:
        raise ValueError(f"Mermaid reconstruction exceeds the {MAX_MERMAID_EDGES}-edge limit")

    id_map: dict[str, str] = {}
    lines = ["```mermaid", f"flowchart {direction}"]
    for index, node in enumerate(nodes, start=1):
        original_id = str(node.get("id") or f"node-{index}")
        safe_id = f"N{index}"
        id_map[original_id] = safe_id
        lines.append(_mermaid_node(node, safe_id))
    for edge in edges:
        source = id_map.get(str(edge.get("from") or edge.get("source") or ""))
        target = id_map.get(str(edge.get("to") or edge.get("target") or ""))
        if not source or not target:
            continue
        if edge.get("directed", False):
            label = edge.get("label")
            if label:
                lines.append(f'    {source} -->|{_escape_mermaid_label(str(label))}| {target}')
            else:
                lines.append(f"    {source} --> {target}")
        else:
            lines.append(f"    {source} --- {target}")
    lines.append("```")
    return "\n".join(lines)


def _nearest_node_index(point: tuple[float, float], rects: list[BBox], tolerance: float) -> int | None:
    best_index: int | None = None
    best_distance = tolerance
    for index, rect in enumerate(rects):
        if not _point_near_rect(point, rect, tolerance):
            continue
        dx = max(rect[0] - point[0], 0.0, point[0] - rect[2])
        dy = max(rect[1] - point[1], 0.0, point[1] - rect[3])
        distance = (dx * dx + dy * dy) ** 0.5
        if distance <= best_distance:
            best_index = index
            best_distance = distance
    return best_index


def _connector_tip(
    point: tuple[float, float],
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    *,
    max_length: float,
) -> bool:
    touching = []
    for segment in segments:
        if _point_distance(point, segment[0]) <= 2.25 or _point_distance(point, segment[1]) <= 2.25:
            touching.append(segment)
    short = [segment for segment in touching if _segment_length(segment) <= max_length]
    if len(short) < 2:
        return False
    vectors = []
    for segment in short[:4]:
        other = segment[1] if _point_distance(point, segment[0]) <= 2.25 else segment[0]
        vectors.append((other[0] - point[0], other[1] - point[1]))
    for left in range(len(vectors)):
        for right in range(left + 1, len(vectors)):
            dot = vectors[left][0] * vectors[right][0] + vectors[left][1] * vectors[right][1]
            if dot < 0:
                return True
    return False


def _group_members(container: BBox, nodes: list[BBox]) -> list[int]:
    members = []
    for index, node in enumerate(nodes):
        node_center = ((node[0] + node[2]) / 2, (node[1] + node[3]) / 2)
        if _point_near_rect(node_center, container, 0.5) or (
            node[0] >= container[0]
            and node[1] >= container[1]
            and node[2] <= container[2]
            and node[3] <= container[3]
        ):
            members.append(index)
    return members


def _visual_confidence(node_count: int, edge_count: int, directed_count: int, primitive_count: int) -> dict[str, float]:
    return {
        "overall": round(min(0.98, 0.52 + node_count * 0.1 + edge_count * 0.08), 3),
        "nodeConfidence": round(min(0.98, 0.68 + node_count * 0.05), 3),
        "topologyConfidence": round(min(0.97, 0.54 + directed_count * 0.09 + edge_count * 0.04), 3),
        "structural": round(min(0.96, 0.62 + node_count * 0.04), 3),
        "semantic": round(min(0.95, 0.55 + edge_count * 0.05), 3),
        "quality": round(min(0.98, 0.5 + primitive_count * 0.02), 3),
    }


def detect_vector_visual_ir(page: Any, excluded_bboxes: list[BBox] | None = None) -> list[dict[str, Any]]:
    excluded_bboxes = excluded_bboxes or []
    try:
        drawings = page.get_drawings()
        page_rect: BBox = _as_bbox(page.rect) or (0.0, 0.0, 1.0, 1.0)
    except Exception:
        return []

    page_area = max(1.0, rect_area(page_rect))
    candidate_rects: list[BBox] = []
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    source_primitives: list[dict[str, Any]] = []

    for path in drawings:
        for item in path.get("items", []):
            if not item:
                continue
            command = item[0]
            if command == "re" and len(item) >= 2:
                rect = _as_bbox(item[1])
                if not rect:
                    continue
                source_primitives.append({"type": "rectangle", "bbox": rect})
                width = rect[2] - rect[0]
                height = rect[3] - rect[1]
                area = rect_area(rect)
                if width < 24 or height < 12 or area > page_area * 0.2:
                    continue
                if any(overlap_ratio(rect, excluded) > 0.25 for excluded in excluded_bboxes):
                    continue
                candidate_rects.append(rect)
            elif command == "l" and len(item) >= 3:
                p1 = _point_xy(item[1])
                p2 = _point_xy(item[2])
                if p1 and p2:
                    segments.append((p1, p2))
                    source_primitives.append({"type": "segment", "points": [p1, p2]})

    candidate_rects = _dedupe_rects(candidate_rects)
    if len(candidate_rects) < 2:
        return []

    labeled_nodes: list[tuple[BBox, str]] = []
    unlabeled_rects: list[BBox] = []
    for rect in candidate_rects:
        try:
            label = sanitize_label(page.get_textbox(rect), fallback="")
        except Exception:
            label = ""
        if label:
            labeled_nodes.append((rect, label))
        else:
            unlabeled_rects.append(rect)

    if len(labeled_nodes) < 2:
        return []

    labeled_nodes = sorted(labeled_nodes, key=lambda item: ((item[0][0] + item[0][2]) / 2, (item[0][1] + item[0][3]) / 2))
    node_rects = [rect for rect, _ in labeled_nodes]
    node_ids = [f"N{index + 1}" for index in range(len(labeled_nodes))]
    tolerance = 12.0
    segment_lengths = [_segment_length(segment) for segment in segments] or [0.0]
    arrow_max = max(12.0, min(segment_lengths) * 1.5)
    edges: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []

    for segment in segments:
        left = _nearest_node_index(segment[0], node_rects, tolerance)
        right = _nearest_node_index(segment[1], node_rects, tolerance)
        if left is None or right is None or left == right:
            unresolved.append(
                {
                    "kind": "connector",
                    "points": [segment[0], segment[1]],
                    "reason": "connector is not anchored to two distinct nodes",
                }
            )
            continue

        left_tip = _connector_tip(segment[0], segments, max_length=arrow_max)
        right_tip = _connector_tip(segment[1], segments, max_length=arrow_max)
        directed = False
        source_index = left
        target_index = right
        if left_tip and not right_tip:
            directed = True
            source_index = right
            target_index = left
        elif right_tip and not left_tip:
            directed = True
            source_index = left
            target_index = right
        elif left_tip and right_tip:
            unresolved.append(
                {
                    "kind": "connector",
                    "points": [segment[0], segment[1]],
                    "reason": "arrowheads appear on both ends of a connector",
                }
            )
            continue
        else:
            unresolved.append(
                {
                    "kind": "connector",
                    "points": [segment[0], segment[1]],
                    "reason": "connector direction is ambiguous",
                }
            )

        edge_bbox = merge_bbox([node_rects[source_index], node_rects[target_index]])
        edge = {
            "id": f"E{len(edges) + 1}",
            "from": node_ids[source_index],
            "to": node_ids[target_index],
            "directed": directed,
            "label": None,
            "bbox": edge_bbox,
            "geometry": {"bbox": edge_bbox},
            "provenance": {
                "source": "native-pdf-vector-structure",
                "segment": segment,
                "arrowheadDetected": directed,
            },
        }
        edges.append(edge)

    groups = []
    for rect in unlabeled_rects:
        members = _group_members(rect, node_rects)
        if len(members) < 2:
            continue
        groups.append(
            {
                "id": f"G{len(groups) + 1}",
                "bbox": rect,
                "members": [node_ids[index] for index in members],
                "kind": "group",
                "provenance": {
                    "source": "native-pdf-vector-structure",
                    "primitive": "rectangle",
                },
            }
        )

    bbox = merge_bbox(node_rects)
    x_centers = [(r[0] + r[2]) / 2 for r in node_rects]
    y_centers = [(r[1] + r[3]) / 2 for r in node_rects]
    x_spread = max(x_centers) - min(x_centers) if len(x_centers) > 1 else 0.0
    y_spread = max(y_centers) - min(y_centers) if len(y_centers) > 1 else 0.0
    direction = "TD" if y_spread >= x_spread else "LR"

    nodes = []
    labels = []
    for index, (rect, label) in enumerate(labeled_nodes):
        shape = _shape_for_rect(rect)
        node = {
            "id": node_ids[index],
            "label": label,
            "shape": shape,
            "bbox": rect,
            "geometry": {"bbox": rect},
            "provenance": {
                "source": "native-pdf-vector-structure",
                "primitive": "rectangle",
                "sourceBBox": rect,
            },
        }
        nodes.append(node)
        labels.append({"text": label, "nodeId": node_ids[index], "bbox": rect})

    directed_count = sum(1 for edge in edges if edge.get("directed"))
    warnings = [item["reason"] for item in unresolved if item.get("reason")]
    if unresolved and not any("ambiguous" in warning.lower() for warning in warnings):
        warnings.append("Connector topology is ambiguous and requires review.")
    if not edges:
        warnings.append("No connector topology confirmed; only isolated nodes were recovered.")
    if groups:
        warnings.append(f"Recovered {len(groups)} containment group(s) from enclosing vector geometry.")

    visual_ir = {
        "schemaVersion": 1,
        "id": f"visual-{int(round(page_rect[0]))}-{int(round(page_rect[1]))}-{len(nodes)}-{len(edges)}",
        "kind": "flowchart" if edges else "diagram",
        "nodes": nodes,
        "edges": edges,
        "labels": labels,
        "geometry": {
            "bbox": bbox,
            "direction": direction,
            "pageBBox": page_rect,
        },
        "shapes": [
            {
                "id": node["id"],
                "shape": node["shape"],
                "bbox": node["bbox"],
            }
            for node in nodes
        ],
        "styles": {
            "node": {"stroke": "currentColor", "fill": "none"},
            "edge": {"stroke": "currentColor", "strokeWidth": 1.5},
        },
        "provenance": {
            "producer": "pdf-sanitizer.graphics",
            "source": "native-pdf-vector-structure",
            "pageBBox": page_rect,
            "primitiveCount": len(source_primitives),
            "connectorCount": len(edges),
        },
        "confidence": _visual_confidence(len(nodes), len(edges), directed_count, len(source_primitives)),
        "disposition": "accepted" if len(nodes) >= 2 and (edges or not unresolved) else "review",
        "warnings": warnings,
        "errors": [],
        "groups": groups,
        "unresolved": unresolved,
        "sourcePrimitives": source_primitives,
    }
    return [visual_ir]


def visual_ir_to_mermaid(visual_ir: dict[str, Any]) -> str:
    return _mermaid_from_visual_ir(visual_ir)


def detect_vector_diagrams(page: Any, excluded_bboxes: list[BBox] | None = None) -> list[VisualRecovery]:
    """Adapter for legacy markdown output while the core recovery uses VisualIR."""

    visual_irs = detect_vector_visual_ir(page, excluded_bboxes=excluded_bboxes)
    out: list[VisualRecovery] = []
    for visual_ir in visual_irs:
        bbox = tuple(visual_ir.get("geometry", {}).get("bbox") or (0.0, 0.0, 0.0, 0.0))
        out.append(
            VisualRecovery(
                bbox=bbox,  # type: ignore[arg-type]
                visual_ir=visual_ir,
                warnings=tuple(visual_ir.get("warnings") or ()),
            )
        )
    return out
