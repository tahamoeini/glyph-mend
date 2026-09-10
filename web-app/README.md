# GlyphMend Browser Edition

> **Faithful document reconstruction from PDF to structured Markdown.**

This is GlyphMend's primary browser-native application. It runs on the user's device without a backend, account, document upload, telemetry requirement, or Python runtime.

For operational guidance and troubleshooting, see the [browser operations guide](../docs/browser.md). For name, slogan, logo, and runtime override details, see the [branding guide](../docs/branding.md).

## Complete local workflow

- PDF.js source-page viewer.
- MuPDF WebAssembly structured extraction in a Web Worker. Text blocks, font information, images, and page geometry are retained instead of treating every visual line as a separate paragraph.
- Conservative heading, table, and editable-equation detection; repeated header/footer cleanup; wrap dehyphenation; and cross-page paragraph repair.
- Locally bundled Tesseract WebAssembly fallback for English scanned pages, with forced OCR and configurable render DPI.
- Source figures preserved as PNG assets. If an equation has no usable textual representation, source visual evidence is retained instead of silently deleting it or inventing LaTeX.
- Editable Markdown, safe rendered preview, source comparison, find, and metrics.
- Pause, cancel, resume, workspace import/export, and incremental IndexedDB checkpoints.
- Markdown, plain text, Word, quality-report, log, and complete-bundle exports.
- Native Office Math for recognized equations and embedded source visuals in DOCX.
- Timestamped activity logs plus per-page metrics and machine-readable quality gates.
- Installable PWA that works offline after the first successful load.

## Brand configuration

The browser does not hardwire its identity into extraction code. The repository-level [`../branding.json`](../branding.json) defines the default:

```json
{
  "name": "GlyphMend",
  "shortName": "GlyphMend",
  "slug": "glyph-mend",
  "cliName": "glyphmend",
  "slogan": "Faithful document reconstruction from PDF to structured Markdown.",
  "logoPath": "./brand/glyphmend-mark.svg"
}
```

Synchronize the source brand into browser assets with:

```bash
npm run brand:sync
```

That command copies the configured logo, writes `public/branding.json`, and regenerates `public/manifest.webmanifest`. It runs automatically before development, tests, preview, and production builds.

The application loads `branding.json` at runtime with a no-cache request and stores the last successful identity locally for offline fallback. As a result, a deployment may replace `dist/branding.json` and its referenced logo to change the visible name/slogan/logo without rebuilding the PDF reconstruction code. Rebuild when PWA install metadata itself must change.

## Run it

```bash
cd web-app
npm ci
npm run dev
```

The npm scripts also repair the current platform's native Rollup and esbuild packages when the same checkout is used from Windows and WSL/Linux.

Build and preview the deployable static site:

```bash
npm run build
npm run preview
```

The result is `web-app/dist/`. A local HTTP server is required because browsers restrict workers and service workers on `file://` URLs.

## Source layout

```text
src/
  app.js                    Browser state and extraction orchestration
  brand-bootstrap.js        Runtime brand initialization
  shared/brand.js           Brand loading, normalization, caching, and DOM application
  mupdf-vite.js             Build adapter for MuPDF sibling JS/WASM assets
  features/
    extraction/             OCR worker, cleanup, reconstruction, and tests
    export/                 DOCX conversion and tests
  storage/                  IndexedDB workspace persistence and tests
  shared/                   Browser utilities
  styles/                   Application styles
scripts/
  sync-brand.mjs            Source-brand → runtime/PWA synchronization
public/                     Manifest, runtime branding, logo, and static runtime assets
```

The Vite configuration deliberately copies MuPDF, PDF.js, and Tesseract runtime assets into the production build. Do not replace those paths with Vite internal `node_modules` URLs: nested browser workers must receive deployable static URLs.

Runtime branding JSON and brand assets are excluded from Workbox precaching so a deployed identity can be changed independently of the extraction bundle. The brand loader provides its own last-known-good offline fallback.

## Deployment and browser support

Deploy the contents of `dist/` as static files over HTTPS. The application uses Web Workers, WebAssembly, IndexedDB, and a service worker, so current Chromium, Firefox, and Safari releases are the practical support baseline. Private browsing, storage-restricted settings, or browser quota limits can prevent workspace resume; exports still work for the active session.

No backend endpoint is required for document processing. The selected PDF, extracted content, and optional checkpoint data remain in the browser unless the user explicitly downloads an export or imports/exports a workspace file. The runtime branding JSON is a public application asset and contains product identity only, not document data.

## Extraction contract

1. Recoverable text becomes semantic Markdown.
2. Confident equations become Markdown display math and native Word equations.
3. Images and equation-like gaps that cannot be reconstructed safely are preserved as source evidence where supported.
4. Unrecoverable content produces a visible placeholder and/or quality issue instead of being silently counted as success.

English OCR data is bundled. Tesseract is suitable for scanned prose but is not a dedicated mathematical OCR engine. Complex layouts still require review; interrupted or failed pages are represented in quality reporting rather than being presented as clean extraction.

Brython is not used because it cannot run the native PyMuPDF stack. MuPDF WASM, PDF.js, Tesseract.js, Web Workers, IndexedDB, and browser OOXML generation provide the required browser capabilities without a backend.

## Licensing

MuPDF.js is AGPL-3.0-or-later or commercially licensed by Artifex. Confirm that your deployment satisfies the applicable AGPL terms or obtain a commercial MuPDF license. Tesseract.js is Apache-2.0 and the bundled English data package is MIT licensed.

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

CI performs the browser checks and uploads the static build. Python code outside `web-app/` remains available through the canonical `glyphmend` package and the retained `pdf_sanitizer` compatibility namespace.

The end-to-end test starts a local Vite server and launches Chromium. On a new Linux machine, run `npx playwright install --with-deps chromium` once before `npm run test:e2e`; CI already performs that setup.

If you switch the same checkout between Windows and WSL, keep using the npm scripts instead of calling Vite or Vitest directly so the native dependency preflight can restore the correct Rollup/esbuild packages.
