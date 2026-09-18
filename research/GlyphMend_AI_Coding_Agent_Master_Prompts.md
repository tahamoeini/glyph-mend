# GlyphMend AI Coding Agent Master Prompts

This file contains the execution sequence for AI coding agents working on GlyphMend.

Every step must:

- inspect current main and existing implementation first;
- preserve browser-first local architecture;
- avoid backend services and external AI APIs;
- use a dedicated branch for substantial work;
- record unfinished items in `docs/remaining-work.md` or the existing remaining-work ledger;
- verify changes with relevant tests and manual checks;
- clearly report FAILED tasks.

## Prompt sequence

## 00 — Repository audit and execution protocol

Goal:
Establish baseline state, inspect architecture, and create persistent progress tracking.

Deliverables:

- architecture map
- current limitations
- remaining work ledger
- regression baseline

## 01 — Extraction pipeline hardening

Goal:
Improve PDF extraction reliability without changing architecture.

Focus:

- MuPDF integration
- worker isolation
- bounded batches
- cancellation
- retries
- page-level failures
- deterministic outputs

## 02 — Semantic Document IR

Goal:
Separate extraction from serialization.

Introduce representations for:

- text
- headings
- lists
- tables
- equations
- figures
- provenance

## 03 — Layout reconstruction

Goal:
Improve:

- reading order
- columns
- hierarchy
- captions
- table relationships

## 04 — Equation reconstruction

Goal:
Recover editable mathematics.

Rules:

- prefer MathIR and LaTeX
- avoid image-only equations
- use fallback only when required
- never invent formulas

## 05 — Table reconstruction

Goal:
Improve structured table extraction while preserving uncertain layouts.

## 06 — Figure and diagram reconstruction

Goal:
Convert only reliably understood diagrams into editable representations.

Fallback:
Preserve original assets.

## 07 — OCR strategy improvement

Goal:
Use OCR only where embedded evidence fails.

Validate:

- language selection
- confidence
- page isolation

## 08 — Export quality

Goal:
Improve Markdown and DOCX fidelity.

Validate:

- formatting
- equations
- tables
- images
- Unicode

## 09 — Benchmark and regression system

Goal:
Create reproducible quality evaluation.

Include:

- difficult PDFs
- expected outputs
- quality reports
- performance measurements

## 10 — Final production review

Review:

- extraction quality
- UI responsiveness
- accessibility
- offline behavior
- security
- documentation

Final output must include:

- changed files
- verification performed
- remaining issues
- release readiness status
