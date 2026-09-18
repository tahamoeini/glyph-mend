# GlyphMend AI Coding Agent Master Prompts

These prompts are the implementation instructions for future AI coding agents.

## Global rules for every task

Before changing code:

- Fetch latest main.
- Review current implementation.
- Review recent commits and PRs.
- Diagnose before implementing.
- Use a dedicated branch for substantial changes.

Never:

- add backend services
- upload documents
- use external AI APIs
- add Playwright
- remove existing capabilities
- break browser-only operation

## Prompt sequence

## 1. Audit and roadmap

Audit the extraction pipeline, MuPDF integration, IR, exporters, OCR, tests and CI. Create an accurate architecture map and document root causes of extraction failures.

## 2. Semantic Document IR v2

Create a stable intermediate representation connecting extraction, reconstruction, Markdown and DOCX.

Support:

- headings
- paragraphs
- lists
- tables
- equations
- figures

Every node requires provenance:

- page
- bounding box
- confidence

## 3. Layout understanding

Improve PDF geometry reconstruction:

- reading order
- multi-column documents
- headings
- paragraphs
- lists
- captions
- headers/footers

Use deterministic methods first.

## 4. Table reconstruction

Build a dedicated table pipeline.

Rules:

- never invent missing cells
- export only when confidence is sufficient
- preserve visuals when uncertain

## 5. Equation reconstruction

Move from image-first equations to:

PDF content
→ MathIR
→ LaTeX
→ DOCX equation

Use local-only approaches.

Never fabricate formulas.

## 6. Figure understanding

Introduce visual classification:

- image
- chart
- diagram
- equation image
- decoration

Create editable representations only when reliable.

## 7. Benchmark framework

Create deterministic extraction fixtures and regression metrics.

Cover:

- academic PDFs
- business documents
- scanned PDFs
- multilingual PDFs
- tables
- equations
- figures

## 8. Companion engine foundation

Create optional Rust/Tauri local companion architecture.

Requirements:

- browser remains complete
- local IPC only
- same Semantic IR
- no cloud

## 9. Advanced local extraction

Evaluate lightweight local models only:

- ONNX Runtime
- OCR models
- layout models
- equation models

Evaluate:

- size
- licensing
- privacy
- maintenance

## 10. Production review

Verify:

- extraction quality
- memory behavior
- large PDF handling
- cancellation
- resumability
- exports
- UI compatibility
- CI quality

Create final readiness documentation.
