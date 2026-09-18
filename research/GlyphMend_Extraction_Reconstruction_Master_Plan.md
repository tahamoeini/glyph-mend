
# GlyphMend Extraction Reconstruction Master Plan

Status: authoritative planning reference for the post-PR #35 extraction work.

This document is the consolidated plan for evolving GlyphMend from a PDF text extractor into a local-first document reconstruction engine:

PDF
→ raw extraction
→ layout understanding
→ semantic document IR
→ confidence-gated reconstruction
→ editable Markdown and DOCX
→ hidden provenance and visual evidence

It incorporates the useful findings from the previous research files and the decisions made during the GlyphMend extraction review. It is a plan, not a claim that all implementation work is complete.

## 1. Product decisions

GlyphMend must remain:

- browser-first and install-free;
- usable offline after the application is available;
- local and private;
- functional without a backend;
- functional without cloud inference or external AI APIs;
- useful on mobile and constrained devices;
- capable of processing large PDFs in bounded, resumable work;
- conservative when reconstruction is uncertain.

The browser engine is the complete default product. A future companion is an optional capability extension, not a replacement, downgrade, or separate user experience.

The output contract remains:

- editable Markdown;
- editable DOCX where the format can preserve editability;
- original visual evidence when semantic reconstruction is not reliable;
- hidden provenance metadata in the reconstructable bundle, not visible comments in ordinary documents.

The governing quality rule is:

strong evidence → reconstruct;
medium evidence → expose uncertainty and preserve evidence;
weak evidence → preserve the source visual and do not invent structure.

## 2. What the existing research contributes

The existing research identified several directions that must be retained:

- a semantic asset model is needed before adding recognizers;
- equations need a real MathIR between extraction and Markdown/DOCX;
- figures need a VisualIR rather than direct image-to-Markdown conversion;
- Mermaid is appropriate only for confidently graph-like diagrams;
- PlantUML is a selective alternative, not a universal replacement;
- charts require a separate ChartIR and conservative data recovery;
- SVG is a useful structural fallback for supported visuals;
- Word export needs multiple fidelity levels;
- recognition should run in dedicated workers and optional capability packs;
- review, provenance, determinism, security, licensing, and performance are product requirements, not afterthoughts;
- the UI should follow the Stitch source of truth and should not be redesigned as part of an extraction change unless a documented regression requires it.

The previous AI coding plan also contributed useful engineering controls:

- persistent progress and remaining-work ledgers;
- baseline measurements before optimization;
- typed contracts before recognizers;
- model and dependency licensing gates;
- security tests for reconstructed active formats;
- explicit release gates;
- no weakening of tests or confidence thresholds to obtain a passing build.

The old files are preserved under research/archive for historical traceability. This document supersedes them as the concise product and architecture plan.

## 3. Current-state diagnosis after PR #35

PR #35 established the right production-hardening direction:

- bounded batches;
- resumability;
- page-level isolation;
- cancellation and progress handling;
- extraction reports;
- confidence values;
- visual preservation;
- OCR fallback;
- large-document export handling.

The remaining quality problem is primarily semantic, not merely operational.

The current pipeline can know that text, images, or visual objects exist without reliably knowing:

- which blocks belong together;
- which column comes first;
- whether a large font is a heading or a decorative label;
- whether a visual is an equation, chart, diagram, or ordinary image;
- whether adjacent spans form a table cell;
- whether an equation can be reconstructed without changing its meaning;
- how a reconstructed node maps back to its page and position.

This creates false confidence: raw text presence can look successful while reading order, hierarchy, tables, equations, and export fidelity remain wrong.

The first engineering priority is therefore a layout and semantic reconstruction layer between MuPDF extraction and the existing exporters.

## 4. Target architecture

### 4.1 Shared document contract

Both execution paths must produce the same versioned semantic IR:

Browser runtime:
- MuPDF WASM;
- browser-compatible deterministic geometry and text analysis;
- local OCR fallback where already supported;
- bounded workers and browser storage.

Optional companion runtime:
- native Rust processing;
- native PDF and rendering capabilities where licensed and justified;
- optional local OCR, layout, table, or math capabilities;
- local IPC only;
- no cloud and no required installation.

Shared downstream:
- semantic reconstruction;
- confidence and disposition decisions;
- Markdown export;
- DOCX export;
- visual evidence and provenance bundle.

The browser must not wait for the companion. Capability detection must be additive: if the companion is absent, unavailable, declined, or unsupported on the device, the browser path remains usable.

### 4.2 Pipeline stages

1. Source intake
   - validate the local PDF;
   - preserve filename and document identity;
   - never upload the source.

2. Raw extraction
   - extract text spans, font information, geometry, images, vector paths, page metadata, and renderable evidence;
   - use embedded text before OCR;
   - isolate errors by page and batch;
   - retain raw evidence long enough for later reconstruction.

3. Layout understanding
   - normalize coordinates;
   - cluster lines and spans into blocks;
   - detect columns, indentation, alignment, whitespace, repeated headers, footers, captions, and footnotes;
   - infer deterministic reading order;
   - keep alternative or uncertain orderings in diagnostics rather than silently flattening them.

4. Semantic reconstruction
   - classify blocks as headings, paragraphs, lists, tables, equations, figures, captions, or metadata;
   - build MathIR, TableIR, VisualIR, and ChartIR where justified;
   - attach confidence and provenance to every semantic node.

5. Disposition
   - reconstruct editable content when confidence and validation support it;
   - preserve the source crop or original object when confidence is insufficient;
   - never replace evidence with invented content.

6. Export
   - render ordinary Markdown and DOCX without visible provenance noise;
   - export a reconstructable bundle containing metadata, assets, quality information, and stable IDs;
   - ensure all exporters consume the semantic IR rather than separate ad hoc extraction structures.

## 5. Semantic Document IR v2

The IR is the central contract between extraction, layout analysis, reconstruction, review, and export. It must be versioned and serializable.

### 5.1 Document and page

Document:
- schemaVersion;
- stable document ID;
- source metadata that is safe to export;
- page list;
- ordered root nodes;
- extraction engine and capability information;
- quality summary;
- warnings and errors.

Page:
- stable page ID;
- one-based page number;
- width and height;
- coordinate-space declaration;
- raw evidence references;
- ordered semantic nodes;
- page-level confidence and warnings.

### 5.2 Common node contract

Every node requires:

- stable deterministic ID;
- node type;
- normalized content or children;
- source page;
- bounding box;
- optional multiple source boxes when a node spans separated regions;
- source kind, such as embedded text, vector, image, OCR, or reconstructed;
- extraction confidence;
- structure confidence;
- export confidence;
- disposition;
- reconstruction version;
- diagnostics and warnings.

The source reference must identify enough information to locate the evidence again. At minimum it contains page and bounding box. Where available it may also contain span IDs, object IDs, crop asset IDs, and coordinate-space details.

Suggested node types:

- heading;
- paragraph;
- quote;
- list;
- list item;
- table;
- equation;
- figure;
- chart;
- caption;
- footnote;
- header;
- footer;
- page break;
- metadata;
- unresolved visual.

### 5.3 Confidence is multidimensional

Do not collapse all quality into one number.

Minimum dimensions:

- raw extraction confidence: was recoverable content obtained?
- reading-order confidence: is the sequence likely correct?
- structure confidence: is the node type and hierarchy likely correct?
- reconstruction confidence: is editable content faithful?
- export confidence: did the target format preserve the intended content?
- visual preservation confidence: was source evidence retained correctly?

A document summary may be useful, but node-level dimensions remain authoritative. Low raw-text confidence must not be hidden by high export confidence, and a high raw-text score must not imply correct reading order.

### 5.4 Disposition

Each asset or node receives an explicit disposition:

- reconstructed;
- reconstructed-with-source;
- preserved-source;
- needs-review;
- unsupported;
- omitted-decoration.

Disposition is deterministic from evidence and policy. A visual may be successfully recognized and still retain its source crop. Recognition must not destroy the fallback.

## 6. Layout and reading-order strategy

Reading order is the highest-value browser improvement.

### 6.1 Block formation

Use PDF geometry and style evidence to construct lines and blocks:

- baseline and vertical overlap;
- gap thresholds relative to font size;
- left and right alignment;
- indentation;
- font family, size, weight, and color;
- line spacing;
- whitespace before and after;
- repeated coordinates across pages;
- page margins;
- ruling lines and vector boundaries.

Avoid one global threshold for all documents. Thresholds should be normalized by page scale and local text metrics.

### 6.2 Column detection

Detect column regions before ordering blocks:

- project block boxes onto the horizontal axis;
- identify repeated gutters;
- separate sidebars, marginal notes, and body columns;
- use alignment and block density;
- do not merge columns merely because their vertical ranges overlap.

Order within a column top-to-bottom, then order columns according to the document's dominant direction and layout evidence. Preserve right-to-left text behavior where applicable.

### 6.3 Headings

Heading inference should combine:

- numbering pattern;
- font family, size, weight, and style;
- whitespace;
- indentation;
- location relative to page margins;
- following paragraph behavior;
- consistency with neighboring headings;
- table-of-contents evidence when available.

A large font alone is not a heading classifier. If hierarchy cannot be established confidently, preserve the text as a paragraph or a low-confidence heading with source metadata rather than inventing a level.

### 6.4 Paragraphs, lists, captions, headers, and footers

Paragraph grouping should account for:

- line continuation;
- justified alignment;
- hyphenation;
- indentation;
- blank-line semantics;
- language and writing direction.

Lists should use numbering, bullets, indentation, repeated patterns, and continuation behavior. Captions should be linked to nearby figures or tables only when proximity and style support the relationship.

Repeated header/footer patterns should be classified separately and excluded from body reading order by default, while remaining available in provenance and optional export modes.

### 6.5 Reading-order diagnostics

The system should retain diagnostics for:

- merged blocks;
- split blocks;
- crossing columns;
- uncertain heading levels;
- duplicate repeated text;
- unresolved ordering;
- skipped or isolated spans.

These diagnostics feed the quality report and benchmark harness.

## 7. Tables

Tables require a dedicated TableIR, not a generic text conversion.

### 7.1 Detection evidence

Use:

- repeated x coordinates;
- repeated y bands;
- aligned text spans;
- vector rules;
- whitespace grids;
- cell-like bounding boxes;
- repeated row patterns;
- nearby captions and labels.

The browser path should support clean digital tables and conservative borderless-table heuristics. It should not claim universal table understanding.

### 7.2 TableIR

TableIR contains:

- table bounding box;
- ordered columns;
- ordered rows;
- cells with row/column spans;
- cell text or child nodes;
- cell bounding boxes;
- cell confidence;
- detected rules and alignment;
- source references;
- table-level confidence;
- unresolved-cell diagnostics.

Never invent a missing value or silently shift a cell to make a rectangular table.

### 7.3 Export policy

- high confidence: Markdown table, with HTML or source evidence when Markdown cannot represent spans;
- medium confidence: structured HTML or reviewable table representation plus source crop;
- low confidence: preserve the visual source and describe the unresolved table in metadata.

The DOCX exporter may use native table structures when the TableIR is reliable. Otherwise it must preserve the source image/crop.

## 8. Equations and MathIR

Equations must move from image-first behavior toward editable representations without fabricating mathematics.

### 8.1 Detection

Detect inline and display candidates using:

- font and symbol analysis;
- baseline and vertical placement;
- mathematical glyphs;
- fractions, roots, superscripts, subscripts, Greek symbols, operators, and delimiters;
- centered display placement;
- surrounding text and punctuation;
- image regions that have equation-like geometry.

A text span containing a mathematical character is not automatically a complete equation.

### 8.2 MathIR

MathIR should represent, where evidence supports it:

- identifiers;
- numbers;
- operators;
- relations;
- functions;
- fractions;
- roots;
- superscripts and subscripts;
- accents;
- matrices;
- delimiters;
- inline/display mode;
- source glyph or region references.

LaTeX is the preferred Markdown representation. MathIR is the intermediate contract for validation and DOCX OMML conversion.

### 8.3 Validation and fallback

Every reconstructed equation requires:

- detection confidence;
- parse/reconstruction confidence;
- source-region reference;
- validation diagnostics;
- original crop or source image retained.

Use editable Markdown and native Word math when confidence is sufficient. When it is not, preserve the source region and mark it needs-review or preserved-source. Never invent a missing symbol, exponent, denominator, or sign.

Lightweight local recognition may be evaluated in the optional companion only. No cloud math API is allowed.

## 9. Figures, diagrams, charts, and visual evidence

VisualIR and ChartIR separate visual categories that have different safe reconstruction strategies.

### 9.1 Visual classes

- ordinary image;
- chart;
- graph or flowchart;
- diagram;
- equation image;
- logo;
- decoration;
- separator;
- background;
- unresolved visual.

Classification is confidence-gated. Low confidence means preserve the original visual.

### 9.2 Editable representations

- use Mermaid only for confidently graph-like diagrams whose nodes and edges are recoverable;
- use PlantUML only where it represents the evidence better and the syntax is sanitized;
- use SVG as a structural fallback for supported vector geometry;
- use Vega-Lite or equivalent only when chart data and encodings are reliably recovered;
- keep ordinary images as images;
- do not generate plausible but unverified diagrams.

The product should retain original and reconstructed forms together so the reconstruction can be audited.

### 9.3 Security

All generated Markdown, SVG, Mermaid, PlantUML, and chart specifications are untrusted derived data. Apply sanitization, strict render configuration, resource limits, and tests for:

- script and event-handler injection;
- external URLs;
- unsafe HTML labels;
- prototype pollution or unsafe object parsing;
- oversized assets;
- archive path traversal.

PDF JavaScript, attachments, and links must not become executable application behavior.

## 10. Optional cross-platform companion

The companion follows the browser-plus-local-runtime pattern used by tools such as local kernels and language servers, while remaining one GlyphMend product.

### 10.1 Responsibilities

Browser always provides:

- PDF intake;
- core extraction;
- layout analysis;
- ordinary OCR fallback where supported;
- semantic IR;
- Markdown and DOCX export;
- small and medium document processing;
- mobile support.

Companion may provide:

- native multi-threaded processing;
- stronger memory behavior for very large documents;
- native rendering;
- optional local OCR/layout/table/math recognition;
- optional hardware acceleration;
- local model packs.

### 10.2 Runtime and IPC

Start with a Rust cross-platform core and a local capability bridge. The exact transport must be selected after evaluating browser security, packaging, and platform support; candidate approaches are loopback HTTP with strict origin/token checks or a platform-native local IPC bridge.

The contract must define:

- protocol version;
- capability discovery;
- engine version;
- job creation;
- bounded progress events;
- cancellation;
- resumable checkpoints;
- page-level errors;
- IR schema version;
- graceful fallback to browser;
- shutdown and timeout behavior.

No document is uploaded to a remote service. The browser must not require the companion to start.

### 10.3 Security and lifecycle

- bind locally only;
- authenticate the browser-to-companion connection;
- validate origin and protocol messages;
- do not accept arbitrary filesystem paths without explicit user action;
- restrict model and asset paths;
- expose only the capabilities the installed engine actually supports;
- isolate failed jobs;
- keep logs local and privacy-safe;
- do not add telemetry.

### 10.4 Model policy

Classical geometry and PDF evidence come first. Lightweight local models may be added only after benchmarks show a meaningful benefit and after license, size, memory, and offline behavior are accepted. Heavy models should be optional packs, never part of the core browser bundle and never silently downloaded because a document requests them.

## 11. Export and provenance

Ordinary exports should remain clean. A reconstructable export bundle should include, where available:

- document.md;
- document.docx;
- manifest.json;
- quality-report.json;
- provenance.json;
- assets/originals;
- assets/rendered;
- assets/reconstructed;
- equations and diagrams in their source representations;
- stable IDs and checksums.

Do not include secrets, local absolute paths, or unnecessary device metadata.

The manifest maps semantic nodes to:

- source page and bounding box;
- source asset or crop;
- reconstruction type and version;
- confidence dimensions;
- disposition;
- exporter status;
- checksums.

Plain Markdown/DOCX exports must not be considered round-trip capable unless import and restoration are implemented and tested.

## 12. Benchmark and regression strategy

Create a deterministic corpus with explicit rights and stable fixtures:

- academic papers;
- academic books;
- business reports;
- clean digital PDFs;
- scanned PDFs;
- multilingual and right-to-left PDFs;
- bordered and borderless tables;
- inline and display equations;
- charts;
- vector diagrams;
- raster diagrams;
- mixed-layout documents;
- adversarial and security fixtures.

Metrics:

- character and word error rate;
- span/block alignment;
- reading-order accuracy;
- heading level accuracy;
- paragraph grouping accuracy;
- table structure and cell accuracy, including TEDS where suitable;
- equation token/LaTeX similarity and structural validation;
- visual preservation rate;
- Markdown validity and determinism;
- DOCX generation and visual-diff checks;
- peak memory, throughput, cancellation latency, and recovery success.

A benchmark must distinguish extraction, structure, reconstruction, and export errors. A single aggregate score is not sufficient.

Every change that affects extraction must run focused fixtures before broad tests. Golden outputs should be reviewed when intentionally changed and should never be updated merely to make CI pass.

## 13. Implementation order

### Phase 0 — Audit and baseline
Audit current main and PR #35, map the existing pipeline, capture representative outputs, and create the remaining-work ledger.

### Phase 1 — Semantic IR v2
Define versioned node contracts, provenance, confidence dimensions, dispositions, serialization, and compatibility adapters.

### Phase 2 — Layout and reading order
Implement block formation, column detection, paragraph grouping, heading inference, list/caption handling, header/footer separation, and diagnostics.

### Phase 3 — Tables
Implement TableIR, deterministic table detection, conservative reconstruction, confidence-gated export, and source fallback.

### Phase 4 — Equations
Strengthen MathIR, inline/display detection, deterministic reconstruction, validation, Markdown LaTeX, and DOCX OMML; preserve source crops.

### Phase 5 — Visuals
Implement VisualIR, vector-first recovery, figure classification, safe Mermaid/SVG/PlantUML/Vega-Lite boundaries, and source preservation.

### Phase 6 — Benchmarking
Build the fixture corpus and quality reports before selecting additional recognition models.

### Phase 7 — Companion foundation
Add the optional Rust runtime, capability handshake, versioned local protocol, cancellation, progress, and same-IR output. Do not move browser logic out of the browser yet.

### Phase 8 — Optional local packs
Evaluate and add lightweight local models only where benchmarks and licensing justify them. Keep all packs optional and offline-capable.

### Phase 9 — Productization and security
Complete reconstructable bundles, security controls, licensing inventory, performance budgets, accessibility, and review workflows.

### Phase 10 — Release hardening
Re-run the full regression corpus, compare against the baseline, inspect the UI against Stitch, verify browser-only behavior, and publish an evidence-based readiness report.

## 14. Definition of done

The plan is not complete merely because files compile.

A release candidate must demonstrate:

- browser-only extraction still works;
- no required backend, upload, cloud API, or Playwright;
- deterministic output for the same input and configuration;
- bounded memory and page-level failure isolation;
- cancellation and resumability where supported;
- provenance for reconstructed and preserved content;
- confidence values that distinguish raw extraction from structure;
- low-confidence content is preserved rather than invented;
- Markdown and DOCX exporters consume the same semantic IR;
- optional companion absence does not degrade the browser path;
- security and licensing gates pass;
- UI changes, if any, follow the Stitch source of truth;
- unresolved limitations are documented in docs/remaining-work.md.

## 15. Open decisions to keep explicit

- exact local IPC transport and packaging strategy;
- native PDF licensing and redistribution boundaries;
- approved model weights and optional-pack distribution;
- supported Word equation feature subset;
- acceptable table-span export policy for Markdown;
- whether review UI is part of the first production slice;
- benchmark fixture licensing and reproducibility;
- platform order for Windows, macOS, and Linux companion releases.

These are decisions to resolve with evidence, not assumptions to hide in implementation.

## 16. Source-of-truth files

- research/GlyphMend_Extraction_Reconstruction_Master_Plan.md — this consolidated plan;
- research/GlyphMend_AI_Coding_Agent_Master_Prompts.md — complete execution prompts;
- research/archive/ — superseded source research retained for traceability;
- research/stitch_glyphmend_desktop_interface_design/ — unchanged UI source of truth;
- docs/remaining-work.md — implementation ledger to be created or updated by coding work;
- docs/upgrade/PROGRESS.md and docs/upgrade/REMAINING.md — optional detailed execution ledger for multi-step implementation.
