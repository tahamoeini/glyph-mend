from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True, slots=True)
class ProgressEvent:
    """One observable milestone emitted by the PDF extraction pipeline."""

    stage: str
    message: str
    current: int | None = None
    total: int | None = None
    page: int | None = None
    elapsed_seconds: float | None = None
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def percent(self) -> float | None:
        if self.current is None or self.total is None or self.total <= 0:
            return None
        return max(0.0, min(100.0, self.current * 100.0 / self.total))


ProgressCallback = Callable[[ProgressEvent], None]


def emit_progress(
    callback: ProgressCallback | None,
    stage: str,
    message: str,
    *,
    current: int | None = None,
    total: int | None = None,
    page: int | None = None,
    elapsed_seconds: float | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Emit a progress event when a callback was supplied by the caller."""

    if callback is None:
        return
    callback(
        ProgressEvent(
            stage=stage,
            message=message,
            current=current,
            total=total,
            page=page,
            elapsed_seconds=elapsed_seconds,
            details=details or {},
        )
    )
