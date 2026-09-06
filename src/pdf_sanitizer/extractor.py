from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import ExtractionConfig
from .graphics import (
    BBox,
    VectorDiagram,
    detect_vector_diagrams,
    format_bbox,
    overlap_ratio,
    rect_area,
)
from .sanitize import sanitize_markdown


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    source: Path
    markdown: str
    page_count: int
    metadata: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _Replacement:
    start: int
    stop: int
    text: str
    priority: int
    bbox: BBox


def _import_engines() -> tuple[Any, Any]:
    try:
        import pymupdf
        import pymupdf4llm
    except ImportError as exc:
        raise RuntimeError(
            "pdf-sanitizer requires PyMuPDF and PyMuPDF4LLM. Install the project dependencies first."
        ) from exc
    return pymupdf, pymupdf4llm


def _bbox(value: Any) -> BBox | None:
    try:
        return (float(value[0]), float(value[1]), float(value[2]), float(value[3]))
    except Exception:
        return None


def _box_span(page_boxes: list[dict[str, Any]], target: BBox, threshold: float = 0.45) -> tuple[int, int] | None:
    spans: list[tuple[int, int]] = []
    for box in page_boxes:
        box_bbox = _bbox(box.get("bbox"))
        pos = box.get("pos")
        if not box_bbox or not isinstance(pos, (list, tuple)) or len(pos) != 2:
            continue
        if overlap_ratio(box_bbox, target) < threshold:
            continue
        try:
            start, stop = int(pos[0]), int(pos[1])
        except Exception:
            continue
        if 0 <= start <= stop:
            spans.append((start, stop))
    if not spans:
        return None
    return min(s[0] for s in spans), max(s[1] for s in spans)


def _insertion_pos(page_boxes: list[dict[str, Any]], target: BBox, text_length: int) -> int:
    target_y = target[1]
    candidates: list[tuple[float, int]] = []
    for box in page_boxes:
        box_bbox = _bbox(box.get("bbox"))
        pos = box.get("pos")
        if not box_bbox or not isinstance(pos, (list, tuple)) or len(pos) != 2:
            continue
        if box_bbox[1] >= target_y:
            try:
                candidates.append((box_bbox[1], int(pos[0])))
            except Exception:
                continue
    return min(candidates, default=(0.0, text_length))[1]


def _select_replacements(items: list[_Replacement]) -> list[_Replacement]:
    selected: list[_Replacement] = []
    for item in sorted(items, key=lambda r: (-r.priority, r.start, -(r.stop - r.start))):
        conflict = False
        for existing in selected:
            # Insertions at the same character offset are allowed; they will be ordered later.
            if item.start == item.stop and existing.start == existing.stop:
                continue
            if max(item.start, existing.start) < min(item.stop, existing.stop):
                conflict = True
                break
        if not conflict:
            selected.append(item)
    return selected


def _apply_replacements(text: str, replacements: list[_Replacement]) -> str:
    value = text
    # Reverse-order edits preserve original character offsets.
    ordered = sorted(
        _select_replacements(replacements),
        key=lambda r: (r.start, r.stop, r.priority),
        reverse=True,
    )
    for item in ordered:
        start = max(0, min(len(value), item.start))
        stop = max(start, min(len(value), item.stop))
        prefix = "\n\n" if start and not value[:start].endswith("\n") else ""
        suffix = "\n\n" if stop < len(value) and not value[stop:].startswith("\n") else ""
        value = value[:start] + prefix + item.text.strip() + suffix + value[stop:]
    return value


def _extract_tables(page: Any) -> list[tuple[BBox, str]]:
    try:
        finder = page.find_tables()
    except Exception:
        try:
            finder = page.find_tables(strategy="text")
        except Exception:
            return []

    output: list[tuple[BBox, str]] = []
    for table in getattr(finder, "tables", []):
        try:
            if getattr(table, "row_count", 0) < 2 or getattr(table, "col_count", 0) < 2:
                continue
            rect = _bbox(table.bbox)
            if not rect or rect_area(rect) <= 0:
                continue
            try:
                markdown = table.to_markdown(clean=True, fill_empty=True)
            except TypeError:
                markdown = table.to_markdown()
            markdown = sanitize_markdown(markdown)
            if markdown.count("|") < 4:
                continue
            output.append((rect, markdown))
        except Exception:
            continue
    return output


def _picture_boxes(page_boxes: list[dict[str, Any]]) -> list[tuple[BBox, tuple[int, int] | None]]:
    pictures: list[tuple[BBox, tuple[int, int] | None]] = []
    for box in page_boxes:
        if str(box.get("class", "")).lower() != "picture":
            continue
        rect = _bbox(box.get("bbox"))
        if not rect:
            continue
        pos = box.get("pos")
        span: tuple[int, int] | None = None
        if isinstance(pos, (list, tuple)) and len(pos) == 2:
            try:
                span = (int(pos[0]), int(pos[1]))
            except Exception:
                span = None
        pictures.append((rect, span))
    return pictures


def _image_boxes(page: Any) -> list[BBox]:
    try:
        infos = page.get_image_info(xrefs=True)
    except Exception:
        return []
    output: list[BBox] = []
    for info in infos:
        rect = _bbox(info.get("bbox")) if isinstance(info, dict) else None
        if rect and rect_area(rect) > 0:
            output.append(rect)
    return output


def _graphic_clusters(page: Any) -> list[BBox]:
    try:
        clusters = page.cluster_drawings()
    except Exception:
        try:
            clusters = [path.get("rect") for path in page.get_drawings() if path.get("rect")]
        except Exception:
            return []
    output: list[BBox] = []
    for item in clusters:
        rect = _bbox(item)
        if rect and rect_area(rect) > 0:
            output.append(rect)
    return output


def _overlaps_any(rect: BBox, others: list[BBox], threshold: float = 0.25) -> bool:
    return any(overlap_ratio(rect, other) >= threshold for other in others)


def _page_markdown(
    page: Any,
    chunk: dict[str, Any],
    page_number: int,
    config: ExtractionConfig,
) -> str:
    text = str(chunk.get("text") or "")
    page_boxes = list(chunk.get("page_boxes") or [])
    page_rect = _bbox(page.rect) or (0.0, 0.0, 1.0, 1.0)
    page_area = max(1.0, rect_area(page_rect))
    replacements: list[_Replacement] = []

    tables = _extract_tables(page) if config.extract_tables else []
    table_bboxes = [rect for rect, _ in tables]
    for rect, table_md in tables:
        span = _box_span(page_boxes, rect)
        if span:
            existing = text[span[0] : span[1]]
            # PyMuPDF4LLM often already did the correct job. Do not churn good tables.
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
        consumed_visuals = table_bboxes + diagram_bboxes

        for rect, span in picture_boxes:
            area_ratio = rect_area(rect) / page_area
            if area_ratio < config.min_image_area_ratio or _overlaps_any(rect, consumed_visuals):
                continue

            # A full-page raster with little native text is probably a scanned page.
            # Keep OCR output instead of replacing the page with one useless placeholder.
            if area_ratio >= config.full_page_scan_ratio and len(native_text) < 50 and len(text.strip()) >= 80:
                continue

            placeholder = f'[IMAGE_PLACEHOLDER page={page_number} bbox="{format_bbox(rect)}"]'
            if span and span[1] > span[0]:
                replacements.append(_Replacement(span[0], span[1], placeholder, 60, rect))
            else:
                pos = _insertion_pos(page_boxes, rect, len(text))
                replacements.append(_Replacement(pos, pos, placeholder, 60, rect))
            consumed_visuals.append(rect)

        for rect in _image_boxes(page):
            if rect_area(rect) / page_area < config.min_image_area_ratio:
                continue
            if _overlaps_any(rect, consumed_visuals, threshold=0.60):
                continue
            pos = _insertion_pos(page_boxes, rect, len(text))
            placeholder = f'[IMAGE_PLACEHOLDER page={page_number} bbox="{format_bbox(rect)}"]'
            replacements.append(_Replacement(pos, pos, placeholder, 50, rect))
            consumed_visuals.append(rect)

        for rect in _graphic_clusters(page):
            if rect_area(rect) / page_area < config.min_graphic_area_ratio:
                continue
            if _overlaps_any(rect, consumed_visuals):
                continue
            pos = _insertion_pos(page_boxes, rect, len(text))
            placeholder = f'[GRAPHIC_PLACEHOLDER page={page_number} bbox="{format_bbox(rect)}"]'
            replacements.append(_Replacement(pos, pos, placeholder, 40, rect))
            consumed_visuals.append(rect)

    output = sanitize_markdown(_apply_replacements(text, replacements))
    if config.include_page_markers:
        marker = f"<!-- page: {page_number} -->"
        output = f"{marker}\n\n{output}" if output else marker
    return output


def extract_pdf(
    pdf_path: str | os.PathLike[str],
    *,
    config: ExtractionConfig | None = None,
    password: str | None = None,
) -> ExtractionResult:
    """Extract a PDF into sanitized Markdown without calling external services."""

    config = config or ExtractionConfig()
    config.validate()
    path = Path(pdf_path).expanduser().resolve()

    if not path.is_file():
        raise FileNotFoundError(path)
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"Expected a .pdf file: {path}")
    if path.stat().st_size > config.max_file_mb * 1024 * 1024:
        raise ValueError(f"PDF exceeds max_file_mb={config.max_file_mb}: {path}")

    pymupdf, pymupdf4llm = _import_engines()
    document = pymupdf.open(path)
    try:
        if document.needs_pass:
            if not password or document.authenticate(password) <= 0:
                raise PermissionError("PDF is password-protected; supply a valid password")

        if config.max_pages is not None and document.page_count > config.max_pages:
            raise ValueError(
                f"PDF has {document.page_count} pages, exceeding max_pages={config.max_pages}"
            )

        chunks = pymupdf4llm.to_markdown(
            document,
            page_chunks=True,
            write_images=False,
            embed_images=False,
            force_text=True,
            use_ocr=config.use_ocr,
            force_ocr=config.force_ocr,
            ocr_language=config.ocr_language,
            ocr_dpi=config.ocr_dpi,
            header=config.keep_headers,
            footer=config.keep_footers,
            show_progress=False,
        )
        if not isinstance(chunks, list):
            raise RuntimeError("PyMuPDF4LLM returned an unexpected non-page-chunk result")

        pages: list[str] = []
        for index, page in enumerate(document):
            chunk = chunks[index] if index < len(chunks) else {"text": "", "page_boxes": []}
            try:
                pages.append(_page_markdown(page, chunk, index + 1, config))
            except Exception:
                if config.strict:
                    raise
                fallback = sanitize_markdown(str(chunk.get("text") or ""))
                if config.include_page_markers:
                    fallback = f"<!-- page: {index + 1} -->\n\n{fallback}".strip()
                pages.append(fallback)

        markdown = sanitize_markdown("\n\n".join(page for page in pages if page.strip()))
        metadata = dict(document.metadata or {})
        metadata.update({"page_count": document.page_count, "source_filename": path.name})
        return ExtractionResult(
            source=path,
            markdown=markdown,
            page_count=document.page_count,
            metadata=metadata,
        )
    finally:
        document.close()
