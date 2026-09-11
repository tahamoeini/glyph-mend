
# GlyphMend — Prompt-by-Prompt Upgrade Plan for an AI Coding Agent

Basis: the attached **GlyphMend Upgrade Research**.  
Goal: evolve GlyphMend into a local-first, evidence-preserving document reconstruction platform while preserving the existing architecture and behavior.

## How to use this plan

Run the prompts in numerical order where practical. They are intentionally designed so that an agent:

- inspects what previous steps actually did instead of assuming success;
- records unfinished, failed, deferred, or discovered work in an append-only ledger;
- continues past unrelated failures;
- stops only when a missing dependency makes the current step unsafe or impossible;
- preserves source evidence when semantic reconstruction is uncertain;
- never weakens tests, security, privacy, or extraction fidelity just to make a step "pass";
- states failures explicitly.

### Required persistent files

Every prompt must use these files. If they do not exist, create them.

- `docs/upgrade/REMAINING.md` — append-only unresolved-work ledger.
- `docs/upgrade/PROGRESS.md` — chronological record of executed steps and results.
- `docs/upgrade/ARCHITECTURE.md` — current target architecture and implementation notes.
- `docs/upgrade/DECISIONS.md` — important architectural/design decisions and rationale.

### `REMAINING.md` entry format

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

Never delete old entries. Mark them `RESOLVED` and add a resolution note.

### Mandatory final result format for every step

The coding agent must end every run with exactly these sections:

```md
## Step result
Status: PASS | PARTIAL | FAILED

## Failure
If the step failed or partially failed, print:
**❌ FAILED OR INCOMPLETE — STEP <N>: <short reason>**
If fully successful, write: None.

## What changed
...

## Verification
- commands run:
- tests passed:
- tests failed:
- manual checks:

## Previous-step gaps found
...

## Ledger entries added/updated
...

## Risks / follow-up
...

## Next safe step
...
```

A failed prerequisite is **not** permission to stop the whole upgrade. Continue the current prompt when it is technically safe. If the current prompt truly depends on the failed prerequisite, do not fabricate a workaround: record the blocker, perform any non-dependent analysis/tests/documentation, and clearly mark the step failed or partial.

---

## Dependency map

```text
00 protocol/ledger
  ↓
01 baseline audit
  ↓
02 semantic asset contracts
  ├───────────────┬─────────────────┬─────────────────┐
  ↓               ↓                 ↓                 ↓
03 provenance     04 workers        05 benchmark      19 UI design foundation
  ↓               ↓                 ↓                 ↓
06 MathIR         08 equation       12 VisualIR       20 adaptive workspace
  ↓               detection         ↓                 ↓
07 OMML           ↓                 13 Mermaid        21 accessibility
  ↓               09 OCR adapter    ↓
10 validation ←───┘                 14 raster flowcharts
  ↓                                 ↓
11 equation review                  15 optional visual ML
                                    ↓
                              16 PlantUML adapter
                                    ↓
                              17 ChartIR/Vega-Lite
                                    ↓
                              18 DOCX visual export

02/03/04/11/12/17
        ↓
22 reconstructable bundle
        ↓
23 security hardening
24 licensing/SBOM
25 performance/offline/model packs
        ↓
26 integration + release gates
```

Tracks may proceed in parallel when dependencies shown above are satisfied.

> **Dependency/licensing gate:** Prompt 24 is intentionally reusable. Run it once **immediately after Prompt 04** before approving or shipping any new parser, renderer, WASM package, runtime, model, model weights, or dataset; then run it again during final productization to audit the finished dependency set. Earlier prompts may create interfaces/adapters without the dependency, but must not silently ship an unreviewed dependency.

---

# Prompt 00 — Install the upgrade execution protocol and persistent ledger

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 00: Install the upgrade execution protocol and persistent ledger
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: establish the process scaffolding that every later AI-agent run will use.

Tasks:
- Inspect existing contributor/agent documentation (`AGENTS.md`, `CONTRIBUTING*`, `README*`, docs, package scripts). Do not duplicate an equivalent existing mechanism without reason.
- Create `docs/upgrade/` if needed.
- Create or normalize:
  - `REMAINING.md`
  - `PROGRESS.md`
  - `ARCHITECTURE.md`
  - `DECISIONS.md`
- Put the unresolved-item schema from this plan in `REMAINING.md`.
- In `PROGRESS.md`, record the repository HEAD/branch if available, package manager, runtime/toolchain versions that can be determined locally, and current timestamp.
- In `ARCHITECTURE.md`, write only the high-level invariants:
  - Markdown remains canonical textual artifact.
  - DOCX remains downstream.
  - source evidence is preserved;
  - semantic IR separates recognition from serialization;
  - browser/local-first/offline remains an invariant;
  - deterministic reconstruction precedes ML;
  - uncertainty is reviewable rather than silently accepted.
- In `DECISIONS.md`, add ADR-style decision IDs for these invariants.
- Add a short "AI coding agent execution rules" section to an existing appropriate agent/contributor file only if the repository has such a convention. Otherwise keep it under `docs/upgrade/`.
- Do not modify application behavior in this step.

Acceptance:
- All four files exist and are internally consistent.
- Existing build/test files are untouched except if formatting tooling requires no-op metadata changes.
- `PROGRESS.md` contains a Step 00 entry.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 01 — Baseline audit, regression snapshot, and architecture map

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 01: Baseline audit, regression snapshot, and architecture map
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: establish what GlyphMend actually does today so later agents do not rebuild or break existing features.

Tasks:
- Inspect the complete browser architecture relevant to:
  - PDF extraction/MuPDF/PDF.js;
  - OCR/Tesseract;
  - workers;
  - IndexedDB/checkpointing;
  - service worker/PWA;
  - Markdown generation/preview/sanitization;
  - current Mermaid/vector-flow conversion;
  - DOCX export and native math;
  - CSS design tokens/responsive behavior/accessibility media queries.
- Inventory package scripts, tests, fixtures, and CI.
- Run the existing install/build/typecheck/lint/unit/e2e commands that are feasible in the environment. Do not "fix" unrelated failures yet.
- Record every pre-existing failure in `REMAINING.md` with evidence and mark whether it blocks future tracks.
- Produce `docs/upgrade/BASELINE.md` containing:
  - module map;
  - current data flow;
  - current test map;
  - current public behavior that must remain backward compatible;
  - dependency/license observations already visible in the repo;
  - known technical debt relevant to the research.
- Identify exact symbols/files where current regex-like LaTeX-to-DOCX conversion occurs and where vector diagrams become Mermaid.
- Identify current 820px/fixed responsive rules and glass-token system, without changing them yet.
- Capture a baseline bundle-size/build-output snapshot if tooling exposes it.

Acceptance:
- No product behavior intentionally changes.
- Baseline test/build result is reproducible and written down.
- Every observed pre-existing failure is in the ledger rather than hidden.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 02 — Introduce typed semantic asset contracts: ReconstructedAsset, MathIR, VisualIR, ChartIR

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 02: Introduce typed semantic asset contracts: ReconstructedAsset, MathIR, VisualIR, ChartIR
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: create the architectural seam that prevents recognizers from being coupled directly to Mermaid, SVG, DOCX, or LaTeX regexes.

Tasks:
- First inspect existing TypeScript/JavaScript domain models and serialization conventions. Extend rather than duplicate.
- Define a versioned `ReconstructedAsset` contract with:
  - stable id;
  - page and bounding box;
  - kind (`equation`, `flowchart`, `diagram`, `chart`, `illustration`, `photo`, `unknown`);
  - source type (`vector`, `raster`, `mixed`);
  - source asset reference;
  - reconstruction format/source;
  - confidence components;
  - provenance/version information;
  - disposition (`accepted`, `review`, `preserved`);
  - optional warnings/errors.
- Define versioned IR schemas/types:
  - `MathIR`: semantic nodes, not Word-specific objects;
  - `VisualIR`: nodes, edges, labels, geometry, shapes, styles with conservative subset;
  - `ChartIR`: recovered data + mark/encoding metadata, but keep it minimal until chart work.
- Add schema/runtime validation if the project already has a validation approach. Do not add a heavy validator solely for this step unless justified.
- Add unit tests for valid/invalid examples and forward-compatible unknown fields where appropriate.
- Document serialization/versioning rules in `ARCHITECTURE.md`.
- Do not yet rewrite production extraction to emit every IR; adapters may initially be unused.

Hard dependency:
- Step 01 architecture understanding. If its documentation is missing, inspect the repo yourself, log the gap, and proceed.

Acceptance:
- IRs have no dependency on Mermaid, Vega-Lite, DOCX, Word OMML, or specific ML models.
- Serialized forms are deterministic.
- Tests cover round-trip serialization and validation.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 03 — Add provenance, confidence, disposition, and reconstruction-version primitives

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 03: Add provenance, confidence, disposition, and reconstruction-version primitives
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make every reconstructed asset auditable and ensure uncertainty is first-class.

Tasks:
- Inspect any existing manifest/checkpoint versioning and reuse its semantics where possible.
- Implement shared types/utilities for:
  - recognizer name/version/model hash when applicable;
  - preprocessing version;
  - source fingerprint/page/bbox;
  - confidence component map;
  - validation evidence;
  - status/disposition;
  - warnings and failure reasons.
- Do not use one magic confidence number internally. Allow named components such as recognition, parse validity, visual similarity, crop quality, node accuracy, topology confidence.
- Implement a small policy module that maps evidence to:
  - `accepted`;
  - `review`;
  - `preserved`.
  Thresholds must be named/configurable and tested; avoid false precision.
- Keep the original asset reference even for accepted reconstructions.
- Add migration/default behavior for older manifests/workspaces lacking these fields.
- Update architecture docs with the asymmetric rule: false positive reconstruction is worse than unresolved source evidence.

Acceptance:
- Existing documents without new metadata still open.
- The source asset can always be traced from a reconstructed asset.
- Policy tests cover high/medium/low evidence and missing confidence components.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 04 — Create capability/worker architecture for heavy local recognition

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 04: Create capability/worker architecture for heavy local recognition
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make math and visual recognition optional local capabilities that cannot freeze the UI thread.

Tasks:
- Inspect existing Web Worker creation, messaging, cancellation, progress, and error handling.
- Define a common capability interface for heavy recognizers with:
  - availability;
  - lazy initialization;
  - version/model metadata;
  - progress events;
  - cancellation/abort;
  - result/error envelope;
  - resource disposal;
  - deterministic fallback path.
- Implement worker shells or adapters for:
  - `math-worker`;
  - `visual-worker`;
  while reusing current worker infrastructure.
- Do not add an ML runtime/model yet unless already present.
- Ensure worker failures cannot corrupt the canonical Markdown or workspace.
- Add graceful capability-unavailable states.
- Add tests for worker message protocol, cancellation, failure, and retry.
- Record memory/performance unknowns in `REMAINING.md`.

Acceptance:
- UI thread has no recognizer implementation logic.
- A simulated worker exception returns a typed error and the document remains usable.
- The app can run with both new capabilities disabled.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 05 — Build a benchmark and golden-fixture harness before selecting models

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 05: Build a benchmark and golden-fixture harness before selecting models
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make recognizer choices evidence-driven and regression-testable.

Tasks:
- Inspect current fixture/test conventions and keep test data small enough for the repository.
- Create a benchmark harness that can evaluate outputs without requiring production models to be committed.
- Define fixture categories for equations:
  - simple;
  - nested fractions;
  - integrals/sums/products with limits;
  - matrices;
  - cases;
  - accents;
  - aligned equations;
  - noisy/low-resolution examples.
- Define fixture categories for diagrams:
  - clean vector flowchart;
  - raster flowchart;
  - reversed-arrow trap;
  - disconnected node;
  - ambiguous connector;
  - mixed figure.
- Define metrics/interfaces, at minimum:
  - math parse success;
  - normalized semantic/AST equivalence where possible;
  - rendered comparison hook;
  - visual node/edge/label/direction correctness;
  - serializer syntax validity.
- Do not manufacture ground-truth claims. Use hand-authored fixtures whose truth is explicit.
- Keep large/private future benchmark corpora out of git and document how to add them locally.
- Add a machine-readable benchmark result format for future model comparisons.

Acceptance:
- Harness runs with lightweight deterministic fixtures now.
- A deliberately wrong arrow direction and wrong equation AST are detected.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 06 — Replace regex-centric math conversion with a real MathIR parsing pipeline

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 06: Replace regex-centric math conversion with a real MathIR parsing pipeline
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: create `LaTeX -> semantic parse -> MathIR` independently of Word export.

Tasks:
- Locate the current equation parser/converter.
- Preserve existing simple-equation behavior with regression tests before replacing internals.
- Introduce a parser adapter boundary:
  `LaTeX -> parser/MathML or equivalent -> MathIR`.
- Prefer an existing already-approved dependency if capable. If considering a new TeX-to-MathML library, do not ship it until Step 24 licensing checks pass; you may create the adapter and test seam now.
- Support an initial semantic subset:
  - identifiers/numbers/operators;
  - Greek/math symbols;
  - fraction;
  - roots;
  - subscript/superscript/sub+sup;
  - fenced expressions;
  - common named functions;
  - integrals/sums/products and limits;
  - matrices;
  - cases/piecewise;
  - accents;
  - text-in-math.
- Unsupported syntax must return an explicit structured fallback/error; never silently strip unknown commands.
- Add AST normalization and deterministic serialization for tests.
- Keep canonical Markdown equation syntax unchanged (`$...$`, `$$...$$`).

Acceptance:
- Existing simple equations still parse.
- Nested constructs no longer rely on top-level regex matching.
- Unsupported constructs are visible and reviewable.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 07 — Implement MathIR to native Word OMML with structural tests

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 07: Implement MathIR to native Word OMML with structural tests
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: complete the downstream native Word equation path without coupling it to OCR.

Tasks:
- Inspect what the installed `docx` version can express and what GlyphMend currently uses.
- Map supported `MathIR` nodes to native Word math structures.
- Where the library lacks a construct, choose one of:
  1. safe OOXML/OMML generation with structural tests;
  2. explicit fallback to rendered visual while preserving LaTeX/MathIR.
- Never flatten an unsupported equation into misleading plain text.
- Add DOCX-level structural tests by opening the generated zip/XML and asserting expected OMML nodes.
- Add fixtures for nested fractions, sub+sup, roots, n-ary operators with limits, matrices, cases, accents, functions.
- Confirm generated documents can still be created entirely in-browser.
- Keep the old behavior behind a temporary compatibility path only if needed; document removal criteria.

Hard dependency:
- MathIR from Step 06. If unavailable, this step cannot safely implement full mapping. Record blocker; you may still audit current OMML capabilities/tests.

Acceptance:
- The test suite validates semantics in XML, not merely "DOCX file exists".
- Unsupported math is explicit and provenance-preserving.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 08 — Implement robust equation-region detection and source-crop preservation

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 08: Implement robust equation-region detection and source-crop preservation
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: identify equation image/regions without performing recognition yet, and always preserve evidence.

Tasks:
- Inspect current PDF text/image/block extraction and equation heuristics.
- Implement or refactor an `EquationCandidate` stage that records:
  - page/bbox;
  - native/vector/raster/mixed source;
  - source crop asset;
  - detection evidence;
  - quality signals (resolution, skew/noise indicators if available);
  - confidence/disposition.
- Prefer native PDF structure/text when available; do not rasterize a natively recoverable equation without reason.
- Preserve exact original crop or equivalent source evidence in the workspace.
- Add deterministic preprocessing helpers: crop normalization, margins, background normalization, optional deskew/noise handling only when it demonstrably helps.
- Do not invoke generic Tesseract as mathematical truth.
- Add fixtures for prose mistaken as math and math embedded near text.

Acceptance:
- Every candidate has source provenance and reversible crop.
- Detection can fail safely to preserved visual.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 09 — Add a pluggable local mathematical OCR provider and model-evaluation seam

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 09: Add a pluggable local mathematical OCR provider and model-evaluation seam
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: integrate math OCR without making the architecture depend on one research model or its license.

Tasks:
- Implement a `MathRecognizerProvider` interface used only through `math-worker`.
- Provider result must include:
  - LaTeX candidate(s);
  - token/sequence confidence if available;
  - model/runtime/version/hash;
  - warnings;
  - timing/resource stats.
- Add a deterministic `mock/test provider` so CI does not require large model downloads.
- If an approved local model/runtime is already available in the repo, integrate it behind the interface.
- If no model has been approved:
  - do NOT silently download or commit one;
  - add adapters/documented integration points;
  - log model selection/licensing as an OPEN/BLOCKED ledger item;
  - continue with the rest of the step.
- Prepare benchmark invocation against Step 05 harness.
- Do not choose a model because of README claims alone.
- Do not add cloud/API recognition.

Acceptance:
- Production code is provider-agnostic.
- CI tests worker/provider behavior without model weights.
- Missing model pack is a normal capability state, not an app failure.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 10 — Implement equation validation: parse, render-back comparison, and confidence gating

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 10: Implement equation validation: parse, render-back comparison, and confidence gating
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: prevent plausible-looking OCR errors from silently replacing source equations.

Tasks:
- Pipeline:
  source crop -> recognizer candidate -> parse to MathIR -> local render -> comparison -> policy.
- Reuse Step 03 confidence/disposition policy.
- Implement validation components:
  - LaTeX parse success;
  - MathIR construction success;
  - render success;
  - visual/structural similarity hook;
  - source quality;
  - recognizer confidence if present.
- If a robust pixel/feature similarity implementation is not yet justified, create a tested interface plus conservative baseline metric; record enhancement work. Do not fake high confidence.
- Automatic acceptance must require all mandatory gates.
- Medium evidence becomes `review`.
- Failed parsing/rendering becomes `preserved` with candidate retained as suggestion if useful.
- Add adversarial tests: visually similar but semantically different symbol, missing denominator, wrong limit, etc.
- Persist validation components in the manifest.

Acceptance:
- No raw recognizer output can bypass parsing/validation to become accepted canonical math.
- Source image always remains available.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 11 — Build the unified reconstruction Review Queue, starting with equations

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 11: Build the unified reconstruction Review Queue, starting with equations
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: turn uncertainty into a manageable product workflow.

Tasks:
- Inspect current editor/workspace UI patterns before adding a new system.
- Create a generic review model/UI that can later host equations, diagrams, charts, tables, and OCR regions.
- First implement equation items with:
  - original source crop;
  - rendered reconstruction;
  - editable LaTeX;
  - confidence components;
  - recognizer/version metadata in an expandable details area;
  - actions: Accept, Edit, Keep original/Revert;
  - keyboard-accessible navigation.
- Editing LaTeX must reparse/revalidate before acceptance.
- Review decisions must update disposition/provenance without deleting source evidence.
- Ensure bulk actions do not auto-accept low-confidence items.
- Add tests for state transitions and persistence/reload.
- Keep the interface usable when recognition capability is unavailable.

Acceptance:
- Review state survives reload/checkpoint.
- A user can always revert accepted reconstruction to source image.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 12 — Implement VisualIR and deterministic recovery from native PDF vector structure

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 12: Implement VisualIR and deterministic recovery from native PDF vector structure
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: improve figures by using the highest-quality evidence first rather than rasterizing and asking ML to rediscover it.

Tasks:
- Inspect current "simple vector box/connector -> Mermaid" logic in detail.
- Refactor recognition into:
  `PDF primitives/text/geometry -> VisualIR`.
- Extract only semantics supported by evidence:
  - boxes/rounded boxes/ellipses/diamonds when confidently detectable;
  - text labels and geometry;
  - line/connectors;
  - arrow direction when determinable;
  - basic grouping/containment;
  - minimal style data required for faithful render.
- Keep ambiguous geometry as warnings/unresolved elements rather than inventing topology.
- Preserve source page region and original primitives/provenance.
- Add tests for connector direction, crossing lines, labels, disconnected nodes, and ambiguous arrowheads.
- Existing Mermaid output should remain compatible through an adapter in the next step.

Acceptance:
- Core recognition emits VisualIR, not Mermaid source.
- Existing simple vector diagrams remain at least as accurate as baseline.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 13 — Add VisualIR -> Mermaid + safe SVG rendering

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 13: Add VisualIR -> Mermaid + safe SVG rendering
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make Mermaid a serializer/output, not the recognition architecture.

Tasks:
- Implement deterministic `VisualIR -> Mermaid` for the supported flow/process subset.
- Stable node IDs and deterministic ordering are required so output is diff-friendly.
- Escape/sanitize labels correctly.
- Render Mermaid to SVG using the existing/local browser approach where available.
- Treat generated Mermaid/SVG as hostile content:
  - restrictive Mermaid config;
  - no arbitrary HTML execution;
  - sanitize SVG;
  - preserve CSP;
  - do not permit labels to inject scripts/foreign content.
- Validate Mermaid syntax before marking an asset accepted.
- Compare rendered output against deterministic fixtures where possible.
- Keep the source visual and VisualIR even when Mermaid is accepted.

Acceptance:
- Serializer can round-trip test fixtures deterministically.
- Invalid Mermaid cannot replace source evidence.
- No security relaxation is introduced for rendering.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 14 — Add deterministic raster flowchart reconstruction with local CV + OCR

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 14: Add deterministic raster flowchart reconstruction with local CV + OCR
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: handle clean raster flowcharts locally before introducing a visual ML fallback.

Tasks:
- Use the `visual-worker`.
- If OpenCV.js or an equivalent local CV dependency is not already approved, isolate it behind a small adapter and record license/bundle implications before adding.
- Build a staged pipeline:
  - normalize crop;
  - threshold/edge/contour processing;
  - shape candidates;
  - line/connector candidates;
  - arrowhead/direction candidates;
  - OCR text regions using existing local OCR where appropriate;
  - associate labels/nodes/edges;
  - emit VisualIR;
  - confidence gate.
- Do not force every raster figure into this pipeline. Add a conservative "not a simple flowchart" rejection.
- Record per-stage diagnostics for review/debugging, but do not expose huge debug payloads by default.
- Test with direction traps and noisy samples.
- If OCR or CV dependency is unavailable, implement the interfaces/tests and log blocker rather than inventing results.

Acceptance:
- Clean supported flowcharts can become VisualIR/Mermaid.
- Ambiguous topology is review/preserved, never silently guessed.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 15 — Add optional local ML visual recognizer only as a fallback

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 15: Add optional local ML visual recognizer only as a fallback
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: handle diagrams the deterministic pipeline cannot reconstruct while keeping ML subordinate to evidence.

Tasks:
- Implement a `VisualRecognizerProvider` interface behind `visual-worker`.
- Invocation order must remain:
  native/vector -> deterministic CV -> optional ML -> preserve source.
- ML provider output must be converted/validated into VisualIR; it must never emit trusted Mermaid directly into canonical output.
- Add model/runtime/version/hash, confidence, and timing metadata.
- Use a mock provider in CI.
- Do not download/ship model weights until licensing and benchmark criteria are approved.
- Validate ML topology against deterministic evidence when such evidence exists.
- A contradiction between ML and deterministic geometry must lower confidence or require review, not be silently resolved in favor of ML.
- Add feature flag/capability state.

Acceptance:
- App works fully with ML disabled.
- Provider failure does not affect deterministic extraction or source preservation.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 16 — Add selective PlantUML support for diagrams Mermaid cannot faithfully express

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 16: Add selective PlantUML support for diagrams Mermaid cannot faithfully express
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: broaden semantic diagram export without turning PlantUML into a second recognition system.

Tasks:
- Create `VisualIR -> PlantUML` only for a clearly defined supported subset (for example selected UML-like structures) where VisualIR has sufficient semantic information.
- Do not infer UML semantics solely to justify PlantUML output.
- Keep Mermaid preferred for ordinary flow/process graphs when faithful.
- Add browser-local rendering only if the renderer/dependency passes license, security, and bundle review.
- If renderer integration is deferred, still support safe source serialization and record rendering gap.
- Sanitize all rendered output and keep CSP strict.
- Add syntax-validation and deterministic-output tests.
- Add routing rules with explicit reasons: Mermaid | PlantUML | SVG/source.

Acceptance:
- Format selection is deterministic and explainable.
- Unknown/freeform visuals do not get mislabeled as UML.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 17 — Introduce ChartIR and conservative Vega-Lite export

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 17: Introduce ChartIR and conservative Vega-Lite export
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: treat data charts as data/encoding structures rather than boxes-and-arrows.

Tasks:
- Keep this feature conservative and behind review by default.
- Define/complete `ChartIR`:
  - recovered data table with provenance per value where practical;
  - mark type;
  - axes;
  - labels;
  - legend;
  - encodings;
  - units/scales when explicitly recoverable;
  - confidence per component.
- Prefer deterministic extraction from native PDF vectors/text/data-like structure.
- For raster charts, do not automatically accept recovered numeric values unless stringent validation exists.
- Implement `ChartIR -> Vega-Lite` for a small initial subset (bar/line/scatter only if evidence supports them).
- Export recovered data as CSV/JSON alongside the spec.
- Render locally to sanitized SVG if an approved renderer is available.
- Every chart reconstruction must retain source image and default to review unless fully deterministic.
- Add tests where a single wrong numeric value causes rejection/review.

Acceptance:
- A chart cannot be accepted merely because its rendering "looks similar".
- Numeric provenance and uncertainty are visible.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 18 — Upgrade DOCX visual export: SVG first, native DrawingML subset second

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 18: Upgrade DOCX visual export: SVG first, native DrawingML subset second
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: provide honest levels of editability in Word.

Tasks:
- Define export tiers:
  1. semantic source preserved in bundle;
  2. SVG embedded in DOCX;
  3. native Word shapes/connectors only for a safe supported VisualIR subset.
- First ensure accepted Mermaid/PlantUML/Vega-Lite renders can be embedded as SVG (or the best supported vector fallback) without raster quality loss where the current DOCX stack permits it.
- Then implement a deliberately limited VisualIR -> DrawingML/native-shape mapper for:
  - rectangle;
  - rounded rectangle;
  - ellipse;
  - diamond;
  - text box;
  - straight/elbow connector;
  - arrow;
  - grouping only if safe.
- Unsupported or ambiguous diagrams fall back to SVG; never approximate silently.
- Add structural DOCX XML tests similar to equation OMML tests.
- Document the exact meaning of "editable" in Word versus semantic editability in GlyphMend.

Acceptance:
- Unsupported native-shape cases degrade to faithful SVG/source, not incorrect shapes.
- DOCX export remains browser-side.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 19 — Simplify the web design system into an HIG-aligned Liquid Glass interpretation

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 19: Simplify the web design system into an HIG-aligned Liquid Glass interpretation
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: fix the design architecture before changing every screen.

Tasks:
- Audit existing design tokens/material variants and component usage.
- Do not attempt to mimic native Apple optical physics exactly in CSS.
- Establish a small semantic surface vocabulary, e.g.:
  - content/background;
  - content/elevated;
  - glass/regular;
  - glass/clear;
  - glass/selected-overlay.
- Restrict glass primarily to navigation/control chrome, not document content.
- Remove redundant per-component pseudo-material variants only after mapping their usage and visual regressions.
- Preserve semantic light/dark tokens.
- Centralize:
  - typography;
  - spacing;
  - radii;
  - separators;
  - accent;
  - glass fill/edge/highlight/shadow;
  - motion durations.
- Keep `-apple-system`/platform font fallbacks appropriately; do not bundle Apple proprietary fonts.
- Create a small design-system demo/test page or Storybook-like internal fixture if the project already has an equivalent convention.
- Document that web output is "HIG-aligned Liquid Glass interpretation", not native Liquid Glass.

This UI track can proceed even if math/visual recognition tracks are incomplete.

Acceptance:
- Fewer material primitives than baseline.
- Content remains visually calm and glass is not stacked indiscriminately.
- Light/dark modes use semantic tokens rather than duplicated component rules.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 20 — Rebuild workspace responsiveness around available space, not a single mobile breakpoint

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 20: Rebuild workspace responsiveness around available space, not a single mobile breakpoint
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make GlyphMend genuinely usable across phone, tablet, resizable windows, and desktop.

Tasks:
- Audit all fixed viewport/device assumptions, especially the current major ~820px transition.
- Define layout modes by available content width, not device name:
  - compact: one content pane + mode switch;
  - medium: main + optional secondary pane;
  - wide: source + editor/preview;
  - extra-wide: source + editor/preview + inspector/review.
- Prefer CSS Grid, intrinsic sizing, `minmax()`, container queries where support/build policy permits, safe-area insets, and dynamic viewport units.
- Keep media queries only where semantically justified.
- Compact navigation should prioritize:
  - back/title/menu at top;
  - mode/navigation actions reachable at bottom where appropriate;
  - settings/export/quality in sheets/popovers rather than permanent side inspectors.
- Do not simply hide desktop controls; preserve equivalent capability.
- Ensure document canvases do not become glass panels.
- Add responsive e2e screenshots or layout assertions at representative widths, without tying logic to product names.

Acceptance:
- No primary behavior depends solely on "mobile <= 820px".
- Resize transitions preserve current document/editor state.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 21 — Make accessibility and input modality first-class in the new UI

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 21: Make accessibility and input modality first-class in the new UI
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make the material and interactions adapt to accessibility preferences and pointer/keyboard/touch input.

Tasks:
- Audit existing support for:
  - reduced motion;
  - reduced transparency;
  - increased contrast;
  - forced colors;
  - coarse pointer;
  - keyboard focus.
- Ensure reduced transparency changes the glass material itself to a more opaque/frosted treatment.
- Ensure increased contrast strengthens foreground/boundaries rather than only changing arbitrary colors.
- Remove elastic/morphing/scale motion under reduced motion.
- Add explicit GlyphMend appearance/accessibility overrides only where browser/OS propagation is unreliable, and make defaults follow system preferences.
- Review touch target sizes, focus order, keyboard shortcuts, screen-reader labels, live progress/status announcements, dialog/sheet focus trapping.
- For MathIR rendering, provide semantic MathML/accessibility output where the chosen renderer supports it.
- For VisualIR, generate an editable textual description of nodes/edges as an accessibility fallback.
- Add automated accessibility checks if existing tooling supports them, plus manual checklist documentation.

Acceptance:
- Core workflow is keyboard-operable.
- Review Queue source/reconstruction comparison is accessible without relying only on color or transparency.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 22 — Build the reconstructable GlyphMend export bundle

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 22: Build the reconstructable GlyphMend export bundle
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: make provenance and semantic editability survive outside one browser session.

Tasks:
- Extend the complete export format without breaking existing plain Markdown/DOCX exports.
- Define a versioned bundle such as:
  - `document.md`
  - `document.docx`
  - `assets/originals/`
  - `assets/rendered/`
  - `assets/reconstructed/`
  - `diagrams/*.mmd`
  - `diagrams/*.puml`
  - `charts/*.vl.json`
  - `charts/*.csv`
  - `equations/*.tex`
  - optional `equations/*.mathml`
  - `manifest.json`
  - `quality-report.json`
- Manifest must map each semantic asset to source page/bbox/source asset, reconstruction, confidence, versions, disposition, and checksums.
- Ensure deterministic file naming and stable IDs.
- Add checksums and validate bundle consistency.
- Do not place secrets, local absolute paths, or unnecessary device metadata in the bundle.
- If import/round-trip restoration already exists, migrate it. Otherwise specify import as a separate ledger item rather than pretending export alone is round-trip.
- Add zip-structure tests.

Acceptance:
- An accepted equation/diagram can be traced back to source evidence from the bundle alone.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 23 — Security hardening for executable/active reconstructed formats

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 23: Security hardening for executable/active reconstructed formats
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: prevent Mermaid, PlantUML, SVG, Markdown preview, or generated markup from expanding the attack surface.

Tasks:
- Threat-model:
  - malicious PDF text becoming diagram labels;
  - SVG scripts/event handlers/external URLs;
  - HTML in Mermaid labels;
  - Markdown/HTML injection;
  - prototype pollution/unsafe parsing;
  - worker message abuse;
  - model-pack URL/code injection;
  - zip path traversal in bundle handling;
  - oversized/decompression-bomb assets;
  - CSP regression.
- Audit DOMPurify/sanitization boundaries and renderer configs.
- Use strict renderer security settings.
- Disallow arbitrary document-provided code/model URLs.
- Validate all worker messages and IR/manifest inputs.
- Add size/resource ceilings with graceful errors, not crashes.
- Keep PDF JavaScript/attachments/links non-executable.
- Add security regression tests for malicious labels/SVG/Markdown/bundle paths.
- Do not relax CSP because a library is inconvenient; find a compatible configuration or log the blocker.

Acceptance:
- Reconstructed active formats are treated as untrusted input end-to-end.
- Security tests demonstrate rejected malicious payloads.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 24 — Create a dependency/model licensing gate and SBOM-style inventory

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 24: Create a dependency/model licensing gate and SBOM-style inventory
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: prevent technically attractive components from silently creating redistribution or source-disclosure problems.

Tasks:
- Inventory runtime dependencies, optional dependencies, renderers, model runtimes, model weights, datasets, fonts, and WASM binaries.
- For each relevant item record:
  - purpose;
  - code license;
  - model-weight license;
  - training-data terms if known/relevant;
  - browser redistribution allowance;
  - commercial-use implications;
  - source-disclosure implications;
  - source URL/version/hash if already vendored;
  - review status.
- Pay special attention to existing MuPDF licensing and any candidate math/visual models mentioned in the research.
- Do not infer that a repository code license automatically covers weights/data.
- Create `docs/upgrade/DEPENDENCY_LICENSES.md`.
- Add an automated license report command if the existing package manager/tooling supports this reasonably.
- Any unknown or incompatible license becomes a `BLOCKED` ledger entry and the feature stays optional/unbundled.
- Do not remove existing dependencies solely based on this prompt without understanding current project licensing strategy.

Acceptance:
- No new production model/renderer dependency remains "license unknown".

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 25 — Optimize performance, storage, offline behavior, and optional model packs

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 25: Optimize performance, storage, offline behavior, and optional model packs
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: keep the local-first PWA fast and usable on constrained devices.

Tasks:
- Measure current and new:
  - JS/WASM bundle size;
  - initial load;
  - worker initialization;
  - peak memory where measurable;
  - model load time;
  - extraction throughput;
  - IndexedDB usage;
  - service-worker cache footprint.
- Introduce optional capability packs rather than forcing all recognition assets into core.
- Provide local install/uninstall/status metadata for optional Equation Recognition and Advanced Visual Recognition packs if actual model assets are approved.
- Cache approved model assets for offline use with explicit version/hash.
- Never fetch a model implicitly from a document-provided URL.
- Add resource scheduling so math and visual workers do not exhaust memory concurrently on mobile-class devices.
- Add cancellation and backpressure for long documents.
- Use capability detection for acceleration; maintain CPU/WASM fallback where supported.
- Record performance budgets and regression thresholds in docs/tests where practical.
- If a model is too large/slow, do not hide the result; mark it unsuitable or optional.

Acceptance:
- Core GlyphMend still loads and works without model packs.
- Offline mode remains functional for installed capabilities.

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```

# Prompt 26 — End-to-end integration, migration, regression, and release gates

Copy/paste the following into the coding agent:

```text
You are upgrading the GlyphMend repository.

STEP 26: End-to-end integration, migration, regression, and release gates
### Shared execution rules for this prompt

1. Work from the repository root. Inspect the current tree, package files, tests, git status, and relevant implementation before editing.
2. Do not assume earlier prompts succeeded. Check the files, symbols, tests, and documents they were expected to create.
3. If earlier work is missing, broken, incomplete, or inconsistent:
   - append or update an entry in `docs/upgrade/REMAINING.md`;
   - continue this step if the missing work is not a hard dependency;
   - if it is a hard dependency, do all safe non-dependent work and mark this step `PARTIAL` or `FAILED`.
4. Append this run to `docs/upgrade/PROGRESS.md`.
5. Never discard, reset, or overwrite unrelated user changes.
6. Do not weaken tests, validation, sanitization, security headers, fidelity rules, or confidence thresholds merely to obtain a passing build.
7. Preserve the product principle: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**.
8. Keep browser processing local/offline. Do not add a backend, cloud inference, telemetry, or document upload.
9. Do not introduce a new dependency until its need, bundle impact, maintenance state, and license are documented. If license is unclear, leave the integration behind an interface/feature flag and record it in `REMAINING.md`.
10. Run the narrowest relevant tests first, then the broader existing test suite/build/lint/typecheck where available.
11. If a task fails, make the final response unmistakable using the mandatory failure format from this plan.

Mission: prove the upgraded platform is safer and more capable without regressing existing PDF -> Markdown -> DOCX behavior.

Tasks:
- Re-read `REMAINING.md` from top to bottom.
- For every OPEN/BLOCKED/FAILED item:
  - verify whether it is still unresolved;
  - mark resolved items with evidence;
  - keep unresolved items and classify whether they block release.
- Run the full available test suite, build, lint/typecheck, and e2e tests.
- Run representative end-to-end documents through:
  1. text/native PDF path;
  2. scanned OCR path;
  3. simple equation image;
  4. complex equation;
  5. vector flowchart;
  6. raster flowchart;
  7. unknown/general illustration;
  8. chart;
  9. malicious/sanitization fixture;
  10. compact and wide UI workflows.
- Verify invariants:
  - canonical Markdown remains deterministic;
  - source evidence is retained;
  - low confidence does not auto-replace source;
  - DOCX equations are native when supported;
  - unsupported Word visuals fall back faithfully;
  - app works without optional models;
  - offline/PWA behavior works;
  - no backend/network document upload was introduced;
  - accessibility settings alter material/motion correctly.
- Compare bundle/performance metrics to Step 01 baseline.
- Create `docs/upgrade/RELEASE_READINESS.md` with:
  - shipped capabilities;
  - deliberately unsupported cases;
  - unresolved blockers;
  - performance deltas;
  - security/licensing status;
  - rollback notes;
  - migration notes.
- Do not call the upgrade complete if critical/high release blockers remain.

Acceptance:
- Release readiness is evidence-based.
- Any failed release gate is reported as:
  **❌ FAILED OR INCOMPLETE — STEP 26: RELEASE BLOCKED — <reason>**

Before editing, inspect git status and preserve unrelated changes. At the end, update `PROGRESS.md`, update/append `REMAINING.md` entries as needed, and use the mandatory step-result format. Do not claim success based only on code generation: verify with tests/builds and inspect generated artifacts when applicable.
```


---

# Recommended execution strategy

## Release Slice A — Foundation and math
Run prompts **00–04**, then run **Prompt 24 as the early dependency/license gate**, then continue with **05–11**. This creates the semantic architecture and completes the highest-value near-term feature: reliable equation reconstruction and native Word math.

A sensible first releasable milestone is:

- versioned semantic asset/provenance model;
- source equation preservation;
- MathIR;
- robust OMML;
- math recognizer provider seam;
- confidence-gated review flow;
- no mandatory large model bundle.

## Release Slice B — Diagrams
Run **12–16**, with **14–16** allowed to remain optional if bundle/licensing/model issues are unresolved.

The core success condition is not "many figures converted"; it is:
**supported figures are reconstructed faithfully and unsupported ones remain safely preserved.**

## Release Slice C — Charts and Word-native visuals
Run **17–18**. Treat chart value recovery as high-risk and conservative. SVG is an acceptable first Word result; DrawingML should cover only a deliberate subset.

## Release Slice D — Product/UI
Prompts **19–21** can run in parallel with the recognition tracks after Prompt 02. They should not wait for model work.

## Release Slice E — Productization
Run **22–26** to finish export, security, the **final rerun of the licensing audit**, performance/offline behavior, and release readiness.

---

# Engineering judgments behind the order

1. **IR before recognizers.** Otherwise OCR/VLM/CV code becomes coupled to Mermaid or DOCX and will be expensive to replace.
2. **Math before generalized figures.** GlyphMend already has a native Word math path; fixing the semantic parser completes a valuable end-to-end capability with a smaller recognition space.
3. **Vector before raster; deterministic before ML.** The PDF may already contain geometry that is more reliable than any image recognizer.
4. **Review before aggressive auto-conversion.** The product's credibility depends more on visible uncertainty than on maximizing conversion count.
5. **SVG before Word DrawingML.** This gives high-quality document output quickly while native Word-shape support grows safely.
6. **Charts later.** A wrong chart value can change the document's claim even when the visual reconstruction looks plausible.
7. **UI can run in parallel.** The HIG/Liquid Glass work is mostly orthogonal once core asset/review contracts are stable.
8. **Licensing is a release gate, not an afterthought.** Model code, weights, datasets, WASM, and renderers can have different terms.
9. **Optional model packs protect the PWA.** Core extraction should remain lightweight and offline even on devices that never install advanced recognition.
10. **The unresolved ledger is append-only.** An AI agent must never erase evidence of an incomplete prior step merely because a later implementation works around it.
