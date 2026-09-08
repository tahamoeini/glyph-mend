# PDF Sanitizer Browser Edition

A separate browser-native edition that runs entirely on the user's device: no backend, account, upload, telemetry, or Python runtime.

## Complete browser workflow

- Local PDF opening and source-page rendering with PDF.js.
- Page-range extraction in a Web Worker, so long documents do not lock the interface.
- Reading-order reconstruction from text coordinates, heading detection, and conservative aligned-text table detection.
- Repeated header/footer/page-number cleanup and cross-page paragraph repair.
- Editable Markdown, safe rendered preview, find, and extraction metrics.
- Pause, cancel, checkpoint, resume, workspace import/export, and IndexedDB persistence.
- Markdown, plain-text, and Word downloads. DOCX includes headings, lists, tables, inline styles, and native Office Math containers.
- Installable offline PWA after its first successful load.

## Run it

```bash
cd web-app
npm ci
npm run dev
```

For the deployable static build:

```bash
npm run build
npm run preview
```

The output is `web-app/dist/`. A local HTTP server is required because browsers restrict workers and service workers on `file://` URLs.

## Privacy and limits

Use a current Chrome, Edge, or Firefox. PDF bytes and checkpoints stay in browser storage. Clearing site data removes the saved workspace.

This implements the complete browser-safe workflow, not fictional parity with native CPython. Scanned PDFs without a text layer need OCR; image-only equations and tables remain visual placeholders. The source viewer lets the user verify those regions instead of the app inventing content.

Brython is intentionally not used. It cannot run the existing native PyMuPDF and Word-processing dependency stack. PDF.js, Web Workers, IndexedDB, and browser OOXML generation are the appropriate runtime.

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The Python package outside `web-app/` is unchanged.
