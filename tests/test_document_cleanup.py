from pdf_sanitizer.document_cleanup import (
    cleanup_combined_markdown,
    normalize_extraction_punctuation,
    repair_cross_page_hyphenation,
    strip_repeated_running_matter,
)


def _page(number: int, body: str) -> str:
    return f"<!-- page: {number} -->\n\n{body}"


def test_repeated_running_headers_and_edge_page_numbers_are_removed():
    pages = []
    for number in range(1, 6):
        pages.append(
            _page(
                number,
                f"{100 + number} _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\n"
                f"Body paragraph for page {number}.\n\n"
                f"_Estimation and Forecasting_\n\n{200 + number}",
            )
        )

    result = strip_repeated_running_matter("\n\n".join(pages))

    assert "THE THEORY AND PRACTICE OF REVENUE MANAGEMENT" not in result
    assert "201" not in result
    assert "205" not in result
    assert result.count("Body paragraph for page") == 5
    # Preserve one unnumbered occurrence in case the first is the actual section title.
    assert result.count("_Estimation and Forecasting_") == 1


def test_intentionally_blank_page_is_not_mistaken_for_running_matter():
    value = "\n\n".join(
        _page(number, "_This page intentionally left blank_") for number in range(1, 5)
    )
    result = strip_repeated_running_matter(value)
    assert result.count("This page intentionally left blank") == 4


def test_cross_page_wrap_hyphen_is_repaired_only_with_corpus_evidence():
    value = (
        "The effect is significant elsewhere.\n\n"
        "This is signifi-\n\n<!-- page: 2 -->\n\ncant for the model."
    )
    result = repair_cross_page_hyphenation(value)
    assert "signifi<!-- page: 2 -->cant" in result
    assert "signifi-" not in result


def test_genuine_cross_page_compound_is_not_joined_without_evidence():
    value = (
        "The model is price-\n\n<!-- page: 2 -->\n\nsensitive in this market. "
        "A price-sensitive policy is discussed later."
    )
    result = repair_cross_page_hyphenation(value)
    assert "price-\n\n<!-- page: 2 -->\n\nsensitive" in result


def test_misencoded_low_comma_is_repaired_in_punctuation_contexts():
    value = "Series Editor‚ Stanford; collusion‚_ is possible; [314]‚ in fact."
    result = normalize_extraction_punctuation(value)
    assert result == "Series Editor, Stanford; collusion,_ is possible; [314], in fact."


def test_combined_cleanup_composes_all_safe_repairs():
    pages = []
    for number in range(1, 5):
        body = (
            f"{300 + number} _BOOK TITLE_\n\n"
            f"Body {number}."
        )
        pages.append(_page(number, body))
    value = "\n\n".join(pages) + "\n\nThis conclusion‚ is significant."
    result = cleanup_combined_markdown(value)
    assert "BOOK TITLE" not in result
    assert "conclusion, is significant" in result
