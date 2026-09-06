from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import TextIO

from .progress import ProgressEvent


class ProgressReporter:
    """Render progress events to stderr and, optionally, a persistent log file."""

    def __init__(
        self,
        *,
        verbose: int = 0,
        quiet: bool = False,
        log_file: Path | None = None,
        log_format: str = "text",
        stderr: TextIO | None = None,
    ) -> None:
        if log_format not in {"text", "json"}:
            raise ValueError("log_format must be 'text' or 'json'")
        self.verbose = max(0, verbose)
        self.quiet = quiet
        self.log_format = log_format
        self.stderr = stderr or sys.stderr
        self._file: TextIO | None = None
        if log_file is not None:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            self._file = log_file.open("a", encoding="utf-8")

    def __enter__(self) -> ProgressReporter:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None

    def _level(self, event: ProgressEvent) -> str:
        if event.stage == "error":
            return "ERROR"
        if event.stage in {"page-fallback", "engine-warning"}:
            return "WARNING"
        return "INFO"

    def _is_progress_event(self, event: ProgressEvent) -> bool:
        return event.stage in {"page", "layout"}

    def _show_on_console(self, event: ProgressEvent) -> bool:
        if event.stage in {"error", "page-fallback", "engine-warning"}:
            return True
        if self.quiet:
            return False
        if not self._is_progress_event(event):
            return True
        if self.verbose >= 1:
            return True
        if event.current is None or event.total is None or event.total <= 0:
            return False
        step = max(1, event.total // 10)
        return event.current in {1, event.total} or event.current % step < max(1, 20)

    def _as_dict(self, event: ProgressEvent) -> dict[str, object]:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "level": self._level(event),
            "stage": event.stage,
            "message": event.message,
            "current": event.current,
            "total": event.total,
            "percent": round(event.percent, 2) if event.percent is not None else None,
            "page": event.page,
            "elapsed_seconds": (
                round(event.elapsed_seconds, 4) if event.elapsed_seconds is not None else None
            ),
            "details": event.details,
        }

    def _format(self, event: ProgressEvent, *, include_details: bool) -> str:
        payload = self._as_dict(event)
        if self.log_format == "json":
            return json.dumps(payload, ensure_ascii=False, sort_keys=True)

        parts = [
            str(payload["timestamp"]),
            str(payload["level"]),
            f"[{event.stage}]",
            event.message,
        ]
        if event.current is not None and event.total is not None:
            percent = f"{event.percent:.0f}%" if event.percent is not None else "?%"
            parts.append(f"({event.current}/{event.total}, {percent})")
        if event.elapsed_seconds is not None:
            parts.append(f"[{event.elapsed_seconds:.2f}s]")
        if include_details and event.details:
            detail_text = " ".join(
                f"{key}={value!r}" for key, value in sorted(event.details.items())
            )
            parts.append(detail_text)
        return " ".join(parts)

    def __call__(self, event: ProgressEvent) -> None:
        if self._show_on_console(event):
            print(
                self._format(event, include_details=self.verbose >= 2),
                file=self.stderr,
                flush=True,
            )
        if self._file is not None:
            print(self._format(event, include_details=True), file=self._file, flush=True)
