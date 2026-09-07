from __future__ import annotations

import re
from typing import Any

_EMPHASIS_RE = re.compile(r"[*_`]+")
_SPACE_RE = re.compile(r"\s+")
_PAGE_NUMBER_RE = re.compile(r"^\d{1,5}$")


def _bbox(value: Any) -> tuple[float, float, float, float] | None:
    try:
        return float(value[0]), float(value[1]), float(value[2]), float(value[3])
    except Exception:
        return None


def _normalize(value: str) -> str:
    text = _EMPHASIS_RE.sub("", str(value or ""))
    text = re.sub(r"^#+\s*", "", text.strip())
    text = _SPACE_RE.sub(" ", text).strip().casefold()
    return text


def _native_margin_lines(page: Any) -> tuple[list[str], list[str]]:
    try:
        payload = page.get_text("dict", sort=True)
    except TypeError:
        try:
            payload = page.get_text("dict")
        except Exception:
            return [], []
    except Exception:
        return [], []

    rect = _bbox(getattr(page, "rect", None))
    if rect is None:
        return [], []
    page_height = max(1.0, rect[3] - rect[1])
    header_limit = rect[1] + page_height * 0.09
    footer_limit = rect[1] + page_height * 0.94

    headers: list[str] = []
    footers: list[str] = []
    for block in payload.get("blocks", []) if isinstance(payload, dict) else []:
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            line_rect = _bbox(line.get("bbox"))
            if line_rect is None:
                continue
            text = "".join(str(span.get("text") or "") for span in line.get("spans", [])).strip()
            normalized = _normalize(text)
            if not normalized:
                continue
            if line_rect[1] <= header_limit:
                headers.append(normalized)
            if line_rect[3] >= footer_limit:
                footers.append(normalized)

    def enrich(values: list[str]) -> list[str]:
        output = list(dict.fromkeys(values))
        # Layout extraction often joins a page number and running title that native
        # geometry stores as two separate lines. Accept either order at the edge only.
        for first, second in zip(values, values[1:]):
            output.append(f"{first} {second}".strip())
            output.append(f"{second} {first}".strip())
        return list(dict.fromkeys(output))

    return enrich(headers), enrich(footers)


def _matches_margin(line: str, candidates: list[str]) -> bool:
    normalized = _normalize(line)
    if not normalized:
        return False
    if normalized in candidates:
        return True

    # Running page number + title may be fused without a clean separator.
    for candidate in candidates:
        if len(candidate) < 3:
            continue
        if normalized.startswith(candidate + " ") or normalized.endswith(" " + candidate):
            remainder = normalized.removeprefix(candidate).removesuffix(candidate).strip()
            if not remainder or _PAGE_NUMBER_RE.fullmatch(remainder):
                return True
    return False


def _strip_edge(lines: list[str], candidates: list[str], *, from_start: bool) -> list[str]:
    if not candidates:
        return lines

    indexes = range(len(lines)) if from_start else range(len(lines) - 1, -1, -1)
    substantive_seen = 0
    remove: set[int] = set()
    for index in indexes:
        stripped = lines[index].strip()
        if not stripped:
            continue
        # Only inspect the document edge. A title repeated in body prose must survive.
        substantive_seen += 1
        if substantive_seen > 7:
            break
        if _matches_margin(stripped, candidates):
            remove.add(index)

    if not remove:
        return lines
    return [line for index, line in enumerate(lines) if index not in remove]


def strip_running_matter(
    markdown: str,
    page: Any,
    *,
    keep_headers: bool = False,
    keep_footers: bool = False,
) -> str:
    """Remove native top/bottom running matter from a rendered Markdown page.

    Detection is geometry-driven and removal is edge-limited, so a chapter title that
    legitimately reappears in body text is not globally deleted.
    """

    if keep_headers and keep_footers:
        return markdown

    headers, footers = _native_margin_lines(page)
    lines = str(markdown or "").splitlines()
    if not keep_headers:
        lines = _strip_edge(lines, headers, from_start=True)
    if not keep_footers:
        lines = _strip_edge(lines, footers, from_start=False)
    return "\n".join(lines).strip()
