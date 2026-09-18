# GlyphMend Browser Edition — remaining work

This is the release-hardening summary. The historical append-only upgrade
ledger remains at [`docs/upgrade/REMAINING.md`](./upgrade/REMAINING.md).

## Resolved in this hardening branch

- MathIR no longer embeds recursive AST objects in every graph node.
- MathIR has independent node, depth, and serialized-payload limits.
- Oversized MathIR is preserved as source evidence in reconstructable bundles.
- DOCX export now selects an incremental OOXML/ZIP writer for large Markdown
  or asset-heavy documents. It emits `word/document.xml` in bounded chunks,
  keeps media as referenced ZIP entries, preserves parseable equations as
  editable OMML, and isolates bad visual/equation blocks.
- The extraction workspace now presents document summary, Smart Extraction,
  a collapsed Advanced Options section, and a dominant Start extraction action
  without removing existing control IDs or capabilities.
- `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` are
  available as release checks.
- Reference review now covers the supplied 745-page Revenue Management and
  56-page Wushu Dictionary exports: damaged embedded font text routes to OCR,
  adjacent duplicate equation emissions are suppressed, and edge detection
  has a wider geometry band for repeated headers and footers.
- A new PDF now resets the document scope to **All pages**. Reports and the
  quality panel expose source, selected, and processed coverage, and partial
  custom ranges are explicitly marked instead of appearing complete.
- Pages whose embedded font encoding contains replacement characters now keep
  OCR text for search/editing while preserving a full-page local source
  page as reversible evidence. If that fallback cannot be rendered, quality
  audit reports an error rather than silently dropping the page layout.
- Stable two-column pages are ordered column-by-column when geometry supports
  it. Conservative equation classification no longer treats ordinary status,
  version, or heartbeat thresholds as editable equations.
- DOCX export accepts both labelled and legacy unlabelled diagram fences,
  preserves their line breaks, and shares an escaped-pipe Markdown table
  parser between the bounded and streaming writers.
- Streaming OMML now preserves binary operands and distinguishes arithmetic
  addition/multiplication from LaTeX summation/product operators; malformed
  display blocks are kept as source text instead of swallowing later pages.
- Page extraction now emits a serializable DocumentIR containing ordered
  paragraphs, headings, lists, tables, figures, equations, and captions. The
  cleanup pipeline and Markdown generator consume that IR, while PDF
  coordinates remain provenance rather than presentation order.
- Table candidates now require consistent row shapes, carry confidence and
  source provenance, and refuse to emit a partial grid that would drop or
  invent cells. Source visual captions remain visible in both DOCX writers.
- Failed pages are retried once in an isolated worker batch. Successful retries
  clear their transient warning; pages that still fail remain in the quality
  report without failing the rest of the document.
- Quality reports now include text/table/equation confidence, figure
  preservation counts, and OCR page usage.

## Open or manually gated

### Browser visual acceptance

The repository has structural UI tests, but it does not contain a browser
visual-regression suite. Desktop, tablet, mobile, light theme, dark theme,
keyboard navigation, and source-PDF interaction still require a manual release
pass against the Stitch references.

### Final DOCX download buffer

Large exports no longer build one complete `docx` object graph. The streaming
writer bounds the working set while producing the ZIP package and yields during
document emission. The browser still materializes the final downloadable Blob;
that unavoidable delivery buffer is distinct from the old unbounded OOXML
object graph and should be included in release memory measurements.

### Recognition dependencies

No production-approved local mathematical OCR model, raster-CV runtime, or
visual ML model is bundled. Ambiguous equations and figures must continue to
fall back to preserved source assets until those dependencies are separately
reviewed for licensing, size, offline behavior, and quality.

The Hugging Face review confirmed that common image-to-text candidates are not
an automatic fit for the browser bundle: `microsoft/trocr-base-printed` is
listed at roughly 333M parameters and its repository metadata did not expose a
clear license in the review response; `naver-clova-ix/donut-base` is MIT but is
also a large general image-to-text model. Neither is bundled or called
remotely. The existing Tesseract path remains the approved local OCR fallback
until a smaller multilingual/math model passes the same review.

### Distribution licensing

The existing MuPDF/PyMuPDF licensing decision remains a product/legal gate and
is tracked in the historical ledger. It is not silently resolved by this code
change.

### Reference fixture limitations

The supplied PDFs remain external release fixtures rather than repository test
assets. They should be rerun manually before release because the dictionary
contains multilingual glyphs and 78 figures, while the Revenue Management
book contains 745 pages, 24 tables, 23 equations, and 1,221 preserved visuals.

### Known fidelity boundary

When a PDF's embedded font map is genuinely unmappable, the browser cannot
recover the original CJK or symbol characters from the damaged text stream.
The safe result is OCR plus an exact source-page image; editable table cells or
equations are emitted only when their geometry and reconstruction pass the
existing validators. A future release may add approved offline multilingual
OCR/CV packs, but no cloud or unlicensed model is assumed here.
