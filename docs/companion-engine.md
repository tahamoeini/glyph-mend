# GlyphMend optional companion engine

## Status and ownership

The companion is an optional local runtime, not a backend or a second product.
The browser continues to own selected `File` intake, MuPDF/PDF.js extraction,
OCR, Semantic Document IR, provenance, confidence, review, IndexedDB
checkpoints, cancellation, exports, mobile use, and every fallback decision.
The only implemented companion capability is `glyphmend.diagnostic.mock.v1`.
It is diagnostic-only and is never requested by browser extraction.

The companion owns lifecycle, protocol negotiation, paired local transport,
bounded jobs, cancellation, local checkpoint metadata, and privacy-safe logs.
Future providers receive explicit bytes and may return only a bounded,
version-tagged `glyphmend.semantic-document-ir` v2 artifact; the browser's
existing canonical validator remains the source of truth. Providers may not
emit trusted HTML, SVG, Markdown, Mermaid, DOCX, executable content, paths,
URLs, shell commands, or renderer options.

## Architecture and protocol

`companion-contract` is transport-free DTOs, limits, errors, and negotiation.
`companion-core` contains the finite job state machine and provider trait.
`companion-service` owns bounded job/event lifecycle. `companion-bridge` is
the local HTTP/WebSocket adapter, while `companion-cli` is the headless host.
The Tauri shell delegates to the same service rather than reimplementing it.

The checked-in v1 envelope requires protocol version, message type, opaque
request ID, optional session/job IDs, engine version, optional IR schema
version, sequence, and bounded payload. Same-major peers negotiate the lower
minor version. Different majors return `protocol-incompatible`; unsupported IR
versions return `ir-schema-unsupported`; unknown fields/messages are rejected.

The service accepts only the ordered flow `created → receiving → queued →
running → cancelling → completed|cancelled|failed`. Input chunks are at most
1 MiB, ordered, length-declared, capped at 512 MiB per document, and finalized
with SHA-256. Events are bounded to 128 per job. The mock accepts a bounded job
and emits deterministic page start/progress/completion events only.

## Local transport and security

The bridge binds only `127.0.0.1` or `::1`; LAN bindings fail. It has no port
scan or automatic discovery. The browser calls it only after a user explicitly
enters a loopback endpoint and pairing code. Control is JSON over HTTP; input
is bounded binary HTTP chunks; progress is a paired WebSocket stream.

Pairing codes are generated from OS randomness, 128 bits, single-use, and
expire after five minutes. Pairing uses constant-time comparison and zeroizes
the retained secret. A paired session is origin-bound, token-authenticated,
kept only in memory, expires after 15 idle minutes, and is revoked at shutdown.
The bridge rate/size limits requests, validates origin before state changes,
and never logs source text, bytes, secrets, tokens, or user paths.

Approved origins are the exact current production origin
`https://glyphmend.negar.team` and listed local development origins. A future
production origin requires an explicit local user approval in the companion UI
or CLI; there is no wildcard CORS, remote configuration, telemetry, document
upload, remote resource fetch, or model download. The browser CSP permits only
loopback HTTP hosts with a user-selected port. This exception is necessary for
the explicit configurable local endpoint and does not enable automatic probing.

Temporary data must stay under an application-owned companion directory,
cleaned on cancel/completion or checkpoint expiry (24 hours). A future native
file handoff is out of scope and must require a separate user action plus OS
permission.

## Packaged Tauri mode

The `apps/companion-tauri` shell exposes only capabilities, create-job, and
cancel-job commands. It grants `core:default` only: no filesystem, shell,
process, updater, or broad network plugin. Its CSP is local-asset-only.
The packaged web adapter must inject a narrow `globalThis.GlyphMendCompanion`
surface; only that adapter imports `@tauri-apps/api`. The ordinary browser build
has no Tauri dependency and dynamically imports only its browser bridge when a
user requests connection.

## Verification and release blockers

The workspace pins Rust 1.97.0. Resolved direct dependencies are recorded in
`companion/Cargo.lock`; `deny.toml` is the license/advisory policy. Run:

```text
cd companion
cargo fmt --check
cargo clippy --workspace --exclude companion-tauri -- -D warnings
cargo test --workspace --exclude companion-tauri
cargo deny check
cd ../web-app
npm run lint && npm run typecheck && npm test && npm run build
```

This environment resolved the lockfile but cannot compile Rust or Tauri because
the MSVC linker `link.exe` is absent. Windows build, WebView2 smoke test,
macOS signing/WebKit smoke test, Linux WebKitGTK smoke test, and all mobile
claims are release blockers until run on their actual supported targets.

Security review before release: verify loopback-only bind; exact allowed origin;
pair replay/expiry/revocation; body/message limits; digest/sequence rejection;
redacted logs; cleanup; no arbitrary path/URL/process interface; least-privilege
Tauri capability file; and browser fallback with no checkpoint changes.
