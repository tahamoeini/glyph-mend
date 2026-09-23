# GlyphMend architecture and repository layout

## Product boundary

GlyphMend is a local-first document reconstruction toolkit. Its Browser and Python editions are separate implementations with different runtimes and adapters; they do not share one extraction core. They follow the same product principles: preserve source evidence, prefer deterministic reconstruction, expose uncertainty, and keep provider output separate from canonical document data.

The core flow is:

```text
PDF intake
  → recover text, layout, and source evidence
  → deterministic reconstruction
  → quality gate and review when uncertain
  → canonical internal document representation
  → Markdown output, with optional DOCX or reconstructable bundle
```

Semantic Document IR, VisualIR, TableIR, EquationIR, and ChartIR describe internal reconstruction data. Markdown is the primary user-facing text artifact. Provider output is evidence and cannot directly replace canonical IR.

## Top-level layout

```text
branding.json          Product identity and logo configuration
brand/                 Source brand assets
src/glyphmend/         Python public package
src/pdf_sanitizer/     Python implementation and compatibility namespace
web-app/               Browser-first application
companion/             Optional local diagnostic runtime and provider seam
tests/                 Python tests grouped by responsibility
docs/                  Current product and operations documentation
docs/archive/          Historical upgrade and roadmap records
.github/workflows/     Python, browser, Companion, and release automation
```

## Python edition

`glyphmend` is the canonical Python public package. The long-standing `pdf_sanitizer` namespace remains a compatibility surface. The Python and Browser editions use separate extraction implementations; neither is a wrapper around the other's core.

| Area | Modules |
| --- | --- |
| Public compatibility | `src/glyphmend/`, `src/pdf_sanitizer/__init__.py` |
| Branding | `branding.py` |
| Interfaces | `cli.py`, `gui.py`, `__main__.py` |
| Configuration and progress | `config.py`, `progress.py`, `reporting.py` |
| Extraction orchestration | `pipeline.py`, `workflow.py`, `workspace.py` |
| Native PDF adapters | `extractor.py`, `native.py`, `native_stderr.py`, `renderer.py` |
| Semantic reconstruction | `semantics.py`, `structure.py`, `tables.py`, `graphics.py`, `equation_quality.py` |
| Cleanup and validation | `sanitize.py`, `document_cleanup.py`, `running_matter.py`, `quality.py` |
| Word export | `docx_export.py`, `word_math.py` |

## Browser edition

```text
web-app/src/
  app.js                    UI state and extraction orchestration
  features/extraction/      Browser PDF/OCR extraction and reconstruction
  features/recognition/     Optional local visual and math providers
  features/companion/       REST client and provider adapter
  shared/                   Semantic IR, review, security, and export utilities
  storage/                  IndexedDB workspace persistence
  styles/                   UI styles
```

Browser extraction retains page provenance, commits bounded batches to IndexedDB, and preserves source visuals when structure cannot be validated. See [the Browser guide](browser.md) for current data flow and operations.

## Companion diagnostic runtime

`companion/` contains a loopback-only Rust HTTP service, shared job service, diagnostic provider, portable CLI, and optional Tauri adapter. REST v1 is its only active wire protocol. Pairing creates an origin-bound session; each job is scoped to its creating session. Binary region crops, bounded results, storage quotas, and cancellation protect the provider seam.

Companion currently reports diagnostic provider evidence. The main extraction pipeline does not route work to it, and Companion is not an extraction accelerator. Capability routing, evidence reconciliation, model integration, and capability-specific result schemas remain planned. See [the Companion guide](companion-engine.md) and the [active roadmap](roadmap.md).

## Branding and compatibility

Brand identity is separate from extraction configuration. Branding changes must not alter extraction fingerprints or invalidate checkpoints. Historical command aliases remain documented in the Python interface guides.

## Tests and automation

```text
tests/                         Python unit, integration, and interface tests
web-app/src/**/*.test.js       Browser unit and contract tests
companion/crates/**/tests      Rust contract, service, and bridge tests
companion/tests/               Browser-client to runtime end-to-end checks
```

| Workflow | Responsibility |
| --- | --- |
| `test.yml` | Python lint, matrix tests, package build, command smoke tests |
| `web-app.yml` | Browser tests, production build, and dependency/security gates |
| `companion.yml` | REST contract, Rust verification, browser-to-runtime E2E on Windows/Linux/macOS, dependency policy, portable artifacts |
| `release.yml` | Version/tag validation and GlyphMend distribution build |

Current unresolved work is tracked only in [docs/roadmap.md](roadmap.md). Historical upgrade and backlog snapshots live in [docs/archive/2026-09-upgrade/](archive/2026-09-upgrade/).
