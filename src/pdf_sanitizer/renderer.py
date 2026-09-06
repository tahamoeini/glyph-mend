from __future__ import annotations

from time import perf_counter
from typing import Any

from .config import ExtractionConfig
from .extractor import (
    _Replacement,
    _apply_replacements,
    _bbox,
    _box_span,
    _equation_span,
    _graphic_clusters,
    _image_boxes,
    _insertion_pos,
    _overlaps_any,
    _picture_boxes,
)
from .graphics import (
    VectorDiagram,
    detect_vector_diagrams,
    format_bbox,
    rect_area,
)
from .progress import ProgressCallback, emit_progress
from .sanitize import sanitize_markdown
from .semantics import (
    detect_display_equations,
    normalize_display_math_lines,
    normalize_task_lists,
)
from .tables import extract_tables


def render_page_markdown(
    page: Any,
    chunk: dict[str, Any],
    page_number: int,
    config: ExtractionConfig,
    *,
    progress: ProgressCallback | None = None,
    total_pages: int | None = None,
) -> str:
    """Render one page from a text/layout chunk plus conservative semantic overlays."""

    page_started = perf_counter()
    text = str(chunk.get("text") or "")
    page_boxes = list(chunk.get("page_boxes") or [])
    page_rect = _bbox(page.rect) or (0.0, 0.0, 1.0, 1.0)
    page_area = max(1.0, rect_area(page_rect))
    replacements: list[_Replacement] = []
    placeholder_count = 0

    tables = extract_tables(page) if config.extract_tables else []
    table_bboxes = [rect for rect, _ in tables]
    for rect, table_md in tables:
        span = _box_span(page_boxes, rect)
        if span:
            existing = text[span[0] : span[1]]
            if existing.count("|") >= 4 and "\n" in existing:
                continue
            replacements.append(_Replacement(span[0], span[1], table_md, 100, rect))
        else:
            pos = _insertion_pos(page_boxes, rect, len(text))
            replacements.append(_Replacement(pos, pos, table_md, 100, rect))

    diagrams: list[VectorDiagram] = []
    if config.detect_vector_flows:
        diagrams = detect_vector_diagrams(page, excluded_bboxes=table_bboxes)
    diagram_bboxes = [item.bbox for item in diagrams]

    equations = []
    if config.extract_equations:
        equations = detect_display_equations(
            page,
            excluded_bboxes=table_bboxes + diagram_bboxes,
        )
    equation_bboxes = [item.bbox for item in equations]
    for equation in equations:
        span = _equation_span(text, page_boxes, equation.bbox, equation.source_text)
        if span:
            replacements.append(_Replacement(span[0], span[1], equation.markdown, 95, equation.bbox))
        else:
            pos = _insertion_pos(page_boxes, equation.bbox, len(text))
            replacements.append(_Replacement(pos, pos, equation.markdown, 95, equation.bbox))

    for diagram in diagrams:
        span = _box_span(page_boxes, diagram.bbox, threshold=0.30)
        if span:
            replacements.append(_Replacement(span[0], span[1], diagram.markdown, 90, diagram.bbox))
        else:
            pos = _insertion_pos(page_boxes, diagram.bbox, len(text))
            replacements.append(_Replacement(pos, pos, diagram.markdown, 90, diagram.bbox))

    if config.include_visual_placeholders:
        native_text = (page.get_text("text") or "").strip()
        picture_boxes = _picture_boxes(page_boxes)
        consumed_visuals = table_bboxes + equation_bboxes + diagram_bboxes

        for rect, span in picture_boxes:
            area_ratio = rect_area(rect) / page_area
            if area_ratio < config.min_image_area_ratio or _overlaps_any(rect, consumed_visuals):
                continue

            if area_ratio >= config.full_page_scan_ratio and len(native_text) < 50 and len(text.strip()) >= 80:
                continue

            placeholder = f'[IMAGE_PLACEHOLDER page={page_number} bbox="{format_bbox(rect)}"]'
            if span and span[1] > span[0]:
                replacements.append(_Replacement(span[0], span[1], placeholder, 60, rect))
            else:
                pos = _insertion_pos(page_boxes, rect, len(text))
                replacements.append(_Replacement(pos, pos, placeholder, 60, rect))
            placeholder_count += 1
            consumed_visuals.append(rect)

        for rect in _image_boxes(page):
            if rect_area(rect) / page_area < config.min_image_area_ratio:
                continue
            if _overlaps_any(rect, consumed_visuals, threshold=0.60):
                continue
            pos = _insertion_pos(page_boxes, rect, len(text))
            placeholder = f'[IMAGE_PLACEHOLDER page={page_number} bbox="{format_bbox(rect)}"]'
            replacements.append(_Replacement(pos, pos, placeholder, 50, rect))
            placeholder_count += 1
            consumed_visuals.append(rect)

        for rect in _graphic_clusters(page):
            if rect_area(rect) / page_area < config.min_graphic_area_ratio:
                continue
            if _overlaps_any(rect, consumed_visuals):
                continue
            pos = _insertion_pos(page_boxes, rect, len(text))
            placeholder = f'[GRAPHIC_PLACEHOLDER page={page_number} bbox="{format_bbox(rect)}"]'
            replacements.append(_Replacement(pos, pos, placeholder, 40, rect))
            placeholder_count += 1
            consumed_visuals.append(rect)

    output = sanitize_markdown(_apply_replacements(text, replacements))
    if config.extract_equations:
        output = normalize_display_math_lines(output)
    if config.normalize_task_lists:
        output = normalize_task_lists(output)
    if config.include_page_markers:
        marker = f"<!-- page: {page_number} -->"
        output = f"{marker}\n\n{output}" if output else marker

    emit_progress(
        progress,
        "page",
        f"Processed page {page_number}" + (f"/{total_pages}" if total_pages else ""),
        current=page_number,
        total=total_pages,
        page=page_number,
        elapsed_seconds=perf_counter() - page_started,
        details={
            "tables": len(tables),
            "equations": len(equations),
            "flows": len(diagrams),
            "visual_placeholders": placeholder_count,
            "output_chars": len(output),
            "text_source": str((chunk.get("metadata") or {}).get("source") or "layout"),
        },
    )
    return output
