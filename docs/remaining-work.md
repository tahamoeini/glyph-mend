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

### Distribution licensing

The existing MuPDF/PyMuPDF licensing decision remains a product/legal gate and
is tracked in the historical ledger. It is not silently resolved by this code
change.

### Reference fixture limitations

The supplied PDFs remain external release fixtures rather than repository test
assets. They should be rerun manually before release because the dictionary
contains multilingual glyphs and 78 figures, while the Revenue Management
book contains 745 pages, 24 tables, 23 equations, and 1,221 preserved visuals.
