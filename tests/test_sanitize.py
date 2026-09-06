from pdf_sanitizer.sanitize import sanitize_markdown


def test_normalizes_unicode_noise_and_ligatures():
    value = "A\u200bB ﬁle\u00ad name"
    assert sanitize_markdown(value) == "AB file name"


def test_preserves_math_compatibility_characters():
    value = "x² + y₁ = ½"
    assert sanitize_markdown(value) == value


def test_repairs_latin_wrap_hyphenation_only():
    assert sanitize_markdown("inter-\nnational") == "international"


def test_replaces_markdown_images():
    assert sanitize_markdown("Before ![x](https://example.test/x.png) after") == (
        "Before [IMAGE_PLACEHOLDER] after"
    )


def test_decodes_safe_layout_artifacts_and_removes_internal_picture_markers():
    value = (
        "a&amp;#45;b&lt;br&gt;c\n"
        "<!-- Start of picture text -->\n"
        "visible\n"
        "<!-- End of picture text -->"
    )
    result = sanitize_markdown(value)
    assert "a-b<br>c" in result
    assert "visible" in result
    assert "picture text" not in result


def test_does_not_rewrite_fenced_code():
    value = "```text\ninter-\nnational\n![x](image.png)\n```"
    assert sanitize_markdown(value) == value
