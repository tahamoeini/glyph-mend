from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$")
_WORD_SPLIT_RE = re.compile(r"[A-Za-z]{2,}\|[A-Za-z]{2,}")
_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}")


@dataclass(frozen=True, slots=True)
class LayoutQuality:
    """Evidence that a layout-generated Markdown page is structurally pathological."""

    suspicious: bool
    table_rows: int
    substantive_lines: int
    table_ratio: float
    prose_lines: int
    split_word_boundaries: int


def _native_text(page: Any) -> str:
    try:
        return str(page.get_text("text", sort=True) or "")
    except TypeError:
        try:
            return str(page.get_text("text") or "")
        except Exception:
            return ""
    except Exception:
        return ""


def _prose_line_count(text: str) -> int:
    count = 0
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if len(line) < 48:
            continue
        if len(_WORD_RE.findall(line)) < 7:
            continue
        count += 1
    return count


def assess_layout_markdown(markdown: str, page: Any) -> LayoutQuality:
    """Detect the common failure mode where prose is emitted as one giant table.

    The PyMuPDF Layout model is valuable for genuinely complex layouts, but on some
    hybrid text/raster books it can mistake page-wide alignment for a table. The
    characteristic output is a page dominated by pipe rows, often with ordinary words
    split across cell boundaries. We only flag a page when there is positive evidence
    of corruption, so genuine compact data tables are left alone.
    """

    lines = [line.strip() for line in str(markdown or "").splitlines() if line.strip()]
    substantive = [line for line in lines if not line.startswith("<!--")]
    table_rows = [line for line in substantive if line.startswith("|")]
    separators = sum(1 for line in table_rows if _TABLE_SEPARATOR_RE.match(line))
    table_ratio = len(table_rows) / max(1, len(substantive))
    split_words = sum(len(_WORD_SPLIT_RE.findall(line)) for line in table_rows)
    prose_lines = _prose_line_count(_native_text(page))

    suspicious = (
        len(table_rows) >= 5
        and separators >= 1
        and table_ratio >= 0.45
        and (
            prose_lines >= 2
            or split_words >= 3
            or (table_ratio >= 0.80 and split_words >= 1)
        )
    )

    return LayoutQuality(
        suspicious=suspicious,
        table_rows=len(table_rows),
        substantive_lines=len(substantive),
        table_ratio=table_ratio,
        prose_lines=prose_lines,
        split_word_boundaries=split_words,
    )
