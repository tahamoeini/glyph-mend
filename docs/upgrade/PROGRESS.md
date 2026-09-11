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



### AI coding agent execution rules

- Work from the repository root and check `git status` before editing.
- Prefer the narrowest relevant validation first, then broaden only when needed.
- Preserve unrelated user changes and never reset the worktree.
- Record missing, blocked, or deferred work in `docs/upgrade/REMAINING.md`.
- Keep browser processing local/offline and do not add unreviewed dependencies.
