from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import ExtractionConfig
from .extractor import extract_pdf


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf-sanitizer",
        description="Extract a PDF into sanitized, structure-aware Markdown.",
    )
    parser.add_argument("input", type=Path, help="Input PDF file")
    parser.add_argument("-o", "--output", type=Path, help="Output Markdown path; defaults to <input>.md")
    parser.add_argument("--password", help="Password for encrypted PDFs")
    parser.add_argument("--ocr-language", default="eng", help="Tesseract language code, e.g. eng or eng+fas")
    parser.add_argument("--no-ocr", action="store_true", help="Disable OCR fallback for scanned pages")
    parser.add_argument("--force-ocr", action="store_true", help="Force OCR even when native text exists")
    parser.add_argument("--keep-headers", action="store_true", help="Keep detected page headers")
    parser.add_argument("--keep-footers", action="store_true", help="Keep detected page footers")
    parser.add_argument("--no-page-markers", action="store_true", help="Omit HTML page comments")
    parser.add_argument("--no-tables", action="store_true", help="Disable table correction/extraction")
    parser.add_argument("--no-equations", action="store_true", help="Disable LaTeX display-equation reconstruction")
    parser.add_argument("--no-task-lists", action="store_true", help="Do not normalize PDF checkbox lists")
    parser.add_argument("--no-flows", action="store_true", help="Disable Mermaid vector-flow reconstruction")
    parser.add_argument("--no-placeholders", action="store_true", help="Omit image/graphic placeholders")
    parser.add_argument("--max-pages", type=int, default=2000, help="Reject PDFs above this page count")
    parser.add_argument("--strict", action="store_true", help="Fail instead of falling back on page-level errors")
    parser.add_argument("--stdout", action="store_true", help="Write Markdown to stdout instead of a file")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = ExtractionConfig(
        use_ocr=not args.no_ocr,
        force_ocr=args.force_ocr,
        ocr_language=args.ocr_language,
        keep_headers=args.keep_headers,
        keep_footers=args.keep_footers,
        include_page_markers=not args.no_page_markers,
        extract_tables=not args.no_tables,
        extract_equations=not args.no_equations,
        normalize_task_lists=not args.no_task_lists,
        detect_vector_flows=not args.no_flows,
        include_visual_placeholders=not args.no_placeholders,
        max_pages=args.max_pages,
        strict=args.strict,
    )

    try:
        result = extract_pdf(args.input, config=config, password=args.password)
    except Exception as exc:
        print(f"pdf-sanitizer: {exc}", file=sys.stderr)
        return 1

    if args.stdout:
        sys.stdout.write(result.markdown)
        if result.markdown and not result.markdown.endswith("\n"):
            sys.stdout.write("\n")
        return 0

    output = args.output or args.input.with_suffix(".md")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(result.markdown + ("\n" if result.markdown else ""), encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
