
# GlyphMend AI Coding Agent Master Prompts

These are complete, copy/paste-ready prompts for implementing the extraction reconstruction plan. Run them as capability milestones, not as tiny isolated edits. Each prompt must inspect previous work, preserve independent progress, verify its result, and record unresolved work.

## Global execution contract for every prompt

You are a senior engineer working in the GlyphMend repository:

Repository: https://github.com/tahamoeini/glyph-mend

GlyphMend is a browser-first, local-first PDF reconstruction platform:

PDF → structured editable Markdown → editable DOCX

Before changing anything:

1. Fetch and inspect the latest remote main.
2. Inspect the current branch, working tree, recent commits, relevant pull requests, current tests, CI, and documentation.
3. Locate the existing extraction worker, MuPDF integration, cleanup pipeline, MathIR, semantic IR, Markdown exporter, DOCX exporter, OCR path, visual preservation path, and UI source of truth.
4. Do not assume an earlier prompt succeeded. Verify files, symbols, tests, and generated artifacts.
5. Diagnose the root cause before changing code.
6. Use a dedicated branch for substantial work.
7. Preserve unrelated user changes.

Non-negotiable product constraints:

- Keep browser-only operation complete and install-free.
- Keep offline and local privacy behavior.
- Do not add a backend, document upload, cloud inference, telemetry, or external AI API.
- Do not add Playwright or another heavy end-to-end test suite.
- Do not remove existing capabilities.
- Do not replace MuPDF without a verified, justified reason.
- Do not weaken confidence thresholds, sanitization, security, or tests just to obtain a passing build.
- Prefer strong evidence → reconstruct, medium evidence → review, weak evidence → preserve source.
- Every reconstructed item must retain page and position provenance.
- Keep large-PDF work bounded, cancellable, resumable, deterministic, and isolated by page where possible.
- Use the Stitch design directory as the UI source of truth when UI is touched.
- Before adding a dependency or model, document need, browser/offline compatibility, bundle and memory impact, maintenance status, and license.

At the end of every prompt:

- run the narrowest relevant tests first;
- run the existing build, type-check, lint, and test commands that apply;
- inspect the complete diff;
- update docs/remaining-work.md, or the detailed docs/upgrade/ ledger if it exists;
- state exactly what was verified;
- if anything failed, use this format:

FAILED: [prompt name]
Reason: [specific evidence]
Remaining: [what is unfinished]
Blocking: [yes/no and why]

Do not claim completion based only on code generation.

---

## Prompt 1 — Extraction architecture audit and reconstruction roadmap

You are the senior document-intelligence architect responsible for auditing GlyphMend before implementation.

Mission:

Create an evidence-based map of the current extraction pipeline and identify where information is lost between PDF input and Markdown/DOCX output. Do not implement major extraction changes in this prompt.

Inspect:

- latest main and the current PR #35 result;
- extraction worker and batch/resume/cancel behavior;
- MuPDF WASM integration and page rendering;
- raw text, spans, fonts, coordinates, images, vectors, and OCR paths;
- cleanup and normalization;
- current semantic IR and MathIR;
- Markdown and DOCX exporters;
- visual preservation and source crop logic;
- quality reports, logs, and manifests;
- tests, fixtures, CI, bundle behavior, and UI flow.

Create or update:

- docs/extraction-reconstruction-roadmap.md;
- docs/remaining-work.md.

The roadmap must contain:

1. Current architecture and data flow.
2. Information-loss points and root causes.
3. Reading-order, column, heading, paragraph, list, caption, header/footer, table, equation, figure, OCR, and export limitations.
4. The distinction between raw extraction confidence and structural correctness.
5. The target pipeline: raw extraction → layout understanding → semantic IR → reconstruction → exporters.
6. Browser-first constraints.
7. Optional Rust companion direction with shared IR and local IPC.
8. Benchmark categories and metrics.
9. A phased implementation order.
10. Explicit unresolved decisions.

For every observed failure record:

- observed behavior;
- likely root cause;
- affected module/file;
- evidence or fixture;
- recommended change;
- whether it blocks later work.

Do not fabricate findings. If a question cannot be verified from the repository, record it as unknown. Do not claim that extraction quality improved in this audit-only prompt.

Acceptance:

- A future engineer can locate each major subsystem and understand the planned migration.
- The roadmap distinguishes facts, hypotheses, and recommendations.
- The remaining-work file contains concrete unresolved items rather than vague TODOs.

---

## Prompt 2 — Implement Semantic Document IR v2

You are the senior document reconstruction engineer responsible for the central semantic contract.

Mission:

Implement a versioned Semantic Document IR v2 without breaking the current browser extraction path or exporters.

Before coding, verify the current IR and identify compatibility boundaries. Then implement the smallest coherent migration that makes the IR the shared contract for:

- raw extraction adapters;
- layout analysis;
- semantic reconstruction;
- Markdown export;
- DOCX export;
- provenance and quality reports.

The IR must represent:

Document → Pages → ordered Nodes

Supported nodes include:

- heading;
- paragraph;
- quote;
- list and list item;
- table;
- equation;
- figure;
- chart;
- caption;
- footnote;
- header/footer;
- metadata;
- unresolved visual.

Every node must support:

- stable deterministic ID;
- type;
- content or children;
- source page;
- bounding box and coordinate space;
- optional source span/object/crop IDs;
- source kind;
- extraction confidence;
- structure confidence;
- reconstruction confidence when applicable;
- export confidence;
- disposition;
- reconstruction version;
- diagnostics.

Define separate confidence dimensions. Do not retain a misleading single score as the only quality signal.

Define explicit dispositions:

- reconstructed;
- reconstructed-with-source;
- preserved-source;
- needs-review;
- unsupported;
- omitted-decoration.

Requirements:

- strong TypeScript types and runtime validation where external/worker data enters;
- deterministic serialization;
- schema versioning;
- compatibility adapter for existing structures;
- no mutation of source evidence;
- page and bounding-box provenance preserved through export;
- browser-compatible implementation;
- focused unit and serialization tests;
- fixtures for headings, paragraphs, lists, tables, equations, and figures.

Migrate one or more exporters only when the contract is stable. Do not rewrite unrelated code. If a full exporter migration is too large, leave a documented adapter and mark the exact remaining work.

Acceptance:

- IR objects can be created, validated, serialized, deserialized, and compared deterministically.
- A representative existing extraction can pass through the IR without losing text or source references.
- Existing exports remain available.
- Tests prove backward compatibility for the current supported path.

---

## Prompt 3 — Implement layout understanding and reading order

You are the senior PDF layout reconstruction engineer.

Mission:

Fix the root cause of flattened contents pages, incorrect multi-column order, broken paragraphs, and unreliable heading hierarchy.

Do not use cloud AI, replace MuPDF, or invent structure when geometry is ambiguous.

Implement a deterministic layout layer that consumes raw spans/lines/objects and produces ordered semantic candidates.

Use evidence from:

- normalized coordinates;
- baseline and vertical overlap;
- font family, size, weight, and style;
- whitespace before/after;
- indentation;
- alignment;
- line spacing;
- repeated page patterns;
- numbering;
- page margins;
- writing direction;
- vector rules and visual boundaries.

Implement or improve:

1. Span-to-line grouping.
2. Line-to-block grouping.
3. Column and gutter detection.
4. Reading order within and across columns.
5. Paragraph continuation and hyphenation handling.
6. Heading detection using numbering, style, whitespace, and context.
7. List and nested-list detection.
8. Caption linkage when evidence is strong.
9. Header/footer repetition detection.
10. Footnote and marginal-note handling where supported.
11. Diagnostics for ambiguous, merged, split, or skipped blocks.

Do not rely only on font size. Do not apply one global threshold to unrelated documents. Preserve page/bbox provenance for every candidate.

Add deterministic regression fixtures for:

- table of contents with hierarchical numbering;
- academic multi-column paper;
- business report with headers and footers;
- right-to-left or multilingual page if supported by existing infrastructure;
- mixed body and sidebar content.

Measure:

- reading-order accuracy;
- heading-level accuracy;
- paragraph-boundary accuracy;
- duplicate header/footer rate.

If a candidate cannot be classified reliably, retain the original block and mark its structure confidence low. Do not silently reorder uncertain content.

Acceptance:

- the known contents-page failure is corrected in a regression fixture;
- column order is improved without regressing single-column documents;
- headings and paragraphs retain provenance;
- diagnostics explain remaining ambiguity;
- existing large-document batching and cancellation remain intact.

---

## Prompt 4 — Implement the dedicated table reconstruction pipeline

You are the senior table-extraction engineer.

Mission:

Make table handling evidence-driven and conservative.

Do not convert every aligned text region into a Markdown table. Do not invent missing cells, values, headers, row spans, or column spans.

Implement a TableIR with:

- table bounding box;
- ordered columns and rows;
- cells;
- row and column spans where supported;
- cell text or child nodes;
- cell bounding boxes;
- cell confidence;
- table confidence;
- source references;
- detected rules/alignment;
- unresolved-cell diagnostics.

Detection should combine:

- repeated x positions;
- repeated y bands;
- text alignment;
- vector lines;
- whitespace grids;
- cell-like boxes;
- repeated row patterns;
- nearby captions.

Support the current browser-compatible deterministic path first. Evaluate any external or local library only behind a documented interface and record bundle, memory, license, and offline implications.

Export policy:

- high confidence: Markdown table where representable, otherwise structured HTML or a documented fallback;
- medium confidence: reviewable structured representation plus source crop;
- low confidence: preserve the table visual and provenance.

DOCX should use a native Word table only when the TableIR is reliable. Otherwise preserve the source evidence.

Add fixtures for:

- bordered digital tables;
- borderless tables;
- merged headers;
- numeric financial tables;
- scientific tables;
- tables split across pages;
- malformed or partially scanned tables.

Add tests for:

- cell ordering;
- merged-cell behavior;
- empty-cell policy;
- deterministic output;
- confidence gating;
- source fallback.

Acceptance:

- no fabricated values or silent cell shifts;
- table confidence reflects structure quality, not only detection;
- low-confidence tables remain visually recoverable;
- existing extraction and export behavior is not broken.

---

## Prompt 5 — Implement equation reconstruction with MathIR

You are the senior scientific document extraction engineer.

Mission:

Move equations from image-first handling toward editable Markdown LaTeX and editable DOCX equations where reliable, while preserving source evidence and never fabricating mathematics.

Use this pipeline:

PDF evidence → equation candidate → MathIR → validation → Markdown LaTeX and/or DOCX OMML → source fallback when needed.

Improve detection for:

- inline math;
- displayed math;
- fractions;
- roots;
- superscripts and subscripts;
- Greek symbols;
- operators and relations;
- matrices;
- accents and delimiters;
- equation images.

MathIR must represent mathematical structure rather than only a final string. Preserve source glyph or region references.

Implement:

- candidate detection using geometry, baseline, font and symbol analysis, and context;
- deterministic reconstruction for text-native equations where evidence supports it;
- LaTeX serialization for Markdown;
- native Word math conversion for the supported MathIR subset;
- validation and parse diagnostics;
- detection and reconstruction confidence;
- preserved source crop/image for every equation;
- explicit inline versus display mode.

If reconstruction confidence is insufficient, use preserved-source or needs-review. Do not guess missing signs, exponents, denominators, variables, or operators.

Evaluate optional local-only equation recognition only as a companion capability. Do not add a cloud API or a mandatory large model.

Add fixtures for:

- inline equations;
- display equations;
- fractions and scripts;
- Greek-heavy formulas;
- matrices;
- equations embedded as images;
- scientific PDFs with surrounding prose.

Acceptance:

- editable output is preferred when structurally supported;
- source evidence remains available after successful reconstruction;
- DOCX equations are native where the exporter supports them;
- low-confidence equations do not become plausible but incorrect formulas;
- tests validate MathIR, LaTeX, OMML, fallback, and determinism.

---

## Prompt 6 — Implement visual, figure, diagram, and chart understanding

You are the senior visual document reconstruction engineer.

Mission:

Classify and preserve visual content without inventing editable structures.

Introduce or complete VisualIR and, where justified, ChartIR. Every visual must retain:

- stable ID;
- class;
- page and bounding box;
- source asset/crop;
- confidence;
- disposition;
- reconstruction metadata;
- warnings.

Classes:

- ordinary image;
- chart;
- graph/flowchart;
- diagram;
- equation image;
- logo;
- decoration;
- separator;
- background;
- unresolved visual.

Use a vector-first strategy. Inspect native PDF paths, text, and geometry before considering image recognition.

Rules:

- ordinary images are preserved;
- diagrams become Mermaid only when nodes and edges are confidently recoverable;
- PlantUML is selective and must not replace Mermaid universally;
- SVG is a structural fallback only when generated safely;
- charts use a separate data/encoding contract and must not receive invented values;
- decorations may be omitted only when classification is reliable;
- low-confidence visuals remain preserved source evidence.

Do not generate an attractive but unsupported diagram. Do not erase the original after reconstruction.

Treat all generated Mermaid, PlantUML, SVG, Markdown, HTML, and chart specifications as untrusted data. Add sanitization, strict rendering settings, URL restrictions, size limits, and security tests.

Add fixtures for:

- vector flowcharts;
- raster diagrams;
- charts;
- ordinary images;
- academic figures;
- logos and decorations;
- mixed scanned pages;
- malicious labels and unsafe SVG content.

Acceptance:

- meaningful visuals are not lost;
- only supported structures are reconstructed;
- original and reconstructed forms are traceable;
- security tests reject active or malicious payloads;
- unsupported cases degrade to faithful visual preservation.

---

## Prompt 7 — Design and implement the optional cross-platform companion foundation

You are the senior platform architect responsible for extending GlyphMend with a safe, optional native companion.

### Mission

Design and implement the first production-quality foundation for a cross-platform Rust/Tauri companion that can later provide native, multi-threaded, memory-stable, and optional model-backed document processing. In this prompt implement the runtime boundary and its integration contract only. Do not move PDF extraction, OCR, layout analysis, semantic reconstruction, exporters, or model inference out of the browser yet.

The companion is an extension of GlyphMend, not a separate product. The browser/PWA remains the complete default product: it must stay install-free, offline-capable, private, usable on mobile, and fully functional when the companion is not installed, not running, unsupported, busy, incompatible, or explicitly declined.

### Product behavior and responsibility split

Document and capability ownership must be explicit:

The browser always owns:

- PDF intake through a user-selected `File`;
- the current browser extraction pipeline and ordinary OCR fallback;
- layout, semantic IR, provenance, confidence, cleanup, review state, and exporters;
- IndexedDB checkpoints and browser-only resume/cancel behavior;
- the complete mobile experience;
- safe fallback whenever the companion cannot be used.

The companion foundation owns only:

- a native runtime host and lifecycle;
- capability discovery and version negotiation;
- a local job protocol and bounded event stream;
- authenticated local communication with the browser or a Tauri-hosted GlyphMend UI;
- cancellation, timeout, backpressure, job isolation, and clean shutdown;
- the future provider boundary for native extraction and optional local packs;
- local diagnostics and privacy-safe logs.

Future companion capabilities may include native PDF/rendering adapters, stronger large-document memory behavior, parallel page processing, local OCR/layout/table/equation providers, and explicit offline model packs. They are not part of this prompt unless required to prove the protocol with a deterministic mock provider.

### Non-goals and hard constraints

Do not:

- make the companion a required backend or a second product;
- upload documents, extracted content, logs, or telemetry anywhere;
- add cloud inference, external AI APIs, remote model downloads, or analytics;
- silently scan ports, read arbitrary files, follow document URLs, or execute PDF JavaScript/attachments;
- accept unrestricted filesystem paths, shell commands, network URLs, or arbitrary renderer settings from a document or web page;
- duplicate the browser Semantic IR, MathIR, TableIR, VisualIR, provenance, or confidence definitions;
- add native extraction implementation to this milestone;
- add Playwright or another heavy end-to-end test suite;
- weaken the browser path, CSP, sanitization, confidence gates, or source-preservation behavior.

If a platform or packaging decision cannot be verified, record it as an explicit decision or blocker in `docs/companion-engine.md`; do not invent support.

### Required technology stack

Use a small, auditable Rust workspace with Tauri 2 as the optional application shell. Keep the protocol and engine usable without a GUI so the browser can connect to a local service and automated tests can run headlessly.

Use the current stable, mutually compatible versions available in the repository environment, pin the verified Rust toolchain, and record exact resolved versions and licenses. Do not guess versions in the prompt implementation.

Required or preferred components:

- Rust workspace with resolver 2 and a pinned `rust-toolchain.toml`;
- Rust 2021 or newer edition, selected according to the verified Tauri toolchain;
- `serde` and `serde_json` for protocol DTOs;
- `thiserror` for typed domain/protocol errors and `anyhow` only at application boundaries;
- `tokio` for the async runtime;
- `tokio-util` cancellation tokens and bounded task control;
- `uuid` for opaque request, session, and job identifiers;
- `bytes` for bounded binary chunk handling;
- `tracing` and `tracing-subscriber` for local, structured, privacy-safe diagnostics;
- `zeroize` and a cryptographically secure randomness crate for short-lived pairing secrets;
- `axum` plus `tower-http` for the browser-facing loopback HTTP/WebSocket bridge, including request limits and exact CORS handling;
- Tauri 2 and `@tauri-apps/api` only in the companion shell or its adapter, not as a required dependency of the ordinary browser build;
- Tauri capabilities/permissions with the smallest possible allowlist; do not enable a broad shell, filesystem, or process plugin;
- `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test`, and the repository’s existing browser lint/typecheck/test/build commands;
- dependency/license auditing consistent with the existing repository gates, such as `cargo-deny` or an equivalent documented check, if available.

Do not add a native PDF library, OCR engine, model runtime, or model weights in this prompt. Those choices belong to a later benchmarked capability prompt and must be independently reviewed for license, size, memory, and platform support.

### Repository structure

Use a clearly isolated top-level native area. Adapt names to the repository if an equivalent structure already exists, but preserve these boundaries:

```text
companion/
  Cargo.toml                         # workspace manifest
  rust-toolchain.toml               # verified toolchain pin
  crates/
    companion-contract/             # wire DTOs, constants, validation, errors
    companion-core/                 # capability registry, job state machine, traits
    companion-service/              # bounded task manager, cancellation, checkpoints
    companion-bridge/               # loopback HTTP/WebSocket transport and auth
    companion-cli/                  # headless local host for development/tests
  apps/
    companion-tauri/
      src-tauri/                    # Tauri 2 shell, commands, capabilities, packaging
      web/                          # only if a packaged companion UI is needed
  schemas/companion/v1/             # checked-in protocol schemas and examples
web-app/src/features/companion/
  bridge.js                          # browser adapter and state machine
  protocol.js                        # generated/validated protocol constants
  companion.test.js                  # browser-side contract and fallback tests
docs/companion-engine.md             # architecture, protocol, threat model, packaging
```

The Rust crates must not import browser UI code. The browser adapter must not import Tauri APIs on the normal web path. The Tauri shell may reuse `companion-core` and `companion-contract`, but it must not create a second implementation of the job or security rules.

### Architecture and dependency direction

Implement these layers and keep dependencies flowing inward:

1. `companion-contract`: versioned protocol types, schema identifiers, capability identifiers, size limits, error codes, and validation. It has no transport, filesystem, PDF, UI, or Tauri dependency.
2. `companion-core`: pure state machines and traits for capability providers, job lifecycle, progress, cancellation, and checkpoint metadata. It must be testable with a deterministic mock provider.
3. `companion-service`: owns bounded async jobs, concurrency limits, backpressure, cancellation propagation, page-level isolation, and local checkpoint metadata. It must never trust a client-provided path or URL.
4. `companion-bridge`: exposes the contract through a local transport, authenticates each session, validates every message, and translates transport disconnects into job cancellation or resumable failure.
5. `companion-cli`: starts the local service without a GUI and is the test/development host.
6. `companion-tauri`: packages the service and provides a user-visible lifecycle/pairing/status surface. Tauri commands call the same core/service APIs; they must not duplicate them.
7. `web-app/src/features/companion`: provides a feature-detected adapter. It must be tree-shakeable or dynamically loaded so the ordinary browser build has no required native dependency.

Define provider interfaces now, but implement only a mock/no-op provider. A future provider must receive an explicit job input and return the same versioned Semantic IR and provenance contract as the browser. It must not emit trusted HTML, SVG, Markdown, Mermaid, DOCX, or executable content directly.

### Browser and web-platform integration

Support two integration modes with one browser-facing abstraction:

#### A. Ordinary web browser/PWA

Use an explicit, user-initiated local bridge based on loopback HTTP for control and WebSocket for bounded progress/events. The companion must:

- bind only to `127.0.0.1`/`::1`, never `0.0.0.0` or a LAN interface;
- use a configurable port and expose the selected endpoint only through the companion’s local UI/CLI output or an explicit user setting;
- avoid background port scans and avoid probing the companion merely because a PDF was opened;
- require a one-time pairing flow before accepting jobs;
- enforce an exact allowlist of production and development web origins; never use wildcard CORS;
- use a short-lived pairing code to mint a scoped session token, bind the session to the browser origin, expire idle sessions, and invalidate tokens on shutdown;
- accept JSON control envelopes and bounded binary PDF chunks only after a valid session is established;
- use sequence numbers, declared lengths, maximum chunk/document sizes, backpressure, and a final digest so truncated or reordered input is rejected;
- expose no arbitrary file path. The normal web path sends bytes from the user-selected `File`; a future native file handoff must require a separate explicit user action and OS permission.

The browser adapter must expose a small interface such as:

```text
detect(): Promise<CompanionAvailability>
connect(userSuppliedEndpoint): Promise<CompanionSession>
getCapabilities(): Promise<Capabilities>
createJob(request): Promise<JobHandle>
subscribe(jobId, onEvent): Unsubscribe
cancel(jobId): Promise<void>
disconnect(): Promise<void>
```

The adapter must distinguish `unavailable`, `pairing-required`, `connected`, `busy`, `protocol-incompatible`, `security-rejected`, `timed-out`, and `failed`. It must return control to the browser pipeline immediately on any non-success state.

#### B. Tauri-hosted GlyphMend UI

When the same web application is packaged inside the optional Tauri companion, use a direct Tauri command adapter (`invoke`) instead of routing through loopback. Keep the command names and payloads mapped to the same contract and service layer. Restrict the Tauri webview origin, capabilities, filesystem scope, and commands to the minimum required set. The ordinary deployed web app must never import or require this adapter.

Keep the core platform-neutral so the Tauri shell can target Windows, macOS, and Linux first and remain eligible for Tauri 2 mobile targets later. Do not claim Android or iOS packaging is complete unless the toolchain builds and a smoke test verifies it. Mobile browser use must not depend on the companion.

### Protocol contract

Create a versioned protocol, with `v1` schemas checked into `companion/schemas/companion/v1/` and generated or validated browser constants under `web-app/src/features/companion/`. There must be one source of truth for every wire field. If the existing Semantic IR schema already has a canonical location, reference and validate that schema rather than copying it.

Every envelope must contain:

- `protocolVersion` with major/minor semantics;
- `messageType`;
- opaque `requestId` and, when applicable, `sessionId` and `jobId`;
- `engineVersion` and `irSchemaVersion` where applicable;
- a bounded payload validated against the message schema;
- a monotonic sequence number for ordered job events.

Define at least these messages:

- `hello` / `hello-ack` for protocol and origin negotiation;
- `pair` / `pair-ack` for explicit user-authorized pairing;
- `capabilities-request` / `capabilities-response`;
- `job-create` with input metadata, requested capabilities, limits, and client idempotency key;
- `job-input-chunk` and `job-input-complete` with length/sequence/digest validation;
- `job-cancel` and `job-cancelled`;
- `job-resume-request` with an opaque checkpoint identifier, never an arbitrary path;
- `job-progress`, `page-started`, `page-completed`, `page-failed`, `diagnostic`, `job-completed`, and `job-failed`;
- `error` with stable machine-readable codes and safe user-facing detail.

Define explicit compatibility behavior:

- same major protocol and supported minor range: negotiate the highest mutually supported minor;
- different major protocol: decline with `protocol-incompatible` and preserve browser operation;
- unsupported IR schema: decline the requested capability; do not silently downgrade or reinterpret nodes;
- unavailable capability: return a structured capability response and let the browser choose its existing path;
- unknown message or field: reject according to the version policy without panicking or terminating unrelated jobs.

Define a finite job state machine such as `created → receiving → queued → running → cancelling → completed|cancelled|failed`. Invalid transitions must be rejected deterministically. Jobs must be isolated so a malformed or failed page/job cannot terminate the service or corrupt another job.

Progress must be bounded and meaningful: page/job counters, phase, bytes received, and optional timing. Do not stream unbounded logs or PDF content. Cancellation must propagate within a documented latency bound, be idempotent, and leave a resumable or explicitly failed checkpoint state. Reconnects must not duplicate a completed event or silently lose the final result.

### Security and privacy model

Document the threat model and implement the following minimum controls:

- loopback-only binding and exact origin validation;
- explicit pairing with short-lived, single-use secrets and constant-time comparison;
- session expiration, revocation, request authentication, rate limits, and body/message size limits;
- strict JSON/schema validation before state changes;
- no wildcard CORS, no arbitrary redirects, no remote resource fetching, and no document-controlled network access;
- no arbitrary filesystem access, process execution, shell invocation, or path traversal;
- canonicalize and constrain any future native file/model paths to user-approved application directories;
- never log document text, PDF bytes, tokens, pairing codes, absolute user paths, or model contents;
- keep temporary input/checkpoint data in an application-owned directory with cleanup policy and clear user controls;
- do not expose service health or capability details beyond what is needed for the paired client;
- use restrictive Tauri CSP and capabilities; do not enable broad `shell`, `fs`, `process`, or updater permissions for convenience;
- treat all future native output as untrusted derived data and preserve the existing sanitization/source-evidence rules.

Add a short security review checklist and record any unresolved platform-specific issue as a release blocker rather than weakening a control.

### Implementation sequence

Work in this order and keep each step verifiable:

1. Inspect the current browser IR, checkpoint version, UI source of truth, build scripts, license gates, and existing docs. Check the worktree and preserve unrelated edits.
2. Establish the Rust workspace, toolchain pin, crate boundaries, formatting/lint/test configuration, and dependency/license report. Do not add extraction dependencies.
3. Define `companion-contract` and `v1` schemas, examples, error codes, limits, and compatibility rules. Add a browser-side validator or equivalent defensive validation.
4. Implement `companion-core` and `companion-service` with a deterministic mock provider, bounded job manager, cancellation, timeout, backpressure, event ordering, and checkpoint metadata.
5. Implement the loopback bridge with exact-origin pairing/authentication, control endpoints, WebSocket event delivery, body limits, and safe shutdown. Add a CLI host for manual and automated tests.
6. Implement the Tauri 2 shell and least-privilege capabilities. Add the direct command adapter while keeping the ordinary web build independent of Tauri.
7. Add the browser adapter, explicit connection affordance, capability/status states, timeout handling, and browser fallback. Follow the Stitch source of truth for any UI changes.
8. Write `docs/companion-engine.md` with the architecture, responsibility split, transport decision, protocol examples, lifecycle, security model, packaging matrix, known limitations, and future extraction-provider boundary.
9. Run focused Rust and browser tests, then the existing browser lint/typecheck/test/build and applicable repository checks. Inspect generated artifacts and the complete diff.

### Required tests

Add deterministic unit and integration tests without Playwright:

Protocol and compatibility:

- valid handshake and capability discovery;
- same-major minor negotiation;
- incompatible major protocol rejection;
- unsupported IR schema rejection;
- unknown/malformed messages and invalid state transitions;
- oversized payload, invalid sequence, truncated input, and digest mismatch.

Lifecycle and reliability:

- unavailable companion and connection timeout;
- explicit pairing success, expired code, wrong origin, replayed token, and revoked session;
- job creation, bounded progress, cancellation, idempotent cancellation, shutdown, and reconnect;
- page/job failure isolation and deterministic mock-provider output;
- fallback to browser with no change to browser results or IndexedDB checkpoints.

Security:

- reject non-loopback binding configuration;
- reject wildcard/unauthorized origins;
- reject arbitrary paths, URLs, shell/process requests, and path traversal;
- verify logs and errors do not contain document content, tokens, pairing secrets, or user paths;
- verify Tauri capabilities do not grant unneeded filesystem, shell, process, or network privileges.

Packaging and compatibility:

- headless CLI startup and clean shutdown;
- Tauri development/build configuration for each verified desktop target;
- ordinary `web-app` build/test/typecheck/lint without Tauri installed;
- protocol schema and generated browser artifact consistency;
- dependency/license/security checks pass or are recorded with a specific blocker.

### Required documentation and acceptance criteria

Create or update:

- `docs/companion-engine.md`;
- `docs/remaining-work.md` or the applicable `docs/upgrade/` ledger;
- repository build/license/security documentation when new commands or dependencies are introduced.

The prompt is complete only when all of the following are true:

- browser-only extraction remains the default and behaves unchanged when no companion exists;
- the companion can start headlessly, advertise capabilities, pair explicitly, negotiate versions, accept a bounded mock job, emit ordered progress, cancel safely, and shut down cleanly;
- ordinary web mode uses the authenticated loopback bridge and packaged Tauri mode uses direct commands over the same contract;
- no remote service, telemetry, implicit download, arbitrary path, or unrestricted native privilege exists;
- Semantic IR and provenance remain single-source/versioned and cannot silently diverge;
- protocol, security, fallback, lifecycle, and packaging behavior are tested and documented;
- no extraction logic or model pack was moved prematurely;
- exact verification commands, results, unresolved decisions, and any failure are recorded.

At the end of this prompt:

1. Run the narrowest relevant tests first, then all applicable existing checks.
2. Inspect the complete diff and generated files.
3. Update the remaining-work ledger.
4. Report what was actually verified. If anything failed, use:

```text
FAILED: Create the optional cross-platform companion foundation
Reason: [specific evidence]
Remaining: [unfinished work]
Blocking: [yes/no and why]
```
---

## Prompt 8 — Evaluate and integrate optional local extraction packs

You are the senior local document-processing engineer.

Mission:

Evaluate lightweight local OCR, layout, table, visual, and equation capabilities for the optional companion. Add only capabilities justified by benchmarks, licensing, memory, and offline requirements.

Candidate categories may include:

- lightweight ONNX inference;
- local OCR;
- layout analysis;
- table structure recognition;
- mathematical recognition;
- visual classification.

Do not assume a model or library is suitable. For every candidate record:

- exact version;
- code license;
- model-weight license;
- redistribution and commercial-use implications;
- model size;
- memory use;
- CPU/GPU requirements;
- startup and inference time;
- supported languages and layouts;
- offline installation behavior;
- maintenance risk;
- benchmark result;
- fallback behavior.

Use the provider/capability interface so the browser path does not depend on the model. Heavy models must be optional packs. Never download a model implicitly because a PDF requests it. Do not ship an unreviewed model or unclear license.

Implement capability negotiation:

- browser: basic extraction;
- companion core: native extraction;
- optional pack: advanced capability.

All providers must produce the same Semantic IR and the same provenance contract. Failures must be isolated by region/page and fall back to the lower capability tier or source evidence.

Acceptance:

- core browser extraction works without packs;
- companion without packs works;
- optional packs are explicit, versioned, and offline-capable after installation;
- licensing and performance are documented;
- no cloud or external API is introduced;
- benchmarks show where the pack helps and where it does not.

---

## Prompt 9 — Build the deterministic benchmark and regression system

You are the senior QA and document-intelligence engineer.

Mission:

Create a lightweight, deterministic extraction benchmark that catches regressions without Playwright.

Create or standardize fixtures under:

- tests/fixtures/documents/academic;
- business;
- scanned;
- multilingual;
- tables;
- equations;
- figures;
- mixed-layout;
- security.

Use only fixtures whose rights and storage are acceptable. Record provenance and expected outputs.

Measure separately:

Text:
- character error rate;
- word error rate;
- Unicode and punctuation preservation.

Structure:
- block alignment;
- reading-order accuracy;
- heading hierarchy;
- paragraph grouping;
- list recognition;
- header/footer separation.

Tables:
- table detection;
- row/column/cell structure;
- merged-cell behavior;
- TEDS or an appropriate structural metric.

Equations:
- token or LaTeX similarity;
- parse validity;
- structural MathIR accuracy;
- native DOCX math result where applicable.

Visuals:
- preservation rate;
- source-crop correctness;
- reconstruction correctness where a gold structure exists.

Exports:
- deterministic Markdown;
- Markdown validity;
- DOCX generation;
- visual diff or structural checks where practical;
- bundle manifest consistency.

Performance:
- throughput;
- peak memory where measurable;
- cancellation latency;
- recovery/resume behavior;
- browser bundle and optional-pack size.

The benchmark must distinguish intentional fixture updates from regressions. Do not rewrite goldens simply to make a failing test pass. Keep CI lightweight and deterministic.

Acceptance:

- focused extraction tests run in CI;
- reports identify which layer failed;
- representative fixtures cover known PR #35 and reconstruction failures;
- benchmark output is reproducible;
- no heavy browser automation is added.

---

## Prompt 10 — Final production-hardening review and release gates

You are the senior engineering reviewer responsible for finalizing the GlyphMend upgrade.

Review all previous work from current main and the relevant branches. Do not assume any prompt succeeded.

Audit:

- raw extraction;
- layout and reading order;
- Semantic IR v2;
- MathIR, TableIR, VisualIR, and ChartIR;
- provenance and confidence;
- Markdown and DOCX exporters;
- visual fallback;
- large-PDF memory behavior;
- batching, cancellation, resumability, and page-level isolation;
- browser-only operation;
- optional companion detection and fallback;
- optional model packs;
- offline behavior;
- security and sanitization;
- dependency/model licensing;
- tests, CI, and documentation;
- the full UI against research/stitch_glyphmend_desktop_interface_design if UI changed.

Run representative workflows:

1. clean text-native PDF;
2. 745-page or similarly large PDF;
3. scanned PDF requiring OCR;
4. table-heavy document;
5. inline and display equations;
6. vector flowchart;
7. raster diagram;
8. chart;
9. multilingual or RTL document;
10. malformed page to verify isolation;
11. malicious reconstruction/security fixture;
12. browser-only run without companion or model packs;
13. companion unavailable or protocol mismatch;
14. Markdown and DOCX export;
15. reconstructable bundle export.

Verify invariants:

- no document upload or cloud inference;
- no required backend;
- no Playwright;
- browser version is not degraded;
- deterministic output where configured;
- source references survive every export path;
- low confidence preserves evidence;
- no fabricated math/table/chart values;
- cancellation and resume do not corrupt state;
- generated active formats are sanitized;
- no unresolved critical licensing blocker is hidden.

Create docs/production-readiness-report.md containing:

- verified capabilities;
- evidence and commands;
- performance baseline and delta;
- known limitations;
- security status;
- licensing status;
- migration and rollback notes;
- release blockers;
- future work.

Review the complete diff and repository status. Keep unresolved work visible. If any critical gate fails, report:

FAILED: Final production-hardening review
Reason: ...
Remaining: ...
Blocking: yes

Do not declare the product production-ready when the evidence only shows that it builds.

---

## Recommended order

Run the prompts in this order:

1. Audit and roadmap.
2. Semantic IR v2.
3. Layout and reading order.
4. Tables.
5. Equations.
6. Visuals.
7. Benchmark and regression framework.
8. Companion foundation.
9. Optional local packs.
10. Final hardening review.

Run the benchmark prompt early enough to establish a baseline, even if its full fixture corpus grows after the first extraction improvements. Run licensing and security checks before accepting any new model, renderer, or active output format.

The browser engine is the primary release. The companion and advanced packs are additive capabilities and must never be allowed to become hidden dependencies.
