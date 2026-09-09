from pdf_sanitizer.cli import _normalize_argv, build_parser


def test_legacy_pdf_invocation_maps_to_extract():
    assert _normalize_argv(["input.pdf", "--no-ocr"]) == ["extract", "input.pdf", "--no-ocr"]


def test_explicit_subcommands_are_preserved():
    assert _normalize_argv(["combine", "input.parts"]) == ["combine", "input.parts"]
    assert _normalize_argv(["md-to-docx", "input.md"]) == ["md-to-docx", "input.md"]
    assert _normalize_argv(["gui"]) == ["gui"]


def test_extract_checkpoint_options_parse():
    args = build_parser().parse_args(
        [
            "extract",
            "input.pdf",
            "--workspace",
            "input.parts",
            "--checkpoint-pages",
            "25",
            "--restart",
        ]
    )
    assert args.command == "extract"
    assert args.checkpoint_pages == 25
    assert args.restart is True


def test_gui_subcommand_parses_without_extraction_arguments():
    args = build_parser().parse_args(["gui"])
    assert args.command == "gui"
