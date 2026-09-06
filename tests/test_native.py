from pdf_sanitizer.native import native_markdown_chunk


class FakePage:
    def get_text(self, mode="text", **_kwargs):
        if mode == "dict":
            return {
                "blocks": [
                    {
                        "type": 0,
                        "bbox": (50, 50, 550, 90),
                        "lines": [
                            {
                                "spans": [
                                    {"text": "Chapter Title", "size": 20},
                                ]
                            }
                        ],
                    },
                    {
                        "type": 0,
                        "bbox": (50, 110, 550, 190),
                        "lines": [
                            {
                                "spans": [
                                    {"text": "This is an ordinary wrapped", "size": 10},
                                ]
                            },
                            {
                                "spans": [
                                    {"text": "paragraph that should remain prose.", "size": 10},
                                ]
                            },
                        ],
                    },
                ]
            }
        return "Chapter Title\nThis is an ordinary wrapped paragraph that should remain prose."


def test_native_fallback_keeps_prose_out_of_tables_and_recovers_heading():
    chunk = native_markdown_chunk(FakePage(), 7)

    assert chunk["metadata"]["source"] == "native-text"
    assert chunk["text"].startswith("# Chapter Title")
    assert "ordinary wrapped paragraph" in chunk["text"]
    assert "|" not in chunk["text"]
    assert len(chunk["page_boxes"]) == 2
