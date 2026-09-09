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


def test_does_not_rewrite_fenced_code():
    value = "```text\ninter-\nnational\n![x](image.png)\n<br>\n```"
    assert sanitize_markdown(value) == value


def test_normalizes_escaped_layout_artifacts():
    value = "A&amp;#45;B &lt;br&gt; C &amp; D &#x27;quoted&#x27;"
    assert sanitize_markdown(value) == "A-B C & D 'quoted'"


def test_flattens_visual_br_tags_in_raw_markdown():
    value = "Revenue<br>Management<br>\n| A<br>B | C |"
    assert sanitize_markdown(value) == "Revenue Management\n| A B | C |"
