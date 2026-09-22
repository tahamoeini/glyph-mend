# GlyphMend optional companion engine

The Companion is an optional local capability runtime, not a second product and
not an AI prerequisite. The Browser remains the owner of PDF intake, MuPDF or
PDF.js extraction, OCR, provenance, confidence, review, canonical IRs,
cancellation, checkpoints, fallback decisions, and exports.

## Provider model

Companion and Browser providers share a provider-neutral capability contract.
A capability declares its id, version, provider kind, input/output schemas,
execution locations, determinism, model requirement, confidence calibration,
and privacy class.

Provider kinds are:

- `deterministic`: reproducible native or Browser logic;
- `hybrid-local`: the existing local hybrid recognition model or an adapter;
- `ml`: an optional future local model provider.

The current Browser recognition seams remain authoritative for local visual and
mathematical recognition. No model is downloaded implicitly, and no model is
required for the Browser or Companion to operate.

Provider output is `glyphmend.provider-result.v1`. It contains source region,
observations, provider metadata, optional model metadata, warnings, and
diagnostics. It is evidence only. Providers cannot directly replace
`SemanticIR`, `VisualIR`, `TableIR`, `EquationIR`, or `ChartIR`.

## Runtime and transport

The portable `glyphmend-companion` binary (built from `companion-cli`) starts a loopback-only HTTP service. Pairing
uses a single-use random code and an origin-bound bearer session. The CLI emits
a connection URL with endpoint and pairing data in the fragment and supports
`--no-open` for development and tests.

The authenticated API is:

```text
POST /v1/session
POST /v1/jobs
PUT  /v1/jobs/:id/chunks/:sequence
POST /v1/jobs/:id/complete
GET  /v1/jobs/:id/events?after=17&limit=64&waitMs=15000
GET  /v1/jobs/:id/result
POST /v1/jobs/:id/cancel
```

Events are bounded, replayable, and monotonically sequenced. The Browser uses
long polling with `after` for reconnects; WebSocket is not part of the runtime.
Jobs accept `document` or `region` input. Region jobs allow future visual,
equation, OCR, or layout providers to receive only the relevant crop and
metadata instead of a full PDF.

Input is persisted only inside the Companion-owned job directory. Chunks are
limited to 1 MiB, documents to 512 MiB, identical retries are idempotent, and
conflicting sequence reuse is rejected. Completion validates total bytes and
SHA-256. Terminal job data is retained for the configured cleanup window.

## Routing policy

The Browser runs deterministic extraction first. If a capability is uncertain,
the existing Browser-local hybrid provider is preferred. Companion is used only
when it advertises a suitable deterministic or hybrid-local capability and the
routing policy allows the input to leave the Browser process. If no provider is
available, the result remains reviewable or unresolved and deterministic output
is preserved.

The visual worker records Companion results as provider evidence when the
provider does not return a canonical VisualIR candidate. It never invents
content or silently overwrites canonical IR.

## Tauri

Tauri is an optional shell over the same service and provider contracts. Its
commands delegate to the shared JobManager for capabilities, job creation,
chunk input, completion, event polling, result retrieval, and cancellation. It
grants only `core:default`; it has no filesystem, shell, process, updater, or
broad network capability.

## Verification

```text
cd companion
cargo fmt --all -- --check
cargo clippy --workspace --exclude companion-tauri -- -D warnings
cargo test --workspace --exclude companion-tauri
cargo deny check
cd ../web-app
npm run lint
npm run typecheck
npm test
npm run build
```

Native provider selection, model licensing, model packs, and production
benchmark gates remain separate follow-up work. The first milestone must pass
with all model providers disabled.