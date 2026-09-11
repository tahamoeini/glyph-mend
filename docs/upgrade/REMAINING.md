# Remaining work ledger

Append-only unresolved-work ledger for GlyphMend upgrade prompts.

## Entry schema

Each unresolved item must use this schema:

```md
## GM-UPG-<unique-id> — <short title>
- Detected in step: <step number/name>
- Date:
- Status: OPEN | BLOCKED | DEFERRED | FAILED | RESOLVED
- Severity: critical | high | medium | low
- Area:
- Dependency:
- Description:
- Evidence:
- Files / symbols involved:
- What was attempted:
- Why it remains:
- Recommended next action:
- Safe to continue unrelated work: yes | no
- Resolution note:
```

Never delete old entries. Mark resolved work as `RESOLVED` and add a resolution note instead of removing history.

## GM-UPG-001 — OCR e2e baseline fails in local Tesseract path
- Detected in step: Step 01 baseline audit
- Date: 2026-09-11
- Status: OPEN
- Severity: medium
- Area: browser / OCR / e2e
- Dependency: local Tesseract pipeline and OCR assets in web-app
- Description: The baseline Playwright OCR test times out because the extraction worker transitions to `Extraction worker failed` instead of completing OCR successfully.
- Evidence: `npm run test:e2e` failed in [web-app/tests/ocr-baseline.spec.js](web-app/tests/ocr-baseline.spec.js) with `#statusText` showing `Extraction worker failed`.
- Files / symbols involved: [web-app/tests/ocr-baseline.spec.js](web-app/tests/ocr-baseline.spec.js), [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js), [web-app/src/app.js](web-app/src/app.js)
- What was attempted: Installed browser dependencies, reran browser unit tests and the browser build, then executed the OCR e2e baseline.
- Why it remains: The local OCR path still fails under the e2e baseline, but the exact worker-side cause was not isolated in this step.
- Recommended next action: Inspect the OCR worker logs and asset loading path for the Tesseract baseline sample before changing OCR behavior.
- Safe to continue unrelated work: yes
- Resolution note: Unresolved.

## GM-UPG-002 — Worker capability memory/performance unknowns
- Detected in step: Step 04 capability/worker architecture
- Date: 2026-09-11
- Status: OPEN
- Severity: medium
- Area: browser / workers / performance
- Dependency: math-worker and visual-worker capability shells
- Description: The new worker-capability abstraction has not yet been stress-tested with large documents, cancellation storms, or concurrent worker initialization.
- Evidence: Step 04 introduced a shared protocol and shells, but no runtime profiling or memory ceiling measurements were collected.
- Files / symbols involved: [web-app/src/shared/recognizer-capability.js](web-app/src/shared/recognizer-capability.js), [web-app/src/features/recognition/math-worker.js](web-app/src/features/recognition/math-worker.js), [web-app/src/features/recognition/visual-worker.js](web-app/src/features/recognition/visual-worker.js)
- What was attempted: Added worker shells, cancellation, and failure envelopes with unit tests.
- Why it remains: The performance envelope for heavy local recognition is still unknown.
- Recommended next action: Measure worker memory usage and responsiveness with representative local documents before routing real math/visual recognition through these shells.
- Safe to continue unrelated work: yes
- Resolution note: Unresolved.

## GM-UPG-003 — Private benchmark corpora stay out of git
- Detected in step: Step 05 benchmark harness
- Date: 2026-09-11
- Status: RESOLVED
- Severity: low
- Area: browser / benchmark / local fixtures
- Dependency: future benchmark corpora and model-evaluation outputs
- Description: Large or private benchmarking corpora are intentionally kept outside the repository and consumed through a local-only benchmark directory.
- Evidence: [web-app/src/shared/benchmark-harness.js](web-app/src/shared/benchmark-harness.js) defines `LOCAL_BENCHMARK_DIRECTORY = ".benchmarks/local"` and the result payload includes a local benchmark directory note.
- Files / symbols involved: [web-app/src/shared/benchmark-harness.js](web-app/src/shared/benchmark-harness.js)
- What was attempted: Added a machine-readable fixture suite and a clear local benchmark directory contract so future private corpora can be loaded without being committed.
- Why it remains: No benchmark corpus is stored in git; local-only benchmark data remains a developer-side concern.
- Recommended next action: Add local corpora under `.benchmarks/local` or a dev-only path not tracked by git, and point the future model runner at that file tree.
- Safe to continue unrelated work: yes
- Resolution note: Local-only benchmark corpora policy is now encoded in the harness and documented as a safe repository boundary.

## GM-UPG-004 — Equation candidate provenance and crop preservation
- Detected in step: Step 08 robust equation-region detection and source-crop preservation
- Date: 2026-09-11
- Status: RESOLVED
- Severity: medium
- Area: browser / extraction / equation detection
- Dependency: local PDF text and image extraction in the browser worker
- Description: The extraction pipeline now records a reversible local crop asset and flow-safe detection metadata for equation candidates instead of silently converting ambiguous prose into math.
- Evidence: [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js), [web-app/src/features/extraction/extract-worker.test.js](web-app/src/features/extraction/extract-worker.test.js)
- Files / symbols involved: `buildEquationCandidate`, `normalizeCropBounds`, `normalizeBackground`, `deskewIfNeeded`, `pageMarkdown`
- What was attempted: Added deterministic normalization helpers and a structured candidate record with page/bbox/crop, evidence, quality signals, and confidence/disposition; added fixtures covering prose mistaken as math and valid equations near prose.
- Why it remains: The feature is intentionally conservative and falls back to preserved visuals when confidence is low, which is the correct safety posture for this upgrade stage.
- Recommended next action: Keep this as the evidence-preserving baseline while the next step wires validation to parse/render comparison and review gating.
- Safe to continue unrelated work: yes
- Resolution note: Resolved as a safe, conservative groundwork step for robust equation detection and crop preservation.

