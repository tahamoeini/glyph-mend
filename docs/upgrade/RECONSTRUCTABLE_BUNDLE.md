# Reconstructable GlyphMend export bundle

The complete browser export is a versioned ZIP with `schema: glyphmend.reconstructable-bundle` and `version: 1`. It is generated locally and contains:

- `document.md` — canonical editable Markdown source.
- `document.docx` — the ordinary Word export for convenient use outside GlyphMend.
- `assets/originals/` — source PDF evidence and original asset bytes when available.
- `assets/rendered/` — faithful rendered SVG assets when available.
- `assets/reconstructed/` — semantic VisualIR, ChartIR, and equation sidecars.
- `diagrams/*.mmd` and `diagrams/*.puml` — only supported deterministic diagram source sidecars.
- `charts/*.vl.json` and `charts/*.csv` — only accepted ChartIR sidecars that pass the existing chart evidence gates.
- `equations/*.tex` and optional `equations/*.mathml` — equation source and available semantic markup.
- `manifest.json` — stable asset IDs, source page/bbox/source-asset links, disposition, confidence, provenance/version fields, file paths, and SHA-256 checksums.
- `quality-report.json` — the existing quality report.

File names are derived from stable semantic IDs, normalized for ZIP paths, sorted before packaging, and disambiguated deterministically. The manifest excludes secrets, absolute local paths, and device metadata. Its consistency validator rejects missing files, unlisted files, unsafe paths, size mismatches, and checksum mismatches.

The bundle preserves the evidence boundary: accepted semantic assets receive reconstruction sidecars; review or preserved assets retain source evidence and semantic JSON without being upgraded silently. Unsupported diagrams and weak charts remain in the source/semantic tiers.

The existing JSON workspace checkpoint import remains backward-compatible. ZIP bundle import and full cross-browser round-trip restoration are tracked separately and are not claimed by this export step.
