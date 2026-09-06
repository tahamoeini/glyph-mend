from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter
from typing import Any

from .config import ExtractionConfig
from .extractor import ExtractionResult, _import_engines, _page_markdown
from .native_stderr import capture_native_stderr
from .progress import ProgressCallback, emit_progress
from .sanitize import sanitize_markdown
from .semantics import normalize_display_math_lines, normalize_task_lists


def _layout_kwargs(config: ExtractionConfig) -> dict[str, Any]:
    return {
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


def _extract_layout_chunks(
    document: Any,
    pymupdf4llm: Any,
    config: ExtractionConfig,
    *,
    progress: ProgressCallback | None,
    pipeline_started: float,
) -> tuple[list[dict[str, Any]], int, int]:
    total = document.page_count
    chunks: list[dict[str, Any]] = [
        {"text": "", "page_boxes": [], "metadata": {"page_number": index + 1}}
        for index in range(total)
    ]
    layout_started = perf_counter()
    suppressed_noise = 0
    unknown_diagnostics = 0

    emit_progress(
        progress,
        "layout-start",
        "Running batched layout-aware Markdown extraction and OCR analysis",
        current=0,
        total=total,
        elapsed_seconds=layout_started - pipeline_started,
        details={"batch_pages": config.layout_batch_pages},
    )

    for start in range(0, total, config.layout_batch_pages):
        stop = min(total, start + config.layout_batch_pages)
        selected = list(range(start, stop))
        batch_started = perf_counter()

        with capture_native_stderr(config.capture_engine_stderr) as native_capture:
            batch_chunks = pymupdf4llm.to_markdown(
                document,
                pages=selected,
                **_layout_kwargs(config),
            )

        if not isinstance(batch_chunks, list):
            raise RuntimeError("PyMuPDF4LLM returned an unexpected non-page-chunk result")
        _store_batch_chunks(chunks, batch_chunks, selected)

        batch_noise = len(native_capture.known_noise) if native_capture is not None else 0
        batch_unknown = len(native_capture.unknown) if native_capture is not None else 0
        suppressed_noise += batch_noise
        unknown_diagnostics += batch_unknown

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
                    "sample": native_capture.unknown[:3] if native_capture is not None else [],
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
                "suppressed_native_noise": batch_noise,
                "unexpected_native_diagnostics": batch_unknown,
            },
        )

    emit_progress(
        progress,
        "layout-complete",
        "Layout-aware extraction completed; running semantic page passes",
        current=total,
        total=total,
        elapsed_seconds=perf_counter() - layout_started,
        details={
            "chunks": len(chunks),
            "suppressed_native_noise": suppressed_noise,
            "unexpected_native_diagnostics": unknown_diagnostics,
        },
    )
    return chunks, suppressed_noise, unknown_diagnostics


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
                "layout_batch_pages": config.layout_batch_pages,
                "capture_engine_stderr": config.capture_engine_stderr,
            },
        )

        chunks, suppressed_noise, unknown_diagnostics = _extract_layout_chunks(
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
