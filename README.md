<p align="center">
  <img src="brand/glyphmend-mark.svg" width="88" height="88" alt="GlyphMend logo">
</p>

# GlyphMend

> **Faithful document reconstruction from PDF to structured Markdown.**

GlyphMend is a local-first, structure-aware PDF reconstruction toolkit. Its primary output is deterministic, inspectable Markdown; DOCX is an export format layered on top of that canonical Markdown.

The recommended browser edition runs extraction locally with MuPDF WebAssembly, bundled OCR support, resumable browser workspaces, source-visual preservation, native Word equation export, logs, quality gates, and offline installation. A Python CLI and desktop GUI remain available for command-line and native workflows.

GlyphMend keeps one deliberately narrow contract:

> **PDF in → faithful, deterministic, structure-aware Markdown out.**

Chunking, embeddings, RAG, article generation, and other downstream concerns stay outside the core reconstruction layer.

## Documentation

- [Branding and configuration](docs/branding.md): change the name, slogan, CLI identity, and logo without editing application logic.
- [Browser operations guide](docs/browser.md): local processing, OCR settings, checkpoints, deployment, and troubleshooting.
- [Browser application guide](web-app/README.md): install, build, verification, and browser-specific licensing.
- [Architecture guide](docs/architecture.md): repository layout, Python module boundaries, tests, and CI workflows.
- [Desktop GUI guide](docs/gui.md): Python desktop interface.

## Semantic output contract

| PDF content | Output |
| --- | --- |
| Titles and headings | Markdown headings |
| Paragraphs | Markdown prose |
| Ordered/unordered lists | Markdown lists |
| Checkbox lists | GitHub task lists (`- [ ]`, `- [x]`) |
| Bold/italic/layout text | Markdown formatting when recoverable |
| Monospaced/code regions | fenced code when detected |
| Links | Markdown links when recoverable |
| Real tables | GitHub-flavored Markdown tables when structure is recoverable |
| Text-based display equations | GitHub/MathJax `$$ ... $$` blocks |
| Strong standalone OCR equations | conservative LaTeX blocks |
| Superscripts/subscripts/fractions | preserved; normalized in equations when deterministic |
| Simple vector box/connector flows | Mermaid `flowchart` blocks |
| Raster images | explicit source-visual placeholders/assets |
| Ambiguous vector graphics | explicit graphic placeholders |
| Scanned text pages | OCR text when OCR is enabled/available |
| Headers/footers | removed by default using geometry plus repeated-document evidence |
| Page boundaries | `<!-- page: N -->` comments by default |

The trust hierarchy is intentionally conservative:

1. Keep native structure when evidence exists.
2. Use deterministic reconstruction for tables, equations, task lists, and simple flows.
3. Fall back to readable text when structure is uncertain.
4. Preserve genuinely visual or unresolved material explicitly instead of inventing semantics.

A suspicious table is therefore downgraded to readable prose rather than emitted as an impressive-looking grid of broken words.

## Processing architecture

The default resumable flow is:

```text
PDF
 ↓
checkpoint range
 ↓
layout / OCR extraction
 ↓
quality gate
 ├─ healthy layout → keep
 └─ pathological layout → conservative text-first reconstruction
 ↓
regional tables / equations / task lists / flows / source visuals
 ↓
page-level structure-safe cleanup
 ↓
persisted Markdown parts + atomic manifest
 ↓
validated combination
 ↓
document-level cleanup
 ↓
canonical Markdown
 ↓ optional
DOCX
 ├─ recognized display math → native Word OMML
 └─ preserved source visual → embedded source image
```

This makes long-running extraction restart-safe and keeps intermediate artifacts inspectable.

## Browser edition — recommended

The browser edition does not require Python, a backend, or a document upload. PDF processing remains on the device.

```bash
cd web-app
npm ci
npm run dev
```

Build a deployable static app with:

```bash
npm run build
```

Serve `web-app/dist/` over HTTPS. See [web-app/README.md](web-app/README.md) for browser behavior, verification, OCR assets, deployment, privacy boundaries, and licensing notes.

## Python installation

Python 3.10+:

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .
```

For OCR in the Python edition, install Tesseract and any language packs you need. Native-text PDFs do not require OCR.

> **Dependency licensing:** PyMuPDF and PyMuPDF4LLM have Artifex/AGPL/commercial licensing terms. Review the applicable terms before distributing a product that depends on them.

## Extract PDF to Markdown

The canonical CLI is `glyphmend`:

```bash
glyphmend input.pdf
```

Equivalent explicit form:

```bash
glyphmend extract input.pdf
```

The default run creates an output Markdown file plus a resumable parts workspace:

```text
input.pdf
input.md
input.parts/
  manifest.json
  part-0001-pages-0001-0020.md
  part-0002-pages-0021-0040.md
  ...
```

Useful extraction options:

```bash
glyphmend input.pdf -o clean.md
glyphmend input.pdf --ocr-language eng+fas
glyphmend input.pdf --force-ocr
glyphmend input.pdf --no-ocr
glyphmend input.pdf --no-tables
glyphmend input.pdf --no-equations
glyphmend input.pdf --no-task-lists
glyphmend input.pdf --no-flows
glyphmend input.pdf --no-placeholders
glyphmend protected.pdf --password "..."
```

### Checkpoints and automatic resume

Persist one Markdown checkpoint every 20 pages:

```bash
glyphmend input.pdf --checkpoint-pages 20
```

Choose a workspace explicitly:

```bash
glyphmend input.pdf -o clean.md --workspace clean.parts
```

If extraction stops, rerun the same command. Completed parts are reused only after GlyphMend validates the source fingerprint, page count, extraction configuration, checkpoint size, extraction algorithm version, and persisted part checksums.

If the source, extraction options, or extraction algorithm intentionally changed, start fresh:

```bash
glyphmend input.pdf --restart
```

The one-shot in-memory path remains available:

```bash
glyphmend input.pdf --no-checkpoints
```

And stdout stays a clean Markdown stream:

```bash
glyphmend input.pdf --stdout > clean.md
```

### Combine existing parts without re-extraction

```bash
glyphmend combine input.parts -o input.md
```

Combination verifies expected parts and checksums before atomically writing the final Markdown and running cleanup that requires cross-page evidence.

## Convert Markdown to DOCX

```bash
glyphmend md-to-docx input.md
```

The standalone command remains available:

```bash
md-to-docx input.md
```

Specify an output path or title:

```bash
md-to-docx input.md -o input.docx
md-to-docx input.md -o report.docx --title "Revenue Management"
```

If the original PDF is available, pass it so visual-only material can be preserved in Word:

```bash
md-to-docx input.md --source-pdf input.pdf
```

Recognized display equations become native Word Office Math (OMML). Visual placeholders with source provenance can become embedded source crops. Source PDF page boundaries are not forced into Word by default because Word is a reflowing format; opt in only when required:

```bash
md-to-docx input.md --preserve-page-breaks
```

## Progress logging

```bash
glyphmend input.pdf -v
glyphmend input.pdf -vv
glyphmend input.pdf --quiet
glyphmend input.pdf --log-file extraction.log
glyphmend input.pdf --log-file extraction.jsonl --log-format json
```

Progress logs go to stderr, not into Markdown output.

## Python API

Canonical imports use `glyphmend`:

```python
from glyphmend import ExtractionConfig, extract_pdf

result = extract_pdf(
    "input.pdf",
    config=ExtractionConfig(
        use_ocr=True,
        extract_tables=True,
        extract_equations=True,
    ),
)
print(result.markdown)
```

For large files:

```python
from glyphmend import ExtractionConfig, extract_pdf_resumable

result = extract_pdf_resumable(
    "input.pdf",
    "input.md",
    workspace_path="input.parts",
    checkpoint_pages=20,
    config=ExtractionConfig(ocr_language="eng"),
)
```

Combine without reopening the PDF:

```python
from glyphmend import combine_workspace

combine_workspace("input.parts", "input.md")
```

Convert Markdown to DOCX:

```python
from glyphmend import markdown_to_docx

markdown_to_docx("input.md", "input.docx", source_pdf="input.pdf")
```

## Configurable branding

The product identity is separated from extraction behavior. The repository-level [`branding.json`](branding.json) is the canonical source for:

- product name and short name;
- repository/application slug;
- CLI display name;
- slogan and description;
- logo path and accessible alt text.

The browser copies this identity into its public runtime assets with:

```bash
cd web-app
npm run brand:sync
```

`dev`, `test`, `preview`, and `build` run that synchronization automatically. The built browser app loads `branding.json` at runtime, so a deployment can replace the runtime branding JSON and referenced logo without recompiling extraction code. Installable PWA manifest metadata is generated during synchronization/build.

Python can use another branding JSON at runtime:

```bash
GLYPHMEND_BRAND_CONFIG=/path/to/branding.json glyphmend --help
```

Or override individual values with environment variables such as `GLYPHMEND_NAME`, `GLYPHMEND_CLI_NAME`, `GLYPHMEND_SLOGAN`, and `GLYPHMEND_LOGO_PATH`.

See [docs/branding.md](docs/branding.md) for the full contract and precedence rules.

## Compatibility after the rename

`glyphmend` and `glyphmend` Python imports are the canonical interfaces. To avoid breaking existing scripts immediately, the previous command and import namespace remain compatibility aliases:

```bash
pdf-sanitizer --help
pdf-sanitizer-gui
```

```python
import pdf_sanitizer
```

Those aliases point to the same implementation and version. New integrations should use `glyphmend`.

Existing checkpoint workspaces are intentionally kept compatible with the extraction algorithm unless an extraction-version or configuration change itself requires a restart. Branding changes alone do not invalidate extraction output.

## Equation handling

GlyphMend uses span-level math symbols, font hints, superscript metadata, text geometry, conservative standalone-line detection, and surrounding-prose checks to preserve mathematical structure only when evidence is strong enough. Unknown or damaged tokens are preserved rather than silently invented or discarded.

Rasterized formulas without reliable recognition remain visual content rather than fabricated LaTeX.

## Table handling

Table extraction is deliberately independent from page-layout classification. GlyphMend prefers strict ruled-line evidence, then line-based evidence, then bounded whitespace/text tables under conservative size and prose checks.

Page-wide whitespace grids are rejected because justified prose can otherwise be misread as artificial columns. Rasterized, highly irregular, or heavily merged tables may remain preserved visual regions instead of fabricated grids.

## Structure-safe cleanup

Cleanup is structural, not editorial. Among other deterministic operations, it can normalize Unicode and extraction artifacts, repair conservative line-wrap hyphenation, remove repeated running matter, join high-confidence cross-page prose continuations, protect fenced code/Mermaid blocks, and avoid duplicate text when reconstructing structured elements.

GlyphMend preserves source claims; it does not summarize or rewrite document content.

## Images, scans, and vector graphics

Raster images and unresolved graphics are preserved explicitly with provenance. Simple vector rectangle/connector diagrams may become Mermaid when connector evidence exists. Full-page scans can use OCR. Ambiguous graphics remain visual content rather than guessed structure.

## Workspace integrity

`manifest.json` is the recovery contract, not just a progress note. It records source and configuration fingerprints, extraction algorithm version, page/checkpoint information, persisted part metadata and checksums, and final combined-output metadata. Part files and manifests are written atomically so an interrupted write does not masquerade as a completed checkpoint.

## Safety and operational boundaries

- No external AI API is required for extraction.
- Browser processing is local to the device.
- GlyphMend does not intentionally execute PDF JavaScript, attachments, links, or embedded files as application code.
- Uncertain document structure is preserved conservatively instead of invented.

## Scope

GlyphMend is the canonical PDF interpretation layer in this repository. It is not a tokenizer, vector database, RAG pipeline, article writer, or general PDF editor. Markdown is the canonical artifact; downstream systems should consume that Markdown rather than introducing another divergent PDF parser.
