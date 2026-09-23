# GlyphMend architecture and repository layout

## Product boundary

The browser platform is the complete default product. It owns PDF intake, resumable workspace storage, extraction settings, review, Semantic Document IR v2 validation, and Markdown/DOCX exports. The optional Rust Companion is a locally running extraction engine selected for an individual job. It returns the same versioned IR, including engine/version metadata and per-page fallback details.

The browser can complete an extraction without a Companion. Connection denial, unsupported APIs, an unavailable Companion, or a failed Companion job falls back to the browser engine unless the user cancelled the job.

## Data flow

```text
PDF bytes in browser
  → selected engine for this job
      ├─ Browser: MuPDF WASM + browser OCR
      └─ Companion: loopback API → PDFium + English Tesseract OCR
  → validate Semantic Document IR v2
  → browser checkpoint and review state
  → shared Markdown renderer
  → shared DOCX exporter
```

The Companion is contacted only after a user connects it and chooses it for a job. Requests contain PDF bytes and bounded extraction options. The API rejects paths and remote URLs; it accepts only the local PDF payload.

## Top-level layout

```text
branding.json              Product identity and browser configuration
brand/                     Source brand assets
web-app/                   Complete browser platform and exports
companion/                 Rust loopback API, PDF extraction, packaging, schemas
docs/                      Current product and operations documentation
docs/archive/              Historical upgrade and roadmap records
research/archive/          Archived research
.github/workflows/         Browser CI, Companion CI, and manual Companion release
```

## Browser platform

`web-app/src/app.js` owns the interface and job orchestration. Browser extraction runs in bounded page batches, commits completed pages to IndexedDB, and uses the shared Semantic Document IR v2 validation and export path. The browser engine remains usable offline after the application and its bundled OCR runtime are available.

## Rust Companion

The Rust workspace contains the loopback bridge, bounded job service, shared protocol contracts, and portable executable. PDFium calls are serialized through the thread-safe binding. OCR and semantic work are bounded and can run concurrently. The Companion uses bundled English Fast and Best Tesseract data in release packages.

The connection is user initiated and bound to an exact web origin and a one-use pairing code. Endpoints are loopback-only, session authenticated, size limited, and time bounded. See [the Companion API guide](companion-engine.md).

## Checks and releases

- `web-app.yml`: browser tests, static build, and dependency checks.
- `companion.yml`: Rust checks and browser-to-Companion contract checks.
- `companion-release.yml`: manual, versioned, signed Companion packages, SBOM, checksums, attestations, and GitHub Release assets.

The first Companion publication must be a prerelease. The release workflow blocks public assets when required platform signing credentials are unavailable or signing/notarization fails. Benchmark and licensing decisions remain visible in the [roadmap](roadmap.md).
