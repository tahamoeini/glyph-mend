# Active roadmap

This is the sole active project backlog. Items describe unresolved work; completed work belongs in release notes or the historical archive.

## NOW

### GM-QUAL-001 — Establish an independently licensed benchmark corpus

- **Problem:** The extraction pipeline lacks a representative, versioned corpus with defensible layout, reading-order, equation, table, OCR, and fidelity measurements.
- **Impact:** Regressions and quality trade-offs cannot be measured consistently before enabling more providers.
- **Dependencies:** Fixture selection, source permissions, corpus policy, and stable metric definitions.
- **Acceptance criteria:** Publish a small reproducible corpus and evaluation command; report per-task and aggregate metrics; document excluded/private data; establish reviewable release thresholds.

### GM-CORE-002 — Measure long-document time, memory, and checkpoint recovery

- **Problem:** Large-document resource budgets and interrupted-run recovery lack repeatable performance evidence.
- **Impact:** Users cannot predict whether large jobs complete reliably on ordinary hardware.
- **Dependencies:** GM-QUAL-001; representative large documents; supported hardware profile.
- **Acceptance criteria:** Record wall time, peak memory, browser storage, and checkpoint recovery across representative page counts; publish budgets and a repeatable profiling procedure.

### GM-RECON-001 — Improve reading order and preserve raw evidence under uncertainty

- **Problem:** Complex columns, mixed writing directions, and ambiguous visual structure can still lose ordering or provenance.
- **Impact:** Incorrect structure is more damaging than a clearly unresolved result.
- **Dependencies:** GM-QUAL-001 and explicit source-evidence fixtures.
- **Acceptance criteria:** Add measurable multi-column and multilingual fixtures; keep source coordinates and unresolved evidence through review; meet the agreed reading-order threshold without silently inventing structure.

## NEXT

### GM-RECON-002 — Build equation, table, and multilingual OCR ground truth

- **Problem:** Equation, table, and language-specific OCR quality is not supported by enough labeled examples.
- **Impact:** Recognition changes cannot be compared reliably across scripts and document types.
- **Dependencies:** GM-QUAL-001; licensing and annotation policy.
- **Acceptance criteria:** Add versioned labeled fixtures for equations, merged/sparse tables, and supported language combinations; publish task-specific scores and known limitations.

### GM-COMP-001 — Add a capability router and evidence reconciler

- **Problem:** Companion is a diagnostic runtime and provider seam; the main extraction pipeline has no active policy for selecting it or reconciling provider evidence.
- **Impact:** Optional providers cannot improve extraction safely until evidence can be compared with deterministic output.
- **Dependencies:** GM-QUAL-001, GM-RECON-001, bounded capability-specific schemas, and explicit privacy policy.
- **Acceptance criteria:** Route only selected uncertain regions; keep deterministic evidence available; reject incompatible or malformed provider payloads; produce auditable decisions and preserve reviewable output on provider failure.

### GM-COMP-002 — Benchmark visual classification before selecting a provider

- **Problem:** No first model or native provider has been selected against an agreed quality and resource baseline.
- **Impact:** Provider choice could add complexity without measurable benefit.
- **Dependencies:** GM-COMP-001, GM-QUAL-001, model and dataset license review.
- **Acceptance criteria:** Compare a bounded visual-classification task against deterministic/browser baselines; publish false-positive rate, latency, memory, exact model revision and hashes, and applicable licenses; reject the provider if thresholds are missed.

## LATER

### GM-ML-001 — Evaluate explicit local model packs

- **Problem:** Optional local models need a reproducible install, verification, compatibility, and rollback contract.
- **Impact:** A well-scoped model could improve uncertain cases without making the service dependent on a backend.
- **Dependencies:** GM-COMP-002 and license approval.
- **Acceptance criteria:** Models require explicit user installation; verify revision and SHA-256; declare memory, runtime, and license requirements; never download because a PDF was opened.

### GM-QUAL-002 — Add selected browser/Python conformance fixtures

- **Problem:** Browser and Python editions are separate implementations and may differ on shared fixtures.
- **Impact:** Users need predictable behavior when switching editions.
- **Dependencies:** Stable, shared, licensed fixtures from GM-QUAL-001.
- **Acceptance criteria:** Run selected fixtures through both editions and publish normalized differences for Markdown, page ordering, and preserved source evidence.

### GM-DESK-001 — Reassess the optional Tauri shell

- **Problem:** The native shell adds packaging and support cost while the portable Companion CLI is the current runtime.
- **Impact:** A measured decision prevents maintaining a second distribution path without user value.
- **Dependencies:** User feedback, packaging cost, and validated Companion capability value.
- **Acceptance criteria:** Record adoption evidence and support cost; keep, simplify, or retire the shell with a documented decision.

## BLOCKED

### GM-REL-001 — Decide project and dependency licensing for public release

- **Problem:** The licensing posture for project distribution and dependencies, including MuPDF/PyMuPDF terms, has not been decided.
- **Impact:** This is a public-release blocker and may constrain distribution, packaging, and supported editions.
- **Dependencies:** Maintainer/legal review of project, dependency, model, and dataset terms.
- **Acceptance criteria:** Publish a reviewed licensing decision and notices for every distributed artifact; document any commercial or copyleft obligations before public release.

### GM-REL-002 — Prepare signed, verifiable Companion distribution

- **Problem:** Cross-platform builds alone do not provide signed binaries, release checksums, or a software bill of materials.
- **Impact:** Users cannot verify publisher identity or artifact integrity.
- **Dependencies:** GM-REL-001 and a validated first useful Companion capability.
- **Acceptance criteria:** Publish signed binaries, SHA-256 checksums, notices, and an SBOM for supported platforms; document browser-to-loopback compatibility.

## WON’T DO

### GM-SCOPE-001 — Use Companion as a second document extraction engine or autonomous agent

- **Problem:** Duplicating document parsing and canonical reconstruction in Companion would create conflicting sources of truth.
- **Impact:** It would weaken deterministic output, provenance, and browser-first operation.
- **Dependencies:** None.
- **Acceptance criteria:** Companion remains an optional local capability runtime; the Browser/Python editions retain document intake, reconstruction policy, canonical IR, review, and export ownership.

### GM-SCOPE-002 — Download models automatically when a document is opened

- **Problem:** Implicit model downloads surprise users and can violate storage, bandwidth, privacy, or licensing expectations.
- **Impact:** User-controlled installation preserves predictable local processing.
- **Dependencies:** None.
- **Acceptance criteria:** Any future model acquisition requires an explicit user action and reports exact size, revision, hash, and license before installation.
