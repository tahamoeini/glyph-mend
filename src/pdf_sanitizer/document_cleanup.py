from __future__ import annotations

import re
from collections import Counter
from functools import lru_cache

_PAGE_MARKER_RE = re.compile(r"(?m)^[ \t]*<!--\s*page:\s*(\d+)\s*-->[ \t]*$")
_HEADING_RE = re.compile(r"^\s*#{1,6}\s+")
_EMPHASIS_RE = re.compile(r"[*_`]+")
_PAGE_LABEL = r"(?:\d{1,5}|[ivxlcdm]{1,12})"
_PAGE_NUMBER_ONLY_RE = re.compile(rf"^{_PAGE_LABEL}$", re.IGNORECASE)
_LEADING_PAGE_RE = re.compile(rf"^(?P<label>{_PAGE_LABEL})\s+", re.IGNORECASE)
_TRAILING_PAGE_RE = re.compile(rf"\s+(?P<label>{_PAGE_LABEL})$", re.IGNORECASE)
_LATIN_WORD_RE = r"[A-Za-zÀ-ÖØ-öø-ÿ]"
_CROSS_PAGE_HYPHEN_RE = re.compile(
    rf"(?P<left>{_LATIN_WORD_RE}{{3,}})-\s*\n+\s*"
    r"(?P<marker><!--\s*page:\s*\d+\s*-->)\s*\n+\s*"
    rf"(?P<right>[a-zà-öø-ÿ]{{2,}})"
)
_CROSS_PAGE_PARAGRAPH_RE = re.compile(
    r"(?P<left>[^\n]+)\n+\s*"
    r"(?P<marker><!--\s*page:\s*\d+\s*-->)\s*\n+"
    r"(?P<right>[^\n]+)"
)
_LOW_COMMA_RE = re.compile(r"‚(?=(?:[*_`]+)?(?:\s|[”’\"]))")
_FOOTNOTE_NUMBER_RE = re.compile(r"(?m)^(?P<prefix>\s*>\s*)(?P<number>\d{1,3})(?=[A-ZÀ-ÖØ-Þ])")
_STRUCTURAL_PREFIXES = ("#", ">", "[IMAGE_", "[GRAPHIC_", "[VISUAL_", "|", "```", "~~~", "$$")


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
        or raw.startswith(("```", "~~~", "[IMAGE_", "[GRAPHIC_", "[VISUAL_", ">", "|"))
    ):
        return None

    raw_without_heading = _HEADING_RE.sub("", raw)
    plain = _EMPHASIS_RE.sub("", raw_without_heading).strip()

    has_page_number = False
    leading = _LEADING_PAGE_RE.match(plain)
    if leading:
        has_page_number = True
        plain = plain[leading.end() :].strip()
    trailing = _TRAILING_PAGE_RE.search(plain)
    if trailing:
        has_page_number = True
        plain = plain[: trailing.start()].strip()

    if plain.casefold() == "this page intentionally left blank":
        return None

    italic_wrapped = bool(re.match(r"^_[^_].*_$", raw_without_heading))
    all_caps = plain.isupper() and any(char.isalpha() for char in plain)
    if not (has_page_number or italic_wrapped or all_caps):
        return None

    signature = re.sub(r"\s+", " ", plain).strip().casefold()
    if len(signature) < 3 or len(signature) > 120:
        return None
    if not re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]", signature):
        return None
    return signature, has_page_number


@lru_cache(maxsize=256)
def _running_prefix_pattern(signature: str) -> re.Pattern[str]:
    tokens = signature.split()
    title = r"[\s*_`]+".join(re.escape(token) for token in tokens)
    pattern = (
        rf"^\s*(?:#{{1,6}}\s*)?"
        rf"(?:(?:{_PAGE_LABEL})[\s*_`]+)?"
        rf"[*_`]*{title}[*_`]*"
        rf"(?:(?:[\s*_`]+{_PAGE_LABEL})(?=\s|$))?"
    )
    return re.compile(pattern, re.IGNORECASE)


def _strip_running_prefix(line: str, repeated: set[str]) -> tuple[str, str] | None:
    for signature in sorted(repeated, key=len, reverse=True):
        match = _running_prefix_pattern(signature).match(line)
        if not match:
            continue
        remainder = line[match.end() :].lstrip(" \t*_`")
        return signature, remainder
    return None


def strip_repeated_running_matter(markdown: str, *, edge_lines: int = 20) -> str:
    """Remove repeated headers/footers, including Roman labels and fused body text."""

    prefix, pages = _split_pages(markdown)
    if not pages:
        return markdown

    frequency: Counter[str] = Counter()
    numbered_frequency: Counter[str] = Counter()
    page_edge_signatures: dict[int, set[str]] = {}
    first_unpaginated_occurrence: dict[str, tuple[int, int]] = {}

    for page_number, _marker, body in pages:
        lines = body.splitlines()
        substantive = [(idx, line.strip()) for idx, line in enumerate(lines) if line.strip()]
        edge = substantive[:edge_lines] + substantive[-edge_lines:]
        seen: set[str] = set()
        seen_numbered: set[str] = set()
        for line_index, line in edge:
            candidate = _edge_signature(line)
            if candidate is None:
                continue
            signature, has_page_number = candidate
            seen.add(signature)
            if has_page_number:
                seen_numbered.add(signature)
            else:
                first_unpaginated_occurrence.setdefault(signature, (page_number, line_index))
        page_edge_signatures[page_number] = seen
        frequency.update(seen)
        numbered_frequency.update(seen_numbered)

    repeated = {
        signature
        for signature, count in frequency.items()
        if count >= 4 or numbered_frequency[signature] >= 2
    }
    if not repeated:
        return markdown

    rebuilt: list[str] = []
    for page_number, marker, body in pages:
        lines = body.splitlines()
        substantive_indexes = [idx for idx, line in enumerate(lines) if line.strip()]
        edge_indexes = set(substantive_indexes[:edge_lines] + substantive_indexes[-edge_lines:])
        page_repeated = page_edge_signatures.get(page_number, set()) & repeated

        page_has_running_prefix = False
        for line_index in edge_indexes:
            if line_index >= len(lines):
                continue
            candidate = _edge_signature(lines[line_index])
            if candidate is not None:
                signature, has_page_number = candidate
                if (
                    signature in repeated
                    and not has_page_number
                    and first_unpaginated_occurrence.get(signature) == (page_number, line_index)
                ):
                    continue
            if _strip_running_prefix(lines[line_index], repeated) is not None:
                page_has_running_prefix = True
                break

        output: list[str] = []
        for line_index, line in enumerate(lines):
            stripped = line.strip()
            if line_index not in edge_indexes:
                output.append(line)
                continue

            if (
                (page_repeated or page_has_running_prefix)
                and _PAGE_NUMBER_ONLY_RE.fullmatch(_EMPHASIS_RE.sub("", stripped))
            ):
                continue

            candidate = _edge_signature(line)
            if candidate is not None:
                signature, has_page_number = candidate
                if signature in repeated:
                    is_first_real_title = (
                        not has_page_number
                        and first_unpaginated_occurrence.get(signature) == (page_number, line_index)
                    )
                    if is_first_real_title:
                        output.append(line)
                        continue

            stripped_prefix = _strip_running_prefix(line, repeated)
            if stripped_prefix is not None:
                _signature, remainder = stripped_prefix
                if remainder:
                    output.append(remainder)
                continue

            output.append(line)

        body_value = "\n".join(output).strip()
        rebuilt.append(f"{marker}\n\n{body_value}" if body_value else marker)

    value = "\n\n".join(rebuilt)
    if prefix.strip():
        value = prefix.rstrip() + "\n\n" + value
    return value.strip()


def repair_cross_page_hyphenation(markdown: str) -> str:
    """Join proven line-wrap hyphenation across page comments without losing the marker."""

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


def repair_cross_page_paragraphs(markdown: str) -> str:
    """Rejoin high-confidence prose continuations split only by a source page boundary.

    The marker becomes an inline HTML comment so provenance survives. We require a
    substantial prose line, no terminal sentence punctuation, and a lowercase next line.
    Structural blocks and all-caps front matter are deliberately excluded.
    """

    def replace(match: re.Match[str]) -> str:
        left = match.group("left").strip()
        right = match.group("right").strip()
        if not left or not right:
            return match.group(0)
        if left.startswith(_STRUCTURAL_PREFIXES) or right.startswith(_STRUCTURAL_PREFIXES):
            return match.group(0)
        if left.startswith(('- ', '* ', '+ ')) or re.match(r"^\d+[.)]\s", left):
            return match.group(0)
        if right.startswith(('- ', '* ', '+ ')) or re.match(r"^\d+[.)]\s", right):
            return match.group(0)
        if len(left) < 40 or left.rstrip().endswith((".", "!", "?", ":", ";")):
            return match.group(0)
        plain_left = _EMPHASIS_RE.sub("", left)
        if plain_left.isupper() and any(char.isalpha() for char in plain_left):
            return match.group(0)
        first = right[:1]
        if not first or not first.islower():
            return match.group(0)
        return f"{left} {match.group('marker')} {right}"

    return _CROSS_PAGE_PARAGRAPH_RE.sub(replace, markdown)


def normalize_extraction_punctuation(markdown: str) -> str:
    """Repair deterministic punctuation/spacing encoding artifacts."""

    value = _LOW_COMMA_RE.sub(",", markdown)
    value = _FOOTNOTE_NUMBER_RE.sub(r"\g<prefix>\g<number> ", value)
    return value


def cleanup_combined_markdown(markdown: str) -> str:
    value = strip_repeated_running_matter(markdown)
    value = repair_cross_page_hyphenation(value)
    value = repair_cross_page_paragraphs(value)
    value = normalize_extraction_punctuation(value)

    # Checkpoint parts may have been produced by an older equation-quality heuristic.
    # Re-evaluate display blocks during combine / DOCX export without re-reading the PDF.
    from .structure import normalize_math_artifacts

    value = normalize_math_artifacts(value)
    return value.strip()
