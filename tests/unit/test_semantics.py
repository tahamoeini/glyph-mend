from pdf_sanitizer.semantics import (
    normalize_inline_math,
    normalize_display_math_lines,
    normalize_task_lists,
    text_to_latex,
)


def test_unicode_math_to_latex():
    assert text_to_latex("E = mc² + α ≤ β") == r"E = mc^{2} + \alpha \leq \beta"
    assert text_to_latex("x₁ = ½") == r"x_{1} = \frac{1}{2}"


def test_inline_math_is_reconstructed_without_absorbing_following_prose():
    assert normalize_inline_math("The model uses x = y + 2 in practice.") == (
        "The model uses $x = y + 2$ in practice."
    )
    assert normalize_inline_math("p(D1 > y1) is estimated.") == "$p(D1 > y1)$ is estimated."
    assert normalize_inline_math("The total amount = the posted amount plus adjustments.") == (
        "The total amount = the posted amount plus adjustments."
    )


def test_strong_standalone_math_becomes_display_math():
    value = "Before\n\nx = y + 2\n\nAfter"
    result = normalize_display_math_lines(value)
    assert "$$\nx = y + 2\n$$" in result


def test_prose_with_equals_is_not_forced_into_math():
    value = "The total amount = the posted amount plus adjustments."
    assert normalize_display_math_lines(value) == value


def test_false_layout_math_blocks_are_unwrapped():
    value = "$$\neBook ISBN: 1-4020-7933-8 Print ISBN: 1-4020-7701-7\n$$"
    result = normalize_display_math_lines(value)
    assert "$$" not in result
    assert "eBook ISBN" in result


def test_picture_title_is_not_math_and_internal_markers_are_removed():
    value = (
        "<!-- Start of picture text -->\n"
        "$$\nREVENUE<br>MANAGEMENT<br><!-- End of picture text -->\n$$"
    )
    result = normalize_display_math_lines(value)
    assert "$$" not in result
    assert "picture text" not in result
    assert "REVENUE\nMANAGEMENT" in result


def test_existing_real_math_block_is_preserved_and_cleaned():
    value = "<!-- Start of picture text -->\n$$\nx₁ = ½\n<!-- End of picture text -->\n$$"
    result = normalize_display_math_lines(value)
    assert "picture text" not in result
    assert "$$\nx_{1} = \\frac{1}{2}\n$$" in result


def test_checkbox_lists_become_github_task_lists():
    value = "☐ First\n☑ Second\nNormal"
    assert normalize_task_lists(value) == "- [ ] First\n- [x] Second\nNormal"


def test_semantic_normalizers_leave_fences_alone():
    value = "```text\n☐ literal\nx = y + 2\n```"
    assert normalize_task_lists(value) == value
    assert normalize_display_math_lines(value) == value
