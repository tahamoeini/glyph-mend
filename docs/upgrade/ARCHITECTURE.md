# Architecture invariants

These are the current high-level invariants for the GlyphMend upgrade process.

- Markdown remains the canonical textual artifact.
- DOCX remains a downstream export format.
- Source evidence is preserved.
- Semantic IR separates recognition from serialization.
- Browser processing remains local-first and offline.
- Deterministic reconstruction precedes ML.
- Uncertainty is reviewable rather than silently accepted.

## Serialization and versioning rules

- Semantic IR lives in versioned JSON contracts, not in Mermaid, SVG, DOCX, Word OMML, or model-specific objects.
- Every IR contract exposes a `schemaVersion` field and is serialized deterministically with sorted object keys.
- Unknown fields are preserved so later upgrade steps can remain forward-compatible while the current seam stays narrow.
- Validation is lightweight and local to the shared contract module; the production extractors may adopt these contracts later through adapters.
- `ReconstructedAsset` is the routing layer that keeps recognizers from coupling directly to output-specific formats.