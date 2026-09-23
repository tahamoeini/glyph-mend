# Optional Companion diagnostic runtime

Companion is a diagnostic layer and provider integration seam. It is not an active extraction accelerator: the Browser's primary extraction flow does not send work to Companion. The Browser remains responsible for PDF intake, extraction, OCR, provenance, review, canonical IR, checkpoints, fallback decisions, and exports. Companion does not parse documents or own canonical reconstruction.

## Current capability

The current runtime advertises a deterministic diagnostic capability. It validates pairing, binary job input, provider boundaries, job lifecycle, and result transport. Its output is diagnostic evidence only and does not change extracted document content. No machine-learning model is included or required.

`glyphmend.provider-result.v1` is a bounded provider envelope containing source region, observations, provider metadata, optional model metadata, warnings, and diagnostics. Providers cannot directly replace `SemanticIR`, `VisualIR`, `TableIR`, `EquationIR`, or `ChartIR`. Capability-specific result payloads, a capability router, and an evidence reconciler are planned for a later phase.

## REST v1 and pairing

REST is the only active wire protocol. Legacy `Envelope` and `MessageType` message schemas are retired. A client posts its supported protocol version and IR schema version to `POST /v1/session`; the server stores the highest mutually supported minor version within protocol major 1. A protocol-major mismatch returns `protocol-incompatible`; an IR mismatch returns `ir-schema-unsupported`. Pairing is single-use, and the bearer session is bound to the exact allowed web origin.

The CLI defaults to the GlyphMend web origin and accepts `--web-origin https://example.invalid` to select one exact `http` or `https` origin. Paths, queries, credentials, wildcards, and non-HTTP schemes are rejected. The emitted pairing secret is placed in the URL fragment so it is not sent to the host; the Browser removes it from the address bar immediately after reading it and clears manual pairing input after use.

Authenticated endpoints are:

```text
GET  /v1/capabilities
POST /v1/jobs
PUT  /v1/jobs/:id/chunks/:sequence
POST /v1/jobs/:id/complete
GET  /v1/jobs/:id/events?after=N&limit=128&waitMs=15000
GET  /v1/jobs/:id/result
POST /v1/jobs/:id/cancel
```

The independent request/response schemas and error behavior are in [`companion/schemas/companion/v1/`](../companion/schemas/companion/v1/protocol.json). Protocol minor negotiation, limits, event replay, and errors are part of the REST contract.

## Input, result, and resource limits

Region input uses `glyphmend.region-input.v1` metadata: page number, four finite bounding-box coordinates, source IDs, and a deterministic summary. The crop is uploaded as binary data, in chunks no larger than 1 MiB. Control requests are limited to 64 KiB in the HTTP bridge; Tauri commands apply the same field and chunk limits through the shared service contract.

Limits include 512 MiB per job, 8 active jobs and at most 2 running providers, 1 GiB aggregate runtime input storage, and 512 MiB per session. Provider results allow at most 256 observations, 64 warnings, 16 KiB metadata, 32 KiB diagnostics, 128-byte identifiers, and 64 KiB for a complete response. Bounding boxes have exactly four finite coordinates; confidence is between 0 and 1; SHA-256 values are 64 hexadecimal characters. Provider execution is bounded to five minutes and runs in Tokio's blocking pool, with cancellation delivered through a token.

The runtime stores inputs under a dedicated Companion directory with restricted directory permissions and removes abandoned jobs after 30 minutes through periodic cleanup. Startup removes stale instance data. Repeating job creation with the same session, idempotency key, and request returns the existing job; a changed request returns HTTP 409. Repeating input completion with the same digest and byte count is accepted. Jobs are visible only to their creating session.

Event pages report `earliestSequence` and `historyTruncated`. A cursor older than retained history returns HTTP 409 `event-history-gap`, including the earliest available sequence. Clients should restart from that point. Browser abort signals also cancel active long polls and signal provider job cancellation.

## Tauri

Tauri remains an optional shell over the shared `JobManager`; the portable CLI is the current runtime entry point. Tauri commands use a local session identity and the same job, chunk, completion, result, event, and cancellation contract.

## Verification

The Companion workflow runs formatting, Clippy, Rust tests, `cargo deny`, and a browser-client-to-runtime diagnostic E2E on Windows, Linux, and macOS. The end-to-end job covers pairing, version and IR errors, chunked upload and retries, idempotent creation, event-history recovery, result retrieval, request limits, long-poll cancellation, and job cleanup.

No public-release licensing determination is made in this phase. The licensing decision remains a public-release blocker tracked in the [active roadmap](roadmap.md).
