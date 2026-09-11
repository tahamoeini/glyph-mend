# Step 01 Baseline Snapshot

This document captures the repository baseline observed during Step 01 without changing application behavior.

## Module map

- Python CLI/package entry points: [src/glyphmend/cli.py](src/glyphmend/cli.py), [src/glyphmend/__main__.py](src/glyphmend/__main__.py), [src/pdf_sanitizer/cli.py](src/pdf_sanitizer/cli.py), [src/pdf_sanitizer/__main__.py](src/pdf_sanitizer/__main__.py)
- Python document export and math: [src/pdf_sanitizer/docx_export.py](src/pdf_sanitizer/docx_export.py), [src/pdf_sanitizer/word_math.py](src/pdf_sanitizer/word_math.py), [src/pdf_sanitizer/semantics.py](src/pdf_sanitizer/semantics.py)
- Python diagram reconstruction: [src/pdf_sanitizer/graphics.py](src/pdf_sanitizer/graphics.py)
- Browser app shell: [web-app/src/app.js](web-app/src/app.js)
- Browser extraction pipeline: [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js), [web-app/src/features/extraction/ocr-layout.js](web-app/src/features/extraction/ocr-layout.js), [web-app/src/features/extraction/cleanup.js](web-app/src/features/extraction/structured-fidelity-finalizer.js), [web-app/src/features/extraction/structured-recovery.js](web-app/src/features/extraction/structured-recovery.js)
- Browser persistence: [web-app/src/storage/workspace-db.js](web-app/src/storage/workspace-db.js)
- Browser export: [web-app/src/features/export/docx-export.js](web-app/src/features/export/docx-export.js)
- Browser styling: [web-app/src/styles/style.css](web-app/src/styles/style.css)

## Current data flow

1. The browser shell loads PDF.js, registers the PWA service worker, and wires the local extraction workspace in [web-app/src/app.js](web-app/src/app.js).
2. The extraction worker uses MuPDF for structured page recovery, OCR via Tesseract, and local quality gates before emitting Markdown-oriented page data.
3. OCR layout helpers normalize OCR rows into headings, paragraphs, tables, and equations.
4. Cleanup merges page output into canonical Markdown while preserving page markers, structural recovery, and conservative fallbacks.
5. Browser state is checkpointed in IndexedDB through [web-app/src/storage/workspace-db.js](web-app/src/storage/workspace-db.js).
6. DOCX export consumes reconstructed Markdown and converts it downstream into Word structures, including native math and source visuals.

## Current test map

- Python unit tests: [tests/unit/](tests/unit/)
- Python integration tests: [tests/integration/](tests/integration/)
- Python interface tests: [tests/interfaces/](tests/interfaces/)
- Browser unit tests: [web-app/src/**/*.test.js](web-app/src)
- Browser e2e tests: [web-app/tests/](web-app/tests/)
- CI workflows: [.github/workflows/test.yml](.github/workflows/test.yml), [.github/workflows/web-app.yml](.github/workflows/web-app.yml), [.github/workflows/release.yml](.github/workflows/release.yml)

## Public behavior that must remain backward compatible

- Markdown remains the canonical textual output.
- DOCX remains a downstream export format.
- The browser app stays local-first and offline.
- Existing checkpoints remain resumable when compatible, and stale checkpoints are invalidated conservatively.
- OCR, structured recovery, tables, equations, and flow diagrams remain evidence-driven and conservative.
- Legacy compatibility aliases continue to work: `pdf-sanitizer` and `pdf-sanitizer-gui`.

## Dependency and license observations

- Python dependencies include MuPDF/PyMuPDF and PyMuPDF4LLM, which carry Artifex/AGPL/commercial licensing considerations.
- Browser dependencies include MuPDF, Tesseract.js, PDF.js, DOMPurify, marked, docx, fflate, and idb.
- Browser build output contains large static assets, especially PDF worker and generated application chunks.
- The browser workspace also uses `vite-plugin-pwa` and `vite-plugin-static-copy` to ship offline assets.

## Known technical debt relevant to the research

- OCR baseline coverage is brittle enough that the local Tesseract e2e path can fail while the unit and build suites pass.
- The browser bundle includes large assets and reports chunk-size warnings during production build.
- The local-first browser architecture depends on workspace-specific assets and installation steps being present before tests can run.
- The repository still relies on compatibility layers for the historical `pdf-sanitizer` naming.

## Exact conversion surfaces

- Regex-like LaTeX to DOCX conversion occurs in [src/pdf_sanitizer/word_math.py](src/pdf_sanitizer/word_math.py), especially `equation_elements()`, `append_equation()`, `_strip_markdown_math_markup()`, and `_Parser`.
- Vector diagrams become Mermaid in [src/pdf_sanitizer/graphics.py](src/pdf_sanitizer/graphics.py), especially `detect_vector_diagrams()` and `_diagram_markdown()`.
- Browser-side flow/diagram reconstruction is also influenced by [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js), which emits vector graphic candidates and diagram placeholders.

## Responsive and glass-token baseline

- 820px responsive behavior is controlled in [web-app/src/app.js](web-app/src/app.js) through `mobileSidebar: queryMedia("(max-width: 820px)")`.
- The corresponding layout and mobile-sidebar rules live in [web-app/src/styles/style.css](web-app/src/styles/style.css), including the `@media (max-width: 820px)` block that collapses the workspace, fixes the sidebar, and adds the backdrop overlay behavior.
- The glass-token system lives in [web-app/src/styles/style.css](web-app/src/styles/style.css) under `:root` and `:root[data-theme="dark"]`, with the `--glass-*` fill/border/highlight/shadow/blur variables and the `.liquid-glass*` classes.

## Baseline validation snapshot

- Python unit test slice: `python -m pytest tests/unit/test_docx_export.py` passed.
- Full Python suite: `python -m pytest` passed.
- Python lint: `python -m ruff check src tests` passed.
- Browser unit tests: `npm test` in `web-app/` passed after installing workspace dependencies.
- Browser build: `npm run build` in `web-app/` passed after installing workspace dependencies.
- Browser e2e: `npm run test:e2e` in `web-app/` failed in `tests/ocr-baseline.spec.js` because the OCR baseline reached `Extraction worker failed` instead of completing.

- Build snapshot: production build produced a large `pdf.worker.min` asset and reported a chunk-size warning for the application chunk, but completed successfully.
