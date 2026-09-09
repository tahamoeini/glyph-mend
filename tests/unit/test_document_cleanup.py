from pdf_sanitizer.document_cleanup import (
    cleanup_combined_markdown,
    normalize_extraction_punctuation,
    repair_cross_page_hyphenation,
    repair_cross_page_paragraphs,
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
    assert result.count("_Estimation and Forecasting_") == 1


def test_roman_running_header_is_removed_but_first_real_title_survives():
    value = "\n\n".join(
        [
            _page(1, "# THE THEORY AND PRACTICE OF REVENUE MANAGEMENT"),
            _page(2, "xxvi _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody two."),
            _page(3, "xxvii _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody three."),
            _page(4, "xxviii _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody four."),
        ]
    )
    result = strip_repeated_running_matter(value)
    assert result.count("THE THEORY AND PRACTICE OF REVENUE MANAGEMENT") == 1
    assert "xxvi" not in result
    assert "xxvii" not in result
    assert "xxviii" not in result
    assert "Body two." in result


def test_running_header_fused_to_body_keeps_body_text():
    value = "\n\n".join(
        [
            _page(1, "# THE THEORY AND PRACTICE OF REVENUE MANAGEMENT"),
            _page(2, "102 _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody two."),
            _page(3, "103 _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody three."),
            _page(
                4,
                "104 _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_ "
                "First, for all products j that use i, a displacement-adjusted revenue is computed.",
            ),
        ]
    )
    result = strip_repeated_running_matter(value)
    assert "104 _THE THEORY" not in result
    assert "First, for all products j that use i" in result
    assert result.count("THE THEORY AND PRACTICE OF REVENUE MANAGEMENT") == 1


def test_running_header_misclassified_as_heading_is_removed():
    value = "\n\n".join(
        [
            _page(1, "# THE THEORY AND PRACTICE OF REVENUE MANAGEMENT"),
            _page(2, "# 209 _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody."),
            _page(3, "# 210 _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nMore body."),
        ]
    )
    result = strip_repeated_running_matter(value)
    assert "# 209" not in result
    assert "# 210" not in result
    assert "Body." in result and "More body." in result


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


def test_cross_page_prose_continuation_becomes_one_semantic_paragraph():
    value = (
        "This paragraph is deliberately long enough to represent ordinary body prose and ends with a comma,\n\n"
        "<!-- page: 2 -->\n\n"
        "continuing naturally on the next source page without starting a new paragraph."
    )
    result = repair_cross_page_paragraphs(value)
    assert ", <!-- page: 2 --> continuing naturally" in result


def test_cross_page_reflow_does_not_merge_real_paragraph_boundary():
    value = (
        "This is a complete paragraph with enough words to pass the length threshold.\n\n"
        "<!-- page: 2 -->\n\n"
        "another paragraph begins here."
    )
    result = repair_cross_page_paragraphs(value)
    assert "\n\n<!-- page: 2 -->\n\n" in result


def test_misencoded_low_comma_and_footnote_spacing_are_repaired():
    value = "Series Editor‚ Stanford; collusion‚_ is possible; [314]‚ in fact.\n\n> 2It is easy."
    result = normalize_extraction_punctuation(value)
    assert "Series Editor, Stanford" in result
    assert "collusion,_ is possible" in result
    assert "[314], in fact" in result
    assert "> 2 It is easy." in result


def test_combined_cleanup_rechecks_stale_false_display_math():
    value = """<!-- page: 1 -->

Table 4.2. Binomial and normal approximation overbooking probabilities with C = 150.

$$
BinomialandnormalapproximationoverbookingprobabilitieswithC=
$$

<!-- page: 2 -->

$$
x = y + 2
$$
"""
    result = cleanup_combined_markdown(value)
    assert "$$\nBinomialandnormalapproximation" not in result
    assert "BinomialandnormalapproximationoverbookingprobabilitieswithC=" in result
    assert "$$\nx = y + 2\n$$" in result


def test_combined_cleanup_composes_all_safe_repairs():
    pages = []
    for number in range(1, 5):
        body = f"{300 + number} _BOOK TITLE_\n\nBody {number}."
        pages.append(_page(number, body))
    value = "\n\n".join(pages) + "\n\nThis conclusion‚ is significant."
    result = cleanup_combined_markdown(value)
    assert "BOOK TITLE" not in result
    assert "conclusion, is significant" in result
