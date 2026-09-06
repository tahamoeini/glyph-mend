from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
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
from .progress import ProgressCallback, emit_progress
from .sanitize import sanitize_markdown
from .semantics import (
    detect_display_equations,
    normalize_display_math_lines,
    normalize_task_lists,
)


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


def _box_span(
    page_boxes: list[dict[str, Any]],
    target: BBox,
    threshold: float = 0.45,
) -> tuple[int, int] | None:
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


def _source_span(text: str, source: str) -> tuple[int, int] | None:
    source = source.strip()
    if not source:
        return None
    start = text.find(source)
    if start < 0:
        return None
    if text.find(source, start + 1) >= 0:
        return None
    return start, start + len(source)


def _equation_span(
    text: str,
    page_boxes: list[dict[str, Any]],
    bbox: BBox,
    source: str,
) -> tuple[int, int] | None:
    exact = _source_span(text, source)
    if exact:
        return exact

    geometric = _box_span(page_boxes, bbox, threshold=0.55)
    if not geometric:
        return None
    span_length = geometric[1] - geometric[0]
    # Do not let a small equation replace a large paragraph-level layout box.
    if span_length <= max(32, int(len(source) * 2.5)):
        return geometric
    return None


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


def _table_from_words(page: Any, rect: BBox) -> str | None:
    try:
        words = page.get_text("words", clip=(rect[0], rect[1], rect[2], rect[3]))
    except Exception:
        return None
    if not words:
        return None

    rows: list[list[dict[str, float | str]]] = []
    current: list[dict[str, float | str]] = []
    current_y: float | None = None
    for word in words:
        try:
            if isinstance(word, (list, tuple)) and len(word) >= 5:
                x0, y0, x1, y1, text = word[:5]
            else:
                continue
        except Exception:
            continue
        label = str(text).strip()
        if not label:
            continue
        item = {"x0": float(x0), "x1": float(x1), "y0": float(y0), "text": label}
        if current_y is None:
            current_y = item["y0"]
        if abs(float(item["y0"]) - float(current_y)) > 12:
            rows.append(current)
            current = [item]
            current_y = item["y0"]
        else:
            current.append(item)
    if current:
        rows.append(current)

    normalized: list[list[str]] = []
    for row in rows:
        if not row:
            continue
        row = sorted(row, key=lambda item: float(item["x0"]))
        cells: list[list[dict[str, float | str]]] = []
        current_cell: list[dict[str, float | str]] = [row[0]]
        for item in row[1:]:
            gap = float(item["x0"]) - float(current_cell[-1]["x1"])
            if gap > 18.0:
                cells.append(current_cell)
                current_cell = [item]
            else:
                current_cell.append(item)
        cells.append(current_cell)
        values = [" ".join(str(part["text"]) for part in cell).strip() for cell in cells if cell]
        if values:
            normalized.append(values)

    if len(normalized) < 2:
        return None
    if max(len(row) for row in normalized) < 2:
        return None

    header = normalized[0]
    body = normalized[1:]
    width = max(len(header), max((len(row) for row in body), default=len(header)))
    lines = [
        "| " + " | ".join(header[:width]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        cells = row[:width] + [""] * max(0, width - len(row))
        lines.append("| " + " | ".join(cells) + " |")
    markdown = "\n".join(lines)
    return markdown if markdown.count("|") >= 4 else None


def _extract_tables(page: Any) -> list[tuple[BBox, str]]:
    attempts = (
        {},
        {"use_layout": False},
        {"strategy": "text", "use_layout": False},
    )

    for kwargs in attempts:
        try:
            finder = page.find_tables(**kwargs)
        except Exception:
            continue

        this_output: list[tuple[BBox, str]] = []
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
                this_output.append((rect, markdown))
            except Exception:
                continue

        if this_output:
            return this_output

    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []

    candidates: list[BBox] = []
    for path in drawings:
        rect = _bbox(path.get("rect"))
        if not rect or rect_area(rect) <= 0:
            continue
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if width < 45 or height < 20:
            continue
        candidates.append(rect)

    for rect in sorted(candidates, key=rect_area, reverse=True):
        markdown = _table_from_words(page, rect)
        if markdown:
            return [(rect, markdown)]

    return []


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
    *,
    progress: ProgressCallback | None = None,
    total_pages: int | None = None,
) -> str:
    page_started = perf_counter()
    text = str(chunk.get("text") or "")
    page_boxes = list(chunk.get("page_boxes") or [])
    page_rect = _bbox(page.rect) or (0.0, 0.0, 1.0, 1.0)
    page_area = max(1.0, rect_area(page_rect))
    replacements: list[_Replacement] = []
    placeholder_count = 0

    tables = _extract_tables(page) if config.extract_tables else []
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
        },
    )
    return output


def extract_pdf(
    pdf_path: str | os.PathLike[str],
    *,
    config: ExtractionConfig | None = None,
    password: str | None = None,
    progress: ProgressCallback | None = None,
) -> ExtractionResult:
    """Extract a PDF into sanitized Markdown without calling external services.

    ``progress`` receives typed, non-content progress events. It is suitable for CLI logs,
    GUIs, notebooks, job runners, or telemetry controlled by the caller.
    """

    started = perf_counter()
    config = config or ExtractionConfig()
    document = None
    path = Path(pdf_path).expanduser().resolve()

    try:
        emit_progress(progress, "validate", "Validating input PDF", details={"path": str(path)})
        config.validate()

        if not path.is_file():
            raise FileNotFoundError(path)
        if path.suffix.lower() != ".pdf":
            raise ValueError(f"Expected a .pdf file: {path}")
        file_size = path.stat().st_size
        if file_size > config.max_file_mb * 1024 * 1024:
            raise ValueError(f"PDF exceeds max_file_mb={config.max_file_mb}: {path}")

        pymupdf, pymupdf4llm = _import_engines()
        emit_progress(
            progress,
            "engine",
            "PDF extraction engines loaded",
            elapsed_seconds=perf_counter() - started,
            details={
                "pymupdf": str(getattr(pymupdf, "__version__", "unknown")),
                "pymupdf4llm": str(getattr(pymupdf4llm, "version", "unknown")),
            },
        )

        document = pymupdf.open(path)
        if document.needs_pass:
            if not password or document.authenticate(password) <= 0:
                raise PermissionError("PDF is password-protected; supply a valid password")

        if config.max_pages is not None and document.page_count > config.max_pages:
            raise ValueError(
                f"PDF has {document.page_count} pages, exceeding max_pages={config.max_pages}"
            )

        emit_progress(
            progress,
            "open",
            f"Opened PDF with {document.page_count} page(s)",
            current=0,
            total=document.page_count,
            elapsed_seconds=perf_counter() - started,
            details={
                "file_mb": round(file_size / (1024 * 1024), 3),
                "page_count": document.page_count,
                "ocr_enabled": config.use_ocr,
                "force_ocr": config.force_ocr,
                "ocr_language": config.ocr_language,
            },
        )

        layout_started = perf_counter()
        emit_progress(
            progress,
            "layout-start",
            "Running layout-aware Markdown extraction and OCR analysis",
            current=0,
            total=document.page_count,
            elapsed_seconds=layout_started - started,
        )
        chunks = pymupdf4llm.to_markdown(
            document,
            page_chunks=True,
            write_images=False,
            embed_images=False,
            force_text=True,
            ignore_code=False,
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
        emit_progress(
            progress,
            "layout-complete",
            "Layout-aware extraction completed; running semantic page passes",
            current=0,
            total=document.page_count,
            elapsed_seconds=perf_counter() - layout_started,
            details={"chunks": len(chunks)},
        )

        pages: list[str] = []
        fallback_pages = 0
        for index, page in enumerate(document):
            page_number = index + 1
            chunk = chunks[index] if index < len(chunks) else {"text": "", "page_boxes": []}
            try:
                pages.append(
                    _page_markdown(
                        page,
                        chunk,
                        page_number,
                        config,
                        progress=progress,
                        total_pages=document.page_count,
                    )
                )
            except Exception as exc:
                if config.strict:
                    raise
                fallback_pages += 1
                fallback = sanitize_markdown(str(chunk.get("text") or ""))
                if config.extract_equations:
                    fallback = normalize_display_math_lines(fallback)
                if config.normalize_task_lists:
                    fallback = normalize_task_lists(fallback)
                if config.include_page_markers:
                    fallback = f"<!-- page: {page_number} -->\n\n{fallback}".strip()
                pages.append(fallback)
                emit_progress(
                    progress,
                    "page-fallback",
                    f"Page {page_number} used safe text fallback",
                    current=page_number,
                    total=document.page_count,
                    page=page_number,
                    elapsed_seconds=perf_counter() - started,
                    details={"error_type": type(exc).__name__, "error": str(exc)},
                )

        markdown = sanitize_markdown("\n\n".join(page for page in pages if page.strip()))
        metadata = dict(document.metadata or {})
        metadata.update({"page_count": document.page_count, "source_filename": path.name})
        result = ExtractionResult(
            source=path,
            markdown=markdown,
            page_count=document.page_count,
            metadata=metadata,
        )
        emit_progress(
            progress,
            "complete",
            f"Extraction completed: {document.page_count} page(s)",
            current=document.page_count,
            total=document.page_count,
            elapsed_seconds=perf_counter() - started,
            details={
                "output_chars": len(markdown),
                "fallback_pages": fallback_pages,
            },
        )
        return result
    except Exception as exc:
        emit_progress(
            progress,
            "error",
            "Extraction failed",
            elapsed_seconds=perf_counter() - started,
            details={"error_type": type(exc).__name__, "error": str(exc)},
        )
        raise
    finally:
        if document is not None:
            document.close()
