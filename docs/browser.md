# GlyphMend browser operations guide

> **Faithful document reconstruction from PDF to structured Markdown.**

## Browser-only privacy boundary

In browser-only mode, the selected PDF and extracted content stay in the browser. Processing uses MuPDF WebAssembly and, when needed, the bundled Tesseract OCR worker. OCR models for English, Russian, Persian, and Simplified Chinese run locally. Resume data is stored in the browser's IndexedDB database; exporting a workspace is an explicit user action. If the user launches the installed GlyphMend app in `--headless-companion` mode, pairs it, and selects its engine, the browser sends that job's PDF bytes to the loopback service; see the [Companion guide](companion-engine.md). No remote extraction service is used.

## Branding at runtime

The browser reads `branding.json` at startup and applies the configured product name, slogan, and logo to the shell. Run `npm run brand:sync` from the repository root to copy the brand definition and logo into the browser public assets and regenerate PWA metadata.

A deployed build can replace its runtime `branding.json` and referenced logo without rebuilding the extraction code. The app stores the last successfully loaded brand as an offline fallback. If the installable PWA name or install icon changes, run the brand sync and rebuild because those values live in manifest metadata.

See [branding.md](branding.md) for the full configuration contract.

## Browser updates and checkpoint compatibility

The deployed PWA registers its service worker in auto-update mode. Publishing a new browser build is a separate deployment step; the GitHub workflow only uploads a build artifact. The development server unregisters existing service workers and related caches on localhost.

The application compares saved checkpoints with its extraction version and invalidates incompatible results when extraction behavior changes. The current extraction version is 14. Export important workspace data before a release that changes extraction behavior; the exported workspace can be imported again after the update. A routine UI or dependency update does not by itself require an extraction-version bump.

## Choosing extraction settings

- Keep **OCR pages without usable text** enabled for scanned documents.
- **English + Persian (mixed)** is the default under **OCR language**, so scans containing both scripts are recognized together; line order follows the dominant script in each row. Choose a single language for single-language documents. The paired model takes longer to load and uses more memory than a single-language run.
- Leave **Force OCR** off for mixed or digitally generated PDFs; it bypasses native text extraction and is slower.
- Start with 20 checkpoint pages. Lower it when browser memory is tight; raise it only after a representative run is stable.
- Keep **strict** off for exploratory runs. It records a skipped page as `needs-review` instead of discarding the rest of the batch.

For a fully scanned long book, OCR can take substantially longer than native-text extraction. Completed batches are checkpointed, so pausing and resuming is safe after the current page operation completes. A startup failure leaves the document open and existing checkpoints intact; start extraction again manually after addressing the reported phase. Startup failures are not retried automatically.

## Reading the activity log

```text
worker-start      → browser worker is running; includes worker-boot elapsed time
engine-loading    → MuPDF WebAssembly initialization started
engine-ready      → MuPDF WebAssembly loaded; includes initialization elapsed time
page-complete     → a page was extracted and queued for its checkpoint
checkpoint-write  → the batch is safely persisted
complete          → extraction and document-level cleanup finished
```

`page-error` means one selected page could not be processed. The final quality report becomes `needs-review`; inspect the source page and retry the relevant range after fixing the underlying issue.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Stops after batch-start | Rebuild/redeploy. Use the last activity stage (worker-boot or mupdf-load) and browser console/network errors to identify where startup stopped. |
| Worker boot timeout (worker-boot) | The extraction worker did not report worker-start within 30 seconds. Inspect browser console errors and available memory. The open document and checkpoints remain available for a manual retry. |
| MuPDF startup timeout (mupdf-load) | MuPDF did not initialize within 90 seconds after worker-start. In the Network panel, verify mupdf.js, mupdf-wasm.js, and mupdf-wasm.wasm return HTTP 200 under /mupdf/; the WASM response must use application/wasm. A loader rejection reports the same phase and elapsed time. |
| Tesseract `importScripts` error | Rebuild/redeploy so `/tesseract/worker.min.js`, `/tesseract-core/`, and `/tessdata/` are present. |
| A run reports an extraction version below 14 | Reload with browser cache bypassed or unregister the old service worker, then reopen the PDF. The current restoration branch uses extraction version 14 and invalidates incompatible older browser checkpoints. |
| OCR-only output needs review | Confirm the current build is loaded and keep **Preserve visual content** enabled. Parsed formula candidates export as editable LaTeX/Word math; uncertain formulas retain their source crop for comparison. |
| Brand changes do not appear | Confirm `branding.json` and the configured logo path are deployed, then reload. Run `npm run brand:sync` before rebuilding PWA metadata. |
| Resume unavailable | Check browser storage permissions and available disk quota; export a workspace checkpoint before clearing site data. |
| Slow extraction | Expected for OCR-heavy scans. Process a short representative range first to choose a practical checkpoint size. |

## Deployment checklist

1. From the repository root, run `npm ci` and `npm run build:web`. To run the browser suite locally, use `npm test`. GitHub Actions has no automatic push or pull-request trigger: select `quick` for the test-free checks, or `full` to run the browser and native test suites manually. The build verifies the three copied MuPDF files, checks that the service worker precaches them, and fetches them from a local production preview.
2. Deploy over HTTPS. For the current Cloudflare Pages project, use `web-app` as the project root and `dist` as the build output; keep Pages Functions under `web-app/functions/`. A static upload of `web-app/dist/` does not include the PostHog proxy Function.
3. Verify `branding.json`, the configured logo, MuPDF, OCR, PDF.js WASM, and service-worker assets return HTTP 200.
4. Test one native-text PDF and one scanned PDF in the target browser. Confirm the MuPDF requests succeed and extraction reaches engine-ready.
5. Test the configured name/slogan/logo online, then reload offline to verify the cached-brand fallback.
6. Review the MuPDF AGPL/commercial licensing obligation before distributing the app.
