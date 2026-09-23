# GlyphMend Browser Platform

> **Faithful document reconstruction from PDF to structured Markdown.**

This is the complete default GlyphMend product. It runs locally on the user's device without a backend, account, document upload, telemetry requirement, or Companion runtime. A user may optionally connect the Rust Companion and choose it for an individual extraction job; the browser remains the default and fallback engine.

For operations and troubleshooting, see the [browser guide](../docs/browser.md). For Companion connection and API details, see the [Companion guide](../docs/companion-engine.md).

## Complete local workflow

- PDF.js source-page viewer.
- MuPDF WebAssembly structured extraction in a Web Worker, with text, images, font information, and page geometry.
- Conservative heading, table, and editable-equation detection; repeated header/footer cleanup; wrap dehyphenation; and cross-page paragraph repair.
- Bundled Tesseract WebAssembly fallback for English scanned pages, forced OCR, and configurable render DPI.
- Source figures retained as PNG assets when supported.
- Editable Markdown, safe preview, source comparison, search, and quality metrics.
- Pause, cancel, resume, workspace import/export, and incremental IndexedDB checkpoints.
- Shared Markdown, plain text, Word, quality-report, log, and complete-bundle exports.
- Native Office Math for recognized equations and embedded source visuals in DOCX.
- Offline-capable installable PWA after the first successful load.

## Run and build

```bash
npm ci
npm run dev
```

```bash
npm test
npm run build
npm run preview
```

The production output is `dist/`. Serve it over HTTPS; browsers restrict workers and service workers on `file://` URLs.

## Optional Companion

The Companion is selected only for a job after a user connects it. It returns Semantic Document IR v2 to this application; the same browser Markdown and DOCX exporters remain in use. If loopback access is denied or the Companion is unavailable, unsupported, or fails, the browser engine processes the job. See the [Companion guide](../docs/companion-engine.md).

## Licensing

MuPDF.js is AGPL-3.0-or-later or commercially licensed by Artifex. Confirm that your deployment satisfies the applicable terms or obtain a commercial MuPDF license. Tesseract.js is Apache-2.0 and the bundled English data package is MIT licensed. Companion package notices and dependencies are tracked separately in its release archive.

## Interface materials

GlyphMend uses a HIG-aligned Liquid Glass interpretation, not native Liquid Glass. The internal [design-system fixture](./design-system.html) demonstrates opaque document surfaces and limited chrome-only glass. The same semantic tokens drive light and dark modes; no Apple proprietary fonts are bundled.
