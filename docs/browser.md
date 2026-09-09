# Browser Edition Operations Guide

## What stays local

The browser edition does not upload the selected PDF or extracted content. Processing
uses MuPDF WebAssembly and, when needed, the bundled English Tesseract OCR worker.
Resume data is stored in the browser's IndexedDB database; exporting a workspace is
an explicit user action.

## Choosing extraction settings

- Keep **OCR pages without usable text** enabled for scanned documents.
- Leave **Force OCR** off for mixed or digitally generated PDFs; it bypasses native
  text extraction and is slower.
- Start with 20 checkpoint pages. Lower it when browser memory is tight; raise it
  only after a representative run is stable.
- Keep **strict** off for exploratory runs. It records a skipped page as
  `needs-review` instead of discarding the rest of the batch.

For a fully scanned 745-page book, OCR can take many minutes. Completed batches are
checkpointed, so pausing and resuming is safe once the current page has finished.

## Reading the activity log

```text
worker-start  → browser worker is running
engine-ready  → MuPDF WebAssembly loaded
page-complete → a page was extracted and queued for its checkpoint
checkpoint-write → the batch is safely persisted
complete      → extraction and document-level cleanup finished
```

`page-error` means one selected page could not be processed. The final quality report
will be `needs-review`; inspect the source page and retry that page range after fixing
the underlying issue.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Stops after `batch-start` | Rebuild/redeploy. The current worker emits `worker-start` and `engine-ready`; if neither appears, inspect browser developer-console errors. |
| Engine startup timeout | Confirm the deployment serves `/mupdf/mupdf.js` and `/mupdf/mupdf-wasm.wasm` as static files. |
| Tesseract `importScripts` error | Rebuild/redeploy so `/tesseract/worker.min.js`, `/tesseract-core/`, and `/tessdata/` are present. |
| A new run still reports extraction version 4 | Reload the app with the browser cache bypassed or unregister the old service worker, then reopen the PDF. Current builds log extraction version 5 and invalidate older checkpoints. |
| OCR-only report has zero source visuals | Use a current version-5 build. It retains a rendered source page in the DOCX/ZIP for each OCR-only page and reports `OCR_ONLY_PAGES`; it does not claim editable reconstruction of raster tables or formulas. |
| Resume unavailable | Check browser storage permissions and available disk quota; download a workspace checkpoint before clearing site data. |
| Slow extraction | This is expected for OCR-heavy scans. Process a short range first to choose a practical checkpoint size. |

## Deployment checklist

1. Run `npm ci`, `npm test`, and `npm run build` in `web-app/`.
2. Deploy the contents of `web-app/dist/` over HTTPS.
3. Verify that the MuPDF, OCR, PDF.js WASM, and service-worker assets return HTTP 200.
4. Test one native-text PDF and one scanned PDF in the target browser.
5. Review the MuPDF AGPL/commercial licensing obligation before distributing the app.
