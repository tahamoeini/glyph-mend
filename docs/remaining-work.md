# GlyphMend Browser Edition — remaining work

This is the release-hardening summary. The historical append-only upgrade
ledger remains at [`docs/upgrade/REMAINING.md`](./upgrade/REMAINING.md).

## Resolved in this hardening branch

- MathIR no longer embeds recursive AST objects in every graph node.
- MathIR has independent node, depth, and serialized-payload limits.
- Oversized MathIR is preserved as source evidence in reconstructable bundles.
- DOCX parsing/export now flushes bounded sections and isolates equation and
  visual block failures.
- The extraction workspace now presents document summary, Smart Extraction,
  a collapsed Advanced Options section, and a dominant Start extraction action
  without removing existing control IDs or capabilities.
- `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` are
  available as release checks.

## Open or manually gated

### Browser visual acceptance

The repository has structural UI tests, but it does not contain a browser
visual-regression suite. Desktop, tablet, mobile, light theme, dark theme,
keyboard navigation, and source-PDF interaction still require a manual release
pass against the Stitch references.

### Final DOCX memory envelope

DOCX block parsing is bounded and yields between sections, but the `docx`
library still owns the complete final OOXML document before `Packer.toBlob()`.
This is safer than the previous monolithic parser and fixes the MathIR crash,
but a true constant-memory DOCX writer would require a reviewed OOXML package
streaming/assembly layer. Do not describe the current implementation as
constant-memory DOCX generation.

### Recognition dependencies

No production-approved local mathematical OCR model, raster-CV runtime, or
visual ML model is bundled. Ambiguous equations and figures must continue to
fall back to preserved source assets until those dependencies are separately
reviewed for licensing, size, offline behavior, and quality.

### Distribution licensing

The existing MuPDF/PyMuPDF licensing decision remains a product/legal gate and
is tracked in the historical ledger. It is not silently resolved by this code
change.
