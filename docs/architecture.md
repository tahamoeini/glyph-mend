# GlyphMend architecture and repository layout

## Top-level layout

```text
branding.json          Canonical product identity and logo configuration
brand/                 Source brand assets
src/glyphmend/         Canonical Python public package
src/pdf_sanitizer/     Core implementation + compatibility namespace
web-app/               Browser-first application
tests/                 Python tests grouped by responsibility
docs/                  Product and operations documentation
.github/workflows/     Python, browser, and release automation
```

## Branding boundary

Brand identity is intentionally separate from extraction configuration. `branding.json` contains the default name, slogan, CLI name, description, and logo path. Python resolves it through `pdf_sanitizer.branding` / `glyphmend.branding`; the browser synchronizes it into public assets and then loads `branding.json` at runtime.

Changing branding must not alter extraction fingerprints or invalidate checkpoints.

## Python edition

`glyphmend` is the canonical public package. The long-standing `pdf_sanitizer` namespace remains as a compatibility surface so existing integrations can migrate without a forced breaking release.

| Area | Modules |
| --- | --- |
| Public compatibility | `src/glyphmend/`, `src/pdf_sanitizer/__init__.py` |
| Branding | `branding.py` |
| Interfaces | `cli.py`, `gui.py`, `__main__.py` |
| Configuration and progress | `config.py`, `progress.py`, `reporting.py` |
| Extraction orchestration | `pipeline.py`, `workflow.py`, `workspace.py` |
| Native PDF adapters | `extractor.py`, `native.py`, `native_stderr.py`, `renderer.py` |
| Semantic reconstruction | `semantics.py`, `structure.py`, `tables.py`, `graphics.py`, `equation_quality.py` |
| Cleanup and validation | `sanitize.py`, `document_cleanup.py`, `running_matter.py`, `quality.py` |
| Word export | `docx_export.py`, `word_math.py` |

Canonical installed commands:

```text
glyphmend              PDF extraction and workspace operations
glyphmend-gui          Tkinter desktop GUI
md-to-docx              Markdown-to-Word export
```

Compatibility commands retained for existing scripts:

```text
pdf-sanitizer
pdf-sanitizer-gui
```

## Browser edition

```text
web-app/src/
  app.js                    UI state and extraction orchestration
  brand-bootstrap.js        Runtime brand initialization
  shared/brand.js           Brand loading, caching, validation, and DOM application
  mupdf-vite.js             MuPDF static-asset adapter for Vite
  features/extraction/      OCR worker and Markdown reconstruction
  features/export/          DOCX export
  storage/                  IndexedDB workspace persistence
  shared/                   Shared browser utilities
  styles/                   UI styles
web-app/scripts/
  sync-brand.mjs            Build/dev synchronization of brand config and PWA metadata
web-app/public/             PWA manifest, runtime branding JSON, logo, and native assets
```

Runtime-only MuPDF, PDF.js, and Tesseract files are copied by `vite.config.js` into the production build. They remain static deployable assets because nested browser workers cannot safely depend on Vite's internal dependency URLs.

The runtime brand JSON and brand assets are deliberately excluded from Workbox precaching. The browser loads the current configuration with `cache: no-store` and stores the last successful brand locally as an offline fallback. PWA install metadata is generated during brand synchronization and therefore requires a rebuild when the installed-app name or icon changes.

## Tests

```text
tests/
  unit/                     Deterministic Python module tests
  integration/              Pipeline and end-to-end workflow tests
  interfaces/               CLI, GUI-helper, and reporting tests
web-app/src/**/**.test.js   Browser unit tests beside their modules
web-app/tests/              Browser end-to-end tests
```

Branding tests verify canonical defaults, JSON/environment overrides, runtime browser loading, safe DOM application, and compatibility imports.

## Automation

| Workflow | Responsibility |
| --- | --- |
| `test.yml` | Python lint, matrix tests, package build, canonical/legacy command smoke tests |
| `web-app.yml` | Browser brand sync, unit tests, production build, and Playwright tests |
| `release.yml` | Version/tag validation, GlyphMend distribution build, wheel validation, GitHub release |
