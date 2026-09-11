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
- False positive reconstruction is worse than unresolved source evidence; policy should prefer preserved or review states over speculative acceptance.
## DOCX visual export tiers

Step 18 defines three deliberately different meanings of editability:

1. Semantic source tier: the complete browser export bundle keeps canonical Markdown and a visual manifest with available VisualIR, ChartIR, or notation source. This is GlyphMend semantic editability: the recognized object can be reviewed, re-rendered, or re-exported without treating Word XML as the source of truth.
2. SVG tier: DOCX embeds a supplied or locally rendered SVG as vector media, with a raster compatibility fallback required by the current Word package stack. The SVG remains visually scalable, but its internal lines and labels are not independently editable Word objects.
3. Native DrawingML tier: DOCX emits an editable Word group only for accepted, high-confidence VisualIR containing rectangle, rounded rectangle, ellipse, diamond, text box, straight connector, elbow connector, and arrow primitives with complete geometry. Unsupported styles, labels on connectors, groups, warnings, ambiguous geometry, and unknown shapes fall back to SVG or preserved source.

In Word, editable means a user can select and adjust the emitted Word shape, text, line, or arrow. It does not mean that Word can recover the original PDF semantics, notation, topology, or GlyphMend provenance. In GlyphMend, semantic editability means the canonical Markdown and retained semantic source remain inspectable and reversible; a Word-native shape is only an output projection. SVG and source fallbacks are therefore fidelity-preserving outcomes, not failed native conversion.

All three tiers remain browser-side and local/offline. PlantUML and Vega-Lite source serialization remains available, while renderer/runtime selection for those notations is still deferred until an approved local dependency is reviewed.