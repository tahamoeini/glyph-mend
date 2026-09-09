import pytest

from pdf_sanitizer.gui import _format_event, _parse_positive_int
from pdf_sanitizer.progress import ProgressEvent


def test_gui_formats_progress_event_without_tk_root():
    event = ProgressEvent(
        stage="page",
        message="Processed page 10/20",
        current=10,
        total=20,
        elapsed_seconds=1.25,
        details={"tables": 1},
    )
    text = _format_event(event)
    assert "[page]" in text
    assert "50%" in text
    assert "tables=1" in text


def test_gui_positive_integer_validation():
    assert _parse_positive_int("20", "Checkpoint pages") == 20
    with pytest.raises(ValueError):
        _parse_positive_int("0", "Checkpoint pages")
    with pytest.raises(ValueError):
        _parse_positive_int("abc", "Checkpoint pages")
