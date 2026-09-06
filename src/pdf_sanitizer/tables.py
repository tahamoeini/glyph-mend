from __future__ import annotations

import re
from typing import Any

from .graphics import BBox, rect_area
from .sanitize import sanitize_markdown

_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}")


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


def _text_table_is_plausible(page: Any, rect: BBox, row_count: int, col_count: int) -> bool:
    """Reject page-wide prose grids produced by whitespace-based table detection."""

    page_rect = _page_bbox(page)
    page_width = max(1.0, page_rect[2] - page_rect[0])
    page_height = max(1.0, page_rect[3] - page_rect[1])
    width = max(0.0, rect[2] - rect[0])
    height = max(0.0, rect[3] - rect[1])
    width_ratio = width / page_width
    height_ratio = height / page_height
    area_ratio = rect_area(rect) / max(1.0, rect_area(page_rect))

    if row_count < 2 or col_count < 2 or col_count > 16 or row_count > 100:
        return False

    # Whitespace/table inference across most of a page is the exact failure mode that
    # turned textbook prose into 5-8 artificial columns. Genuine borderless tables are
    # normally bounded regions; full-page lists and prose should remain text.
    if area_ratio > 0.58:
        return False
    if width_ratio > 0.92 and height_ratio > 0.52 and row_count >= 6:
        return False
    if height_ratio > 0.62 and row_count >= 10:
        return False

    # A large whitespace grid that contains several natural-language prose lines is
    # almost certainly a paragraph page whose aligned word positions were mistaken for
    # virtual cell boundaries. This is the failure seen in long-form books and papers.
    prose_lines = _prose_lines_in_rect(page, rect)
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
    """Extract real tables without allowing the Layout model to classify whole pages.

    Ruled tables are preferred because line evidence is explicit. Borderless text tables
    are considered only as a conservative last pass and must occupy a bounded region.
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
            # Older compatible PyMuPDF variants may not expose use_layout. Keeping the
            # explicit line strategy is still safer than the model-driven default.
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
                if strategy_name == "text" and not _text_table_is_plausible(
                    page, rect, row_count, col_count
                ):
                    continue
                markdown = _table_markdown(table)
                if markdown:
                    output.append((rect, markdown))
            except Exception:
                continue

        if output:
            return output

    return []
