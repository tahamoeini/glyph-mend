from __future__ import annotations

import os
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator


_KNOWN_NOISE = (
    "Image too small to scale!!",
    "Line cannot be recognized!!",
)


@dataclass(slots=True)
class NativeStderrCapture:
    """Captured native-library stderr emitted below Python's logging layer."""

    text: str = ""

    @property
    def lines(self) -> list[str]:
        return [line.strip() for line in self.text.splitlines() if line.strip()]

    @property
    def known_noise(self) -> list[str]:
        return [line for line in self.lines if any(marker in line for marker in _KNOWN_NOISE)]

    @property
    def unknown(self) -> list[str]:
        return [line for line in self.lines if not any(marker in line for marker in _KNOWN_NOISE)]


@contextmanager
def capture_native_stderr(enabled: bool = True) -> Iterator[NativeStderrCapture | None]:
    """Capture C/C++ stderr (for example Tesseract/Leptonica diagnostics).

    ``contextlib.redirect_stderr`` only replaces Python's ``sys.stderr`` object and
    therefore misses native libraries that write directly to file descriptor 2. This
    context manager temporarily redirects the underlying descriptor instead.

    If the current stderr object does not expose a file descriptor, capture gracefully
    degrades to a no-op rather than breaking extraction.
    """

    if not enabled:
        yield None
        return

    try:
        stderr_fd = sys.stderr.fileno()
    except (AttributeError, OSError):
        yield None
        return

    capture = NativeStderrCapture()
    saved_fd: int | None = None
    try:
        try:
            sys.stderr.flush()
        except Exception:
            pass
        saved_fd = os.dup(stderr_fd)
        with tempfile.TemporaryFile(mode="w+b") as temp:
            os.dup2(temp.fileno(), stderr_fd)
            try:
                yield capture
            finally:
                try:
                    sys.stderr.flush()
                except Exception:
                    pass
                os.dup2(saved_fd, stderr_fd)
                os.close(saved_fd)
                saved_fd = None
                temp.seek(0)
                capture.text = temp.read().decode("utf-8", errors="replace")
    finally:
        if saved_fd is not None:
            try:
                os.dup2(saved_fd, stderr_fd)
            finally:
                os.close(saved_fd)
