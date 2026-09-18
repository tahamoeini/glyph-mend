# GlyphMend Extraction Reconstruction Master Plan

## Mission

Evolve GlyphMend from PDF extraction into a local-first document reconstruction engine:

PDF
↓
raw evidence extraction
↓
layout understanding
↓
semantic document representation
↓
editable Markdown
↓
editable DOCX

The system must preserve privacy, offline capability, deterministic behavior, and source fidelity.

## Core principles

- Extract embedded PDF content before OCR.
- Never fabricate missing content.
- Prefer editable reconstruction when confidence is high.
- Preserve original visuals when reconstruction is uncertain.
- Keep Markdown as the canonical editable artifact.
- Keep DOCX as a downstream renderer.
- Separate recognition, semantic understanding, and export.

## Workstreams

### 1. Extraction foundation

- Audit MuPDF pipeline and workers.
- Improve bounded processing, cancellation, retries, and resumability.
- Preserve page-level isolation.
- Add regression fixtures from difficult PDFs.

### 2. Semantic document model

Introduce a stable intermediate representation for:

- text blocks
- paragraphs
- headings
- lists
- tables
- equations
- figures
- diagrams
- charts
- provenance metadata

### 3. Layout understanding

Improve:

- reading order
- multi-column handling
- headers/footers
- captions
- tables and figures relationships
- document hierarchy

### 4. Mathematics

Pipeline:

PDF math evidence
→ MathIR
→ Markdown LaTeX
→ DOCX equation representation

Image fallback only when semantic recovery is unreliable.

### 5. Visual reconstruction

Use conservative reconstruction:

- Mermaid for reliable diagrams
- structured representations for simple flows
- preserve source images for complex figures

### 6. Quality system

Add:

- extraction benchmarks
- golden fixtures
- quality reports
- confidence tracking
- regression comparison

### 7. Production hardening

Validate:

- large documents
- memory usage
- offline operation
- export reliability
- browser compatibility
- accessibility

## Execution order

1. Baseline audit
2. Semantic contracts
3. Provenance/confidence model
4. Extraction worker hardening
5. Layout improvements
6. Math reconstruction
7. Visual reconstruction
8. Export improvements
9. Benchmarking
10. Final UI and release review
