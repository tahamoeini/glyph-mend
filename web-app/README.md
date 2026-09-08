# PDF Sanitizer Browser Edition 2

The primary, browser-native PDF Sanitizer. It runs on the user's device without a
backend, account, upload, telemetry, or Python runtime.

## Complete local workflow

- PDF.js source-page viewer.
- MuPDF WebAssembly structured extraction in a Web Worker. Text blocks, font
  information, images, and page geometry are retained instead of treating every
  visual line as a separate paragraph.
- Conservative heading, table, and editable-equation detection; repeated
  header/footer cleanup; wrap dehyphenation; and cross-page paragraph repair.
- Locally bundled Tesseract WebAssembly fallback for English scanned pages, with
  forced OCR and configurable render DPI.
- Source figures preserved as PNG assets. If an equation has no usable text
  representation, a source-PDF crop is retained instead of silently deleting it.
- Editable Markdown, safe rendered preview, source comparison, find, and metrics.
- Pause, cancel, resume, workspace import/export, and incremental IndexedDB
  checkpoints. PDF bytes are stored once and completed pages individually.
- Markdown, plain text, and Word downloads. DOCX includes headings, lists, tables,
  inline styles, native Office Math, and embedded source visuals.
- Complete ZIP bundle containing Markdown, text, report, log, and PNG assets.
- Timestamped activity log plus per-page metrics, OCR/worker events, and
  machine-readable quality gates.
- Installable PWA that works offline after the first successful load.

## Run it

```bash
cd web-app
npm ci
npm run dev
```

Build and preview the deployable static site:

```bash
npm run build
npm run preview
```

The result is `web-app/dist/`. A local HTTP server is required because browsers
restrict workers and service workers on `file://` URLs.

## Extraction contract

1. Recoverable text becomes semantic Markdown.
2. Confident equations become Markdown display math and native Word equations.
3. Images and equation-like gaps that cannot be reconstructed safely are preserved
   from the source PDF and embedded into Word.
4. Unrecoverable content produces a visible placeholder and a quality issue. It is
   never silently counted as success.

English OCR data is bundled. Tesseract is suitable for scanned prose but is not a
mathematical OCR engine, so image-only mathematics is preserved visually rather than
invented as LaTeX. Complex layouts still require review; the report changes to
`warnings` or `needs-review` when deterministic checks find suspicious omissions.

Brython is not used because it cannot run the native PyMuPDF stack. MuPDF WASM,
PDF.js, Tesseract.js, Web Workers, IndexedDB, and browser OOXML generation provide
the required capabilities without a backend.

## Licensing

MuPDF.js is AGPL-3.0-or-later or commercially licensed by Artifex, matching the
licensing concern already documented for the Python PyMuPDF dependency. Confirm that
your deployment satisfies the AGPL, or obtain a commercial MuPDF license. Tesseract.js
is Apache-2.0 and the bundled English data package is MIT licensed.

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

CI performs all three checks and uploads the static build. The Python code outside
`web-app/` remains available as the legacy/reference edition and was not modified by
this migration.
