"""Canonical public package for GlyphMend.

The implementation still exposes the historical ``pdf_sanitizer`` namespace as a
compatibility surface so existing integrations keep working during the rebrand.
"""

from pdf_sanitizer import (
    ExtractionConfig,
    ExtractionResult,
    ExtractionWorkspace,
    ProgressCallback,
    ProgressEvent,
    WorkspaceError,
    combine_workspace,
    extract_pdf,
    extract_pdf_resumable,
    markdown_to_docx,
)
from pdf_sanitizer import __version__
from pdf_sanitizer.branding import BrandConfig, DEFAULT_BRAND, get_brand, load_brand

__all__ = [
    "BrandConfig",
    "DEFAULT_BRAND",
    "ExtractionConfig",
    "ExtractionResult",
    "ExtractionWorkspace",
    "ProgressCallback",
    "ProgressEvent",
    "WorkspaceError",
    "combine_workspace",
    "extract_pdf",
    "extract_pdf_resumable",
    "get_brand",
    "load_brand",
    "markdown_to_docx",
]
