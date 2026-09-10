# GlyphMend desktop GUI

GlyphMend includes a lightweight native Tkinter interface over the same extraction, checkpoint, combine, and DOCX code used by the CLI.

Launch the canonical interface with either:

```bash
glyphmend-gui
```

or:

```bash
glyphmend gui
```

The historical `pdf-sanitizer-gui` and `pdf-sanitizer gui` commands remain compatibility aliases.

On normal Windows and macOS Python installations, Tkinter is included. Minimal Linux installations may need the system Tk package, commonly `python3-tk`.

The GUI title, product heading, slogan, and product-level error labels resolve through the same GlyphMend branding configuration used by the CLI. See [branding.md](branding.md) for JSON and environment-variable overrides.

## Extract / Resume

The first tab exposes the restart-safe PDF pipeline:

- input PDF
- output Markdown
- checkpoint workspace
- OCR fallback / force OCR
- OCR language and DPI
- automatic, forced Layout, or legacy/text-first mode
- low-level engine batch size
- persisted checkpoint size
- tables
- equations
- task lists
- simple vector flows
- visual placeholders
- page markers
- header/footer retention
- strict fail-fast mode

`Extract / Resume` automatically reuses valid completed checkpoints. `Restart from Scratch` explicitly discards a compatible existing workspace after confirmation.

When the extraction algorithm changes in a way that can alter persisted part semantics, old workspaces are rejected by version rather than silently reused. Branding-only changes do not invalidate checkpoints.

`Stop Safely` is cooperative. The current low-level engine operation may need to return first, but every already-written checkpoint remains reusable. The active incomplete checkpoint is retried on the next run.

## Progress and logs

The GUI receives the same typed `ProgressEvent` objects used by CLI reporting. Extraction runs on a worker thread so the window remains responsive.

The bottom area shows overall progress, current stage/status, the structured event log, semantic details emitted by the pipeline, and a `Save Log…` action. Worker threads never update Tk widgets directly; events cross a thread-safe queue and are rendered by the Tk main loop.

## Combine Workspace

A completed workspace can be combined without reopening the PDF. The GUI can inspect `manifest.json`, show source/status/page/part information, and combine only after normal checksum validation succeeds.

Final assembly also performs document-level cleanup that cannot be done reliably from one page alone, including repeated-running-matter removal, fused header/body repair, cross-page wrap-hyphen repair, high-confidence prose continuation, and stale false-math cleanup.

## Markdown → DOCX

The DOCX tab converts an existing Markdown file independently of PDF extraction. It supports an optional document title, optional original/source PDF, and optional preservation of source PDF page boundaries.

Recognized `$$ ... $$` display-math blocks become native editable Word Office Math (OMML) equations. When the original PDF is selected, visual placeholders carrying page/bounding-box provenance can be cropped from that PDF and embedded in Word. Those source crops are faithful images, not falsely reconstructed editable equations.

Word uses natural reflow by default. Source `<!-- page: N -->` comments therefore do not create hard Word page breaks unless source-page preservation is explicitly enabled. For long documents, the GUI warns before creating hundreds of hard page breaks.

## Architecture

The GUI deliberately contains no independent PDF parsing logic:

```text
GlyphMend Tkinter GUI
   ↓
ExtractionConfig / ProgressEvent
   ↓
extract_pdf_resumable()
combine_workspace()
markdown_to_docx(source_pdf=...)
   ↓
shared tested reconstruction pipeline
```

This keeps browser-adjacent product behavior, CLI behavior, and desktop behavior aligned around the same extraction contract rather than maintaining separate parsing products.
