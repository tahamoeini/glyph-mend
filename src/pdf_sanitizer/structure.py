from __future__ import annotations

import re

from .equation_quality import display_math_text_is_plausible

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_NUMBERED_HEADING_RE = re.compile(r"^(\d+(?:\.\d+)*)(?:\.)?(?:\s+|$)")
_APPENDIX_NUMBER_RE = re.compile(r"^([A-Z])\.(\d+(?:\.\d+)*)(?:\s+|$)")
_TOP_LEVEL_RE = re.compile(r"^(?:chapter\s+\d+|part\s+[IVXLCDM]+|appendix\s+[A-Z])\b", re.IGNORECASE)
_FENCE_START_RE = re.compile(r"^\s*(```+|~~~+)")
_VISUAL_PAYLOAD_RE = re.compile(
    r"(?:\[)?(?:IMAGE_|GRAPHIC_|VISUAL_)?PLACEHOLDER\s+page=(\d+)\s+bbox=\"([^\"]+)\"(?:\])?",
    re.IGNORECASE,
)


def _strip_outer_emphasis(text: str) -> str:
    value = text.strip()
    changed = True
    while changed and len(value) >= 2:
        changed = False
        for left, right in (("**", "**"), ("__", "__"), ("*", "*"), ("_", "_")):
            if value.startswith(left) and value.endswith(right) and len(value) > len(left) + len(right):
                value = value[len(left) : -len(right)].strip()
                changed = True
                break
    return value


def _semantic_heading_level(text: str, fallback: int) -> int:
    value = _strip_outer_emphasis(text)
    if _TOP_LEVEL_RE.match(value):
        return 1

    appendix = _APPENDIX_NUMBER_RE.match(value)
    if appendix:
        numeric_depth = len(appendix.group(2).split("."))
        return min(6, numeric_depth + 1)

    numbered = _NUMBERED_HEADING_RE.match(value)
    if numbered:
        return min(6, len(numbered.group(1).split(".")))
    return fallback


def normalize_heading_structure(markdown: str) -> str:
    """Align Markdown heading depth with explicit section numbering.

    PDF font size is useful evidence, but a heading labelled 11.6.1.1 is semantically
    four levels deep regardless of whether the source typesetter happened to make it
    the same size as a neighboring heading.
    """

    lines = str(markdown or "").splitlines()
    output: list[str] = []
    fence_marker: str | None = None
    in_math = False

    for line in lines:
        fence = _FENCE_START_RE.match(line)
        if fence and not in_math:
            marker = fence.group(1)[:3]
            if fence_marker is None:
                fence_marker = marker
            elif line.lstrip().startswith(fence_marker):
                fence_marker = None
            output.append(line)
            continue

        if fence_marker is not None:
            output.append(line)
            continue

        if line.strip() == "$$":
            in_math = not in_math
            output.append(line)
            continue
        if in_math:
            output.append(line)
            continue

        match = _HEADING_RE.match(line)
        if not match:
            output.append(line)
            continue

        text = _strip_outer_emphasis(match.group(2))
        fallback = len(match.group(1))
        level = _semantic_heading_level(text, fallback)
        output.append(f"{'#' * level} {text}")

    return "\n".join(output)


def _clean_false_math_payload(payload: str) -> str:
    value = payload.strip()
    visual = _VISUAL_PAYLOAD_RE.search(value)
    if visual:
        return f'[VISUAL_PLACEHOLDER page={visual.group(1)} bbox="{visual.group(2)}"]'
    return value


def normalize_math_artifacts(markdown: str) -> str:
    """Unwrap false display math and remove exact adjacent duplicate math blocks."""

    lines = str(markdown or "").splitlines()
    output: list[str] = []
    index = 0
    fence_marker: str | None = None
    previous_math_payload: str | None = None
    previous_was_math = False

    while index < len(lines):
        line = lines[index]
        fence = _FENCE_START_RE.match(line)
        if fence:
            marker = fence.group(1)[:3]
            if fence_marker is None:
                fence_marker = marker
            elif line.lstrip().startswith(fence_marker):
                fence_marker = None
            output.append(line)
            index += 1
            previous_was_math = False
            continue

        if fence_marker is not None:
            output.append(line)
            index += 1
            continue

        if line.strip() != "$$":
            output.append(line)
            if line.strip():
                previous_was_math = False
            index += 1
            continue

        payload_lines: list[str] = []
        index += 1
        while index < len(lines) and lines[index].strip() != "$$":
            payload_lines.append(lines[index])
            index += 1
        if index < len(lines):
            index += 1

        payload = "\n".join(payload_lines).strip()
        if not payload:
            continue

        if not display_math_text_is_plausible(payload):
            cleaned = _clean_false_math_payload(payload)
            if cleaned:
                output.append(cleaned)
            previous_was_math = False
            previous_math_payload = None
            continue

        normalized = re.sub(r"\s+", " ", payload).strip()
        if previous_was_math and normalized == previous_math_payload:
            continue

        output.extend(["$$", payload, "$$"])
        previous_math_payload = normalized
        previous_was_math = True

    return "\n".join(output)


def normalize_document_structure(markdown: str) -> str:
    value = normalize_math_artifacts(markdown)
    value = normalize_heading_structure(value)
    return value.strip()
