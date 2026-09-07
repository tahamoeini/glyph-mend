from __future__ import annotations

import re
import unicodedata

_ZERO_WIDTH = "\u200b\u200c\u200d\u2060\ufeff"
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^\n)]*\)")
_FENCE_RE = re.compile(
    r"(^```[^\n]*\n.*?^```[ \t]*$|^~~~[^\n]*\n.*?^~~~[ \t]*$)",
    re.MULTILINE | re.DOTALL,
)
_ESCAPED_BR_RE = re.compile(r"&lt;br\s*/?&gt;", re.IGNORECASE)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
# Some older embedded PDF fonts map the ordinary comma glyph to U+201A. Replace it
# only in word/list punctuation contexts, not globally, because U+201A is legitimate
# opening punctuation in some languages.
_MISENCODED_COMMA_RE = re.compile(r"(?<=[A-Za-z0-9)])\u201a(?=(?:\s|[A-Za-z0-9(]))")
_PICTURE_MARKERS = (
    "<!-- Start of picture text -->",
    "<!-- End of picture text -->",
)
_SAFE_ENTITIES = {
    "&amp;": "&",
    "&#x27;": "'",
    "&#39;": "'",
    "&apos;": "'",
    "&quot;": '"',
    "&nbsp;": " ",
}

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


def _protect_fences(text: str) -> tuple[str, list[str]]:
    fences: list[str] = []

    def replace(match: re.Match[str]) -> str:
        token = f"<<<PDF_SANITIZER_FENCE_{len(fences):06d}>>>"
        fences.append(match.group(0))
        return token

    return _FENCE_RE.sub(replace, text), fences


def _restore_fences(text: str, fences: list[str]) -> str:
    value = text
    for index, fence in enumerate(fences):
        value = value.replace(f"<<<PDF_SANITIZER_FENCE_{index:06d}>>>", fence)
    return value


def sanitize_markdown(text: str) -> str:
    """Normalize extraction noise without rewriting or semantically changing content.

    NFC is used deliberately instead of NFKC: compatibility normalization can flatten
    superscript/subscript characters and vulgar fractions, destroying mathematical meaning.
    Fenced blocks are protected from prose-specific cleanup such as de-hyphenation.
    """

    if not text:
        return ""

    value = text.replace("\r\n", "\n").replace("\r", "\n")
    value = unicodedata.normalize("NFC", value).translate(_LIGATURES)
    value = value.replace("\u00ad", "")
    value = value.translate({ord(ch): None for ch in _ZERO_WIDTH})
    value = _CONTROL_RE.sub("", value)

    value, fences = _protect_fences(value)

    # Decode only deterministic extraction artifacts. Do not broadly HTML-unescape
    # arbitrary source text because angle brackets may be meaningful code or prose.
    value = _ESCAPED_BR_RE.sub("<br>", value)
    value = value.replace("&amp;#45;", "-").replace("&#45;", "-")
    for source, replacement in _SAFE_ENTITIES.items():
        value = value.replace(source, replacement)
    for marker in _PICTURE_MARKERS:
        value = value.replace(marker, "")

    value = _MISENCODED_COMMA_RE.sub(",", value)

    # PyMuPDF uses <br> inside table/layout cells to preserve visual line wrapping.
    # In a semantic Markdown export those visual wraps are noise, not structure. Flatten
    # them to spaces so raw Markdown stays readable and table cells stay single-line.
    value = _BR_RE.sub(" ", value)
    value = re.sub(r"[ \t]{2,}", " ", value)

    # Repair line-wrap hyphenation conservatively for Latin prose only. Fenced code,
    # Mermaid and other literal Markdown blocks have already been protected above.
    value = re.sub(r"(?<=[A-Za-z])-\n(?=[A-Za-z])", "", value)

    # Generated image links/binaries are replaced by the extractor's deterministic
    # visual placeholders. Literal examples inside fenced code remain untouched.
    value = _MD_IMAGE_RE.sub("[IMAGE_PLACEHOLDER]", value)

    lines = [line.rstrip() for line in value.split("\n")]
    value = "\n".join(lines)
    value = re.sub(r"\n{4,}", "\n\n\n", value)
    value = re.sub(r"[ \t]+\n", "\n", value)

    value = _restore_fences(value, fences)

    # A multi-page chunk provides evidence unavailable on a single page: repeated
    # running titles can be identified statistically, and page-boundary hyphenation can
    # be repaired without guessing. Import lazily to avoid a module cycle.
    if value.count("<!-- page:") >= 2:
        from .document_cleanup import cleanup_combined_markdown

        value = cleanup_combined_markdown(value)

    return value.strip()


def sanitize_label(text: str, fallback: str = "Shape") -> str:
    value = sanitize_markdown(text)
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return fallback
    return value[:160]
