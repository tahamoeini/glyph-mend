from pathlib import Path

import pymupdf

from pdf_sanitizer import (
    ExtractionConfig,
    ProgressEvent,
    extract_pdf,
    extract_pdf_resumable,
)


def _sample_pdf(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((72, 72), "Sample Document", fontsize=20)
    page.insert_text((72, 110), "This paragraph should survive extraction.", fontsize=11)
    page.insert_text((220, 135), "x = y + 2", fontsize=12)

    # 2x2 table.
    x0, y0, x1, y1 = 72, 160, 420, 260
    page.draw_rect((x0, y0, x1, y1))
    page.draw_line((246, y0), (246, y1))
    page.draw_line((x0, 210), (x1, 210))
    page.insert_text((90, 190), "Name", fontsize=10)
    page.insert_text((270, 190), "Value", fontsize=10)
    page.insert_text((90, 240), "Alpha", fontsize=10)
    page.insert_text((270, 240), "1", fontsize=10)

    # Simple vector flow, separate from the table.
    page.draw_rect((90, 330, 220, 380))
    page.draw_rect((330, 330, 460, 380))
    page.insert_text((120, 360), "Start", fontsize=11)
    page.insert_text((365, 360), "Finish", fontsize=11)
    page.draw_line((220, 355), (330, 355))

    doc.save(path)
    doc.close()


def test_extracts_semantic_markdown_and_emits_progress(tmp_path: Path):
    pdf = tmp_path / "sample.pdf"
    _sample_pdf(pdf)
    events: list[ProgressEvent] = []

    result = extract_pdf(
        pdf,
        config=ExtractionConfig(
            use_ocr=False,
            keep_headers=True,
            keep_footers=True,
            layout_batch_pages=1,
        ),
        progress=events.append,
    )

    assert "This paragraph should survive extraction." in result.markdown
    assert "|" in result.markdown
    assert "$$\nx = y + 2\n$$" in result.markdown
    assert "```mermaid" in result.markdown
    assert "Start" in result.markdown
    assert "Finish" in result.markdown

    stages = [event.stage for event in events]
    assert stages[0] == "validate"
    assert "layout-start" in stages
    assert "layout" in stages
    assert "layout-complete" in stages
    assert "page" in stages
    assert stages[-1] == "complete"

    layout_event = next(event for event in events if event.stage == "layout")
    assert layout_event.current == 1
    assert layout_event.total == 1
    assert layout_event.percent == 100.0

    page_event = next(event for event in events if event.stage == "page")
    assert page_event.current == 1
    assert page_event.total == 1
    assert page_event.percent == 100.0
    assert page_event.details["tables"] >= 1
    assert page_event.details["equations"] >= 1
    assert page_event.details["flows"] >= 1


def test_resumable_extraction_reuses_completed_part(tmp_path: Path, monkeypatch):
    pdf = tmp_path / "sample.pdf"
    output = tmp_path / "sample.md"
    workspace = tmp_path / "sample.parts"
    _sample_pdf(pdf)
    config = ExtractionConfig(
        use_ocr=False,
        keep_headers=True,
        keep_footers=True,
        layout_batch_pages=1,
    )

    first_events: list[ProgressEvent] = []
    first = extract_pdf_resumable(
        pdf,
        output,
        workspace_path=workspace,
        checkpoint_pages=1,
        config=config,
        progress=first_events.append,
    )
    assert output.is_file()
    assert (workspace / "manifest.json").is_file()
    assert any(path.name.startswith("part-0001-") for path in workspace.glob("*.md"))
    assert "This paragraph should survive extraction." in first.markdown

    def should_not_extract(*_args, **_kwargs):
        raise AssertionError("completed checkpoint should have been reused")

    monkeypatch.setattr("pdf_sanitizer.workflow._extract_checkpoint_chunks", should_not_extract)
    second_events: list[ProgressEvent] = []
    second = extract_pdf_resumable(
        pdf,
        output,
        workspace_path=workspace,
        checkpoint_pages=1,
        config=config,
        progress=second_events.append,
    )

    assert second.markdown == first.markdown
    assert second.metadata["resumed_parts"] == 1
    assert any(event.stage == "checkpoint-resume" for event in second_events)
