# Rust Companion engine and API

The Rust Companion is an optional local PDF extraction engine. Users download and start it, connect from the browser, and select it for an individual job. The browser engine remains the default and is available without a Companion.

The Companion uses PDFium for native PDF text, page geometry, page objects, and rendering. Tesseract OCR is English-only in this release scope and offers Fast (default) and High Accuracy modes. Release packages bundle both the Fast and Best English model sets. The Tesseract project documents the speed/accuracy tradeoff between these model sets in its [data-file guide](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md).

## User initiated loopback connection

The browser connects only to an explicitly provided loopback endpoint. The Companion binds to loopback, checks the exact allowed web origin, and requires a one-use pairing code before issuing a session token. The browser does not send a document until the user connects and selects Companion for the job. A browser local-network permission prompt may appear; declining it leaves browser extraction available.

The API accepts PDF bytes and bounded extraction options. It rejects arbitrary local paths and remote URLs. Request size, metadata, runtime input storage, concurrent jobs, and provider execution are bounded. Cancellation is delivered to the active job. Input chunks are content-hashed and idempotent; events are replayable so a client can recover progress after a temporary disconnect.

## Versioned REST API

Protocol v1 negotiates a protocol version and Semantic Document IR version at `POST /v1/session`. Authenticated endpoints are:

```text
GET  /v1/capabilities
POST /v1/jobs
PUT  /v1/jobs/:id/chunks/:sequence
POST /v1/jobs/:id/complete
GET  /v1/jobs/:id/events?after=N&limit=128&waitMs=15000
GET  /v1/jobs/:id/result
POST /v1/jobs/:id/cancel
```

Document extraction uses the `glyphmend.document.extract.v2` capability, `inputKind=document`, PDF bytes uploaded in bounded chunks, and metadata such as `ocrAccuracy: "fast" | "high-accuracy"` and selected page numbers. Input is identified by its digest, not by a caller-supplied path or URL. Capability discovery reports engine version, supported IR version, and available OCR choices.

Results are Semantic Document IR v2 and contain per-page source geometry, text and object evidence, engine/version metadata, OCR status, and fallback details. The browser validates the IR before updating checkpoints, then uses the existing shared Markdown and DOCX exporters. The Companion cannot replace the browser's export implementation.

The wire schemas are under [`companion/schemas/`](../companion/schemas/). The shared IR schema and cross-runtime fixtures define the stable data contract.

## Failure and fallback behavior

Connection denial, missing or unsupported Companion APIs, protocol mismatch, Companion unavailability, invalid output, or an extraction failure causes the current uncommitted batch to run in the browser engine. Previously checkpointed pages are reused. User cancellation stops the Companion job and does not trigger fallback work.

## Resource and security boundaries

- Loopback endpoints only; exact-origin check and short-lived, single-use pairing.
- Session-scoped jobs and bearer authentication.
- PDF-only bounded upload; no path or URL intake.
- Per-request size, job count, storage, timeout, and concurrency limits.
- PDFium calls are safely serialized; bounded OCR and semantic processing may run concurrently.
- Progress and terminal events are available through a bounded replayable event stream.

## Release packages

Each signed archive contains the Companion executable, required PDFium and Tesseract runtime files, English Fast and Best models, third-party notices, SHA-256 checksums, and an SBOM. The manual release workflow also uploads workflow artifacts and GitHub Release assets with provenance attestations. It stops when Windows signing, or macOS signing/notarization, cannot complete.

The first release is a prerelease. Stable promotion requires repeatable, independently measured improvements by document class and no browser-only regression.
