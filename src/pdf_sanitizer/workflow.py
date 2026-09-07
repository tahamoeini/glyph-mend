from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter
from typing import Any

from .config import ExtractionConfig
from .extractor import ExtractionResult, _import_engines
from .native import native_markdown_chunk
from .pipeline import _capture_counts, _invoke_markdown, _store_batch_chunks
from .progress import ProgressCallback, emit_progress
from .quality import assess_layout_markdown
from .renderer import render_page_markdown
from .sanitize import sanitize_markdown
from .semantics import normalize_display_math_lines, normalize_task_lists
from .workspace import ExtractionWorkspace, WorkspaceError, default_workspace_path


def _render_fallback(page: Any, chunk: dict[str, Any], page_number: int, config: ExtractionConfig) -> str:
    fallback_chunk = native_markdown_chunk(page, page_number)
    fallback = sanitize_markdown(str(fallback_chunk.get("text") or chunk.get("text") or ""))
    if config.extract_equations:
        fallback = normalize_display_math_lines(fallback)
    if config.normalize_task_lists:
        fallback = normalize_task_lists(fallback)
    if config.include_page_markers:
        fallback = f"<!-- page: {page_number} -->\n\n{fallback}".strip()
    return fallback


def _extract_checkpoint_chunks(
    document: Any,
    pymupdf4llm: Any,
    config: ExtractionConfig,
    selected: list[int],
    *,
    progress: ProgressCallback | None,
    started: float,
) -> tuple[list[dict[str, Any]], int, int, int]:
    """Extract one checkpoint range and repair pathological Layout pages in-place."""

    total = document.page_count
    chunks: list[dict[str, Any]] = [
        {"text": "", "page_boxes": [], "metadata": {"page_number": index + 1}}
        for index in range(total)
    ]
    primary_layout = config.layout_mode != "legacy"
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

    suppressed_noise, unknown_diagnostics = _capture_counts(primary_capture)
    repaired_pages = 0
    repair_selected: list[int] = []
    repair_details: list[dict[str, object]] = []
    ocr_fallback_selected: list[int] = []
    repair_capture = None

    if config.layout_mode == "auto":
        for index in selected:
            quality = assess_layout_markdown(str(chunks[index].get("text") or ""), document[index])
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
            for index in repair_selected:
                native_chunk = native_markdown_chunk(document[index], index + 1)
                if str(native_chunk.get("text") or "").strip():
                    chunks[index] = native_chunk
                else:
                    ocr_fallback_selected.append(index)

            if ocr_fallback_selected:
                repair_chunks, repair_capture = _invoke_markdown(
                    document,
                    pymupdf4llm,
                    config,
                    ocr_fallback_selected,
                    use_layout=False,
                )
                _store_batch_chunks(chunks, repair_chunks, ocr_fallback_selected)
                for index in ocr_fallback_selected:
                    metadata = chunks[index].setdefault("metadata", {})
                    if isinstance(metadata, dict):
                        metadata["source"] = "text-first-ocr"

            repaired_pages = len(repair_selected)
            emit_progress(
                progress,
                "layout-repair",
                f"Rebuilt {repaired_pages} suspicious layout page(s) from text-first geometry",
                current=selected[-1] + 1,
                total=total,
                elapsed_seconds=perf_counter() - started,
                details={
                    "pages": [index + 1 for index in repair_selected],
                    "ocr_fallback_pages": [index + 1 for index in ocr_fallback_selected],
                    "sample_evidence": repair_details[:3],
                },
            )

    repair_noise, repair_unknown = _capture_counts(repair_capture)
    suppressed_noise += repair_noise
    unknown_diagnostics += repair_unknown
    captures = [capture for capture in (primary_capture, repair_capture) if capture is not None]
    unknown_lines = [line for capture in captures for line in capture.unknown]
    if unknown_diagnostics:
        emit_progress(
            progress,
            "engine-warning",
            "Native OCR/layout engine emitted unexpected diagnostics",
            current=selected[-1] + 1,
            total=total,
            elapsed_seconds=perf_counter() - started,
            details={
                "count": unknown_diagnostics,
                "sample": unknown_lines[:3],
                "page_range": f"{selected[0] + 1}-{selected[-1] + 1}",
            },
        )

    return chunks, suppressed_noise, unknown_diagnostics, repaired_pages


def extract_pdf_resumable(
    pdf_path: str | os.PathLike[str],
    output_path: str | os.PathLike[str],
    *,
    workspace_path: str | os.PathLike[str] | None = None,
    checkpoint_pages: int = 20,
    config: ExtractionConfig | None = None,
    password: str | None = None,
    restart: bool = False,
    progress: ProgressCallback | None = None,
) -> ExtractionResult:
    """Extract a PDF into persisted Markdown parts, resume safely, then combine them.

    A completed part is skipped only when the source PDF fingerprint, extraction config,
    page range, and part checksum all still match the workspace manifest.
    """

    started = perf_counter()
    config = config or ExtractionConfig()
    source = Path(pdf_path).expanduser().resolve()
    output = Path(output_path).expanduser().resolve()
    workspace_root = (
        Path(workspace_path).expanduser().resolve()
        if workspace_path is not None
        else default_workspace_path(output).resolve()
    )
    document = None

    try:
        emit_progress(progress, "validate", "Validating input PDF", details={"path": str(source)})
        config.validate()
        if checkpoint_pages <= 0:
            raise ValueError("checkpoint_pages must be positive")
        if not source.is_file():
            raise FileNotFoundError(source)
        if source.suffix.lower() != ".pdf":
            raise ValueError(f"Expected a .pdf file: {source}")
        file_size = source.stat().st_size
        if file_size > config.max_file_mb * 1024 * 1024:
            raise ValueError(f"PDF exceeds max_file_mb={config.max_file_mb}: {source}")

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

        document = pymupdf.open(source)
        if document.needs_pass:
            if not password or document.authenticate(password) <= 0:
                raise PermissionError("PDF is password-protected; supply a valid password")
        if config.max_pages is not None and document.page_count > config.max_pages:
            raise ValueError(
                f"PDF has {document.page_count} pages, exceeding max_pages={config.max_pages}"
            )

        workspace = ExtractionWorkspace.prepare(
            workspace_root,
            source=source,
            page_count=document.page_count,
            checkpoint_pages=checkpoint_pages,
            config=config,
            output=output,
            restart=restart,
        )
        emit_progress(
            progress,
            "workspace",
            "Checkpoint workspace ready",
            current=0,
            total=document.page_count,
            elapsed_seconds=perf_counter() - started,
            details={
                "workspace": str(workspace.root),
                "checkpoint_pages": checkpoint_pages,
                "parts": workspace.expected_part_count,
            },
        )

        total_noise = 0
        total_unknown = 0
        total_repaired = 0
        total_fallback = 0
        resumed_parts = 0

        for part_index in range(1, workspace.expected_part_count + 1):
            start_page, end_page = workspace.expected_range(part_index)
            existing = workspace.completed_part(part_index)
            if existing is not None:
                resumed_parts += 1
                emit_progress(
                    progress,
                    "checkpoint-resume",
                    f"Reusing completed Markdown part for pages {start_page}-{end_page}",
                    current=end_page,
                    total=document.page_count,
                    elapsed_seconds=perf_counter() - started,
                    details={"part": part_index, "path": str(existing)},
                )
                continue

            selected = list(range(start_page - 1, end_page))
            batch_started = perf_counter()
            emit_progress(
                progress,
                "checkpoint-start",
                f"Extracting checkpoint {part_index}/{workspace.expected_part_count}: pages {start_page}-{end_page}",
                current=start_page - 1,
                total=document.page_count,
                elapsed_seconds=perf_counter() - started,
                details={"part": part_index, "start_page": start_page, "end_page": end_page},
            )

            chunks, noise, unknown, repaired = _extract_checkpoint_chunks(
                document,
                pymupdf4llm,
                config,
                selected,
                progress=progress,
                started=started,
            )
            total_noise += noise
            total_unknown += unknown
            total_repaired += repaired

            rendered_pages: list[str] = []
            for index in selected:
                page = document[index]
                page_number = index + 1
                chunk = chunks[index]
                try:
                    rendered_pages.append(
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
                    total_fallback += 1
                    rendered_pages.append(_render_fallback(page, chunk, page_number, config))
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

            part_markdown = sanitize_markdown(
                "\n\n".join(page for page in rendered_pages if page.strip())
            )
            part_path = workspace.write_part(part_index, part_markdown)
            emit_progress(
                progress,
                "checkpoint-write",
                f"Saved checkpoint {part_index}/{workspace.expected_part_count}",
                current=end_page,
                total=document.page_count,
                elapsed_seconds=perf_counter() - started,
                details={
                    "part": part_index,
                    "path": str(part_path),
                    "pages": f"{start_page}-{end_page}",
                    "chars": len(part_markdown),
                    "seconds": round(perf_counter() - batch_started, 3),
                },
            )

        emit_progress(
            progress,
            "combine",
            "Combining validated Markdown checkpoints",
            current=document.page_count,
            total=document.page_count,
            elapsed_seconds=perf_counter() - started,
            details={"workspace": str(workspace.root), "output": str(output)},
        )
        final_path = workspace.combine(output)
        markdown = final_path.read_text(encoding="utf-8").rstrip("\n")
        metadata = dict(document.metadata or {})
        metadata.update(
            {
                "page_count": document.page_count,
                "source_filename": source.name,
                "layout_mode": config.layout_mode,
                "layout_repaired_pages": total_repaired,
                "fallback_pages": total_fallback,
                "checkpoint_pages": checkpoint_pages,
                "checkpoint_parts": workspace.expected_part_count,
                "resumed_parts": resumed_parts,
                "workspace": str(workspace.root),
            }
        )
        result = ExtractionResult(
            source=source,
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
                "output": str(final_path),
                "output_chars": len(markdown),
                "checkpoint_parts": workspace.expected_part_count,
                "resumed_parts": resumed_parts,
                "fallback_pages": total_fallback,
                "layout_repaired_pages": total_repaired,
                "suppressed_native_noise": total_noise,
                "unexpected_native_diagnostics": total_unknown,
            },
        )
        return result
    except (Exception, WorkspaceError) as exc:
        emit_progress(
            progress,
            "error",
            "Extraction failed; completed checkpoint parts were preserved",
            elapsed_seconds=perf_counter() - started,
            details={
                "error_type": type(exc).__name__,
                "error": str(exc),
                "workspace": str(workspace_root),
            },
        )
        raise
    finally:
        if document is not None:
            document.close()


def combine_workspace(
    workspace_path: str | os.PathLike[str],
    output_path: str | os.PathLike[str] | None = None,
) -> Path:
    """Combine a complete checkpoint workspace without re-opening the source PDF."""

    workspace = ExtractionWorkspace.open_existing(workspace_path)
    return workspace.combine(output_path)
