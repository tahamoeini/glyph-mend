# GlyphMend Extraction Reconstruction Master Plan

## Purpose

This document is the long-term technical plan for evolving GlyphMend from a PDF extractor into a local-first document reconstruction engine.

Target pipeline:

PDF
↓
Raw extraction
↓
Layout understanding
↓
Semantic Document IR
↓
Content reconstruction
↓
Editable Markdown
↓
Editable DOCX

## Product principles

- Browser-first remains the default.
- No backend dependency.
- No cloud AI APIs.
- Offline and private by design.
- Preserve source evidence when reconstruction is uncertain.
- Prefer faithful reconstruction over invented structure.

## Current research integration

Existing research documents remain valuable and are integrated into this roadmap:

- `GlyphMend Upgrade Research.md` provides guidance for Visual IR, equation reconstruction, editable figures, Mermaid/PlantUML/Vega-Lite decisions, and UI considerations.
- `GlyphMend_AI_Coding_Agent_Upgrade_Plan.md` provides previous implementation planning and is superseded where this document conflicts with the newer extraction architecture.
- `stitch_glyphmend_desktop_interface_design` remains the UI source of truth and must not be modified.

## Target architecture

### Browser engine

Always available:

- MuPDF WASM
- deterministic extraction
- layout analysis
- local OCR fallback
- semantic reconstruction
- Markdown/DOCX export

### Optional local companion

A future Rust/Tauri companion enhances capability without replacing the browser version.

Capabilities:

- native processing
- large document workloads
- advanced local OCR
- optional ONNX models
- accelerated extraction

Both runtimes must produce the same Semantic IR.

## Major engineering phases

1. Extraction architecture audit
2. Semantic Document IR v2
3. Layout understanding and reading order
4. Table reconstruction
5. Equation reconstruction
6. Visual understanding
7. Benchmark and regression framework
8. Optional companion engine foundation
9. Optional advanced local extraction packs
10. Production hardening review

## Semantic IR requirements

Every extracted element should support:

- stable identifier
- type
- content
- page reference
- bounding box
- confidence
- source provenance

Supported nodes:

- heading
- paragraph
- list
- table
- equation
- figure
- metadata

## Quality goals

Measure:

- text accuracy
- reading order accuracy
- heading hierarchy accuracy
- table reconstruction quality
- equation correctness
- figure preservation
- Markdown quality
- DOCX quality

## Companion engine principles

The companion is:

- optional
- local-only
- cross-platform
- capability extension

It must never downgrade browser-only users.

## Remaining work

Track implementation gaps in `docs/remaining-work.md`.
