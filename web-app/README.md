# PDF Sanitizer Browser Edition

The primary, browser-native PDF Sanitizer. It runs on the user's device without a
backend, account, upload, telemetry, or Python runtime.

For operational guidance and runtime troubleshooting, see the
[browser operations guide](../docs/browser.md).

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
  checkpoints. PDF bytes are stored once and completed pages individually; a
  batch is not marked persisted until its page checkpoints finish writing.
- Markdown, plain text, and Word downloads. DOCX includes headings, lists, tables,
  inline styles, native Office Math, and embedded source visuals.
- Complete ZIP bundle containing Markdown, text, report, log, and PNG assets.
- Timestamped activity log plus per-page metrics, OCR/worker events, and
  machine-readable quality gates. A skipped selected page is always reported as
  `needs-review`; it is never shown as a clean extraction.
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

## Source layout

```text
src/
  app.js                    Browser entry point and UI orchestration
  mupdf-vite.js             Build adapter for MuPDF's sibling JS/WASM assets
  features/
    extraction/             OCR worker, cleanup, and tests
    export/                 DOCX conversion and tests
  storage/                  IndexedDB workspace persistence and tests
  shared/                   Download helpers
  styles/                   Application styles
public/                     Manifest and static UI assets
```

The Vite configuration deliberately copies MuPDF, PDF.js, and Tesseract runtime
assets into the production build. Do not replace those paths with Vite's internal
`node_modules` URLs: nested browser workers must receive deployable static URLs.

## Deployment and browser support

Deploy the contents of `dist/` as static files over HTTPS. The application uses Web
Workers, WebAssembly, IndexedDB, and a service worker, so current Chromium, Firefox,
and Safari releases are the practical support baseline. Private browsing,
storage-restricted browser settings, or browser quota limits can prevent workspace
resume; exports still work for the active session.

No backend endpoint is required or contacted by this application. The selected PDF,
its extracted content, and optional checkpoint data remain in the browser unless the
user explicitly downloads an export or imports/exports a workspace file.

## Extraction contract

1. Recoverable text becomes semantic Markdown.
2. Confident equations become Markdown display math and native Word equations.
3. Images and equation-like gaps that cannot be reconstructed safely are preserved
   from the source PDF and embedded into Word.
4. Unrecoverable content produces a visible placeholder and a quality issue. It is
   never silently counted as success.

English OCR data is bundled. Tesseract is suitable for scanned prose but is not a
mathematical OCR engine. On an OCR-only page, the app now reconstructs paragraph and
heading boundaries from the OCR layout data (or its text fallback). A source-page
rendition is retained only on OCR pages that contain a detected figure, table, or
equation cue; it is never added to every page. Clearly mathematical OCR lines are
emitted as editable display math; visual material and ambiguous notation are kept as
source visual evidence rather than fabricated equations. The report marks OCR-only
pages as `OCR_ONLY_PAGES` so they are never mistaken for an equivalent native-text
extraction. Complex layouts still require review; an interrupted or failed page is
recorded in the quality report and blocks a clean status.

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

The end-to-end test starts a local Vite server and launches Chromium. On a new Linux
machine, run `npx playwright install --with-deps chromium` once before running
`npm run test:e2e`; the CI workflow already performs that setup.
