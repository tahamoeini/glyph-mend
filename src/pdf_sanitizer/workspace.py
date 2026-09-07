from __future__ import annotations

import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import ExtractionConfig
from .document_cleanup import cleanup_combined_markdown


SCHEMA_VERSION = 1
ALGORITHM_VERSION = 3
_OUTPUT_CONFIG_FIELDS = (
    "use_ocr",
    "force_ocr",
    "ocr_language",
    "ocr_dpi",
    "keep_headers",
    "keep_footers",
    "include_page_markers",
    "extract_tables",
    "extract_equations",
    "normalize_task_lists",
    "detect_vector_flows",
    "include_visual_placeholders",
    "layout_mode",
    "min_image_area_ratio",
    "min_graphic_area_ratio",
    "full_page_scan_ratio",
)


class WorkspaceError(RuntimeError):
    """Raised when a checkpoint workspace is unsafe, incompatible, or incomplete."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        with temp.open("wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink(missing_ok=True)


def _atomic_write_text(path: Path, text: str) -> None:
    _atomic_write_bytes(path, text.encode("utf-8"))


def _json_fingerprint(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _sha256_bytes(payload.encode("utf-8"))


def _config_payload(config: ExtractionConfig) -> dict[str, Any]:
    # Only settings that can change produced Markdown invalidate checkpoints. Logging,
    # batching, fail-fast behavior, and safety limits can change between resume attempts.
    return {name: getattr(config, name) for name in _OUTPUT_CONFIG_FIELDS}


def source_fingerprint(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "sha256": file_sha256(path),
    }


def default_workspace_path(output: Path) -> Path:
    return output.with_suffix(".parts")


def _safe_to_clear(root: Path) -> bool:
    if not root.exists():
        return True
    if not root.is_dir():
        return False
    entries = list(root.iterdir())
    if not entries:
        return True
    return (root / "manifest.json").is_file()


class ExtractionWorkspace:
    """Persistent Markdown-part workspace used for restart-safe PDF extraction."""

    def __init__(self, root: Path, manifest: dict[str, Any]):
        self.root = root
        self.manifest_path = root / "manifest.json"
        self.manifest = manifest

    @classmethod
    def prepare(
        cls,
        root: str | os.PathLike[str],
        *,
        source: Path,
        page_count: int,
        checkpoint_pages: int,
        config: ExtractionConfig,
        output: Path,
        restart: bool = False,
    ) -> "ExtractionWorkspace":
        root_path = Path(root).expanduser().resolve()
        source = source.resolve()
        output = output.expanduser().resolve()

        if checkpoint_pages <= 0:
            raise ValueError("checkpoint_pages must be positive")
        if root_path == source.parent or root_path == Path.cwd().resolve():
            raise WorkspaceError("Refusing to use the source/current directory itself as a workspace")

        if restart and root_path.exists():
            if not _safe_to_clear(root_path):
                raise WorkspaceError(
                    "Refusing to clear a non-workspace directory. Choose an empty workspace or one "
                    "containing a pdf-sanitizer manifest."
                )
            shutil.rmtree(root_path)

        root_path.mkdir(parents=True, exist_ok=True)
        manifest_path = root_path / "manifest.json"
        source_info = source_fingerprint(source)
        config_payload = _config_payload(config)
        config_sha = _json_fingerprint(config_payload)

        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception as exc:
                raise WorkspaceError(f"Cannot read workspace manifest: {manifest_path}") from exc
            cls._validate_existing(
                manifest,
                source_info=source_info,
                page_count=page_count,
                checkpoint_pages=checkpoint_pages,
                config_sha=config_sha,
            )
            manifest["source"]["path"] = str(source)
            manifest["source"]["mtime_ns"] = source_info["mtime_ns"]
            manifest["output_path"] = str(output)
            manifest["updated_at"] = _now()
            workspace = cls(root_path, manifest)
            workspace.save_manifest()
            return workspace

        if any(root_path.iterdir()):
            raise WorkspaceError(
                f"Workspace is not empty and has no manifest: {root_path}. "
                "Use a different path or explicitly --restart a known pdf-sanitizer workspace."
            )

        manifest = {
            "schema_version": SCHEMA_VERSION,
            "algorithm_version": ALGORITHM_VERSION,
            "status": "in_progress",
            "created_at": _now(),
            "updated_at": _now(),
            "source": source_info,
            "page_count": page_count,
            "checkpoint_pages": checkpoint_pages,
            "config": config_payload,
            "config_sha256": config_sha,
            "output_path": str(output),
            "parts": [],
            "combined": None,
        }
        workspace = cls(root_path, manifest)
        workspace.save_manifest()
        return workspace

    @staticmethod
    def _validate_existing(
        manifest: dict[str, Any],
        *,
        source_info: dict[str, Any],
        page_count: int,
        checkpoint_pages: int,
        config_sha: str,
    ) -> None:
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise WorkspaceError("Workspace manifest schema is incompatible; use --restart")
        if manifest.get("algorithm_version") != ALGORITHM_VERSION:
            raise WorkspaceError("Extraction algorithm changed since this workspace was created; use --restart")
        old_source = manifest.get("source") or {}
        if old_source.get("sha256") != source_info["sha256"] or old_source.get("size") != source_info["size"]:
            raise WorkspaceError("Workspace belongs to a different or changed PDF; use --restart")
        if int(manifest.get("page_count") or 0) != page_count:
            raise WorkspaceError("Workspace page count does not match the PDF; use --restart")
        if int(manifest.get("checkpoint_pages") or 0) != checkpoint_pages:
            raise WorkspaceError("checkpoint_pages changed since this workspace was created; use --restart")
        if manifest.get("config_sha256") != config_sha:
            raise WorkspaceError("Extraction options changed since this workspace was created; use --restart")

    @classmethod
    def open_existing(cls, root: str | os.PathLike[str]) -> "ExtractionWorkspace":
        root_path = Path(root).expanduser().resolve()
        manifest_path = root_path / "manifest.json"
        if not manifest_path.is_file():
            raise WorkspaceError(f"No workspace manifest found: {manifest_path}")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise WorkspaceError(f"Cannot read workspace manifest: {manifest_path}") from exc
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise WorkspaceError("Unsupported workspace manifest schema")
        if manifest.get("algorithm_version") != ALGORITHM_VERSION:
            raise WorkspaceError("Workspace was produced by an incompatible extraction algorithm")
        return cls(root_path, manifest)

    @property
    def page_count(self) -> int:
        return int(self.manifest["page_count"])

    @property
    def checkpoint_pages(self) -> int:
        return int(self.manifest["checkpoint_pages"])

    @property
    def expected_part_count(self) -> int:
        return (self.page_count + self.checkpoint_pages - 1) // self.checkpoint_pages

    def expected_range(self, part_index: int) -> tuple[int, int]:
        if part_index < 1 or part_index > self.expected_part_count:
            raise IndexError(part_index)
        start = (part_index - 1) * self.checkpoint_pages + 1
        end = min(self.page_count, start + self.checkpoint_pages - 1)
        return start, end

    def part_filename(self, part_index: int, start_page: int, end_page: int) -> str:
        width = max(4, len(str(self.page_count)))
        return (
            f"part-{part_index:04d}-pages-"
            f"{start_page:0{width}d}-{end_page:0{width}d}.md"
        )

    def _part_entry(self, part_index: int) -> dict[str, Any] | None:
        for item in self.manifest.get("parts", []):
            if int(item.get("index") or 0) == part_index:
                return item
        return None

    def completed_part(self, part_index: int) -> Path | None:
        start_page, end_page = self.expected_range(part_index)
        entry = self._part_entry(part_index)
        if not entry or entry.get("status") != "complete":
            return None
        if int(entry.get("start_page") or 0) != start_page or int(entry.get("end_page") or 0) != end_page:
            return None
        filename = str(entry.get("filename") or "")
        if not filename:
            return None
        path = self.root / filename
        if not path.is_file():
            return None
        expected_sha = str(entry.get("sha256") or "")
        if not expected_sha or file_sha256(path) != expected_sha:
            return None
        return path

    def write_part(self, part_index: int, markdown: str) -> Path:
        start_page, end_page = self.expected_range(part_index)
        filename = self.part_filename(part_index, start_page, end_page)
        path = self.root / filename
        text = markdown.strip()
        if text:
            text += "\n"
        _atomic_write_text(path, text)
        sha = file_sha256(path)
        entry = {
            "index": part_index,
            "start_page": start_page,
            "end_page": end_page,
            "filename": filename,
            "status": "complete",
            "sha256": sha,
            "chars": len(text),
            "updated_at": _now(),
        }
        parts = [
            item
            for item in self.manifest.get("parts", [])
            if int(item.get("index") or 0) != part_index
        ]
        parts.append(entry)
        parts.sort(key=lambda item: int(item["index"]))
        self.manifest["parts"] = parts
        self.manifest["status"] = "in_progress"
        self.manifest["combined"] = None
        self.manifest["updated_at"] = _now()
        self.save_manifest()
        return path

    def save_manifest(self) -> None:
        self.manifest["updated_at"] = _now()
        payload = json.dumps(self.manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        _atomic_write_text(self.manifest_path, payload)

    def combine(self, output: str | os.PathLike[str] | None = None) -> Path:
        if output is None:
            configured = self.manifest.get("output_path")
            if not configured:
                raise WorkspaceError("No output path is stored in the workspace; provide -o")
            output_path = Path(str(configured)).expanduser().resolve()
        else:
            output_path = Path(output).expanduser().resolve()

        pieces: list[str] = []
        for part_index in range(1, self.expected_part_count + 1):
            part_path = self.completed_part(part_index)
            if part_path is None:
                start_page, end_page = self.expected_range(part_index)
                raise WorkspaceError(
                    f"Workspace is incomplete or a part is corrupt: pages {start_page}-{end_page}"
                )
            value = part_path.read_text(encoding="utf-8").strip()
            if value:
                pieces.append(value)

        combined = cleanup_combined_markdown("\n\n".join(pieces).strip())
        if combined:
            combined += "\n"
        _atomic_write_text(output_path, combined)
        self.manifest["status"] = "complete"
        self.manifest["output_path"] = str(output_path)
        self.manifest["combined"] = {
            "path": str(output_path),
            "sha256": file_sha256(output_path),
            "chars": len(combined),
            "updated_at": _now(),
        }
        self.save_manifest()
        return output_path
