# Architecture and Repository Layout

## Top-level layout

```text
src/pdf_sanitizer/     Python reference edition
web-app/               Browser-first application
tests/                 Python tests grouped by responsibility
docs/                  Product and operations documentation
.github/workflows/     Python, browser, and release automation
```

## Python reference edition

The Python package keeps its long-standing public module paths so existing scripts,
plugins, and console entry points continue to work. Its modules are organized by
responsibility:

| Area | Modules |
| --- | --- |
| Interfaces | `cli.py`, `gui.py`, `__main__.py` |
| Configuration and progress | `config.py`, `progress.py`, `reporting.py` |
| Extraction orchestration | `pipeline.py`, `workflow.py`, `workspace.py` |
| Native PDF adapters | `extractor.py`, `native.py`, `native_stderr.py`, `renderer.py` |
| Semantic reconstruction | `semantics.py`, `structure.py`, `tables.py`, `graphics.py`, `equation_quality.py` |
| Cleanup and validation | `sanitize.py`, `document_cleanup.py`, `running_matter.py`, `quality.py` |
| Word export | `docx_export.py`, `word_math.py` |

The installed commands remain stable:

```text
pdf-sanitizer          PDF extraction and workspace operations
pdf-sanitizer-gui      Tkinter desktop GUI
md-to-docx             Markdown-to-Word export
```

## Browser edition

```text
web-app/src/
  app.js                    UI entry point and state orchestration
  features/extraction/      MuPDF/OCR worker and Markdown reconstruction
  features/export/          DOCX export
  storage/                  IndexedDB workspace persistence
  shared/                   Download utilities
  styles/                   UI style sheets
web-app/public/             PWA manifest and icons
```

Runtime-only MuPDF, PDF.js, and Tesseract files are copied by `vite.config.js` into
the production build. They must remain static, deployable assets because nested
browser workers cannot safely load Vite internal dependency URLs.

## Tests

```text
tests/
  unit/                     Deterministic Python module tests
  integration/              Pipeline and end-to-end workflow tests
  interfaces/               CLI, GUI-helper, and reporting tests
web-app/src/**/**.test.js   Browser unit tests beside their modules
web-app/tests/              Browser end-to-end tests
```

## Automation

| Workflow | Responsibility |
| --- | --- |
| `test.yml` | Python lint, matrix tests, package build, installed-command smoke tests |
| `web-app.yml` | Browser unit tests, production build, and Playwright tests |
| `release.yml` | Version/tag validation, distribution build, wheel validation, GitHub release |
