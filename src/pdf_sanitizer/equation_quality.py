from __future__ import annotations

import re
from typing import Any

_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}")
_RELATION_RE = re.compile(r"(?:=|≤|≥|≠|≈|≡|\\(?:leq|geq|neq|approx|equiv)\b)")
_OPERATOR_RE = re.compile(r"(?:[+*/^_]|\\(?:frac|sqrt|sum|prod|int|partial|nabla|infty|to)\b)")
_ADVANCED_RE = re.compile(
    r"(?:\\(?:frac|sqrt|sum|prod|int|partial|nabla|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|infty)\b|[∑∏∫√∂∇∞])"
)
_CAPTION_RE = re.compile(
    r"^\s*(?:table|figure|fig\.?|example|proposition|theorem|lemma|corollary|remark|proof|chapter|section)\b",
    re.IGNORECASE,
)
_PLACEHOLDER_RE = re.compile(r"(?:IMAGE|GRAPHIC|VISUAL)?_?PLACEHOLDER", re.IGNORECASE)
_MARKUP_RE = re.compile(r"[*_`$]|</?(?:sup|sub|u)>|<!--.*?-->", re.IGNORECASE)
_NONWORD_RE = re.compile(r"[^a-z0-9]+")
_PROSE_RUN_RE = re.compile(
    r"\b[A-Za-zÀ-ÖØ-öø-ÿ]{2,}\s+"
    r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}\s+"
    r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}\s+"
    r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}\b"
)
_PROSE_CUE_RE = re.compile(
    r"\b(?:the|this|these|those|that|which|where|because|however|therefore|given|note|"
    r"can|could|would|should|is|are|was|were|and|with|from|into|than)\b",
    re.IGNORECASE,
)
_MATH_DENSITY_CHARS = set("=+-*/^_<>≤≥≠≈≡∑∏∫√∂∇∞()[]{}")


def _clean(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("$$") and text.endswith("$$") and len(text) >= 4:
        text = text[2:-2].strip()
    return re.sub(r"[ \t]+", " ", text)


def _comparison_text(value: str) -> str:
    text = _MARKUP_RE.sub(" ", _clean(value)).lower()
    text = re.sub(r"\\[A-Za-z]+", " ", text)
    return _NONWORD_RE.sub(" ", text).strip()


def _compact_math_text(value: str) -> str:
    """Compact OCR spacing while retaining relation/operator characters."""

    text = _MARKUP_RE.sub("", _clean(value)).casefold()
    return re.sub(r"[^a-z0-9=<>≤≥≠≈≡+*/^-]+", "", text)


def _math_density(text: str) -> float:
    if not text:
        return 0.0
    symbol_count = sum(char in _MATH_DENSITY_CHARS for char in text)
    return symbol_count / len(text)


def display_math_text_is_plausible(value: str) -> bool:
    """Return True only when a display block has convincing mathematical evidence.

    A relation sign somewhere in an English sentence is not enough. This intentionally
    prefers readable prose over confidently manufacturing a display equation from a
    caption, sentence fragment, or visual placeholder.
    """

    text = _clean(value)
    if len(text) < 2 or len(text) > 600 or _PLACEHOLDER_RE.search(text):
        return False

    words = _WORD_RE.findall(text)
    relations = len(_RELATION_RE.findall(text))
    operators = len(_OPERATOR_RE.findall(text))
    advanced = bool(_ADVANCED_RE.search(text))
    density = _math_density(text)
    prose_cues = len(_PROSE_CUE_RE.findall(text))

    if _CAPTION_RE.match(text) and len(words) >= 2:
        return False

    # Four consecutive natural-language words are strong evidence that the block is a
    # sentence fragment with some mathematics in it, not a standalone display equation.
    # OCR-heavy formulas may contain short labels such as "if" or "max", but rarely a
    # normal prose run of this length.
    if len(words) >= 5 and _PROSE_RUN_RE.search(text):
        return False
    if len(words) >= 6 and prose_cues >= 3:
        return False

    # Long natural-language blocks should stay prose unless the symbol density is
    # unmistakably mathematical. This catches cases such as a sentence ending in
    # "... = 16.23. This is higher than given" even though it contains \times tokens.
    if len(words) >= 8 and density < 0.16:
        return False
    if len(words) >= 6 and density < 0.10:
        return False

    sentence_like = text.rstrip().endswith((".", "!", "?", ":", ";", ","))
    if sentence_like and len(words) >= 5 and density < 0.18:
        return False
    if text.count(",") >= 2 and len(words) >= 5 and relations <= 1 and density < 0.16:
        return False

    if advanced:
        return True
    if relations >= 1 and (operators >= 1 or len(words) <= 5):
        return True
    if operators >= 2 and len(words) <= 5:
        return True
    return False


def equation_overlay_is_plausible(equation: Any, existing_markdown: str) -> bool:
    """Reject weak equation candidates and approximate duplicates of surrounding prose."""

    source = _clean(str(getattr(equation, "source_text", "") or ""))
    markdown = str(getattr(equation, "markdown", "") or "")
    if not display_math_text_is_plausible(source or markdown):
        return False

    # If the exact source is present, first check whether it is actually a fragment of
    # a much longer prose line. Replacing such a fragment with display math was the
    # source of duplicates like "(as Ci > R(..." appearing below the original sentence.
    if source and source in existing_markdown:
        for raw_line in existing_markdown.splitlines():
            if source not in raw_line:
                continue
            line = raw_line.strip()
            if line == source or len(line) <= max(len(source) + 12, int(len(source) * 1.25)):
                return True
            if len(_WORD_RE.findall(line)) >= 6:
                return False
        return True

    # OCR often changes only spacing: a candidate such as "ifpi=pe" may already be
    # embedded in a longer extracted formula as "if pi = pe". Treating the compact
    # fragment as a second display equation only duplicates damaged source text.
    source_compact = _compact_math_text(source)
    if len(source_compact) >= 5:
        for raw_line in existing_markdown.splitlines():
            line_compact = _compact_math_text(raw_line)
            if (
                source_compact in line_compact
                and len(line_compact) >= max(len(source_compact) + 8, int(len(source_compact) * 1.5))
            ):
                return False

    source_cmp = _comparison_text(source)
    if not source_cmp:
        return True

    source_tokens = source_cmp.split()
    if len(source_tokens) < 4:
        return True

    # PyMuPDF sometimes emits a second, slightly mangled equation-like interpretation
    # of a prose/caption line. If most normalized words already occur together in one
    # surrounding Markdown line, inserting another display block only duplicates text.
    for raw_line in existing_markdown.splitlines():
        line_cmp = _comparison_text(raw_line)
        if not line_cmp:
            continue
        if source_cmp in line_cmp or line_cmp in source_cmp:
            return False
        line_tokens = set(line_cmp.split())
        overlap = sum(1 for token in source_tokens if token in line_tokens)
        if overlap / max(1, len(source_tokens)) >= 0.85:
            return False
    return True
