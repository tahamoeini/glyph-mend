from __future__ import annotations

import re
from statistics import median
from typing import Any

from .graphics import BBox

_BULLET_RE = re.compile(r"^[\s\u2022\u2023\u25e6\u2043\u2219\u25aa\u25ab\u25cf\u25cb]+")
_NUMBERED_RE = re.compile(r"^\s*(\d+[.)])\s+")


def _bbox(value: Any) -> BBox | None:
    try:
        return float(value[0]), float(value[1]), float(value[2]), float(value[3])
    except Exception:
        return None


def _merge_rects(rects: list[BBox]) -> BBox:
    return (
        min(rect[0] for rect in rects),
        min(rect[1] for rect in rects),
        max(rect[2] for rect in rects),
        max(rect[3] for rect in rects),
    )


def _join_wrapped_lines(lines: list[str]) -> str:
    value = ""
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if not value:
            value = line
            continue
        if value.endswith("-") and line[:1].isalpha():
            value = value[:-1] + line
        else:
            value += " " + line
    return re.sub(r"[ \t]+", " ", value).strip()


def _heading_prefix(max_size: float, body_size: float, text: str) -> str:
    if not text or len(text) > 160 or body_size <= 0:
        return ""
    ratio = max_size / body_size
    if ratio >= 1.75:
        return "# "
    if ratio >= 1.48:
        return "## "
    if ratio >= 1.26:
        return "### "
    return ""


def _page_height(page: Any) -> float | None:
    rect = _bbox(getattr(page, "rect", None))
    if rect is None:
        return None
    return max(1.0, rect[3] - rect[1])


def _skip_running_matter(
    rect: BBox,
    page_height: float | None,
    *,
    keep_headers: bool,
    keep_footers: bool,
) -> bool:
    if page_height is None:
        return False
    if not keep_headers and rect[1] <= page_height * 0.06:
        return True
    if not keep_footers and rect[3] >= page_height * 0.96:
        return True
    return False


def native_markdown_chunk(
    page: Any,
    page_number: int,
    *,
    keep_headers: bool = False,
    keep_footers: bool = False,
) -> dict[str, Any]:
    """Build a conservative Markdown chunk directly from PyMuPDF text geometry.

    This is the safety path for pages where a layout model has hallucinated page-wide
    table structure. It deliberately favors readable prose and deterministic headings
    over speculative layout reconstruction. Region-level tables, equations, diagrams,
    and visual placeholders are added later by the normal semantic renderer.
    """

    try:
        payload = page.get_text("dict", sort=True)
    except TypeError:
        payload = page.get_text("dict")
    except Exception:
        payload = {"blocks": []}

    blocks = list(payload.get("blocks", [])) if isinstance(payload, dict) else []
    page_height = _page_height(page)
    sizes: list[float] = []
    for block in blocks:
        if block.get("type", 0) != 0:
            continue
        block_rect = _bbox(block.get("bbox"))
        if block_rect is not None and _skip_running_matter(
            block_rect,
            page_height,
            keep_headers=keep_headers,
            keep_footers=keep_footers,
        ):
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = str(span.get("text") or "").strip()
                if not text:
                    continue
                try:
                    size = float(span.get("size") or 0)
                except Exception:
                    size = 0.0
                if size > 0:
                    sizes.extend([size] * min(8, max(1, len(text) // 8)))
    body_size = median(sizes) if sizes else 10.0

    segments: list[tuple[str, BBox]] = []

    for block in blocks:
        if block.get("type", 0) != 0:
            continue
        block_rect = _bbox(block.get("bbox"))
        if block_rect is None:
            continue
        if _skip_running_matter(
            block_rect,
            page_height,
            keep_headers=keep_headers,
            keep_footers=keep_footers,
        ):
            continue

        paragraph_lines: list[str] = []
        paragraph_rects: list[BBox] = []

        def flush_paragraph() -> None:
            nonlocal paragraph_lines, paragraph_rects
            if not paragraph_lines or not paragraph_rects:
                paragraph_lines = []
                paragraph_rects = []
                return
            text = _join_wrapped_lines(paragraph_lines)
            if text:
                segments.append((text, _merge_rects(paragraph_rects)))
            paragraph_lines = []
            paragraph_rects = []

        for line in block.get("lines", []):
            line_rect = _bbox(line.get("bbox"))
            spans = [span for span in line.get("spans", []) if str(span.get("text") or "")]
            if not spans:
                continue
            if line_rect is None:
                span_rects = [_bbox(span.get("bbox")) for span in spans]
                span_rects = [rect for rect in span_rects if rect is not None]
                line_rect = _merge_rects(span_rects) if span_rects else block_rect

            line_text = "".join(str(span.get("text") or "") for span in spans).strip()
            if not line_text:
                continue
            max_size = 0.0
            for span in spans:
                try:
                    max_size = max(max_size, float(span.get("size") or 0))
                except Exception:
                    pass

            heading = _heading_prefix(max_size, body_size, line_text)
            bullet = bool(_BULLET_RE.match(line_text))
            numbered = bool(_NUMBERED_RE.match(line_text))

            if heading:
                flush_paragraph()
                segments.append((heading + line_text, line_rect))
            elif bullet:
                flush_paragraph()
                cleaned = _BULLET_RE.sub("", line_text).strip()
                if cleaned:
                    segments.append((f"- {cleaned}", line_rect))
            elif numbered:
                flush_paragraph()
                segments.append((line_text, line_rect))
            else:
                paragraph_lines.append(line_text)
                paragraph_rects.append(line_rect)

        flush_paragraph()

    output = ""
    page_boxes: list[dict[str, Any]] = []
    for box_index, (segment_text, rect) in enumerate(segments):
        if output:
            output += "\n\n"
        start = len(output)
        output += segment_text
        stop = len(output)
        page_boxes.append(
            {
                "index": box_index,
                "class": "text",
                "bbox": list(rect),
                "pos": (start, stop),
            }
        )

    if not output:
        try:
            output = str(page.get_text("text", sort=True) or "").strip()
        except TypeError:
            output = str(page.get_text("text") or "").strip()
        except Exception:
            output = ""

    return {
        "metadata": {"page_number": page_number, "source": "native-text"},
        "text": output,
        "page_boxes": page_boxes,
    }
