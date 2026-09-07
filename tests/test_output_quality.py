from types import SimpleNamespace

from pdf_sanitizer.equation_quality import (
    display_math_text_is_plausible,
    equation_overlay_is_plausible,
)
from pdf_sanitizer.running_matter import strip_running_matter
from pdf_sanitizer.structure import (
    normalize_heading_structure,
    normalize_math_artifacts,
)


def test_sentence_with_one_relation_is_not_display_math():
    assert not display_math_text_is_plausible(
        "The capacity C = 20, and there are three population sizes: 15, 20, and 25."
    )
    assert not display_math_text_is_plausible(
        "Table 4.2. Binomial and normal approximation probabilities with C = 150."
    )
    assert display_math_text_is_plausible("x = y + 2")
    assert display_math_text_is_plausible(r"f(x) = \frac{1}{2} x^2")


def test_prose_fragments_with_math_symbols_are_not_display_math():
    assert not display_math_text_is_plausible(
        "probability 1/2, generating a positive expected profit for firm 2. However,"
    )
    assert not display_math_text_is_plausible(
        r"0.284 \times 57.14 = 16.23. This is higher than given"
    )
    assert not display_math_text_is_plausible(
        "efficient sets can be ordered by revenue. These can be ordered as follows"
    )


def test_whitespace_stripped_caption_is_not_display_math():
    assert not display_math_text_is_plausible(
        "BinomialandnormalapproximationoverbookingprobabilitieswithC="
    )
    assert not display_math_text_is_plausible(
        "Attributeweightsx},forattributesm=1,2inalternativej=1,"
    )


def test_compact_equation_fragment_already_inside_longer_formula_is_rejected():
    equation = SimpleNamespace(source_text="ifpi=pe", markdown="$$\nifpi=pe\n$$")
    existing = "dpi) if pi<pe di(pi,p2) = d(pi)/2 if pi =pe (8.24) 0 if pi > po."
    assert not equation_overlay_is_plausible(equation, existing)


def test_heading_depth_follows_explicit_section_numbering():
    value = "# **9.4.1 Expectation-Maximization (EM) Method**\n\n## **11.6.1.1 Analysts**"
    assert normalize_heading_structure(value) == (
        "### 9.4.1 Expectation-Maximization (EM) Method\n\n"
        "#### 11.6.1.1 Analysts"
    )


def test_false_math_is_unwrapped_and_duplicate_math_is_removed():
    value = """$$
Table 4.2. Probabilities with C = 150.
$$

$$
x = y + 2
$$

$$
x = y + 2
$$
"""
    result = normalize_math_artifacts(value)
    assert "Table 4.2. Probabilities with C = 150." in result
    assert "$$\nTable 4.2" not in result
    assert result.count("x = y + 2") == 1


def test_placeholder_accidentally_wrapped_as_math_becomes_visual_placeholder():
    value = '$$\nPLACEHOLDER page=546 bbox="108,179,379,243"\n$$'
    assert normalize_math_artifacts(value) == (
        '[VISUAL_PLACEHOLDER page=546 bbox="108,179,379,243"]'
    )


class FakePage:
    rect = (0, 0, 600, 800)

    def get_text(self, kind, sort=True):
        assert kind == "dict"
        return {
            "blocks": [
                {
                    "type": 0,
                    "lines": [
                        {
                            "bbox": (50, 12, 550, 28),
                            "spans": [
                                {"text": "474 ", "bbox": (50, 12, 80, 28)},
                                {
                                    "text": "THE THEORY AND PRACTICE OF REVENUE MANAGEMENT",
                                    "bbox": (90, 12, 550, 28),
                                },
                            ],
                        },
                        {
                            "bbox": (50, 100, 550, 130),
                            "spans": [{"text": "Body paragraph", "bbox": (50, 100, 200, 130)}],
                        },
                    ],
                }
            ]
        }


def test_running_header_is_removed_only_when_not_requested():
    markdown = "474 _THE THEORY AND PRACTICE OF REVENUE MANAGEMENT_\n\nBody paragraph"
    page = FakePage()
    assert strip_running_matter(markdown, page) == "Body paragraph"
    assert strip_running_matter(markdown, page, keep_headers=True) == markdown
