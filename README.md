# GlyphMend

> **Faithful document reconstruction from PDF to structured Markdown.**

GlyphMend is a local-first PDF reconstruction product. The browser platform is the complete default: it extracts documents on the user's device, stores resumable checkpoints locally, and exports Markdown and DOCX without a backend.

An optional Rust Companion can be downloaded and started by the user, then selected for an individual extraction job. It uses PDFium for PDF text, geometry, page objects, and rendering, and Tesseract for English OCR. Both engines exchange the versioned Semantic Document IR v2 and use the same Markdown and DOCX export paths. Browser extraction remains available when the Companion is absent, denied, unsupported, or fails.

No speed or accuracy advantage is claimed until independently labeled benchmarks support one for a specific document class.

## Start the browser platform

```bash
cd web-app
npm ci
npm run dev
```

Build the static application with `npm run build`. See the [Browser guide](docs/browser.md) for local processing, OCR, checkpoints, deployment, and troubleshooting.

## Optional Rust Companion

The Companion is opt-in and processes the PDF locally. Download links and connection instructions are in the app's Companion area and on the [GitHub Releases page](https://github.com/tahamoeini/glyph-mend/releases). Start the downloaded program, connect using its loopback endpoint and one-time pairing code, then select Companion for an individual job. Browser remains the default.

Companion extraction offers Fast OCR by default and High Accuracy OCR as an explicit option. Both English model sets are bundled in release packages. A release is published as a prerelease until benchmark results demonstrate repeatable improvements and browser-only behavior remains unchanged.

See [Companion architecture and API](docs/companion-engine.md) and [release requirements](docs/ci.md).

## Product contract

| PDF content | Output |
| --- | --- |
| Titles, paragraphs, and lists | Structured Markdown |
| Recoverable tables and equations | Markdown tables and display math |
| Source images and unresolved graphics | Preserved visual references and quality details |
| Scanned pages | English OCR when enabled and available |
| Page boundaries | Optional page markers |
| Extraction provenance | Semantic Document IR v2 with per-page engine and fallback details |

The reconstruction policy is conservative: preserve source evidence and expose uncertainty instead of inventing document structure. Markdown is the canonical text artifact; DOCX is a shared export layered on top.

## Documentation

- [Browser operations](docs/browser.md)
- [Browser application](web-app/README.md)
- [Companion engine and API](docs/companion-engine.md)
- [Architecture and repository layout](docs/architecture.md)
- [CI and release workflow](docs/ci.md)
- [Branding](docs/branding.md)
- [Active roadmap](docs/roadmap.md)
- [Documentation index](docs/README.md)
