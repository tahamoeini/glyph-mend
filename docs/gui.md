# Desktop GUI

`pdf-sanitizer` includes a lightweight native Tkinter interface over the same extraction, checkpoint, combine, and DOCX code used by the CLI.

Launch it with either:

```bash
pdf-sanitizer-gui
```

or:

```bash
pdf-sanitizer gui
```

On normal Windows and macOS Python installations, Tkinter is included. Minimal Linux installations may need the system Tk package, commonly `python3-tk`.

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

When the extraction algorithm changes in a way that can alter persisted part semantics, old workspaces are rejected by version rather than silently reused. `v0.3.3` uses extraction algorithm version 3.

`Stop Safely` is cooperative. The current low-level engine operation may need to return first, but every already-written checkpoint remains reusable. The active incomplete checkpoint is simply retried on the next run.

## Progress and logs

The GUI receives the same typed `ProgressEvent` objects used by CLI reporting. Extraction runs on a worker thread so the window remains responsive.

The bottom area shows:

- overall progress
- current stage/status
- live structured event log
- semantic details when emitted by the pipeline
- a `Save Log…` action

The worker thread never updates Tk widgets directly; events cross a thread-safe queue and are rendered by the Tk main loop.

## Combine Workspace

A completed workspace can be combined without reopening the PDF. The GUI can inspect `manifest.json`, show source/status/page/part information, and combine only after the normal checksum validation succeeds.

Final assembly also performs document-level cleanup that cannot be done reliably from a single page alone, including Arabic/Roman running-header removal, fused header/body repair, cross-page wrap-hyphen repair, high-confidence prose continuation, and stale false-math cleanup.

## Markdown → DOCX

The DOCX tab converts an existing Markdown file independently of PDF extraction. It supports:

- optional document title
- optional original/source PDF
- optional preservation of source PDF page boundaries

Recognized `$$ ... $$` display-math blocks become **native editable Word Office Math (OMML) equations**, including common fractions, roots, superscripts, subscripts, Greek letters, relations, and operators.

If the original PDF is selected, visual placeholders that carry page/bounding-box provenance are cropped from that PDF and embedded in Word. This preserves image-only equations, irregular tables, charts, and diagrams visually instead of replacing them with omission notices. Those source crops are faithful images, not falsely reconstructed editable equations.

Word uses **natural reflow by default**. Source `<!-- page: N -->` comments therefore do not create hard Word page breaks unless `Preserve source PDF page boundaries as hard Word page breaks` is explicitly enabled.

For long documents, the GUI warns before creating hundreds of hard page breaks because that can produce a much longer and sparsely filled Word document.

## Architecture

The GUI deliberately contains no PDF parsing logic:

```text
Tkinter GUI
   ↓
ExtractionConfig / ProgressEvent
   ↓
extract_pdf_resumable()
combine_workspace()
markdown_to_docx(source_pdf=...)
   ↓
existing tested core pipeline
```

This keeps the CLI and GUI behavior aligned and avoids maintaining two subtly different extraction products.
