from __future__ import annotations

import json

from glyphmend import get_brand
from pdf_sanitizer.branding import load_brand


def test_canonical_brand_defaults() -> None:
    brand = get_brand()
    assert brand.name == "GlyphMend"
    assert brand.cli_name == "glyphmend"
    assert brand.slogan == "Faithful document reconstruction from PDF to structured Markdown."


def test_explicit_brand_file_and_environment_override(tmp_path) -> None:
    path = tmp_path / "brand.json"
    path.write_text(
        json.dumps(
            {
                "name": "Configured Docs",
                "shortName": "Configured",
                "slogan": "Configured slogan",
                "logoPath": "./configured.svg",
            }
        ),
        encoding="utf-8",
    )
    brand = load_brand(
        path,
        environ={
            "GLYPHMEND_NAME": "Environment Docs",
            "GLYPHMEND_CLI_NAME": "configured-cli",
        },
    )
    assert brand.name == "Environment Docs"
    assert brand.short_name == "Configured"
    assert brand.slogan == "Configured slogan"
    assert brand.cli_name == "configured-cli"
    assert brand.logo_path == "./configured.svg"
