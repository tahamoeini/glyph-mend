from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import ExtractionConfig
from .docx_export import markdown_to_docx
from .pipeline import extract_pdf
from .reporting import ProgressReporter
from .workflow import combine_workspace, extract_pdf_resumable
from .workspace import default_workspace_path


_COMMANDS = {"extract", "combine", "md-to-docx", "gui"}


def _add_extraction_options(parser: argparse.ArgumentParser) -> None:
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
        help="Pages per low-level layout/OCR call",
    )
    parser.add_argument(
        "--show-engine-warnings",
        action="store_true",
        help="Do not capture raw PyMuPDF/Tesseract parser diagnostics",
    )
    parser.add_argument("--strict", action="store_true", help="Fail instead of falling back on page-level errors")
    parser.add_argument("--stdout", action="store_true", help="Write Markdown to stdout; disables checkpoint output")

    checkpoint_group = parser.add_argument_group("checkpointing and resume")
    checkpoint_group.add_argument(
        "--workspace",
        type=Path,
        help="Checkpoint directory; defaults to <output-stem>.parts",
    )
    checkpoint_group.add_argument(
        "--checkpoint-pages",
        type=int,
        default=20,
        help="Pages per persisted Markdown part; completed parts are reused on the next run",
    )
    checkpoint_group.add_argument(
        "--restart",
        action="store_true",
        help="Discard a compatible existing pdf-sanitizer workspace and start again",
    )
    checkpoint_group.add_argument(
        "--no-checkpoints",
        action="store_true",
        help="Use the older in-memory one-shot pipeline instead of persisted Markdown parts",
    )

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
    logging_group.add_argument("--log-file", type=Path, help="Append all progress events to a log file")
    logging_group.add_argument(
        "--log-format",
        choices=("text", "json"),
        default="text",
        help="Progress log format for stderr and --log-file",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf-sanitizer",
        description="Extract PDFs into restart-safe semantic Markdown, use a desktop GUI, and convert Markdown to DOCX.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser(
        "extract",
        help="Extract a PDF to checkpointed Markdown (default command for backward compatibility)",
    )
    _add_extraction_options(extract_parser)

    combine_parser = subparsers.add_parser(
        "combine",
        help="Combine an already-complete checkpoint workspace without re-extracting the PDF",
    )
    combine_parser.add_argument("workspace", type=Path, help="Workspace containing manifest.json and part files")
    combine_parser.add_argument("-o", "--output", type=Path, help="Output Markdown path; defaults to manifest value")

    docx_parser = subparsers.add_parser("md-to-docx", help="Convert a Markdown file to DOCX")
    docx_parser.add_argument("input", type=Path, help="Input Markdown file")
    docx_parser.add_argument("-o", "--output", type=Path, help="Output DOCX path; defaults to <input>.docx")
    docx_parser.add_argument("--title", help="Optional Word document title")
    docx_parser.add_argument(
        "--source-pdf",
        type=Path,
        help="Optional original PDF; embed page/bbox visual placeholders as source crops",
    )
    docx_parser.add_argument(
        "--preserve-page-breaks",
        action="store_true",
        help="Turn source <!-- page: N --> markers into hard Word page breaks",
    )
    # Kept for scripts written against 0.2/0.3. Page breaks are now off by default,
    # so this compatibility flag is intentionally hidden and effectively a no-op.
    docx_parser.add_argument("--no-page-breaks", action="store_true", help=argparse.SUPPRESS)

    subparsers.add_parser("gui", help="Launch the native desktop interface")
    return parser


def _normalize_argv(argv: list[str] | None) -> list[str]:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in _COMMANDS or args[0] in {"-h", "--help"}:
        return args
    # Preserve the original `pdf-sanitizer input.pdf ...` interface.
    return ["extract", *args]


def _config_from_args(args: argparse.Namespace) -> ExtractionConfig:
    return ExtractionConfig(
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


def _write_markdown(path: Path, markdown: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(markdown + ("\n" if markdown and not markdown.endswith("\n") else ""), encoding="utf-8")


def _run_extract(args: argparse.Namespace) -> int:
    config = _config_from_args(args)
    output = (args.output or args.input.with_suffix(".md")).expanduser().resolve()

    with ProgressReporter(
        verbose=args.verbose,
        quiet=args.quiet,
        log_file=args.log_file,
        log_format=args.log_format,
    ) as reporter:
        try:
            if args.stdout or args.no_checkpoints:
                result = extract_pdf(
                    args.input,
                    config=config,
                    password=args.password,
                    progress=reporter,
                )
            else:
                workspace = (
                    args.workspace.expanduser().resolve()
                    if args.workspace is not None
                    else default_workspace_path(output).resolve()
                )
                result = extract_pdf_resumable(
                    args.input,
                    output,
                    workspace_path=workspace,
                    checkpoint_pages=args.checkpoint_pages,
                    config=config,
                    password=args.password,
                    restart=args.restart,
                    progress=reporter,
                )
        except Exception:
            return 1

    if args.stdout:
        sys.stdout.write(result.markdown)
        if result.markdown and not result.markdown.endswith("\n"):
            sys.stdout.write("\n")
        return 0

    if args.no_checkpoints:
        _write_markdown(output, result.markdown)
    print(output)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(_normalize_argv(argv))

    if args.command == "extract":
        return _run_extract(args)
    if args.command == "combine":
        try:
            output = combine_workspace(args.workspace, args.output)
        except Exception as exc:
            print(f"pdf-sanitizer: {exc}", file=sys.stderr)
            return 1
        print(output)
        return 0
    if args.command == "md-to-docx":
        try:
            output = markdown_to_docx(
                args.input,
                args.output,
                title=args.title,
                page_breaks=args.preserve_page_breaks and not args.no_page_breaks,
                source_pdf=args.source_pdf,
            )
        except Exception as exc:
            print(f"pdf-sanitizer: {exc}", file=sys.stderr)
            return 1
        print(output)
        return 0
    if args.command == "gui":
        from .gui import main as gui_main

        return gui_main()
    return 2


def docx_main() -> int:
    """Standalone `md-to-docx` console-script entry point."""

    return main(["md-to-docx", *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
