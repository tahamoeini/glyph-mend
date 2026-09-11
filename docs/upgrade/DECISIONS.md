# Decisions

Decision records for upgrade-wide invariants.

## ADR-0001 — Markdown is the canonical textual artifact

Status: Accepted

Decision: GlyphMend treats Markdown as the canonical textual output for reconstruction.

Rationale: Markdown is inspectable, diff-friendly, and fits the repository's evidence-preserving workflow.

## ADR-0002 — DOCX is downstream from canonical Markdown

Status: Accepted

Decision: DOCX export is produced from reconstructed Markdown rather than becoming the canonical source.

Rationale: This preserves a single textual source of truth while still supporting office workflows.

## ADR-0003 — Source evidence is preserved

Status: Accepted

Decision: Reconstruction must preserve original evidence whenever semantics are uncertain or visual structure is not recoverable.

Rationale: The product favors faithful reconstruction over speculative normalization.

## ADR-0004 — Recognition is separate from serialization

Status: Accepted

Decision: Semantic IR should model recognized content independently from the final output format.

Rationale: This keeps parsing, reconstruction, and export concerns independently testable.

## ADR-0005 — Browser processing stays local and offline

Status: Accepted

Decision: Browser workflows must remain local-first and offline without requiring backend inference or upload.

Rationale: Local processing preserves privacy, portability, and the current product architecture.

## ADR-0006 — Deterministic reconstruction precedes ML

Status: Accepted

Decision: Deterministic reconstruction is preferred before any ML-assisted fallback.

Rationale: Deterministic methods are easier to inspect, test, and reproduce.

## ADR-0007 — Uncertainty is reviewable

Status: Accepted

Decision: Ambiguous reconstruction should surface reviewable evidence rather than silently inventing structure.

Rationale: Reviewable uncertainty aligns with the evidence-preserving contract.
