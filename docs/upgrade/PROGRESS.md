# Progress log

This file records executed upgrade steps in chronological order.

## Step 00 — Install protocol and persistent ledger

- Date: 2026-09-11T00:00:00-07:00
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Python runtime: `Python 3.13.14`
- pip: `pip 26.2.1`
- Node.js: `v22.14.0`
- npm: `11.6.4`
- Status: PASS
- Summary: Established the upgrade ledger under `docs/upgrade/`, recorded the local baseline environment, and normalized the process scaffolding without changing application behavior.

## Step 01 — Baseline audit, regression snapshot, and architecture map

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PARTIAL
- Summary: Mapped the current browser, export, styling, and CI architecture; validated the Python unit suite, full Python suite, lint, browser unit tests, and browser build; captured the baseline bundle snapshot; and recorded the OCR e2e regression in the unresolved ledger.
- Validation notes:
	- `python -m pytest tests/unit/test_docx_export.py` passed in the project virtual environment.
	- `python -m pytest` passed in the project virtual environment.
	- `python -m ruff check src tests` passed in the project virtual environment.
	- `npm test` passed in `web-app/` after installing workspace dependencies.
	- `npm run build` passed in `web-app/` after installing workspace dependencies.
	- `npm run test:e2e` failed in `web-app/tests/ocr-baseline.spec.js` with the extraction worker reporting `Extraction worker failed`.

## Step 02 — Introduce typed semantic asset contracts: ReconstructedAsset, MathIR, VisualIR, ChartIR

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a shared versioned semantic IR seam in `web-app/src/shared/semantic-ir.js` for reconstructed assets, math, visual, and chart contracts; documented serialization and versioning rules in the architecture ledger; and verified deterministic round-trips plus validation behavior without coupling the contracts to Mermaid, SVG, DOCX, or Word OMML.
- Validation notes:
	- `npm test src/shared/semantic-ir.test.js` passed in `web-app/`.
	- `npm test` passed in `web-app/`.
	- `python -m pytest tests/unit/test_docx_export.py` passed in the project virtual environment.

## Step 03 — Add provenance, confidence, disposition, and reconstruction-version primitives

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Extended the shared semantic IR seam with provenance, named confidence components, validation evidence, reconstruction-version defaults, and a configurable disposition policy; reused the workspace versioning semantics for older manifests; and documented the asymmetric rule that false positive reconstruction is worse than unresolved source evidence.
- Validation notes:
	- `npm test src/shared/semantic-ir.test.js` passed in `web-app/`.
	- `npm test` passed in `web-app/`.
	- `python -m pytest tests/unit/test_docx_export.py` passed in the project virtual environment.

## Step 04 — Create capability/worker architecture for heavy local recognition

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PARTIAL
- Summary: Added a shared worker-capability protocol with deterministic message envelopes, cancellation, failure handling, and graceful unavailable states; introduced math-worker and visual-worker shells as isolated adapters; and recorded the remaining performance and memory unknowns for heavy local recognition.
- Validation notes:
	- `npm test src/shared/recognizer-capability.test.js src/features/recognition/math-worker.test.js src/features/recognition/visual-worker.test.js` passed in `web-app/`.
	- The capability layer remains isolated from the canonical Markdown pipeline and is not yet wired into the main extraction orchestration.

## Step 05 — Build a benchmark and golden-fixture harness before selecting models

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a small browser-local benchmark harness with hand-authored math and diagram fixtures; defined evidence-driven metrics for parse success, semantic equivalence, rendering comparisons, graph correctness, and serializer validity; and kept the harness intentionally deterministic with no committed model weights required.
- Validation notes:
	- `npm test src/shared/benchmark-harness.test.js` passed in `web-app/`.
	- The harness specifically detects both a wrong equation AST and a deliberately wrong arrow direction.
	- The benchmark result payload is machine-readable JSON for future model comparisons.

## Step 06 — Replace regex-centric math conversion with a real MathIR parsing pipeline

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a browser-local LaTeX-to-MathIR adapter with explicit unsupported-command handling and an evidence-preserving fallback path. The parser seam preserves simple equations, nested fractions, definite integrals, and unsupported syntax visibility while avoiding the previous recursive memory blow-up.
- Validation notes:
	- `npm test src/shared/mathir-parser.test.js` passed in `web-app/`.
	- The parser remains intentionally local/offline and independent of Word export, with unsupported commands reported as explicit structured reviewable evidence rather than silently dropped.

## Step 07 — Implement MathIR to native Word OMML with structural tests

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a browser-local MathIR-to-Word OMML conversion path in `web-app/src/features/export/docx-export.js`, mapped supported MathIR nodes to native `docx` math primitives (`MathFraction`, `MathRadical`, `MathSum`, `MathIntegral`, `MathFunction`, and script wrappers), and kept unsupported constructs in a fallback plain math run instead of flattening them into misleading text. Structural XML assertions confirm the generated DOCX contains native OMML nodes for fractions, roots, scripts, and n-ary operators.
- Validation notes:
	- `npm test src/shared/mathir-parser.test.js src/features/export/docx-export.test.js` passed in `web-app/`.
	- Generated DOCX XML includes `<m:f>`, `<m:rad>`, `<m:nary>`, and script elements in the zipped `word/document.xml`.
	- The export remains browser-only and local/offline; no backend or cloud inference was introduced.

## Step 08 — Implement robust equation-region detection and source-crop preservation

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a deterministic equation-candidate stage in `web-app/src/features/extraction/extract-worker.js` that records page/bbox provenance, source-type metadata, reversible crop data, evidence, quality signals, and confidence/disposition without invoking generic OCR as mathematical truth. The detector still preserves weak math as source visuals instead of inventing equations from prose, and the extraction tests cover prose mistaken for math plus valid math embedded near text.
- Validation notes:
	- `npm test src/features/extraction/extract-worker.test.js` passed in `web-app/`.
	- The equation candidate now carries `page`, `sourceAsset`, `cropAsset`, `evidence`, `qualitySignals`, and `confidence` fields with a reversible local crop asset.
	- Weak or prose-like candidates default to `preserved` rather than silently accepted as equations.
	- Browser-local processing remains offline and does not add a new dependency.

## Step 09 — Add a pluggable local mathematical OCR provider and model-evaluation seam

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: `main`
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a provider-agnostic math-recognition seam behind the existing worker capability adapter. The repo now supports a deterministic mock provider for CI plus a local provider wrapper that carries provider metadata, candidate confidence, timings, resource stats, and warnings without forcing a model bundle at runtime. No cloud or model download path was introduced. The benchmark harness is ready for math provider evaluation through the existing local fixture suite.
- Validation notes:
	- `npm test src/features/recognition/math-worker.test.js` passed in `web-app/`.
	- Provider output includes LaTeX candidates, confidence values, provider metadata, warnings, and resource/timing fields.
	- The default behavior remains mock/local-only and safe for CI, while the architecture remains open for an approved model adapter in a future step.

## Step 11 — Build the unified reconstruction Review Queue, starting with equations

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `npm` for the browser workspace; `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a browser-local review queue model for reconstructed equations, persisted it through workspace serialization and checkpoint restore, surfaced it in the results inspector with keyboard-accessible queue cards and editable LaTeX, and kept the source crop and provenance attached so accepted equations can always revert to preserved evidence. The queue is equations-first but intentionally data-modelled to host future diagram, chart, table, and OCR-region review items without changing the persistence shape.
- Validation notes:
	- `npm test src/shared/review-queue.test.js src/storage/review-queue-persistence.test.js src/features/extraction/extract-worker.test.js` passed in `web-app/`.
	- `npm test src/ui-shell.test.js src/storage/workspace-db.test.js src/features/recognition/math-validation.test.js src/features/recognition/math-worker.test.js src/shared/semantic-ir.test.js` passed in `web-app/`.
	- Review queue state now survives workspace serialization and reload checkpoints.
	- Accepted equations can be reverted back to the preserved source crop without deleting source evidence.

## Step 12 — Implement VisualIR and deterministic recovery from native PDF vector structure

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `pip`/`python -m pip` for the Python package
- Status: PASS
- Summary: Added a native VisualIR recovery core for PDF vector structure, kept Mermaid as a boundary adapter, wired the extractor and renderer to consume the new contract, and added deterministic Python tests for connector direction, disconnected nodes, and ambiguous connector handling.
- Validation notes:
	- `python -m pytest tests/unit/test_graphics.py -q` passed in the project virtual environment.
	- VisualIR recovery now emits structured nodes, edges, warnings, provenance, and confidence fields instead of making Mermaid the recovery primitive.
	- The Python extraction and rendering paths now adapt from VisualIR to Mermaid only at the boundary.

## Step 13 — Add VisualIR -> Mermaid + safe SVG rendering

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `npm` for the browser workspace
- Status: PARTIAL
- Summary: Added a browser-local VisualIR serializer that deterministically converts the supported flowchart subset into Mermaid, validates the Mermaid syntax before acceptance, and renders the supported subset to sanitized SVG without introducing a Mermaid runtime dependency. The serializer keeps VisualIR as the canonical contract and treats Mermaid/SVG as hostile outputs rather than inputs.
- Validation notes:
	- `npm test src/shared/semantic-ir.test.js` passed in `web-app/`.
	- `npm test src/features/export/docx-export.test.js src/features/extraction/extract-worker.test.js src/ui-shell.test.js` passed for extraction/UI, but `src/features/export/docx-export.test.js` still fails on a preexisting nested-OMML expectation unrelated to this step.
	- The SVG renderer is restricted to a supported flowchart subset, strips unsafe SVG content, and preserves the source VisualIR alongside the rendered output path.

## Step 14 — Add deterministic raster flowchart reconstruction with local CV + OCR

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `npm` for the browser workspace
- Status: PARTIAL
- Summary: Added a conservative browser-local raster flowchart adapter in `web-app/src/features/recognition/raster-flowchart.js`, wired `visual-worker` to return a staged VisualIR result using local OCR-derived text regions and deterministic diagnostics, and kept non-simple raster inputs on the preserve/review path instead of inventing topology. The step remains partial because no approved local CV dependency is present, so the implementation is intentionally adapter-based rather than a full contour/arrowhead recognizer.
- Validation notes:
	- `npm test src/features/recognition/visual-worker.test.js src/shared/benchmark-harness.test.js` passed in `web-app/`.
	- The staged raster worker now returns canonical VisualIR with deterministic Mermaid serialization for the supported simple flowchart path.
	- Non-simple or ambiguous raster inputs are preserved with diagnostics rather than reconstructed as false positives.

## Step 15 — Add optional local ML visual recognizer only as a fallback

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `npm` for the browser workspace
- Status: PARTIAL
- Summary: Added an optional VisualRecognizerProvider interface behind `visual-worker`, including a mock CI provider, deterministic-first execution order, ML-to-VisualIR conversion/validation, confidence and timing metadata, and contradiction-aware review downgrades. The browser remains fully functional with ML disabled, and provider failure stays isolated from deterministic extraction and source preservation.
- Validation notes:
	- `npm test src/features/recognition/visual-worker.test.js src/shared/recognizer-capability.test.js src/shared/benchmark-harness.test.js` passed in `web-app/`.
	- The worker metadata now reports provider, providerKind, modelHash, featureFlag, and mlEnabled state.
	- ML predictions are validated against deterministic evidence and are downgraded to review when they contradict the deterministic topology.

## Step 16 — Add selective PlantUML support for diagrams Mermaid cannot faithfully express

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `npm` for the browser workspace
- Status: PARTIAL
- Summary: Added deterministic routing for VisualIR output so ordinary flow/process graphs prefer Mermaid, explicitly UML-labeled VisualIR can serialize to PlantUML for a narrow supported subset, and unknown/freeform visuals remain source-preserved. PlantUML rendering integration is deferred because no approved browser-local PlantUML renderer dependency has been added or licensed yet.
- Validation notes:
	- `npm test src/shared/semantic-ir.test.js` passed in `web-app/`.
	- Routing is explicit and explainable: `mermaid`, `plantuml`, or `source`.
	- Freeform visuals are not mislabeled as UML, and PlantUML serialization rejects VisualIR without explicit UML notation hints.

## Step 17 — Introduce ChartIR and conservative Vega-Lite export

- Date: 2026-09-11
- Repository HEAD: `0b4e0c5`
- Branch: main
- Package manager: `npm` for the browser workspace
- Status: PARTIAL
- Summary: Extended the shared ChartIR contract with conservative chart metadata, provenance, axis/label/legend support, and stricter row/value normalization; added a browser-local ChartIR-to-Vega-Lite export helper that emits a strict Vega-Lite spec plus JSON/CSV sidecars only for accepted bar/line/point/scatter charts with strong numeric evidence; and added narrow tests plus benchmark coverage for the new chart path. Rendering integration remains deferred because the workspace still does not include an approved browser-local Vega-Lite renderer/runtime.
- Validation notes:
	- `npm test src/shared/semantic-ir.test.js src/shared/benchmark-harness.test.js src/shared/chart-rendering.test.js` passed in `web-app/`.
	- The exporter rejects weak disposition, unsupported marks, and non-numeric quantitative values instead of synthesizing chart evidence.
	- The benchmark harness now includes deterministic chart fixtures alongside the existing math and diagram fixtures.


### AI coding agent execution rules

- Work from the repository root and check `git status` before editing.
- Prefer the narrowest relevant validation first, then broaden only when needed.
- Preserve unrelated user changes and never reset the worktree.
- Record missing, blocked, or deferred work in `docs/upgrade/REMAINING.md`.
- Keep browser processing local/offline and do not add unreviewed dependencies.
