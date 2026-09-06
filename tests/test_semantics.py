from pdf_sanitizer.semantics import (
    normalize_display_math_lines,
    normalize_task_lists,
    text_to_latex,
)


def test_unicode_math_to_latex():
    assert text_to_latex("E = mc² + α ≤ β") == r"E = mc^{2} + \alpha \leq \beta"
    assert text_to_latex("x₁ = ½") == r"x_{1} = \frac{1}{2}"


def test_strong_standalone_math_becomes_display_math():
    value = "Before\n\nx = y + 2\n\nAfter"
    result = normalize_display_math_lines(value)
    assert "$$\nx = y + 2\n$$" in result


def test_prose_with_equals_is_not_forced_into_math():
    value = "The total amount = the posted amount plus adjustments."
    assert normalize_display_math_lines(value) == value


def test_checkbox_lists_become_github_task_lists():
    value = "☐ First\n☑ Second\nNormal"
    assert normalize_task_lists(value) == "- [ ] First\n- [x] Second\nNormal"


def test_semantic_normalizers_leave_fences_alone():
    value = "```text\n☐ literal\nx = y + 2\n```"
    assert normalize_task_lists(value) == value
    assert normalize_display_math_lines(value) == value
