from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from .graphics import BBox, merge_bbox, overlap_ratio


@dataclass(frozen=True, slots=True)
class DisplayEquation:
    bbox: BBox
    markdown: str
    source_text: str


_GREEK = {
    "α": r"\alpha",
    "β": r"\beta",
    "γ": r"\gamma",
    "δ": r"\delta",
    "ε": r"\epsilon",
    "ζ": r"\zeta",
    "η": r"\eta",
    "θ": r"\theta",
    "ι": r"\iota",
    "κ": r"\kappa",
    "λ": r"\lambda",
    "μ": r"\mu",
    "ν": r"\nu",
    "ξ": r"\xi",
    "π": r"\pi",
    "ρ": r"\rho",
    "σ": r"\sigma",
    "τ": r"\tau",
    "υ": r"\upsilon",
    "φ": r"\phi",
    "χ": r"\chi",
    "ψ": r"\psi",
    "ω": r"\omega",
    "Γ": r"\Gamma",
    "Δ": r"\Delta",
    "Θ": r"\Theta",
    "Λ": r"\Lambda",
    "Ξ": r"\Xi",
    "Π": r"\Pi",
    "Σ": r"\Sigma",
    "Φ": r"\Phi",
    "Ψ": r"\Psi",
    "Ω": r"\Omega",
}

_SYMBOLS = {
    "±": r"\pm",
    "∓": r"\mp",
    "×": r"\times",
    "÷": r"\div",
    "≤": r"\leq",
    "≥": r"\geq",
    "≠": r"\neq",
    "≈": r"\approx",
    "≡": r"\equiv",
    "∞": r"\infty",
    "∑": r"\sum",
    "∏": r"\prod",
    "∫": r"\int",
    "∂": r"\partial",
    "∇": r"\nabla",
    "∈": r"\in",
    "∉": r"\notin",
    "⊂": r"\subset",
    "⊆": r"\subseteq",
    "⊃": r"\supset",
    "⊇": r"\supseteq",
    "∪": r"\cup",
    "∩": r"\cap",
    "→": r"\to",
    "←": r"\leftarrow",
    "↔": r"\leftrightarrow",
    "⇒": r"\Rightarrow",
    "⇐": r"\Leftarrow",
    "⇔": r"\Leftrightarrow",
    "∝": r"\propto",
    "∴": r"\therefore",
    "∵": r"\because",
    "°": r"^{\circ}",
}

_FRACTIONS = {
    "½": r"\frac{1}{2}",
    "⅓": r"\frac{1}{3}",
    "⅔": r"\frac{2}{3}",
    "¼": r"\frac{1}{4}",
    "¾": r"\frac{3}{4}",
    "⅕": r"\frac{1}{5}",
    "⅖": r"\frac{2}{5}",
    "⅗": r"\frac{3}{5}",
    "⅘": r"\frac{4}{5}",
    "⅙": r"\frac{1}{6}",
    "⅚": r"\frac{5}{6}",
    "⅛": r"\frac{1}{8}",
    "⅜": r"\frac{3}{8}",
    "⅝": r"\frac{5}{8}",
    "⅞": r"\frac{7}{8}",
}

_SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ", "0123456789+-=()ni")
_SUBSCRIPT = str.maketrans(
    "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓ",
    "0123456789+-=()aehijklmnoprstx",
)
_SUPER_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"
_SUB_CHARS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓ"
_MATH_CHARS = set("=+-*/^_<>±∓×÷≤≥≠≈≡∞∑∏∫√∂∇∈∉⊂⊆⊃⊇∪∩→←↔⇒⇐⇔∝∴∵")
_MATH_CHARS.update(_GREEK)
_MATH_CHARS.update(_SUPER_CHARS)
_MATH_CHARS.update(_SUB_CHARS)
_MATH_FONT_HINTS = ("math", "symbol", "stix", "cambria", "computer modern", "cmsy", "cmmi")
_URL_RE = re.compile(r"(?:https?://|www\.|\b\S+@\S+\.\S+)", re.IGNORECASE)
_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]{3,}")
_FENCE_RE = re.compile(r"(^```[^\n]*\n.*?^```[ \t]*$|^~~~[^\n]*\n.*?^~~~[ \t]*$)", re.MULTILINE | re.DOTALL)


def _bbox(value: Any) -> BBox | None:
    try:
        return float(value[0]), float(value[1]), float(value[2]), float(value[3])
    except Exception:
        return None


def _translate_runs(text: str, chars: str, translation: dict[int, str], marker: str) -> str:
    pattern = re.compile(f"([{re.escape(chars)}]+)")

    def repl(match: re.Match[str]) -> str:
        value = match.group(1).translate(translation)
        return f"{marker}{{{value}}}"

    return pattern.sub(repl, text)


def text_to_latex(text: str) -> str:
    """Conservatively normalize Unicode math into GitHub/MathJax-friendly LaTeX."""

    value = text.strip()
    for source, replacement in _FRACTIONS.items():
        value = value.replace(source, replacement)

    value = _translate_runs(value, _SUPER_CHARS, _SUPERSCRIPT, "^")
    value = _translate_runs(value, _SUB_CHARS, _SUBSCRIPT, "_")

    # Handle the common unambiguous square-root case without guessing expression scope.
    value = re.sub(r"√\s*([A-Za-z0-9]+)", r"\\sqrt{\1}", value)

    for source, replacement in {**_GREEK, **_SYMBOLS}.items():
        value = value.replace(source, replacement)

    # LaTeX commands need a separator before a following ASCII letter.
    value = re.sub(r"(\\[A-Za-z]+)(?=[A-Za-z])", r"\1 ", value)
    value = re.sub(r"[ \t]+", " ", value).strip()
    return value


def _span_text(span: dict[str, Any]) -> str:
    return str(span.get("text") or "")


def _math_score(text: str, spans: list[dict[str, Any]]) -> int:
    stripped = text.strip()
    if len(stripped) < 3 or len(stripped) > 260 or _URL_RE.search(stripped):
        return -100

    math_hits = sum(1 for ch in stripped if ch in _MATH_CHARS)
    relations = sum(1 for ch in stripped if ch in "=<>≤≥≠≈≡")
    greek = sum(1 for ch in stripped if ch in _GREEK)
    super_sub = sum(1 for ch in stripped if ch in _SUPER_CHARS or ch in _SUB_CHARS)
    superscript_spans = sum(1 for span in spans if int(span.get("flags") or 0) & 1)
    math_fonts = sum(
        1
        for span in spans
        if any(hint in str(span.get("font") or "").lower() for hint in _MATH_FONT_HINTS)
    )
    variable_relation = bool(
        re.search(r"(?:^|\s)[A-Za-z][A-Za-z0-9_]*\s*(?:=|≤|≥|<|>|≈|≠)", stripped)
    )

    words = _WORD_RE.findall(stripped)
    score = math_hits + 2 * relations + greek + super_sub + superscript_spans
    if math_fonts:
        score += 2
    if variable_relation:
        score += 2
    if len(words) > 12:
        score -= 4
    if stripped.endswith((".", "!", "?")) and len(words) > 5:
        score -= 2
    return score


def _line_latex(spans: list[dict[str, Any]]) -> tuple[str, str]:
    raw_parts: list[str] = []
    latex_parts: list[str] = []
    for span in spans:
        raw = _span_text(span)
        if not raw:
            continue
        raw_parts.append(raw)
        latex = text_to_latex(raw)
        if int(span.get("flags") or 0) & 1 and latex:
            # If the glyph is already explicitly superscripted Unicode, text_to_latex
            # has handled it and wrapping again would duplicate the exponent.
            if not any(ch in raw for ch in _SUPER_CHARS):
                latex = f"^{{{latex}}}"
        latex_parts.append(latex)
    raw_text = "".join(raw_parts).strip()
    latex_text = "".join(latex_parts).strip()
    return raw_text, latex_text


def detect_display_equations(
    page: Any,
    excluded_bboxes: Iterable[BBox] | None = None,
) -> list[DisplayEquation]:
    """Detect text-based display equations and emit conservative LaTeX math blocks.

    This intentionally handles only lines with strong mathematical evidence. Inline prose
    is left untouched rather than being wrapped in math delimiters based on weak guesses.
    """

    excluded = list(excluded_bboxes or [])
    try:
        blocks = page.get_text("dict").get("blocks", [])
    except Exception:
        return []

    output: list[DisplayEquation] = []
    for block in blocks:
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            spans = [span for span in line.get("spans", []) if _span_text(span).strip()]
            if not spans:
                continue
            raw_text, latex_text = _line_latex(spans)
            if not raw_text or not latex_text or _math_score(raw_text, spans) < 4:
                continue

            rects = [_bbox(span.get("bbox")) for span in spans]
            rects = [rect for rect in rects if rect is not None]
            if not rects:
                continue
            bbox = merge_bbox(rects)
            if any(overlap_ratio(bbox, excluded_rect) >= 0.25 for excluded_rect in excluded):
                continue

            output.append(
                DisplayEquation(
                    bbox=bbox,
                    markdown=f"$$\n{latex_text}\n$$",
                    source_text=raw_text,
                )
            )
    return output


def _outside_fences(markdown: str, transform: Callable[[str], str]) -> str:
    parts = _FENCE_RE.split(markdown)
    return "".join(part if _FENCE_RE.fullmatch(part) else transform(part) for part in parts)


def normalize_display_math_lines(markdown: str) -> str:
    """Catch strong standalone equations left by OCR or layout extraction.

    This is intentionally stricter than native span-level detection because OCR has less
    structural evidence. It never rewrites fenced code, Mermaid, or existing literal blocks.
    """

    def transform(part: str) -> str:
        lines: list[str] = []
        inside_math = False
        for line in part.split("\n"):
            stripped = line.strip()
            if stripped == "$$":
                inside_math = not inside_math
                lines.append(line)
                continue
            if inside_math or not stripped:
                lines.append(line)
                continue
            if stripped.startswith(("#", "|", ">", "- ", "* ", "+ ", "[", "<!--")):
                lines.append(line)
                continue
            if _math_score(stripped, []) >= 6:
                lines.extend(("$$", text_to_latex(stripped), "$$"))
            else:
                lines.append(line)
        return "\n".join(lines)

    return _outside_fences(markdown, transform)


def normalize_task_lists(markdown: str) -> str:
    """Turn PDF checkbox-list glyphs into GitHub task-list syntax."""

    def transform(part: str) -> str:
        unchecked = re.compile(r"^(\s*)(?:[-*+]\s*)?[☐□]\s+(.+)$", re.MULTILINE)
        checked = re.compile(r"^(\s*)(?:[-*+]\s*)?[☑☒]\s+(.+)$", re.MULTILINE)
        value = unchecked.sub(r"\1- [ ] \2", part)
        return checked.sub(r"\1- [x] \2", value)

    return _outside_fences(markdown, transform) if markdown else markdown
