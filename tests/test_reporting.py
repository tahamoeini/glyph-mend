import io
import json

from pdf_sanitizer.progress import ProgressEvent
from pdf_sanitizer.reporting import ProgressReporter


def test_default_console_coarsens_page_progress():
    stream = io.StringIO()
    reporter = ProgressReporter(stderr=stream)
    reporter(ProgressEvent("page", "Processed page 1/100", current=1, total=100, page=1))
    reporter(ProgressEvent("page", "Processed page 2/100", current=2, total=100, page=2))
    reporter(ProgressEvent("page", "Processed page 10/100", current=10, total=100, page=10))
    reporter.close()

    output = stream.getvalue()
    assert "Processed page 1/100" in output
    assert "Processed page 2/100" not in output
    assert "Processed page 10/100" in output


def test_json_logging_is_machine_readable():
    stream = io.StringIO()
    reporter = ProgressReporter(stderr=stream, log_format="json", verbose=1)
    reporter(
        ProgressEvent(
            "page",
            "Processed page 2/4",
            current=2,
            total=4,
            page=2,
            elapsed_seconds=0.25,
            details={"tables": 1},
        )
    )
    reporter.close()

    payload = json.loads(stream.getvalue())
    assert payload["stage"] == "page"
    assert payload["percent"] == 50.0
    assert payload["details"]["tables"] == 1


def test_quiet_mode_still_reports_errors():
    stream = io.StringIO()
    reporter = ProgressReporter(stderr=stream, quiet=True)
    reporter(ProgressEvent("layout-start", "Working"))
    reporter(ProgressEvent("error", "Extraction failed", details={"error": "bad pdf"}))
    reporter.close()

    output = stream.getvalue()
    assert "Working" not in output
    assert "Extraction failed" in output
