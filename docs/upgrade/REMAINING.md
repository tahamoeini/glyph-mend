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

## GM-UPG-008 — Step 13 browser SVG/export validation remains partially blocked by an existing DOCX regression
- Detected in step: Step 13 VisualIR -> Mermaid + safe SVG rendering
- Date: 2026-09-11
- Status: RESOLVED
- Severity: low
- Area: browser / export / validation
- Dependency: `web-app/src/features/export/docx-export.test.js`
- Description: The Step 13 browser slice validates the new VisualIR Mermaid serializer and safe SVG renderer, but the broader browser test command still reports an unrelated DOCX nested-OMML expectation failure.
- Evidence: `npm test src/features/export/docx-export.test.js src/features/extraction/extract-worker.test.js src/ui-shell.test.js` failed only in `src/features/export/docx-export.test.js` with a missing `<m:rad>` expectation, while `src/shared/semantic-ir.test.js` passed.
- Files / symbols involved: [web-app/src/features/export/docx-export.test.js](web-app/src/features/export/docx-export.test.js), [web-app/src/shared/visual-rendering.js](web-app/src/shared/visual-rendering.js), [web-app/src/shared/semantic-ir.test.js](web-app/src/shared/semantic-ir.test.js)
- What was attempted: Implemented deterministic VisualIR-to-Mermaid serialization, Mermaid syntax validation, and safe SVG rendering with hostile-content sanitization, then ran the narrow and broader browser test slices.
- Why it remains: Resolved in Step 18 by preserving MathIR sequence child references and lower/upper script references before DOCX OMML serialization.
- Recommended next action: Keep the structural DOCX regression test in the focused export suite.
- Safe to continue unrelated work: yes
- Resolution note: Resolved in Step 18; the nested OMML regression now passes alongside the new visual DOCX tests.

## GM-UPG-009 — Step 14 raster flowchart reconstruction is adapter-only until an approved local CV dependency is available
- Detected in step: Step 14 raster flowchart reconstruction with local CV + OCR
- Date: 2026-09-11
- Status: BLOCKED
- Severity: medium
- Area: browser / recognition / raster diagrams
- Dependency: approved local CV runtime or package for contour/arrowhead reconstruction
- Description: The browser workspace has local OCR and a staged visual-worker adapter, but no approved OpenCV/OpenCV.js-style dependency was present to complete deterministic raster contour, shape, and arrowhead reconstruction with verified licensing and bundle impact.
- Evidence: Inspection of [web-app/package.json](web-app/package.json) found no approved CV runtime dependency; the implemented worker path remains adapter-based and conservative.
- Files / symbols involved: [web-app/src/features/recognition/visual-worker.js](web-app/src/features/recognition/visual-worker.js), [web-app/src/features/recognition/raster-flowchart.js](web-app/src/features/recognition/raster-flowchart.js), [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js)
- What was attempted: Built a staged browser-local raster flowchart adapter around OCR text regions, deterministic candidate scoring, conservative rejection, and VisualIR emission.
- Why it remains: The repository does not yet include an approved local CV library to power real contour/arrowhead detection, so the step cannot honestly be claimed complete.
- Recommended next action: Evaluate and approve a local CV dependency, then replace the adapter-only heuristic path with real contour, shape, and direction reconstruction inside the same worker seam.
- Safe to continue unrelated work: yes
- Resolution note: Blocked only on the missing approved local CV dependency; the adapter seam and conservative preserve/review behavior are in place.

## GM-UPG-010 — Optional visual ML provider remains interface-only until an approved model/runtime is selected
- Detected in step: Step 15 optional local ML visual recognizer fallback
- Date: 2026-09-11
- Status: BLOCKED
- Severity: medium
- Area: browser / recognition / visual ML
- Dependency: approved local visual model/runtime bundle and license review
- Description: The optional visual recognizer provider interface is in place, with a mock CI provider and deterministic-first worker orchestration, but no approved local ML visual model or runtime has been selected or licensed for shipping.
- Evidence: [web-app/src/features/recognition/visual-provider.js](web-app/src/features/recognition/visual-provider.js) implements the provider seam and mock CI path; the repository still lacks a committed ML model bundle or licensed runtime for production use.
- Files / symbols involved: [web-app/src/features/recognition/visual-worker.js](web-app/src/features/recognition/visual-worker.js), [web-app/src/features/recognition/visual-provider.js](web-app/src/features/recognition/visual-provider.js), [web-app/src/features/recognition/visual-worker.test.js](web-app/src/features/recognition/visual-worker.test.js)
- What was attempted: Added provider metadata, deterministic-first invocation order, ML-to-VisualIR conversion, confidence/timing/resource metadata, and contradiction-aware review downgrades behind the worker seam.
- Why it remains: The repo does not yet include an approved local visual ML runtime or model bundle, so shipping a real ML recognizer would violate the dependency/licensing rule.
- Recommended next action: Select and license an approved local visual model/runtime, then swap the mock provider for that implementation behind the existing interface and feature flag.
- Safe to continue unrelated work: yes
- Resolution note: Blocked only on missing model/runtime approval; the provider seam and ML gating are implemented and test-covered.

## GM-UPG-011 — PlantUML rendering integration is deferred until a browser-local renderer passes review
- Detected in step: Step 16 selective PlantUML support for diagrams Mermaid cannot faithfully express
- Date: 2026-09-11
- Status: DEFERRED
- Severity: medium
- Area: browser / export / rendering
- Dependency: approved browser-local PlantUML renderer/runtime with license and bundle review
- Description: The repository now supports deterministic VisualIR-to-PlantUML serialization for an explicit UML subset, but no browser-local PlantUML renderer dependency has been approved for integration.
- Evidence: [web-app/src/shared/visual-rendering.js](web-app/src/shared/visual-rendering.js) now routes Mermaid, PlantUML, or source preservation deterministically, while [web-app/package.json](web-app/package.json) still contains no PlantUML renderer/runtime dependency.
- Files / symbols involved: [web-app/src/shared/visual-rendering.js](web-app/src/shared/visual-rendering.js), [web-app/src/shared/semantic-ir.test.js](web-app/src/shared/semantic-ir.test.js)
- What was attempted: Added explicit UML-only PlantUML serialization, a deterministic routing helper, syntax-validation tests, and a preservation fallback for freeform visuals.
- Why it remains: A renderer would introduce a new dependency that still needs license/security/bundle approval, so integration is intentionally deferred.
- Recommended next action: Review a browser-local PlantUML renderer/runtime for licensing and bundle impact, then integrate behind the existing routing seam if approved.
- Safe to continue unrelated work: yes
- Resolution note: Deferred only for renderer integration; deterministic serialization and routing are already implemented and covered by tests.

## GM-UPG-012 — Vega-Lite rendering integration is deferred until an approved browser-local renderer/runtime is selected
- Detected in step: Step 17 ChartIR and conservative Vega-Lite export
- Date: 2026-09-11
- Status: DEFERRED
- Severity: medium
- Area: browser / export / chart rendering
- Dependency: approved browser-local Vega-Lite renderer/runtime with bundle and license review
- Description: The repository now has conservative ChartIR normalization and a strict ChartIR-to-Vega-Lite export path, but there is still no approved browser-local renderer/runtime to visualize the exported spec inside the app.
- Evidence: [web-app/src/shared/chart-rendering.js](web-app/src/shared/chart-rendering.js) emits Vega-Lite JSON plus CSV/JSON sidecars, while [web-app/package.json](web-app/package.json) still has no Vega-Lite renderer/runtime dependency.
- Files / symbols involved: [web-app/src/shared/chart-rendering.js](web-app/src/shared/chart-rendering.js), [web-app/src/shared/semantic-ir.js](web-app/src/shared/semantic-ir.js), [web-app/src/shared/benchmark-harness.js](web-app/src/shared/benchmark-harness.js)
- What was attempted: Extended ChartIR with conservative metadata and evidence constraints, then added a strict export helper and tests for accepted/rejected chart cases.
- Why it remains: Rendering a Vega-Lite spec still requires a reviewed browser-local runtime or renderer, which has not been selected yet.
- Recommended next action: Review an approved browser-local Vega-Lite renderer/runtime for licensing and bundle impact, then integrate it behind the existing export seam if approved.
- Safe to continue unrelated work: yes
- Resolution note: Deferred only for renderer/runtime integration; the conservative export path is implemented and validated.


## GM-UPG-013 — Step 18 visual DOCX native-editability boundary remains intentionally conservative

- Detected in step: Step 18 Upgrade DOCX visual export: SVG first, native DrawingML subset second
- Date: 2026-09-11
- Status: PARTIAL
- Severity: medium
- Area: browser / export / DOCX / visual fidelity
- Dependency: complete VisualIR geometry for native mapping and approved local PlantUML/Vega-Lite renderers for notation-specific SVG generation
- Description: The browser exporter now has explicit semantic-source, SVG, and native DrawingML tiers. SVG assets are embedded as SVG media with a raster compatibility fallback; accepted Mermaid flowcharts can be rendered locally to SVG; and a strict native mapper supports only the documented VisualIR subset.
- Evidence: web-app/src/features/export/visual-docx.js and web-app/src/features/export/visual-docx.test.js; full browser unit suite and production build passed. The generated DOCX XML was inspected for wpg:wgp, preset geometries, connectors, arrowheads, SVG media, and fallback behavior.
- What was attempted: Added the native mapper, grouped DrawingML serializer, SVG asset path, Mermaid fence path, semantic bundle manifest, structural tests, and documentation distinguishing Word object editability from GlyphMend semantic editability. Also repaired the pre-existing nested OMML regression without weakening its assertions.
- Why it remains: No approved browser-local PlantUML or Vega-Lite renderer/runtime has been selected, and the current extraction path does not attach complete VisualIR geometry to every preserved source crop. Those cases remain source/SVG fallbacks rather than being approximated.
- Recommended next action: Review and license an offline PlantUML/Vega-Lite renderer if notation-specific SVG generation is required, then wire complete VisualIR assets into the browser extraction/review pipeline behind the existing evidence gates.
- Safe to continue unrelated work: yes
- Resolution note: The safe export tiers and fallback boundary are implemented and verified; only renderer/runtime selection and broader semantic-asset wiring remain deferred.
## GM-UPG-014 — Web Liquid Glass stays an intentional CSS interpretation
- Detected in step: Step 19 HIG-aligned Liquid Glass design system
- Date: 2026-09-11
- Status: RESOLVED
- Severity: low
- Area: browser / design system / accessibility
- Dependency: semantic CSS token layer and browser fixture
- Description: The prior UI carried component-specific material names that could encourage glass stacking and divergent light/dark rules.
- Evidence: `web-app/src/styles/style.css`, `web-app/design-system.html`, `web-app/src/styles/design-system.test.js`, and `web-app/tests/design-system.spec.js` now define and validate three opaque content surfaces and three chrome-only glass roles.
- Files / symbols involved: `--surface-content-background`, `--surface-content-elevated`, `--surface-content-inset`, `--glass-regular-fill`, `--glass-clear-fill`, `--glass-selected-overlay-fill`
- What was attempted: Replaced toolbar/sidebar/capsule variants with semantic regular/clear glass; centralized glass fill, edge, highlight, shadow, blur, typography, radii, accent, and motion tokens; added an internal fixture and light/dark browser check.
- Why it remains: No native Apple optical-physics claim is made; the documented CSS interpretation is the intended product boundary.
- Recommended next action: Preserve semantic-token usage when future screens are redesigned, and keep document content on opaque content surfaces.
- Safe to continue unrelated work: yes
- Resolution note: Resolved by the semantic surface consolidation and regression coverage in Step 19.

## GM-UPG-015 — Available-width workspace layout modes
- Detected in step: Step 20 workspace responsiveness
- Date: 2026-09-11
- Status: RESOLVED
- Severity: low
- Area: browser / workspace layout / accessibility
- Dependency: CSS Grid container queries and existing local workspace state
- Description: The prior workspace used a primary fixed `max-width: 820px` transition that conflated device category with available application width.
- Evidence: `web-app/src/styles/style.css`, `web-app/src/app.js`, and `web-app/tests/app.spec.js` now define and verify compact, medium, wide, and extra-wide modes plus resize-state preservation.
- Files / symbols involved: `syncWorkspaceLayoutState`, `data-layout-mode`, `compactActionDock`, `resultsInspector`
- What was attempted: Replaced the fixed JavaScript breakpoint with measured main-content width, introduced container-based grid modes, added safe-area/dynamic viewport behavior, and exposed settings and quality/export through compact sheets.
- Why it remains: The previous hard breakpoint has been removed from primary workspace behavior.
- Recommended next action: Keep future workspace features within the semantic mode contract and test state preservation when adding panes.
- Safe to continue unrelated work: yes
- Resolution note: Resolved by the available-width layout system and regression coverage.

## GM-UPG-016 — Accessibility and input-modality release matrix remains partly manual

- Detected in step: Step 21 Make accessibility and input modality first-class
- Date: 2026-09-11
- Status: RESOLVED
- Severity: low
- Area: browser / accessibility / input modality
- Dependency: browser and screen-reader combinations used by release QA
- Description: The app previously exposed system preference datasets but did not make reduced-transparency material, compact-sheet focus, source/reconstruction comparison, or VisualIR accessibility descriptions explicit enough for reliable assistive technology use.
- Evidence: web-app/src/app.js, web-app/src/styles/style.css, web-app/index.html, web-app/src/accessibility.test.js, web-app/src/shared/accessibility.test.js, and docs/upgrade/ACCESSIBILITY.md; focused tests, full unit tests, browser regressions, and production build passed.
- What was attempted: Added opaque reduced-transparency surfaces, stronger contrast boundaries, forced-colors fallback tokens, reduced-motion suppression, coarse-pointer sizing, focus trapping/restoration, live progress/review announcements, semantic MathML/text fallback, and deterministic VisualIR node/edge descriptions.
- Why it remains: Automated structural checks cannot replace a release pass with real browser/screen-reader combinations. No external accessibility scanner or speech-rendering dependency was added because the repository has no existing approved tool and the dependency rule requires a separate bundle/license review.
- Recommended next action: Run the documented manual matrix in docs/upgrade/ACCESSIBILITY.md against the supported browser/screen-reader matrix before a production release.
- Safe to continue unrelated work: yes
- Resolution note: Core keyboard operation, preference adaptation, and non-visual review comparison are implemented and regression-tested; only cross-browser/screen-reader release verification remains manual.

## GM-UPG-017 — Reconstructable ZIP bundle import/round-trip restoration

- Detected in step: Step 22 Build the reconstructable GlyphMend export bundle
- Date: 2026-09-11
- Status: DEFERRED
- Severity: medium
- Area: browser / export / persistence
- Dependency: a separately specified ZIP import policy and migration path for manifest versioning
- Description: Step 22 exports a versioned, checksum-validated ZIP that preserves canonical source, evidence, semantic sidecars, reconstructions, quality data, and provenance. The current import path restores JSON workspace checkpoints only; ZIP import and full round-trip restoration are not present.
- Evidence: web-app/src/shared/reconstructable-bundle.js, web-app/src/shared/reconstructable-bundle.test.js, docs/upgrade/RECONSTRUCTABLE_BUNDLE.md, and the existing workspace JSON import in web-app/src/app.js.
- What was attempted: Preserved the existing JSON import contract while explicitly marking ZIP import unsupported in manifest.import. No export-only behavior is presented as round-trip restoration.
- Recommended next action: Design and implement a browser-only ZIP importer that validates schema/version, paths, checksums, source evidence, and semantic sidecars before restoring workspace state; add migration tests for future manifest versions.
- Safe to continue unrelated work: yes

## GM-UPG-018 — Step 23 security hardening was merged before its CI became green
- Detected in step: Step 24 dependency/model licensing gate
- Date: 2026-09-11
- Status: FAILED
- Severity: high
- Area: repository / CI / security regression verification
- Dependency: Step 23 security-hardening branch and merged PR #19
- Description: Step 23 landed on `main` even though the pull-request browser workflow later reported `npm test` failure and skipped build/e2e, while the Python CI matrix reported pytest failures. `docs/upgrade/PROGRESS.md` also had no Step 23 run entry when Step 24 began.
- Evidence: PR #19 merged commit `8fae396b5f7107a3d6dde40cd703df5f04f4f801`; browser Actions run `34634261919` failed at `npm test`; Python Actions run `34634261968` failed in pytest matrix jobs; Step 24 inspected `PROGRESS.md` and found it ending at Step 22.
- Files / symbols involved: Step 23 security boundary tests and implementation, `.github/workflows/web-app.yml`, `.github/workflows/test.yml`, `docs/upgrade/PROGRESS.md`.
- What was attempted: Step 24 did not reset or remove Step 23 work; it isolated licensing changes on a new branch and treated the failed CI as a prior-step gap rather than weakening security assertions.
- Why it remains: The Step 23 test failures require separate diagnosis; licensing inventory work does not depend on changing the security implementation.
- Recommended next action: Reproduce the failing browser/Python test cases, repair the implementation rather than tests/security policy, then add an accurate Step 23 progress entry with green verification.
- Safe to continue unrelated work: yes
- Resolution note: Unresolved; Step 24 intentionally does not claim Step 23 verification success.

## GM-UPG-019 — Project licensing strategy is unresolved for MuPDF/PyMuPDF AGPL redistribution
- Detected in step: Step 24 dependency/model licensing gate
- Date: 2026-09-11
- Status: BLOCKED
- Severity: high
- Area: licensing / distribution / browser and Python runtimes
- Dependency: explicit GlyphMend project license/distribution strategy or applicable Artifex commercial licensing
- Description: GlyphMend currently ships MuPDF browser JS/WASM (`AGPL-3.0-or-later`) and declares PyMuPDF/PyMuPDF4LLM 1.28.2, which upstream distributes under GNU AGPL v3 or Artifex commercial licensing. The repository has no top-level `LICENSE` file and GitHub reports no repository license, so Step 24 cannot infer that current public distribution satisfies AGPL obligations or that proprietary redistribution is authorized.
- Evidence: `web-app/package-lock.json`, `web-app/vite.config.js`, `pyproject.toml`, GitHub repository metadata, and `docs/upgrade/DEPENDENCY_LICENSES.md`.
- Files / symbols involved: `web-app/package.json`, `web-app/package-lock.json`, `web-app/vite.config.js`, `pyproject.toml`, `docs/upgrade/DEPENDENCY_LICENSES.md`.
- What was attempted: Added explicit `BLOCKED_STRATEGY_REVIEW` status to the machine-readable license gate and documented browser/Python redistribution and source-disclosure implications without removing existing dependencies.
- Why it remains: Choosing a project license or purchasing/recording a commercial license is a product/legal distribution decision outside this code-only step.
- Recommended next action: Decide the intended GlyphMend distribution license. If AGPL is intended, document compliance/notices/source obligations. If not, obtain and record applicable Artifex commercial licensing before distribution, then update the inventory status.
- Safe to continue unrelated work: yes
- Resolution note: Blocked; no existing MuPDF-family dependency was removed solely because of this audit.

## GM-UPG-020 — Candidate math/visual model weights and dataset terms remain unapproved
- Detected in step: Step 24 dependency/model licensing gate
- Date: 2026-09-11
- Status: BLOCKED
- Severity: medium
- Area: browser / local ML / model redistribution
- Dependency: exact model artifact selection with code, weight, dataset, runtime, bundle, and hash review
- Description: Research candidates including Texo, UniMERNet, PP-FormulaNet, pix2tex/LaTeX-OCR, Flowchart2Mermaid-style VLMs, and any future visual-provider model are not production-approved merely because their code repositories or model cards expose an open-source license. Model weights and relevant training-data terms must be reviewed independently.
- Evidence: `research/GlyphMend Upgrade Research.md`, existing provider seams, and `docs/upgrade/DEPENDENCY_LICENSES.md`. PP-FormulaNet S/L model metadata currently reports Apache-2.0, while other candidates still have unresolved weight/data terms; no production weight files are bundled in the repository.
- Files / symbols involved: `web-app/src/features/recognition/math-provider.js`, `web-app/src/features/recognition/visual-provider.js`, `docs/upgrade/DEPENDENCY_LICENSES.md`.
- What was attempted: Recorded candidate-by-candidate statuses and kept all unapproved models/runtimes optional and unbundled behind existing provider interfaces.
- Why it remains: No exact production model files, hashes, training-data terms, and redistribution notices have been selected and approved end-to-end.
- Recommended next action: For any candidate selected for benchmarking, record exact source URL/version/file SHA-256, code license, weight license, dataset terms, commercial restrictions, and runtime license before enabling it in production.
- Safe to continue unrelated work: yes
- Resolution note: Blocked by design; acceptance for Step 24 is satisfied by keeping every unknown model/renderer unbundled rather than calling it approved.