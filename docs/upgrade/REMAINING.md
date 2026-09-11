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

## GM-UPG-005 — No approved local math model has been selected or licensed in-repo
- Detected in step: Step 09 local mathematical OCR provider and model-evaluation seam
- Date: 2026-09-11
- Status: OPEN
- Severity: medium
- Area: browser / recognition / provider integration
- Dependency: approved local math OCR runtime or model bundle
- Description: The repository does not currently include an approved local mathematical OCR runtime or model bundle, and no model choice was validated from repository docs alone. This step therefore keeps the provider interface local-only and deterministic while documenting the future integration point.
- Evidence: Repository inspection of [web-app/src/features/recognition](web-app/src/features/recognition) and the worker capability seam found no approved in-repo model pack or runtime commitment. The active default is the mock provider in [web-app/src/features/recognition/math-provider.js](web-app/src/features/recognition/math-provider.js).
- Files / symbols involved: [web-app/src/features/recognition/math-worker.js](web-app/src/features/recognition/math-worker.js), [web-app/src/features/recognition/math-provider.js](web-app/src/features/recognition/math-provider.js), [web-app/src/shared/benchmark-harness.js](web-app/src/shared/benchmark-harness.js)
- What was attempted: Added a provider-agnostic adapter, mock/test provider, benchmark evaluation harness, and worker plumbing without introducing a download or cloud path.
- Why it remains: No approved local model/runtime was present in the repo to integrate behind the interface, so model selection and licensing remain an explicit OPEN item rather than a silent dependency.
- Recommended next action: Evaluate any approved local math OCR runtime or model pack against the benchmark harness before enabling it behind the provider interface, with licensing reviewed before production use.
- Safe to continue unrelated work: yes
- Resolution note: Open, intentionally deferred until an approved model/runtime is available and licensed for local use.

## GM-UPG-006 — Review queue remains equations-first until other asset types are wired
- Detected in step: Step 11 unified reconstruction Review Queue
- Date: 2026-09-11
- Status: OPEN
- Severity: low
- Area: browser / review queue / UI
- Dependency: future reconstruction emitters for diagrams, charts, tables, and OCR regions
- Description: The new unified review queue is structured to host multiple reconstructed asset types, but only equations are currently emitted into the queue and rendered in the inspector.
- Evidence: The queue model and inspector surface are generic, while the extraction worker currently emits review items only for equation candidates.
- Files / symbols involved: [web-app/src/shared/review-queue.js](web-app/src/shared/review-queue.js), [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js), [web-app/src/app.js](web-app/src/app.js)
- What was attempted: Built the queue state model, persistence seam, inspector UI, editable LaTeX workflow, and revert path for equations.
- Why it remains: Non-equation reconstruction emitters are not yet wired into the queue.
- Recommended next action: Add diagram, chart, table, and OCR-region review item emitters that reuse the same queue item contract.
- Safe to continue unrelated work: yes
- Resolution note: Open, by design, until the remaining reconstruction families are connected.

## GM-UPG-007 — VisualIR recovery and native vector adapter landed
- Detected in step: Step 12 native PDF vector structure recovery
- Date: 2026-09-11
- Status: RESOLVED
- Severity: low
- Area: Python / PDF vector recovery / graphics
- Dependency: native PDF vector drawing inspection and VisualIR adapter layer
- Description: The native vector recovery path now uses VisualIR as the internal contract, with Mermaid generation preserved only as an adapter for legacy markdown output.
- Evidence: [src/pdf_sanitizer/visual_ir.py](src/pdf_sanitizer/visual_ir.py), [src/pdf_sanitizer/extractor.py](src/pdf_sanitizer/extractor.py), [src/pdf_sanitizer/renderer.py](src/pdf_sanitizer/renderer.py), [tests/unit/test_graphics.py](tests/unit/test_graphics.py)
- Files / symbols involved: [src/pdf_sanitizer/visual_ir.py](src/pdf_sanitizer/visual_ir.py), [src/pdf_sanitizer/extractor.py](src/pdf_sanitizer/extractor.py), [src/pdf_sanitizer/renderer.py](src/pdf_sanitizer/renderer.py), [tests/unit/test_graphics.py](tests/unit/test_graphics.py)
- What was attempted: Built a VisualIR recovery core, rewired the extractor and renderer boundaries, and added deterministic tests for direction, ambiguity, and disconnected nodes.
- Why it remains: The implementation and focused validation are complete; only future native-visual expansion to other asset families remains.
- Recommended next action: Carry the same VisualIR-first pattern into any future diagram or chart recovery work if needed.
- Safe to continue unrelated work: yes
- Resolution note: Resolved by landing the VisualIR recovery core and adapter boundary refactor for Step 12.

