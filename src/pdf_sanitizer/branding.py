from __future__ import annotations

import json
import os
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True, slots=True)
class BrandConfig:
    """Runtime product identity, deliberately separate from extraction settings."""

    name: str = "GlyphMend"
    short_name: str = "GlyphMend"
    slug: str = "glyph-mend"
    cli_name: str = "glyphmend"
    slogan: str = "Faithful document reconstruction from PDF to structured Markdown."
    description: str = (
        "Local-first, structure-aware PDF reconstruction with OCR, resumable extraction, "
        "quality checks, and Markdown-first export."
    )
    logo_path: str = "./brand/glyphmend-mark.svg"
    logo_alt: str = "GlyphMend logo"


_JSON_KEYS = {
    "name": "name",
    "shortName": "short_name",
    "slug": "slug",
    "cliName": "cli_name",
    "slogan": "slogan",
    "description": "description",
    "logoPath": "logo_path",
    "logoAlt": "logo_alt",
}
_ENV_KEYS = {
    "GLYPHMEND_NAME": "name",
    "GLYPHMEND_SHORT_NAME": "short_name",
    "GLYPHMEND_SLUG": "slug",
    "GLYPHMEND_CLI_NAME": "cli_name",
    "GLYPHMEND_SLOGAN": "slogan",
    "GLYPHMEND_DESCRIPTION": "description",
    "GLYPHMEND_LOGO_PATH": "logo_path",
    "GLYPHMEND_LOGO_ALT": "logo_alt",
}


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _source_branding_path() -> Path | None:
    """Find the repository-level branding.json when running from a source checkout."""

    for parent in Path(__file__).resolve().parents:
        candidate = parent / "branding.json"
        if candidate.is_file():
            return candidate
    return None


def _read_branding_file(path: Path) -> dict[str, str]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read GlyphMend branding config: {path}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"GlyphMend branding config must contain a JSON object: {path}")

    values: dict[str, str] = {}
    for json_key, field_name in _JSON_KEYS.items():
        value = _clean(raw.get(json_key))
        if value is not None:
            values[field_name] = value
    return values


def load_brand(
    path: str | os.PathLike[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
) -> BrandConfig:
    """Load brand configuration from JSON plus optional environment overrides.

    Precedence is: built-in defaults < source/explicit JSON < environment variables.
    `GLYPHMEND_BRAND_CONFIG` selects an explicit JSON file when ``path`` is omitted.
    """

    env = os.environ if environ is None else environ
    values = {field.name: getattr(BrandConfig(), field.name) for field in fields(BrandConfig)}

    configured_path: Path | None
    if path is not None:
        configured_path = Path(path).expanduser()
    else:
        env_path = _clean(env.get("GLYPHMEND_BRAND_CONFIG"))
        configured_path = Path(env_path).expanduser() if env_path else _source_branding_path()

    if configured_path is not None:
        values.update(_read_branding_file(configured_path))

    for env_key, field_name in _ENV_KEYS.items():
        value = _clean(env.get(env_key))
        if value is not None:
            values[field_name] = value

    return BrandConfig(**values)


def get_brand() -> BrandConfig:
    """Return the current brand, re-reading configuration so overrides can change per run."""

    return load_brand()


DEFAULT_BRAND = BrandConfig()

__all__ = ["BrandConfig", "DEFAULT_BRAND", "get_brand", "load_brand"]
