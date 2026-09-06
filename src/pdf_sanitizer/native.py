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


def native_markdown_chunk(page: Any, page_number: int) -> dict[str, Any]:
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
    sizes: list[float] = []
    for block in blocks:
        if block.get("type", 0) != 0:
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

    output = ""
    page_boxes: list[dict[str, Any]] = []
    box_index = 0

    for block in blocks:
        if block.get("type", 0) != 0:
            continue
        rect = _bbox(block.get("bbox"))
        if rect is None:
            continue

        raw_lines: list[str] = []
        max_size = 0.0
        for line in block.get("lines", []):
            spans = [span for span in line.get("spans", []) if str(span.get("text") or "")]
            if not spans:
                continue
            line_text = "".join(str(span.get("text") or "") for span in spans).strip()
            if line_text:
                raw_lines.append(line_text)
            for span in spans:
                try:
                    max_size = max(max_size, float(span.get("size") or 0))
                except Exception:
                    pass

        if not raw_lines:
            continue

        joined = _join_wrapped_lines(raw_lines)
        if not joined:
            continue

        bullet = bool(_BULLET_RE.match(raw_lines[0]))
        numbered = bool(_NUMBERED_RE.match(raw_lines[0]))
        heading = _heading_prefix(max_size, body_size, joined)

        if bullet:
            cleaned = _BULLET_RE.sub("", joined).strip()
            block_text = f"- {cleaned}" if cleaned else ""
        elif numbered:
            block_text = joined
        elif heading:
            block_text = heading + joined
        else:
            block_text = joined

        if not block_text:
            continue
        if output:
            output += "\n\n"
        start = len(output)
        output += block_text
        stop = len(output)
        page_boxes.append(
            {
                "index": box_index,
                "class": "text",
                "bbox": list(rect),
                "pos": (start, stop),
            }
        )
        box_index += 1

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
