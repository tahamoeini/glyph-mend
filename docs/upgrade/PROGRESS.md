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

## Step 23 — Security hardening for executable/active reconstructed formats

- Date: 2026-09-11
- Repository base: `c58ea20add8a485981ccbb575b1835ddcda55bc0`
- Working branches: isolated Step 23 feature branches; final branch recorded in the pull request for this run
- Package manager: `npm` for the browser workspace; no dependency changes were introduced
- Status: PARTIAL
- Summary: Hardened the active untrusted-content boundaries that exist on the current baseline: strict Markdown/HTML sanitization, a static-only reconstructed SVG sanitizer, prototype-pollution-resistant workspace imports, worker request/response validation, same-origin OCR code/model URL allowlisting, resource ceilings, safe bundle-path inputs, and a restrictive CSP. PDF.js remains configured with `isEvalSupported: false`, and the UI does not render PDF annotation/action layers, so PDF JavaScript/attachments/links remain non-executable through the current browser UI. Mermaid, PlantUML, typed reconstruction IR/manifests, model-pack loading, and reconstructable bundle import are not present on `main`, so renderer-specific Step 23 acceptance cannot be completed yet.
- Security regression coverage:
	- malicious Markdown/HTML does not retain active links, remote images, scripts, SVG, or event handlers in preview;
	- active reconstructed SVG payloads using scripts, event handlers, `foreignObject`, URL attributes, external references, or `url(...)` are rejected;
	- workspace JSON rejects prototype-pollution keys, unsafe asset identifiers, and traversal/absolute-path workspace filenames that could become unsafe ZIP entry names;
	- worker messages are type/range/size checked and worker pages are constrained to the requested batch;
	- arbitrary cross-origin OCR worker/core/language/model paths are rejected;
	- CSP regression tests prevent accidental script/network/object/frame/form broadening.
- Validation notes:
	- `npm test` passed on the primary Step 23 implementation: 10 test files, 86/86 tests, including 16 dedicated Step 23 security tests. A final narrow workspace regression was then added for traversal-capable imported filenames; the final branch reruns this suite before merge.
	- `npm run build` passed under Vite 7.3.6; the production build generated `dist/index.html`, worker bundles, PWA assets, and copied local OCR/MuPDF resources.
	- `npm run test:e2e` ran 13 Playwright tests: 12 passed, including the new served-CSP/malicious-Markdown security test and structured WASM extraction; only the pre-existing OCR baseline failed with `Extraction failed` and remains tracked as `GM-UPG-001`.
	- Python CI lint, build-package validation, and the Linux/Windows Python 3.10/3.12 test matrix plus installed-command smoke tests passed for the verified Step 23 implementation commit.
	- Browser `npm ci` reported 4 existing dependency vulnerabilities (3 moderate, 1 high); package manifests were intentionally left unchanged and the audit is tracked in `GM-UPG-005`.
- Process notes:
	- The user's local `git status` could not be inspected in this execution environment; edits were isolated from `main` on GitHub feature branches and the limitation is tracked as `GM-UPG-003`.
	- Two temporary Step 23 PR branches were deleted/closed externally while CI/verification was running. Their commit chain was preserved without force-updating `main`, then consolidated into the final Step 23 branch.
	- Pre-render raster/decompression ceilings still need enforcement inside the MuPDF/OCR allocation paths before all expensive allocations; tracked as `GM-UPG-004`.


### AI coding agent execution rules

- Work from the repository root and check `git status` before editing.
- Prefer the narrowest relevant validation first, then broaden only when needed.
- Preserve unrelated user changes and never reset the worktree.
- Record missing, blocked, or deferred work in `docs/upgrade/REMAINING.md`.
- Keep browser processing local/offline and do not add unreviewed dependencies.
