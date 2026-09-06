from pdf_sanitizer.config import ExtractionConfig
from pdf_sanitizer.pipeline import _extract_layout_chunks
from pdf_sanitizer.progress import ProgressEvent


class FakePage:
    def get_text(self, *_args, **_kwargs):
        return (
            "This ordinary prose line is long enough to represent a normal textbook paragraph.\n"
            "Another sentence continues naturally across the page instead of across table cells.\n"
            "The extractor should preserve prose structure whenever the page contains paragraphs.\n"
        )


class FakeDocument:
    page_count = 1

    def __getitem__(self, index: int):
        assert index == 0
        return FakePage()


class FakeLLM:
    def __init__(self):
        self.layout_enabled = True
        self.calls: list[bool] = []

    def use_layout(self, enabled: bool = True):
        self.layout_enabled = enabled

    def to_markdown(self, _document, *, pages, **_kwargs):
        self.calls.append(self.layout_enabled)
        if self.layout_enabled:
            text = "\n".join(
                [
                    "|This ordina|ry prose has been|split acro|ss cells|",
                    "|---|---|---|---|",
                    "|Another sent|ence is bro|ken into|columns.|",
                    "|The extrac|tor should not|pretend th|is is data.|",
                    "|More prose|continues|across the|page.|",
                    "|Final para|graph frag|ment here|too.|",
                ]
            )
        else:
            text = "This ordinary prose was recovered without the Layout model."
        return [
            {
                "metadata": {"page_number": page + 1},
                "text": text,
                "page_boxes": [],
            }
            for page in pages
        ]


def test_auto_mode_repairs_pathological_layout_page():
    llm = FakeLLM()
    events: list[ProgressEvent] = []
    chunks, noise, unknown, repaired = _extract_layout_chunks(
        FakeDocument(),
        llm,
        ExtractionConfig(
            use_ocr=False,
            capture_engine_stderr=False,
            layout_mode="auto",
            layout_batch_pages=20,
        ),
        progress=events.append,
        pipeline_started=0.0,
    )

    assert "recovered without the Layout model" in chunks[0]["text"]
    assert llm.calls == [True, False]
    assert repaired == 1
    assert noise == 0
    assert unknown == 0
    assert any(event.stage == "layout-repair" for event in events)
