from pathlib import Path

import pytest

from pdf_sanitizer.config import ExtractionConfig
from pdf_sanitizer.workspace import ExtractionWorkspace, WorkspaceError


def test_workspace_persists_parts_and_combines(tmp_path: Path):
    source = tmp_path / "input.pdf"
    source.write_bytes(b"fake-pdf")
    output = tmp_path / "output.md"
    root = tmp_path / "output.parts"
    config = ExtractionConfig(use_ocr=False)

    workspace = ExtractionWorkspace.prepare(
        root,
        source=source,
        page_count=4,
        checkpoint_pages=2,
        config=config,
        output=output,
    )
    first = workspace.write_part(1, "<!-- page: 1 -->\n\nOne\n\n<!-- page: 2 -->\n\nTwo")
    second = workspace.write_part(2, "<!-- page: 3 -->\n\nThree\n\n<!-- page: 4 -->\n\nFour")

    assert first.is_file()
    assert second.is_file()
    assert workspace.completed_part(1) == first
    assert workspace.completed_part(2) == second

    combined = workspace.combine()
    text = combined.read_text(encoding="utf-8")
    assert text.index("One") < text.index("Three")
    assert workspace.manifest["status"] == "complete"


def test_corrupt_checkpoint_is_not_reused(tmp_path: Path):
    source = tmp_path / "input.pdf"
    source.write_bytes(b"fake-pdf")
    root = tmp_path / "work.parts"
    workspace = ExtractionWorkspace.prepare(
        root,
        source=source,
        page_count=2,
        checkpoint_pages=2,
        config=ExtractionConfig(use_ocr=False),
        output=tmp_path / "out.md",
    )
    part = workspace.write_part(1, "valid")
    part.write_text("corrupt", encoding="utf-8")
    assert workspace.completed_part(1) is None


def test_workspace_rejects_changed_config(tmp_path: Path):
    source = tmp_path / "input.pdf"
    source.write_bytes(b"fake-pdf")
    root = tmp_path / "work.parts"
    ExtractionWorkspace.prepare(
        root,
        source=source,
        page_count=2,
        checkpoint_pages=2,
        config=ExtractionConfig(use_ocr=False),
        output=tmp_path / "out.md",
    )

    with pytest.raises(WorkspaceError):
        ExtractionWorkspace.prepare(
            root,
            source=source,
            page_count=2,
            checkpoint_pages=2,
            config=ExtractionConfig(use_ocr=True),
            output=tmp_path / "out.md",
        )
