from pdf_sanitizer.sanitize import sanitize_markdown


def test_normalizes_unicode_noise_and_ligatures():
    value = "A\u200bB ﬁle\u00ad name"
    assert sanitize_markdown(value) == "AB file name"


def test_repairs_latin_wrap_hyphenation_only():
    assert sanitize_markdown("inter-\nnational") == "international"


def test_replaces_markdown_images():
    assert sanitize_markdown("Before ![x](https://example.test/x.png) after") == (
        "Before [IMAGE_PLACEHOLDER] after"
    )
