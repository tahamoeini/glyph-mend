<p align="center">
  <img src="web-app/public/brand/glyphmend-mark.svg" alt="GlyphMend logo" width="72" height="72">
</p>

<h1 align="center">GlyphMend</h1>

<p align="center"><strong>Faithful document reconstruction from PDF to structured Markdown.</strong></p>

<p align="center">GlyphMend is a local-first PDF reconstruction product. The browser platform is the complete default: it extracts documents on the user's device, stores resumable checkpoints locally, and exports Markdown and DOCX without a backend.</p>

<p align="center"><a href="https://glyphmend.negar.team/" target="_blank" rel="noopener noreferrer">Open the platform</a></p>

<p align="center">
  <a href="https://www.producthunt.com/products/glyphmend?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-glyphmend" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1247011&amp;theme=dark&amp;t=1789071061228">
      <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1247011&amp;theme=light&amp;t=1789071058947" alt="GlyphMend - Faithful document reconstruction from PDF to Text. | Product Hunt" width="250" height="54">
    </picture>
  </a>
</p>

Choose one of three modes:

- **Browser/PWA:** open GlyphMend in a supported browser or install the PWA. Browser extraction, local checkpoints, workspace import/export, Markdown, and DOCX work without the Companion.
- **Browser + local engine:** start the installed GlyphMend app with `--headless-companion`. The app hides its window, starts the loopback service, and opens the browser interface with a one-time pairing code. The browser remains the interface and fallback.
- **GlyphMend Desktop:** install the same app normally and use its bundled interface. The UI calls the shared Rust engine through Tauri IPC; no browser pairing or loopback server is needed.

The browser and both installed-app modes use the same versioned Semantic Document IR v2. Browser + local engine mode uses the loopback API; Desktop calls the same Rust service through Tauri IPC. GlyphMend does not publish a separate Companion installer. The CLI source is retained for developer diagnostics and benchmark tooling.

No speed or accuracy advantage is claimed until independently labeled benchmarks support one for a specific document class.

## Start the browser platform

Use Node.js 22 and npm from the repository root:

```bash
npm ci
npm run dev:web
```

Build the static application with `npm run build:web`. See the [Browser guide](docs/browser.md) for local processing, OCR, checkpoints, deployment, and troubleshooting.

## Develop the Desktop app

Install prerequisites for the host OS, then run from the repository root:

```bash
npm ci --include=optional
npm run dev:desktop
```

This prepares the target's pinned runtime and starts the shared interface in Tauri's development WebView. Keep a separate checkout for Windows, WSL, Linux, and macOS because native npm bindings and runtime files are platform-specific. For WSL, put the Linux checkout under its Linux filesystem (for example `~/src/glyph-mend`), not on a mounted Windows drive such as `/mnt/f`; see the [Desktop guide](docs/desktop.md).

**WSL2 status:** the latest reported WSLg launches still showed a blank/gray window, including with `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `GDK_BACKEND=x11`. The Tauri dev launcher now applies `WEBKIT_DISABLE_COMPOSITING_MODE=1` in WSL unless overridden, but that workaround still needs a visual check on this setup. A process starting does not confirm that the interface rendered. See the [Desktop guide](docs/desktop.md#reported-wsl2-issue).

To run the same engine with the browser interface, use the installed GlyphMend executable with `--headless-companion`; in development, use `npm run dev:companion`. See the [Desktop guide](docs/desktop.md).

## Headless Companion mode

This is a launch mode of the installed GlyphMend app, not a separate product download. It binds only to loopback, uses the existing one-time pairing protocol and capability report, and processes the PDF on the same machine. If pairing or processing fails, the browser provider remains available.

See [Companion architecture and API](docs/companion-engine.md) for the protocol and [release workflow](docs/ci.md) for the shared package version.

## GlyphMend Desktop

The integrated Desktop package targets Windows x64 (NSIS setup), Ubuntu 24.04 x64 (`.deb`), and macOS Intel and Apple silicon (`.dmg`). macOS has a 15.0 baseline; each installer may require the build host's later patch release, recorded in its Info.plist and runtime manifest. Both macOS architecture builds and all other platform packages use the same automatically calculated SemVer prerelease. One manually dispatched release builds the browser artifact and integrated Desktop installers into a single unsigned draft release; there is no separate Companion package. Stable public distribution requires code signing and macOS notarization.

The standard Windows installer uses the WebView2 bootstrapper and may need an internet connection to install WebView2 on a machine without its runtime. The alternative offline WebView2 installer adds about 127 MB and is not currently bundled. After installation, GlyphMend's frontend, PDFium, Tesseract, and all supported OCR models are bundled for offline work. The Desktop guide records the package and runtime checks: [GlyphMend Desktop](docs/desktop.md).

Every CI/CD run is manually dispatched from one workflow. Choose the fast, test-free `quick` mode for licensing and dependency checks, lint, typecheck, and browser/Desktop frontend builds. Full validation and release modes add Rust formatting, compilation, and dependency-policy checks; paired benchmarks and release packaging are also separate manual modes. Release skips tests by default; enable `release_smoke` to run installed-package PDF/OCR checks. See [CI/CD and releases](docs/ci.md) for commands and SemVer rules.

## Product contract

| PDF content | Output |
| --- | --- |
| Titles, paragraphs, and lists | Structured Markdown |
| Recoverable tables and formulas | Markdown tables and editable LaTeX math, with source crops for uncertain formulas |
| Source images and unresolved graphics | Preserved visual references and quality details |
| Scanned pages | OCR in English, Russian, Persian, or Simplified Chinese when enabled |
| Page boundaries | Optional page markers |
| Extraction provenance | Semantic Document IR v2 with per-page engine and fallback details |

The reconstruction policy is conservative: preserve source evidence and expose uncertainty instead of inventing document structure. Markdown is the canonical text artifact; DOCX is a shared export layered on top.

## Optional analytics

Browser Edition sends one product_opened event per page load when a public project token is configured for production. It shows no in-app setup prompt. The event's custom properties include only the fixed app name. PostHog also receives a session-scoped anonymous identifier and ordinary request metadata such as IP address and browser details; page views, autocapture, session replay, exception capture, feature flags, document content, and workspace data are disabled. GlyphMend Desktop does not load this integration.

The public project token is preconfigured for production Browser Edition builds. Set VITE_POSTHOG_PROJECT_TOKEN and VITE_POSTHOG_API_HOST to override the token or endpoint; set the token to an empty string to disable analytics. Use a public project ingestion token, not a personal API key. The CSP allows standard US and EU PostHog Cloud hosts; a self-hosted endpoint needs a matching CSP update.

## Licensing

The browser interface is licensed under AGPL-3.0-or-later; its [license](web-app/LICENSE) and deployed-version source links are available in the app footer. The Rust crates are separately licensed under Apache-2.0 OR MIT. Desktop bundles include these licenses and target-specific runtime notices.

## Documentation

- [Browser operations](docs/browser.md)
- [Browser application](web-app/README.md)
- [Companion workspace](companion/README.md)
- [Companion engine and API](docs/companion-engine.md)
- [GlyphMend Desktop distribution](docs/desktop.md)
- [Distribution status and release gates](docs/distribution-plan.md)
- [Architecture and repository layout](docs/architecture.md)
- [CI/CD and releases](docs/ci.md)
- [Compliance and data handling](docs/compliance.md)
- [Branding](docs/branding.md)
- [Roadmap and release readiness](docs/roadmap.md)
- [Documentation index](docs/README.md)
- [Creator and attribution](CREATOR.md)
