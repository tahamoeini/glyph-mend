# Extraction reconstruction roadmap

This roadmap records the production-hardening audit for PR #35. It is an
implementation document, not a claim that every release gate is complete.

## Constraints

- MuPDF, OCR, layout analysis, cleanup, and export remain browser-local.
- PDFs and extracted content are never uploaded to a backend or external AI
  service.
- The PWA remains offline-capable and resumable through local checkpoints.
- Existing extraction, review, asset, and export capabilities remain available.
- Recognition is confidence-gated: editable output requires evidence; weak or
  ambiguous content keeps reversible source evidence.
- No Playwright or heavy browser E2E framework is introduced.

## Current architecture

1. `extract-worker.js` opens the PDF with MuPDF WebAssembly, reads structured
   text/images/vectors, routes damaged or empty pages to the bundled local OCR
   worker, and emits one page result at a time.
2. `app.js` processes bounded page batches, persists page artifacts in
   IndexedDB, retries failed pages once in an isolated worker, and finalizes
   pages in source order.
3. `document-ir.js` is the semantic boundary between page extraction and
   cleanup/export. It carries page-local block order and source provenance.
4. `cleanup.js` applies heading, paragraph, task-list, running-matter, and
   equation policies before the Markdown view is produced.
5. `docx-export.js` uses the normal `docx` writer for small documents and the
   incremental OOXML/ZIP writer for large or asset-heavy documents. Equations
   use editable OMML when validation succeeds; source evidence is retained on
   failure.
6. The quality report records coverage, OCR use, confidence summaries,
   preservation counts, and page-level warnings.

## Audit findings and root causes

### Resolved in PR #35 and the current hardening commits

- Recursive MathIR expansion caused the previous structured-data failure on
  the 745-page Revenue Management export. Independent node, depth, and string
  limits now stop pathological graphs before export and preserve source
  evidence instead.
- Large DOCX generation no longer retains one complete OOXML document graph;
  the streaming writer emits package parts incrementally and isolates bad
  equation/visual blocks.
- New documents reset to **All pages**. Source, selected, and processed page
  coverage is visible, so a stale one-page custom range cannot appear to be a
  complete 56-page extraction.
- Damaged embedded-font text routes to local OCR while preserving a source-page
  image when the text mapping is not trustworthy.
- Stable two-column pages, escaped table pipes, equation duplicates, diagram
  fences, and source visual captions have regression coverage.
- Direct MuPDF inspection found that the dictionary page contains five
  separate stacked image XObjects; broad vertical coalescing was merging them
  into one crop. Recovery now joins only same-line, similarly sized fragments.
- Vector table rules are now used as evidence for a regular TableIR grid. The
  path rejects sparse/merged rows, so complex tables remain source-preserved;
  it does not invent empty cells to make Markdown appear rectangular.
- Vector graphics with labels are no longer discarded merely because their
  bounding region contains many text lines. Validated tables suppress only
  overlapping vector-table duplicates; other graphics remain reversible crops.

### Remaining structural problems addressed by this roadmap

- The first DocumentIR seam normalized blocks, but it did not make the
  required provenance contract explicit on every block. Missing geometry or
  confidence must be represented as unknown/low-confidence metadata rather
  than silently omitted.
- Block relationships were implicit. Captions, table captions, equations, and
  visual assets need deterministic parent/child links without embedding binary
  data or recursive MathIR objects.
- Header/footer cleanup still operated as destructive text removal. A repeated
  edge can be a real chapter heading, a continuation fragment, or a page label;
  one boolean `removeHeaders`/`removeFooters` decision is not enough.
- Table recovery is intentionally conservative, but its IR must distinguish
  verified cells from unavailable spans and retain table provenance for future
  merged-cell and multi-page reconciliation.
- Layout confidence was not a first-class page metric even though reading order
  depends on column geometry, whitespace, and alignment.
- The supplied 745-page Revenue Management and 56-page Wushu Dictionary PDFs
  are release fixtures, not committed repository fixtures. Their full browser
  rerun, rendered DOCX comparison, and peak-memory profile remain release
  gates.

## Implementation plan

### 1. Contracted semantic IR

Version the IR and make `DocumentIR`, `PageIR`, and `BlockIR` serializable.
Every block carries `sourcePage`, `bbox` (or an explicit unknown value), a
conservative confidence score, `extractionMethod`, and a `children` ID list.
Page relationships remain ID-based so assets and MathIR graphs cannot be
recursively duplicated.

### 2. Evidence-based layout

Keep MuPDF coordinates as evidence, detect stable columns before ordering,
group lines into paragraphs using spacing and alignment, and record the order
method and layout confidence on PageIR. Ambiguous geometry stays in source
order or is preserved for review.

### 3. Non-destructive running-matter decisions

Classify edge candidates as `REMOVE`, `KEEP`, or `MERGE` using repetition,
position, page-label signals, heading/chapter signals, and available font
metadata. Apply the decision to semantic blocks; do not globally delete text
from the final Markdown string.

### 4. Structure-specific IR and exports

Represent table cells, spans, captions, equations, figures, and footnotes as
typed blocks with provenance. Markdown and DOCX remain separate renderers of
the same ordered IR. A failed reconstruction emits a source asset/marker,
never a fabricated cell, formula, or diagram.

### 5. Quality and recovery

Expose text/layout/table/equation/figure confidence, suspicious missing
regions, OCR usage, and failed-page coverage. Keep bounded batches,
checkpointing, cancellation, retry isolation, and deterministic finalization.

### 6. Deterministic validation

Maintain lightweight fixtures for an academic textbook, research paper,
table-heavy document, equation-heavy document, and scanned document. These are
semantic/layout fixtures rather than private PDF uploads. Validate Unicode,
reading order, hierarchy, tables, equations, figures, source fallback, and
both DOCX writers without adding a browser E2E framework.

## Remaining release issues

- Full local browser reruns of the supplied 745-page and 56-page PDFs.
- Representative Markdown/DOCX visual comparison against those PDFs.
- Peak memory and final downloadable Blob measurements on supported browsers.
- Manual Stitch acceptance across desktop/tablet/mobile and light/dark themes.
- MuPDF/PyMuPDF licensing decision before distribution.
- Future multilingual OCR/math/visual model packs require separate size,
  license, offline, and quality review; no remote model is assumed.
