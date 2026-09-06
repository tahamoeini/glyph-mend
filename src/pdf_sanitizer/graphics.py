from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from .sanitize import sanitize_label

BBox = tuple[float, float, float, float]


@dataclass(frozen=True, slots=True)
class VectorDiagram:
    bbox: BBox
    markdown: str
    node_count: int
    edge_count: int


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


def _escape_mermaid_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', "'").replace("\n", " ")


def _diagram_markdown(labels: list[str], edges: set[tuple[int, int]], direction: str) -> str:
    lines = ["```mermaid", f"flowchart {direction}"]
    for idx, label in enumerate(labels, start=1):
        lines.append(f'    N{idx}["{_escape_mermaid_label(label)}"]')
    for left, right in sorted(edges):
        lines.append(f"    N{left + 1} --- N{right + 1}")
    lines.append("```")
    return "\n".join(lines)


def detect_vector_diagrams(page: Any, excluded_bboxes: list[BBox] | None = None) -> list[VectorDiagram]:
    """Conservatively reconstruct simple box-and-connector vector diagrams as Mermaid.

    It intentionally refuses ambiguous graphics. Anything not reconstructed here is left
    for the extractor to represent with a GRAPHIC_PLACEHOLDER.
    """

    excluded_bboxes = excluded_bboxes or []
    try:
        drawings = page.get_drawings()
        page_rect: BBox = _as_bbox(page.rect) or (0.0, 0.0, 1.0, 1.0)
    except Exception:
        return []

    page_area = max(1.0, rect_area(page_rect))
    candidate_rects: list[BBox] = []
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []

    for path in drawings:
        for item in path.get("items", []):
            if not item:
                continue
            command = item[0]
            if command == "re" and len(item) >= 2:
                rect = _as_bbox(item[1])
                if not rect:
                    continue
                width = rect[2] - rect[0]
                height = rect[3] - rect[1]
                area = rect_area(rect)
                if width < 24 or height < 12 or area > page_area * 0.18:
                    continue
                if any(overlap_ratio(rect, excluded) > 0.25 for excluded in excluded_bboxes):
                    continue
                candidate_rects.append(rect)
            elif command == "l" and len(item) >= 3:
                p1 = _point_xy(item[1])
                p2 = _point_xy(item[2])
                if p1 and p2:
                    segments.append((p1, p2))

    candidate_rects = _dedupe_rects(candidate_rects)
    if len(candidate_rects) < 2:
        return []

    labeled_nodes: list[tuple[BBox, str]] = []
    for rect in candidate_rects:
        try:
            label = sanitize_label(page.get_textbox(rect), fallback="")
        except Exception:
            label = ""
        if label:
            labeled_nodes.append((rect, label))

    if len(labeled_nodes) < 2:
        return []

    rects = [item[0] for item in labeled_nodes]
    labels = [item[1] for item in labeled_nodes]
    tolerance = 12.0
    edges: set[tuple[int, int]] = set()

    for p1, p2 in segments:
        left = next((i for i, rect in enumerate(rects) if _point_near_rect(p1, rect, tolerance)), None)
        right = next((i for i, rect in enumerate(rects) if _point_near_rect(p2, rect, tolerance)), None)
        if left is None or right is None or left == right:
            continue
        edges.add(tuple(sorted((left, right))))

    # Two or more labeled boxes with at least one connector is a defensible flow diagram.
    if not edges:
        return []

    # Keep only nodes that participate in the connector graph. This prevents unrelated
    # form fields or decorative boxes elsewhere on the page from leaking into Mermaid.
    used = sorted({index for edge in edges for index in edge})
    remap = {old_index: new_index for new_index, old_index in enumerate(used)}
    rects = [rects[index] for index in used]
    labels = [labels[index] for index in used]
    edges = {(remap[left], remap[right]) for left, right in edges}

    bbox = merge_bbox(rects)
    x_centers = [(r[0] + r[2]) / 2 for r in rects]
    y_centers = [(r[1] + r[3]) / 2 for r in rects]
    x_spread = max(x_centers) - min(x_centers)
    y_spread = max(y_centers) - min(y_centers)
    direction = "TD" if y_spread >= x_spread else "LR"

    return [
        VectorDiagram(
            bbox=bbox,
            markdown=_diagram_markdown(labels, edges, direction),
            node_count=len(labels),
            edge_count=len(edges),
        )
    ]
