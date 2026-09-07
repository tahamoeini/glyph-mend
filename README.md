# pdf-sanitizer

A local-first **semantic PDF-to-Markdown extractor and sanitizer** with restart-safe checkpoints and optional Markdown-to-DOCX export.

It consolidates the useful PDF-processing ideas from [`pdf-tokenizer`](https://github.com/tahamoeini/pdf-tokenizer) and the ingestion path in [`article-writer`](https://github.com/tahamoeini/article-writer), then keeps one narrow contract:

> **PDF in → faithful, deterministic, structure-aware Markdown out.**

DOCX is an export format layered on top of the Markdown. Chunking, embeddings, RAG, article generation, and other downstream concerns remain separate.

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
| Raster images | `[IMAGE_PLACEHOLDER ...]` |
| Ambiguous vector graphics | `[GRAPHIC_PLACEHOLDER ...]` |
| Scanned text pages | OCR text when OCR is enabled/available |
| Headers/footers | removed by default using page geometry plus repeated-document evidence |
| Page boundaries | `<!-- page: N -->` comments by default |

The trust hierarchy is intentionally conservative:

1. Native structure when evidence exists.
2. Deterministic reconstruction for tables, equations, task lists, and simple flows.
3. Readable text when structure is uncertain.
4. Explicit placeholders for genuinely visual content.

A suspicious table is therefore downgraded to readable prose rather than preserved as an impressive-looking grid of broken words.

## Processing architecture

The default CLI path is restart-safe:

```text
PDF
 ↓
checkpoint range (for example pages 1-20)
 ↓
layout/OCR extraction
 ↓
quality gate
 ├─ healthy layout → keep
 └─ pathological page-wide table → text-first native reconstruction
 ↓
conservative regional tables
 ↓
equations / task lists / flows / visual placeholders
 ↓
page-level structure-safe sanitization
 ↓
part-0001-pages-0001-0020.md
 ↓
manifest.json updated atomically
 ↓
next checkpoint
 ↓
validated parts combined
 ↓
document-level cleanup
 ├─ repeated running headers/page numbers
 ├─ cross-page wrap hyphenation
 └─ deterministic punctuation encoding artifacts
 ↓
final Markdown
 ↓ optional
DOCX
```

This avoids the old failure mode where a 700-page extraction crashed near the end and the only available recovery strategy was apparently to age one year and start again.

## Installation

Python 3.10+:

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .
```

For OCR, install Tesseract and the language packs you need. Ordinary native-text PDFs do not require OCR.

> **Dependency licensing:** PyMuPDF and PyMuPDF4LLM have Artifex/AGPL/commercial licensing terms. Review them before distributing a product that depends on these libraries.

## Extract PDF to Markdown

Backward-compatible usage still works:

```bash
pdf-sanitizer input.pdf
```

It is equivalent to:

```bash
pdf-sanitizer extract input.pdf
```

The default run creates:

```text
input.pdf
input.md
input.parts/
  manifest.json
  part-0001-pages-0001-0020.md
  part-0002-pages-0021-0040.md
  ...
```

The part files are deliberately kept after success. They are both recovery checkpoints and inspectable intermediate Markdown.

Useful extraction options:

```bash
pdf-sanitizer input.pdf -o clean.md
pdf-sanitizer input.pdf --ocr-language eng+fas
pdf-sanitizer input.pdf --force-ocr
pdf-sanitizer input.pdf --no-ocr
pdf-sanitizer input.pdf --no-tables
pdf-sanitizer input.pdf --no-equations
pdf-sanitizer input.pdf --no-task-lists
pdf-sanitizer input.pdf --no-flows
pdf-sanitizer input.pdf --no-placeholders
pdf-sanitizer protected.pdf --password "..."
```

### Checkpoints and automatic resume

By default one Markdown checkpoint is persisted every 20 pages:

```bash
pdf-sanitizer input.pdf --checkpoint-pages 20
```

Choose a workspace explicitly:

```bash
pdf-sanitizer input.pdf -o clean.md --workspace clean.parts
```

If the process stops after pages 1-400, rerun the same command. Completed parts are reused after validating:

- source PDF SHA-256 and size;
- page count;
- extraction configuration;
- checkpoint size;
- extraction algorithm version;
- persisted part SHA-256 checksums.

Only missing or corrupt compatible parts are processed again.

If the PDF, extraction options, or extraction algorithm intentionally changed, start a fresh workspace:

```bash
pdf-sanitizer input.pdf --restart
```

`v0.3.2` uses checkpoint algorithm version 3. Workspaces created by an earlier extraction algorithm are deliberately rejected rather than silently reusing stale output.

`--restart` refuses to recursively delete arbitrary non-workspace directories. Humans already have enough ways to delete their own files.

The old one-shot in-memory path remains available when useful:

```bash
pdf-sanitizer input.pdf --no-checkpoints
```

`--stdout` also uses the one-shot path so stdout remains a clean Markdown stream:

```bash
pdf-sanitizer input.pdf --stdout > clean.md
```

### Combine existing parts without re-extraction

If every compatible part exists but the run stopped before final assembly:

```bash
pdf-sanitizer combine input.parts -o input.md
```

If `-o` is omitted, the output path stored in `manifest.json` is used.

Combination verifies every part and checksum before writing final Markdown atomically, then runs document-level cleanup that needs evidence across page/checkpoint boundaries.

## Convert Markdown to DOCX

DOCX conversion is intentionally a separate operation:

```bash
pdf-sanitizer md-to-docx input.md
```

or via the standalone installed command:

```bash
md-to-docx input.md
```

Specify an output path or title:

```bash
md-to-docx input.md -o input.docx
md-to-docx input.md -o report.docx --title "Revenue Management"
```

The exporter maps sanitizer Markdown into Word structure:

| Markdown | DOCX |
| --- | --- |
| headings | Word heading styles |
| paragraphs | normal paragraphs |
| bold/italic/code spans | formatted runs |
| `<sup>`, `<sub>`, `<u>` | native Word run formatting |
| ordered/unordered lists | Word lists |
| task lists | visible checkbox symbols |
| GFM tables | Word tables |
| blockquotes | quote style when available |
| fenced code / Mermaid | monospaced code blocks |
| visual placeholders | readable caption-style notices |
| `<!-- page: N -->` | metadata only; Word reflows naturally by default |
| `$$ ... $$` | centered LaTeX text in Cambria Math |

Word is a reflowing format. The default exporter therefore **does not** turn every source-PDF page marker into a hard Word page break. Doing that to a long technical book can create hundreds of sparse pages and a much larger document.

Preserve source PDF page boundaries only when that is explicitly required:

```bash
md-to-docx input.md --preserve-page-breaks
```

The desktop GUI uses the same natural-reflow default and warns before preserving very large numbers of source page boundaries.

The DOCX exporter does **not** pretend to convert arbitrary LaTeX into native Word OMML equations. It preserves LaTeX legibly rather than silently corrupting formulas.

## Progress logging

Normal runs show low-noise progress. Use `-v` for detailed progress and `-vv` for page-level semantic counts.

```bash
pdf-sanitizer input.pdf -v
pdf-sanitizer input.pdf -vv
pdf-sanitizer input.pdf --quiet
pdf-sanitizer input.pdf --log-file extraction.log
pdf-sanitizer input.pdf --log-file extraction.jsonl --log-format json
```

Checkpointed runs add stages such as:

- `workspace`
- `checkpoint-start`
- `checkpoint-resume`
- `checkpoint-write`
- `layout-repair`
- `page`
- `page-fallback`
- `combine`
- `complete`
- `error`

Progress logs go to stderr, not into Markdown content.

## Python API

One-shot extraction remains available:

```python
from pdf_sanitizer import ExtractionConfig, extract_pdf

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

For large files, prefer the resumable API:

```python
from pdf_sanitizer import ExtractionConfig, extract_pdf_resumable

result = extract_pdf_resumable(
    "input.pdf",
    "input.md",
    workspace_path="input.parts",
    checkpoint_pages=20,
    config=ExtractionConfig(ocr_language="eng"),
)
```

Combine later without reopening the PDF:

```python
from pdf_sanitizer import combine_workspace

combine_workspace("input.parts", "input.md")
```

Convert Markdown to DOCX:

```python
from pdf_sanitizer import markdown_to_docx

markdown_to_docx("input.md", "input.docx")
```

## Equation handling

GitHub Markdown supports LaTeX math, so mathematical content is preserved structurally when evidence is strong enough.

The extractor uses:

- span-level math symbols, font hints, superscript metadata, and text geometry for native equations;
- a stricter standalone-line detector for OCR/layout text;
- prose-density and surrounding-text checks to reject sentence fragments that merely contain mathematical symbols;
- conservative Unicode-to-LaTeX normalization for common Greek symbols, relations, fractions, superscripts, and subscripts.

Inline prose is not aggressively rewritten as math. Rasterized formulas without reliable recognition remain visual content rather than invented LaTeX.

## Table handling

Table extraction is deliberately independent from page-layout classification.

The preferred order is:

1. strict ruled-line evidence;
2. line-based table evidence;
3. bounded whitespace/text tables under conservative size and prose checks.

Page-wide whitespace grids are rejected because justified paragraphs can otherwise be misread as 5-8 artificial columns. Genuine compact tables remain tables when their cell structure is recoverable; prose remains prose.

**Known limitation:** tables that are rasterized, highly irregular, heavily merged, or otherwise only recoverable as a visual region may remain image/graphic placeholders. `pdf-sanitizer` does not currently run a dedicated image-table recognition model, and it prefers a visible placeholder to a fabricated grid.

## Structure-safe sanitization

Sanitization is structural, not editorial. It:

- uses Unicode NFC rather than destructive compatibility normalization;
- normalizes ligatures, zero-width/control characters, line endings, and deterministic extraction artifacts;
- removes meaningless `<br>` layout debris from generated semantic Markdown;
- repairs conservative Latin line-wrap hyphenation, including proven cross-page wraps at final assembly;
- removes repeated running titles/page numbers using page geometry and document-level repetition evidence;
- normalizes known embedded-font punctuation artifacts only in safe punctuation contexts;
- protects fenced code and Mermaid from prose cleanup;
- avoids duplicate text when replacing tables, equations, and diagrams;
- preserves the actual source claims instead of summarizing or rewriting them.

## Images, scans, and vector graphics

Raster images become deterministic placeholders containing page/bounding-box coordinates in canonical Markdown. DOCX renders those placeholders as readable caption-style notices rather than exposing parser coordinates as document prose.

Simple vector rectangle/connector diagrams can become Mermaid when connector evidence exists. Connector direction is not invented.

Full-page scans can use OCR text when available. Ambiguous graphics remain placeholders.

**Known limitation:** image-only formulas, raster diagrams, and raster tables are not reconstructed by a dedicated formula/table/diagram vision model. OCR may recover text around them, but visually encoded semantics can remain placeholders.

## Front matter and complex lists

Books often encode tables of contents, lists of figures, and lists of tables as multi-column geometry rather than semantic PDF structure. The extractor protects these pages from false giant-table reconstruction, but a difficult source may still produce a readable flattened sequence rather than a perfectly paired title/page-number hierarchy.

That is intentional: losing some presentation structure is preferable to inventing associations between entries and page numbers. A specialized geometry-aware TOC/list reconstruction pass is a possible future enhancement.

## Workspace integrity

`manifest.json` is not merely a progress note. It is the recovery contract. It records:

- source fingerprint;
- extraction configuration fingerprint;
- extraction algorithm version;
- page count;
- checkpoint size;
- each part's page range, filename, status, size, and SHA-256;
- final combined output checksum.

Part files and the manifest are written through temporary files and atomic replacement, so an interrupted write does not masquerade as a completed checkpoint.

## Safety and operational limits

- No network calls or external AI APIs.
- Does not execute PDF JavaScript, attachments, links, or embedded files.
- Progress events contain operational metadata, not extracted document text.
- Default input limit: 512 MB.
- Default page limit: 2,000 pages.
- Password-protected PDFs require an explicit password.
- `--strict` changes page-level graceful fallback into fail-fast behavior.

## Development

```bash
pip install -e ".[dev]"
ruff check src tests
pytest
```

Regression coverage includes sanitization, math/prose discrimination, task lists, conservative table extraction, vector-flow reconstruction, repeated running-matter cleanup, cross-page hyphenation, progress reporting, checkpoint integrity/resume, Markdown combination, DOCX reflow/formatting, and generated end-to-end PDFs.

CI runs linting and tests on every push and pull request.

## Project boundary

`pdf-sanitizer` is the canonical PDF interpretation layer.

It is not a tokenizer, vector database, RAG pipeline, article writer, or PDF editor. The canonical artifact is Markdown. DOCX is an explicit export from that Markdown, while downstream systems consume the same Markdown instead of implementing yet another slightly different PDF parser.
