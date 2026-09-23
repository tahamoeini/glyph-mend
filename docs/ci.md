# CI and Companion releases

## Browser checks

From `web-app/`:

```bash
npm ci
npm run license:check
npm run lint
npm run typecheck
npm test
npm run build
```

The `web-app.yml` workflow runs the browser checks and production build for pull requests.

## Rust checks

From `companion/`:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Companion CI verifies the shared contract and browser client against the local API. OCR development builds require the Tesseract and Leptonica development libraries; release jobs install the platform toolchain and package the runtime libraries.

## Manual Companion release

Run `Companion Release` from GitHub Actions and provide a SemVer version such as `0.1.0-beta.1`. The workflow builds Windows x64, macOS x64/arm64, and Linux x64/arm64 packages, includes PDFium/Tesseract runtime files and both English OCR model sets, and produces third-party notices, SHA-256 checksums, an SBOM, workflow artifacts, provenance attestations, and GitHub Release assets.

Windows code signing and Apple Developer ID signing/notarization are required. Missing credentials and signing failures stop publication. Versions containing a prerelease identifier are published as prereleases. Stable promotion is a separate maintainer decision after repeatable benchmark improvements and a browser regression review.

No historical Python release or tag is rewritten by the current workflows.
