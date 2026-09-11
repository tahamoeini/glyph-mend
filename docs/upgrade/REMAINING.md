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
- What was attempted: Installed browser dependencies, reran browser unit tests and the browser build, then executed the OCR e2e baseline. Step 23 reproduced the same failure after the worker validation wrapper was introduced; the structured non-OCR WASM worker e2e still passed.
- Why it remains: The local OCR path still fails under the e2e baseline, but the exact worker-side cause was not isolated in this step.
- Recommended next action: Inspect the OCR worker logs and asset loading path for the Tesseract baseline sample before changing OCR behavior.
- Safe to continue unrelated work: yes
- Resolution note: Unresolved; reproduced during Step 23 without weakening the test.

## GM-UPG-002 — Steps 02–22 security dependencies are absent on the current baseline
- Detected in step: Step 23 security hardening
- Date: 2026-09-11
- Status: BLOCKED
- Severity: high
- Area: semantic reconstruction / active formats / security
- Dependency: Steps 02–22, especially typed IR/manifest contracts, Mermaid and PlantUML adapters, model-pack handling, and reconstructable bundle import/export
- Description: Step 23 depends on executable reconstruction surfaces that do not exist in the current `main` baseline. The repository contains the research/upgrade-plan descriptions, but production code for Mermaid, PlantUML, typed reconstruction IR/manifests, model-pack loading, and reconstructable bundle import is absent.
- Evidence: `docs/upgrade/PROGRESS.md` records only Steps 00 and 01; repository code search for Mermaid/PlantUML/VisualIR/MathIR/ChartIR/reconstructed bundle finds the research/plan documents rather than implementation modules.
- Files / symbols involved: `docs/upgrade/PROGRESS.md`, `research/GlyphMend_AI_Coding_Agent_Upgrade_Plan.md`, future reconstruction/renderer/bundle modules
- What was attempted: Audited the current tree and implemented reusable security boundaries for the active surfaces that do exist: Markdown/HTML/SVG rendering, workspace imports, worker messaging, OCR resource URLs, CSP, and resource ceilings.
- Why it remains: Renderer-specific configuration and IR/manifest/bundle validation cannot be integrated or verified against code that has not been implemented yet.
- Recommended next action: Execute the missing upgrade steps in dependency order, then rerun Step 23 against the real Mermaid/PlantUML/model-pack/IR/bundle implementations before release.
- Safe to continue unrelated work: yes
- Resolution note: Step 23 must remain PARTIAL until these hard dependencies exist and are re-audited.

## GM-UPG-003 — Local working-tree status was unavailable during Step 23
- Detected in step: Step 23 security hardening
- Date: 2026-09-11
- Status: BLOCKED
- Severity: low
- Area: process / repository safety
- Dependency: access to the user's local repository worktree
- Description: The execution environment could not inspect the user's local `git status`. Work therefore used the connected GitHub repository and an isolated branch from the exact remote `main` commit instead of modifying the user's local checkout.
- Evidence: Step 23 began from remote `main` commit `c58ea20add8a485981ccbb575b1835ddcda55bc0`; no force-update or reset was applied to `main`.
- Files / symbols involved: repository worktree / branch refs
- What was attempted: Requested the local repository execution environment first, then continued through GitHub after that handoff was unavailable. All edits were isolated on a feature branch/PR.
- Why it remains: Remote GitHub state cannot prove whether the user's machine has uncommitted or unpushed changes.
- Recommended next action: Before applying or merging this branch into a local checkout, run `git status --short --branch` and reconcile any local-only work without resetting it.
- Safe to continue unrelated work: yes
- Resolution note: No local files were overwritten by this run.

## GM-UPG-004 — Pre-render raster/decompression ceilings are not enforced before every worker allocation
- Detected in step: Step 23 security hardening
- Date: 2026-09-11
- Status: OPEN
- Severity: high
- Area: browser / extraction worker / resource exhaustion
- Dependency: MuPDF crop/raster and OCR allocation paths
- Description: Step 23 adds byte/count ceilings at worker ingress and validates produced assets before they cross the worker boundary, but some MuPDF crop/raster allocations happen inside the extraction core before outbound validation can reject an oversized result.
- Evidence: `cropPage()` computes a target and rasterizes the page before the security wrapper can validate the resulting asset bytes. The wrapper therefore limits propagation but cannot guarantee graceful rejection before all potentially expensive allocations.
- Files / symbols involved: `web-app/src/features/extraction/extract-worker-core.js`, `cropPage()`, OCR rasterization paths, `web-app/src/security/validation.js`
- What was attempted: Added worker PDF/page ceilings, per-asset and per-page asset byte/count ceilings, text limits, bounded worker messages, and graceful security-error responses.
- Why it remains: A hard pixel-area/dimension budget needs to be enforced inside the core immediately before pixmap/PNG/OCR allocations, with fixtures that exercise malicious extreme geometry/decompression cases.
- Recommended next action: Add pre-allocation pixel-area and decoded-byte budgets to MuPDF crop and OCR rendering paths, then add regression tests that prove oversized geometry is rejected before raster allocation.
- Safe to continue unrelated work: yes
- Resolution note: Do not treat current post-render asset limits as complete decompression-bomb protection.

## GM-UPG-005 — Browser dependency audit reports unresolved vulnerabilities
- Detected in step: Step 23 security hardening
- Date: 2026-09-11
- Status: OPEN
- Severity: medium
- Area: browser / dependencies / supply chain
- Dependency: npm dependency audit and Step 24 dependency/license review
- Description: `npm ci` reports four known vulnerabilities in the current dependency graph: three moderate and one high. This step did not change package manifests or run an unreviewed automatic upgrade.
- Evidence: GitHub Actions `npm ci` output for the Step 23 branch reports `4 vulnerabilities (3 moderate, 1 high)` and also flags an outdated transitive `glob` package.
- Files / symbols involved: `web-app/package.json`, `web-app/package-lock.json`
- What was attempted: Preserved the dependency set because Step 23 required no new package and dependency changes require explicit bundle/maintenance/license review.
- Why it remains: The exact advisories, runtime reachability, ownership, safe upgrade path, and bundle impact were not yet triaged.
- Recommended next action: Run a focused `npm audit`/dependency review, classify production versus development exposure, and apply only reviewed compatible updates with full regression testing.
- Safe to continue unrelated work: yes
- Resolution note: Unresolved; do not use `npm audit fix --force` as a blanket remedy.

## GM-UPG-006 — CSP still permits inline application styles
- Detected in step: Step 23 security hardening
- Date: 2026-09-11
- Status: DEFERRED
- Severity: low
- Area: browser / CSP / UI
- Dependency: existing inline/dynamically assigned application styles
- Description: The new CSP keeps executable script restricted to same-origin code plus the WebAssembly-specific allowance, but `style-src` still contains `'unsafe-inline'` to preserve the current UI implementation. Untrusted Markdown/SVG content is separately stripped of style attributes and active URL references.
- Evidence: `web-app/src/security/policy.js` uses `script-src 'self' 'wasm-unsafe-eval'` and `style-src 'self' 'unsafe-inline'`; security regression tests assert that script CSP does not gain `'unsafe-eval'` or `'unsafe-inline'`.
- Files / symbols involved: `web-app/src/security/policy.js`, `web-app/index.html`, UI code that assigns inline styles
- What was attempted: Applied the strictest executable-content policy compatible with the current app without relaxing script or network directives for library convenience.
- Why it remains: Removing inline styles requires a separate UI/CSS migration and verification pass.
- Recommended next action: Move remaining inline/dynamic style declarations to classes or a nonce/hash-compatible strategy, then remove `'unsafe-inline'` from `style-src` if the app remains functional.
- Safe to continue unrelated work: yes
- Resolution note: Deferred; this is not permission to loosen any script/network CSP directive.
