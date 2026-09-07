from __future__ import annotations

import re
from typing import Any

from .graphics import BBox, rect_area
from .sanitize import sanitize_markdown

_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}")
_ALPHA_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]")
_SPLIT_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}\s*\|\s*[A-Za-zÀ-ÖØ-öø-ÿ]{1,}")
_MARKUP_RE = re.compile(r"[*_`<>]+")


def _bbox(value: Any) -> BBox | None:
    try:
        return float(value[0]), float(value[1]), float(value[2]), float(value[3])
    except Exception:
        return None


def _page_bbox(page: Any) -> BBox:
    rect = _bbox(getattr(page, "rect", None))
    return rect or (0.0, 0.0, 1.0, 1.0)


def _prose_lines_in_rect(page: Any, rect: BBox) -> int:
    try:
        text = str(page.get_text("text", clip=rect, sort=True) or "")
    except TypeError:
        try:
            text = str(page.get_text("text", clip=rect) or "")
        except Exception:
            return 0
    except Exception:
        return 0

    count = 0
    for raw in text.splitlines():
        line = raw.strip()
        if len(line) >= 48 and len(_WORD_RE.findall(line)) >= 7:
            count += 1
    return count


def _split_markdown_row(line: str) -> list[str]:
    value = line.strip()
    if value.startswith("|"):
        value = value[1:]
    if value.endswith("|"):
        value = value[:-1]
    return [cell.strip() for cell in re.split(r"(?<!\\)\|", value)]


def _markdown_cell_stats(markdown: str) -> tuple[int, float, int]:
    alpha_cells = 0
    short_alpha_cells = 0
    split_boundaries = 0

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line.startswith("|") or re.fullmatch(r"[|:\-\s]+", line):
            continue
        split_boundaries += len(_SPLIT_WORD_RE.findall(line))
        for cell in _split_markdown_row(line):
            clean = _MARKUP_RE.sub("", cell).strip()
            letters = "".join(ch for ch in clean if ch.isalpha())
            if not letters:
                continue
            alpha_cells += 1
            # Artificial columns in prose/index pages often consist of orphaned word
            # fragments such as "margi | nal", "Dedicatio | n", or "INTR | ODUCT | ION".
            if len(letters) <= 3:
                short_alpha_cells += 1

    short_ratio = short_alpha_cells / max(1, alpha_cells)
    return split_boundaries, short_ratio, alpha_cells


def _table_is_plausible(
    page: Any,
    rect: BBox,
    row_count: int,
    col_count: int,
    markdown: str,
    *,
    strategy_name: str,
) -> bool:
    """Reject table candidates that are better explained as ordinary page layout."""

    page_rect = _page_bbox(page)
    page_width = max(1.0, page_rect[2] - page_rect[0])
    page_height = max(1.0, page_rect[3] - page_rect[1])
    width = max(0.0, rect[2] - rect[0])
    height = max(0.0, rect[3] - rect[1])
    width_ratio = width / page_width
    height_ratio = height / page_height
    area_ratio = rect_area(rect) / max(1.0, rect_area(page_rect))

    if row_count < 2 or col_count < 2 or col_count > 16 or row_count > 120:
        return False

    prose_lines = _prose_lines_in_rect(page, rect)
    split_boundaries, short_alpha_ratio, alpha_cells = _markdown_cell_stats(markdown)

    # Word fragments crossing cell boundaries are direct evidence that columns were
    # inferred through prose rather than representing semantic cells.
    if split_boundaries >= 3:
        return False
    if split_boundaries >= 1 and short_alpha_ratio >= 0.18 and alpha_cells >= 6:
        return False
    if short_alpha_ratio >= 0.34 and alpha_cells >= 8 and row_count >= 4:
        return False

    # Even ruled strategies can be fooled by decorative baselines, index leaders,
    # underlines, or PDF drawing fragments. Large natural-language regions therefore
    # need the same plausibility checks as whitespace-based tables.
    if prose_lines >= 3 and area_ratio > 0.30:
        return False
    if prose_lines >= 2 and height_ratio > 0.42 and width_ratio > 0.72:
        return False

    # Page-wide grids are especially suspicious when they contain text. Numeric data
    # tables can still occupy most of a page because they have little/no prose evidence.
    if area_ratio > 0.68 and alpha_cells >= 6:
        return False
    if width_ratio > 0.94 and height_ratio > 0.58 and row_count >= 6 and alpha_cells >= 6:
        return False

    if strategy_name == "text":
        # Whitespace-based inference is useful for genuine borderless tables, but its
        # virtual columns are inherently weaker evidence than explicit ruled lines.
        if area_ratio > 0.58:
            return False
        if height_ratio > 0.62 and row_count >= 10:
            return False
        if prose_lines >= 2 and (height_ratio > 0.35 or area_ratio > 0.30):
            return False

    return True


def _table_markdown(table: Any) -> str | None:
    try:
        try:
            markdown = table.to_markdown(clean=True, fill_empty=True)
        except TypeError:
            markdown = table.to_markdown()
    except Exception:
        return None
    markdown = sanitize_markdown(str(markdown or ""))
    return markdown if markdown.count("|") >= 4 else None


def extract_tables(page: Any) -> list[tuple[BBox, str]]:
    """Extract tables only when geometry and content jointly support tabular meaning.

    Ruled tables remain preferred, but line evidence alone is not trusted blindly:
    long-form PDFs often contain underlines, leaders, and drawing fragments that can
    make prose look like a ruled grid. Every strategy therefore passes the same semantic
    plausibility gate before becoming a GFM table.
    """

    attempts: tuple[tuple[str, dict[str, Any]], ...] = (
        ("lines_strict", {"strategy": "lines_strict", "use_layout": False}),
        ("lines", {"strategy": "lines", "use_layout": False}),
        ("text", {"strategy": "text", "use_layout": False}),
    )

    for strategy_name, kwargs in attempts:
        try:
            finder = page.find_tables(**kwargs)
        except TypeError:
            fallback_kwargs = dict(kwargs)
            fallback_kwargs.pop("use_layout", None)
            try:
                finder = page.find_tables(**fallback_kwargs)
            except Exception:
                continue
        except Exception:
            continue

        output: list[tuple[BBox, str]] = []
        for table in getattr(finder, "tables", []):
            try:
                row_count = int(getattr(table, "row_count", 0) or 0)
                col_count = int(getattr(table, "col_count", 0) or 0)
                if row_count < 2 or col_count < 2:
                    continue
                rect = _bbox(getattr(table, "bbox", None))
                if rect is None or rect_area(rect) <= 0:
                    continue
                markdown = _table_markdown(table)
                if not markdown:
                    continue
                if not _table_is_plausible(
                    page,
                    rect,
                    row_count,
                    col_count,
                    markdown,
                    strategy_name=strategy_name,
                ):
                    continue
                output.append((rect, markdown))
            except Exception:
                continue

        if output:
            return output

    return []
