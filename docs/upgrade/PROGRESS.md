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



### AI coding agent execution rules

- Work from the repository root and check `git status` before editing.
- Prefer the narrowest relevant validation first, then broaden only when needed.
- Preserve unrelated user changes and never reset the worktree.
- Record missing, blocked, or deferred work in `docs/upgrade/REMAINING.md`.
- Keep browser processing local/offline and do not add unreviewed dependencies.
