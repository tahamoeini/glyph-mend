from __future__ import annotations

import re
from collections import Counter

_PAGE_MARKER_RE = re.compile(r"(?m)^[ \t]*<!--\s*page:\s*(\d+)\s*-->[ \t]*$")
_HEADING_RE = re.compile(r"^\s*#{1,6}\s+")
_EMPHASIS_RE = re.compile(r"[*_`]+")
_PAGE_NUMBER_ONLY_RE = re.compile(r"^\d{1,5}$")
_LATIN_WORD_RE = r"[A-Za-zÀ-ÖØ-öø-ÿ]"
_CROSS_PAGE_HYPHEN_RE = re.compile(
    rf"(?P<left>{_LATIN_WORD_RE}{{3,}})-\s*\n+\s*"
    r"(?P<marker><!--\s*page:\s*\d+\s*-->)\s*\n+\s*"
    rf"(?P<right>[a-zà-öø-ÿ]{{2,}})"
)
_LOW_COMMA_RE = re.compile(r"‚(?=(?:[*_`]+)?(?:\s|[”’\"]))")


def _split_pages(markdown: str) -> tuple[str, list[tuple[int, str, str]]]:
    matches = list(_PAGE_MARKER_RE.finditer(markdown))
    if not matches:
        return markdown, []

    prefix = markdown[: matches[0].start()]
    pages: list[tuple[int, str, str]] = []
    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        pages.append((int(match.group(1)), match.group(0).strip(), markdown[match.end() : stop]))
    return prefix, pages


def _edge_signature(line: str) -> tuple[str, bool] | None:
    raw = line.strip()
    if (
        not raw
        or raw == "$$"
        or _HEADING_RE.match(raw)
        or raw.startswith(("```", "~~~", "[IMAGE_", "[GRAPHIC_", "[VISUAL_", ">", "|"))
    ):
        return None

    plain = _EMPHASIS_RE.sub("", raw)
    has_page_number = bool(re.match(r"^\d{1,5}\s+", plain) or re.search(r"\s+\d{1,5}$", plain))
    plain = re.sub(r"^\d{1,5}\s+", "", plain)
    plain = re.sub(r"\s+\d{1,5}$", "", plain)
    plain = re.sub(r"\s+", " ", plain).strip()

    if plain.casefold() == "this page intentionally left blank":
        return None

    italic_wrapped = bool(re.match(r"^_[^_].*_$", raw))
    all_caps = plain.isupper() and any(char.isalpha() for char in plain)
    if not (has_page_number or italic_wrapped or all_caps):
        return None

    signature = plain.casefold()
    if len(signature) < 3 or len(signature) > 120:
        return None
    if not re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]", signature):
        return None
    return signature, has_page_number


def strip_repeated_running_matter(markdown: str, *, edge_lines: int = 20) -> str:
    """Remove recurring page headers/footers after page parts have been combined.

    Per-page geometry is useful but not sufficient for difficult books where formulas,
    pictures, or OCR blocks can be emitted before the printed running header. At document
    level repetition becomes strong evidence: a short italic/all-caps edge line repeated
    on several pages is much more likely to be running matter than body prose.
    """

    prefix, pages = _split_pages(markdown)
    if not pages:
        return markdown

    frequency: Counter[str] = Counter()
    page_edge_signatures: dict[int, set[str]] = {}
    first_unpaginated_occurrence: dict[str, tuple[int, int]] = {}

    for page_number, _marker, body in pages:
        lines = body.splitlines()
        substantive = [(idx, line.strip()) for idx, line in enumerate(lines) if line.strip()]
        edge = substantive[:edge_lines] + substantive[-edge_lines:]
        seen: set[str] = set()
        for line_index, line in edge:
            candidate = _edge_signature(line)
            if candidate is None:
                continue
            signature, has_page_number = candidate
            seen.add(signature)
            if not has_page_number:
                first_unpaginated_occurrence.setdefault(signature, (page_number, line_index))
        page_edge_signatures[page_number] = seen
        frequency.update(seen)

    repeated = {signature for signature, count in frequency.items() if count >= 4}
    if not repeated:
        return markdown

    rebuilt: list[str] = []
    for page_number, marker, body in pages:
        lines = body.splitlines()
        substantive_indexes = [idx for idx, line in enumerate(lines) if line.strip()]
        edge_indexes = set(substantive_indexes[:edge_lines] + substantive_indexes[-edge_lines:])
        page_repeated = page_edge_signatures.get(page_number, set()) & repeated
        output: list[str] = []

        for line_index, line in enumerate(lines):
            stripped = line.strip()
            if (
                line_index in edge_indexes
                and page_repeated
                and _PAGE_NUMBER_ONLY_RE.fullmatch(stripped)
            ):
                continue

            candidate = _edge_signature(line)
            if candidate is not None:
                signature, has_page_number = candidate
                if signature in repeated:
                    # A numbered candidate is unambiguously running matter. For an
                    # unnumbered italic/all-caps signature, preserve its first occurrence
                    # because it may be the actual appendix/part title that later became
                    # a running header.
                    if has_page_number or first_unpaginated_occurrence.get(signature) != (
                        page_number,
                        line_index,
                    ):
                        continue

            output.append(line)

        body_value = "\n".join(output).strip()
        rebuilt.append(f"{marker}\n\n{body_value}" if body_value else marker)

    value = "\n\n".join(rebuilt)
    if prefix.strip():
        value = prefix.rstrip() + "\n\n" + value
    return value.strip()


def repair_cross_page_hyphenation(markdown: str) -> str:
    """Join proven line-wrap hyphenation across page comments without losing the marker.

    The join is made only when the unhyphenated word occurs elsewhere in the same
    document and the hyphenated spelling does not. This avoids guessing about genuine
    compounds such as ``price-sensitive``.
    """

    search_text = markdown.casefold()

    def replace(match: re.Match[str]) -> str:
        left = match.group("left")
        right = match.group("right")
        joined = (left + right).casefold()
        hyphenated = (left + "-" + right).casefold()
        if search_text.count(joined) >= 1 and search_text.count(hyphenated) == 0:
            return f"{left}{match.group('marker')}{right}"
        return match.group(0)

    return _CROSS_PAGE_HYPHEN_RE.sub(replace, markdown)


def normalize_extraction_punctuation(markdown: str) -> str:
    """Repair deterministic punctuation encoding artifacts without broad transcoding."""

    # Some older embedded PDF fonts map a comma glyph to U+201A. A true opening
    # low-quotation mark is followed directly by quoted text, whereas this extraction
    # artifact is followed by whitespace, Markdown emphasis, or a closing quote.
    return _LOW_COMMA_RE.sub(",", markdown)


def cleanup_combined_markdown(markdown: str) -> str:
    value = strip_repeated_running_matter(markdown)
    value = repair_cross_page_hyphenation(value)
    value = normalize_extraction_punctuation(value)
    return value.strip()
