from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractionConfig:
    """Configuration for deterministic PDF -> Markdown extraction."""

    use_ocr: bool = True
    force_ocr: bool = False
    ocr_language: str = "eng"
    ocr_dpi: int = 300

    keep_headers: bool = False
    keep_footers: bool = False
    include_page_markers: bool = True

    extract_tables: bool = True
    extract_equations: bool = True
    normalize_task_lists: bool = True
    detect_vector_flows: bool = True
    include_visual_placeholders: bool = True

    # "auto" uses the Layout model first and transparently repairs pages where prose
    # was misclassified as a giant table by re-extracting only those pages with the
    # legacy/non-Layout path. "layout" and "legacy" force one engine path.
    layout_mode: str = "auto"

    # Process the expensive PyMuPDF4LLM layout/OCR pass in bounded page batches so
    # callers receive meaningful progress before the entire document is finished.
    layout_batch_pages: int = 20

    # Tesseract/Leptonica and the Layout parser may write benign diagnostics directly
    # to process stdout/stderr. Capture them by default and surface only a summary.
    capture_engine_stderr: bool = True

    min_image_area_ratio: float = 0.0025
    min_graphic_area_ratio: float = 0.004
    full_page_scan_ratio: float = 0.80

    max_file_mb: int = 512
    max_pages: int | None = 2000
    strict: bool = False

    def validate(self) -> None:
        if self.ocr_dpi < 72 or self.ocr_dpi > 600:
            raise ValueError("ocr_dpi must be between 72 and 600")
        if self.layout_mode not in {"auto", "layout", "legacy"}:
            raise ValueError("layout_mode must be 'auto', 'layout', or 'legacy'")
        if self.layout_batch_pages <= 0:
            raise ValueError("layout_batch_pages must be positive")
        for name in (
            "min_image_area_ratio",
            "min_graphic_area_ratio",
            "full_page_scan_ratio",
        ):
            value = getattr(self, name)
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be between 0 and 1")
        if self.max_file_mb <= 0:
            raise ValueError("max_file_mb must be positive")
        if self.max_pages is not None and self.max_pages <= 0:
            raise ValueError("max_pages must be positive or None")
