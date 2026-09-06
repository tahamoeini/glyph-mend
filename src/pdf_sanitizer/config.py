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
    detect_vector_flows: bool = True
    include_visual_placeholders: bool = True

    min_image_area_ratio: float = 0.0025
    min_graphic_area_ratio: float = 0.004
    full_page_scan_ratio: float = 0.80

    max_file_mb: int = 512
    max_pages: int | None = 2000
    strict: bool = False

    def validate(self) -> None:
        if self.ocr_dpi < 72 or self.ocr_dpi > 600:
            raise ValueError("ocr_dpi must be between 72 and 600")
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
