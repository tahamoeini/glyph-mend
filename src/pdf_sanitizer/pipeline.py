from __future__ import annotations

import io
import os
import threading
from contextlib import redirect_stdout
from pathlib import Path
from time import perf_counter
from typing import Any

from .config import ExtractionConfig
from .extractor import ExtractionResult, _import_engines
from .native import native_markdown_chunk
from .native_stderr import NativeStderrCapture, capture_native_stderr
from .progress import ProgressCallback, emit_progress
from .quality import assess_layout_markdown
from .renderer import render_page_markdown
from .sanitize import sanitize_markdown
from .semantics import normalize_display_math_lines, normalize_task_lists


_LAYOUT_SWITCH_LOCK = threading.RLock()


def _layout_kwargs(config: ExtractionConfig, *, use_layout: bool) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "page_chunks": True,
        "write_images": False,
        "embed_images": False,
        "force_text": True,
        "ignore_code": False,
        "use_ocr": config.use_ocr,
        "force_ocr": config.force_ocr,
        "ocr_language": config.ocr_language,
        "ocr_dpi": config.ocr_dpi,
        "header": config.keep_headers,
        "footer": config.keep_footers,
        "show_progress": False,
    }
    if not use_layout:
        # The legacy PyMuPDF4LLM path can still infer tables from page graphics.
        # We want a text-only safety baseline here; real tables are reconstructed later
        # by our conservative region-level table extractor.
        kwargs["ignore_graphics"] = True
    return kwargs


def _store_batch_chunks(
    output: list[dict[str, Any]],
    batch_chunks: list[dict[str, Any]],
    selected_pages: list[int],
) -> None:
    """Map returned page chunks back to absolute 0-based PDF page positions."""

    unresolved: list[dict[str, Any]] = []
    for chunk in batch_chunks:
        metadata = chunk.get("metadata") if isinstance(chunk, dict) else None
        page_number = metadata.get("page_number") if isinstance(metadata, dict) else None
        try:
            index = int(page_number) - 1
        except (TypeError, ValueError):
            unresolved.append(chunk)
            continue
        if 0 <= index < len(output):
            output[index] = chunk
        else:
            unresolved.append(chunk)

    if unresolved:
        empty_positions = [
            index
            for index in selected_pages
            if not output[index].get("text") and not output[index].get("page_boxes")
        ]
        for index, chunk in zip(empty_positions, unresolved):
            output[index] = chunk


def _invoke_markdown(
    document: Any,
    pymupdf4llm: Any,
    config: ExtractionConfig,
    selected_pages: list[int],
    *,
    use_layout: bool,
) -> tuple[list[dict[str, Any]], NativeStderrCapture | None]:
    """Run one PyMuPDF4LLM call with controlled global layout state and diagnostics."""

    stdout_buffer = io.StringIO()
    capture: NativeStderrCapture | None = None

    # PyMuPDF4LLM exposes layout selection as process-global state. Serialize our own
    # switches so concurrent pdf-sanitizer calls cannot toggle the engine underneath
    # one another.
    with _LAYOUT_SWITCH_LOCK:
        pymupdf4llm.use_layout(use_layout)
        try:
            with capture_native_stderr(config.capture_engine_stderr) as native_capture:
                capture = native_capture
                if config.capture_engine_stderr:
                    with redirect_stdout(stdout_buffer):
                        result = pymupdf4llm.to_markdown(
                            document,
                            pages=selected_pages,
                            **_layout_kwargs(config, use_layout=use_layout),
                        )
                else:
                    result = pymupdf4llm.to_markdown(
                        document,
                        pages=selected_pages,
                        **_layout_kwargs(config, use_layout=use_layout),
                    )
        finally:
            # Restore the library default even after exceptions. This matters because
            # use_layout() is global to the imported PyMuPDF4LLM module.
            pymupdf4llm.use_layout(True)

    if capture is not None and stdout_buffer.getvalue():
        extra = stdout_buffer.getvalue()
        capture.text = (capture.text + "\n" + extra).strip()

    if not isinstance(result, list):
        raise RuntimeError("PyMuPDF4LLM returned an unexpected non-page-chunk result")
    return result, capture


def _capture_counts(capture: NativeStderrCapture | None) -> tuple[int, int]:
    if capture is None:
        return 0, 0
    return len(capture.known_noise), len(capture.unknown)


def _extract_layout_chunks(
    document: Any,
    pymupdf4llm: Any,
    config: ExtractionConfig,
    *,
    progress: ProgressCallback | None,
    pipeline_started: float,
) -> tuple[list[dict[str, Any]], int, int, int]:
    total = document.page_count
    chunks: list[dict[str, Any]] = [
        {"text": "", "page_boxes": [], "metadata": {"page_number": index + 1}}
        for index in range(total)
    ]
    layout_started = perf_counter()
    suppressed_noise = 0
    unknown_diagnostics = 0
    repaired_pages = 0

    primary_layout = config.layout_mode != "legacy"
    mode_label = "layout-aware" if primary_layout else "text-first"
    emit_progress(
        progress,
        "layout-start",
        f"Running batched {mode_label} Markdown extraction and OCR analysis",
        current=0,
        total=total,
        elapsed_seconds=layout_started - pipeline_started,
        details={
            "batch_pages": config.layout_batch_pages,
            "layout_mode": config.layout_mode,
        },
    )

    for start in range(0, total, config.layout_batch_pages):
        stop = min(total, start + config.layout_batch_pages)
        selected = list(range(start, stop))
        batch_started = perf_counter()

        batch_chunks, primary_capture = _invoke_markdown(
            document,
            pymupdf4llm,
            config,
            selected,
            use_layout=primary_layout,
        )
        _store_batch_chunks(chunks, batch_chunks, selected)
        for index in selected:
            metadata = chunks[index].setdefault("metadata", {})
            if isinstance(metadata, dict):
                metadata.setdefault("source", "layout" if primary_layout else "text-first")

        batch_noise, batch_unknown = _capture_counts(primary_capture)
        repair_selected: list[int] = []
        repair_details: list[dict[str, object]] = []
        legacy_repair_selected: list[int] = []
        repair_capture: NativeStderrCapture | None = None

        if config.layout_mode == "auto":
            for index in selected:
                quality = assess_layout_markdown(
                    str(chunks[index].get("text") or ""),
                    document[index],
                )
                if not quality.suspicious:
                    continue
                repair_selected.append(index)
                repair_details.append(
                    {
                        "page": index + 1,
                        "table_ratio": round(quality.table_ratio, 3),
                        "table_rows": quality.table_rows,
                        "prose_lines": quality.prose_lines,
                        "split_word_boundaries": quality.split_word_boundaries,
                    }
                )

            if repair_selected:
                # Do not ask the same layout stack to reinterpret a page it already
                # mangled. Native PyMuPDF text geometry becomes the deterministic base;
                # tables/equations/diagrams are overlaid later by independent detectors.
                for index in repair_selected:
                    native_chunk = native_markdown_chunk(document[index], index + 1)
                    if str(native_chunk.get("text") or "").strip():
                        chunks[index] = native_chunk
                    else:
                        legacy_repair_selected.append(index)

                # Image-only/scanned pages may have no useful native text. For those
                # only, fall back to PyMuPDF4LLM without Layout and with graphics/table
                # inference disabled, preserving OCR while avoiding page-wide grids.
                if legacy_repair_selected:
                    repair_chunks, repair_capture = _invoke_markdown(
                        document,
                        pymupdf4llm,
                        config,
                        legacy_repair_selected,
                        use_layout=False,
                    )
                    _store_batch_chunks(chunks, repair_chunks, legacy_repair_selected)
                    for index in legacy_repair_selected:
                        metadata = chunks[index].setdefault("metadata", {})
                        if isinstance(metadata, dict):
                            metadata["source"] = "text-first-ocr"

                repaired_pages += len(repair_selected)
                emit_progress(
                    progress,
                    "layout-repair",
                    f"Rebuilt {len(repair_selected)} suspicious layout page(s) from text-first geometry",
                    current=stop,
                    total=total,
                    elapsed_seconds=perf_counter() - pipeline_started,
                    details={
                        "pages": [index + 1 for index in repair_selected],
                        "ocr_fallback_pages": [index + 1 for index in legacy_repair_selected],
                        "sample_evidence": repair_details[:3],
                    },
                )

        repair_noise, repair_unknown = _capture_counts(repair_capture)
        batch_noise += repair_noise
        batch_unknown += repair_unknown
        suppressed_noise += batch_noise
        unknown_diagnostics += batch_unknown

        captures = [capture for capture in (primary_capture, repair_capture) if capture is not None]
        unknown_lines = [line for capture in captures for line in capture.unknown]

        if batch_unknown:
            emit_progress(
                progress,
                "engine-warning",
                "Native OCR/layout engine emitted unexpected diagnostics",
                current=stop,
                total=total,
                elapsed_seconds=perf_counter() - pipeline_started,
                details={
                    "count": batch_unknown,
                    "sample": unknown_lines[:3],
                    "page_range": f"{start + 1}-{stop}",
                },
            )

        emit_progress(
            progress,
            "layout",
            f"Layout/OCR processed pages {start + 1}-{stop}",
            current=stop,
            total=total,
            elapsed_seconds=perf_counter() - pipeline_started,
            details={
                "batch_seconds": round(perf_counter() - batch_started, 3),
                "returned_chunks": len(batch_chunks),
                "repaired_pages": len(repair_selected),
                "suppressed_native_noise": batch_noise,
                "unexpected_native_diagnostics": batch_unknown,
            },
        )

    emit_progress(
        progress,
        "layout-complete",
        "Layout extraction completed; running semantic page passes",
        current=total,
        total=total,
        elapsed_seconds=perf_counter() - layout_started,
        details={
            "chunks": len(chunks),
            "layout_mode": config.layout_mode,
            "repaired_pages": repaired_pages,
            "suppressed_native_noise": suppressed_noise,
            "unexpected_native_diagnostics": unknown_diagnostics,
        },
    )
    return chunks, suppressed_noise, unknown_diagnostics, repaired_pages


def extract_pdf(
    pdf_path: str | os.PathLike[str],
    *,
    config: ExtractionConfig | None = None,
    password: str | None = None,
    progress: ProgressCallback | None = None,
) -> ExtractionResult:
    """Extract a PDF into sanitized Markdown with observable batched progress."""

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
                "layout_mode": config.layout_mode,
                "layout_batch_pages": config.layout_batch_pages,
                "capture_engine_stderr": config.capture_engine_stderr,
            },
        )

        chunks, suppressed_noise, unknown_diagnostics, repaired_pages = _extract_layout_chunks(
            document,
            pymupdf4llm,
            config,
            progress=progress,
            pipeline_started=started,
        )

        pages: list[str] = []
        fallback_pages = 0
        for index, page in enumerate(document):
            page_number = index + 1
            chunk = chunks[index]
            try:
                pages.append(
                    render_page_markdown(
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
                fallback_chunk = native_markdown_chunk(page, page_number)
                fallback = sanitize_markdown(str(fallback_chunk.get("text") or chunk.get("text") or ""))
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
                    f"Page {page_number} used safe native-text fallback",
                    current=page_number,
                    total=document.page_count,
                    page=page_number,
                    elapsed_seconds=perf_counter() - started,
                    details={"error_type": type(exc).__name__, "error": str(exc)},
                )

        markdown = sanitize_markdown("\n\n".join(page for page in pages if page.strip()))
        metadata = dict(document.metadata or {})
        metadata.update(
            {
                "page_count": document.page_count,
                "source_filename": path.name,
                "layout_mode": config.layout_mode,
                "layout_repaired_pages": repaired_pages,
            }
        )
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
                "layout_repaired_pages": repaired_pages,
                "suppressed_native_noise": suppressed_noise,
                "unexpected_native_diagnostics": unknown_diagnostics,
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
