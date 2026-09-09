from pdf_sanitizer.quality import assess_layout_markdown


class FakePage:
    def __init__(self, text: str):
        self.text = text

    def get_text(self, *_args, **_kwargs):
        return self.text


def test_flags_page_wide_prose_table_corruption():
    markdown = "\n".join(
        [
            "|This ordina|ry prose has been|split acro|ss cells|",
            "|---|---|---|---|",
            "|Another sent|ence is bro|ken into|columns.|",
            "|The extrac|tor should not|pretend th|is is data.|",
            "|More prose|continues|across the|page.|",
            "|Final para|graph frag|ment here|too.|",
        ]
    )
    native = (
        "This ordinary prose line is long enough to represent a normal textbook paragraph.\n"
        "Another sentence continues naturally across the page instead of across table cells.\n"
        "The extractor should preserve prose structure whenever the page contains paragraphs.\n"
    )
    quality = assess_layout_markdown(markdown, FakePage(native))
    assert quality.suspicious is True
    assert quality.table_ratio > 0.9
    assert quality.split_word_boundaries >= 3


def test_keeps_compact_real_table():
    markdown = "\n".join(
        [
            "| Name | Value |",
            "| --- | --- |",
            "| Alpha | 1 |",
            "| Beta | 2 |",
        ]
    )
    quality = assess_layout_markdown(markdown, FakePage("Name Value\nAlpha 1\nBeta 2"))
    assert quality.suspicious is False
