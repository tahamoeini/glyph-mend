from __future__ import annotations

import re
import unicodedata

_ZERO_WIDTH = "\u200b\u200c\u200d\u2060\ufeff"
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^\n)]*\)")

_LIGATURES = str.maketrans(
    {
        "ﬀ": "ff",
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬃ": "ffi",
        "ﬄ": "ffl",
        "ﬅ": "st",
        "ﬆ": "st",
    }
)


def sanitize_markdown(text: str) -> str:
    """Normalize extraction noise without rewriting or semantically changing content."""

    if not text:
        return ""

    value = unicodedata.normalize("NFKC", text).translate(_LIGATURES)
    value = value.replace("\u00ad", "")
    value = value.translate({ord(ch): None for ch in _ZERO_WIDTH})
    value = _CONTROL_RE.sub("", value)
    value = value.replace("\r\n", "\n").replace("\r", "\n")

    # Repair line-wrap hyphenation conservatively for Latin words only.
    value = re.sub(r"(?<=[A-Za-z])-\n(?=[A-Za-z])", "", value)

    # Never retain generated binary/remote image markdown. Visuals are represented
    # by our own deterministic placeholders in the extraction stage.
    value = _MD_IMAGE_RE.sub("[IMAGE_PLACEHOLDER]", value)

    # Trim trailing whitespace without damaging Markdown structure.
    lines = [line.rstrip() for line in value.split("\n")]
    value = "\n".join(lines)

    # Normalize excessive vertical whitespace while preserving paragraph boundaries.
    value = re.sub(r"\n{4,}", "\n\n\n", value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    return value.strip()


def sanitize_label(text: str, fallback: str = "Shape") -> str:
    value = sanitize_markdown(text)
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return fallback
    return value[:160]
