from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import ExtractionConfig
from .pipeline import extract_pdf
from .reporting import ProgressReporter


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
    parser.add_argument(
        "--layout-mode",
        choices=("auto", "layout", "legacy"),
        default="auto",
        help="Layout strategy: auto repairs pathological page-wide tables; layout/legacy force one path",
    )
    parser.add_argument(
        "--layout-batch-pages",
        type=int,
        default=20,
        help="Pages per layout/OCR batch; smaller values give finer progress updates",
    )
    parser.add_argument(
        "--show-engine-warnings",
        action="store_true",
        help="Do not capture raw PyMuPDF/Tesseract parser diagnostics",
    )
    parser.add_argument("--strict", action="store_true", help="Fail instead of falling back on page-level errors")
    parser.add_argument("--stdout", action="store_true", help="Write Markdown to stdout instead of a file")

    logging_group = parser.add_argument_group("progress logging")
    logging_group.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Show every progress batch/page; use -vv to include detection details",
    )
    logging_group.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Suppress console progress logs except errors/warnings",
    )
    logging_group.add_argument(
        "--log-file",
        type=Path,
        help="Append all progress events to a log file",
    )
    logging_group.add_argument(
        "--log-format",
        choices=("text", "json"),
        default="text",
        help="Progress log format for stderr and --log-file",
    )
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
        layout_mode=args.layout_mode,
        layout_batch_pages=args.layout_batch_pages,
        capture_engine_stderr=not args.show_engine_warnings,
        max_pages=args.max_pages,
        strict=args.strict,
    )

    with ProgressReporter(
        verbose=args.verbose,
        quiet=args.quiet,
        log_file=args.log_file,
        log_format=args.log_format,
    ) as reporter:
        try:
            result = extract_pdf(
                args.input,
                config=config,
                password=args.password,
                progress=reporter,
            )
        except Exception:
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
