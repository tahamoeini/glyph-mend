# GlyphMend dependency, model, and redistribution inventory

_Last reviewed: 2026-09-11 — Step 24_

This file is an engineering release gate and SBOM-style inventory. It is **not legal advice**. A package being open source, publicly hosted, or installable from npm/PyPI does not by itself prove that GlyphMend may redistribute it under any desired product license. Model code, model weights, datasets, fonts, WASM binaries, and generated assets are reviewed separately where relevant.

## Gate rules

1. Every direct production dependency must have an explicit review entry before it may be added.
2. The browser lockfile license expression must match the reviewed expression for every direct browser dependency.
3. Runtime files copied into the offline/PWA bundle are treated as redistributed artifacts, even if they enter the build transitively.
4. A code license does **not** automatically license model weights or training data.
5. `UNKNOWN`, unclear, or strategically incompatible licenses are `BLOCKED`; the related feature remains optional/unbundled until resolved.
6. Copyleft software is not automatically prohibited, but it must be consistent with the project-wide licensing/distribution strategy or covered by a suitable commercial/alternative license.
7. The product principle remains unchanged: **strong evidence → reconstruct; medium evidence → review; weak evidence → preserve the source**. Licensing uncertainty never justifies silently substituting a different reconstruction path.

Run from `web-app/`:

```bash
npm run license:report
npm run license:check
```

`license:check` is deny-by-default for new direct browser/Python runtime dependencies: if a new dependency is added without a reviewed policy entry, or a browser lockfile license expression drifts, the command fails. CI runs this gate before browser tests/builds.

## Project-level licensing blocker

The repository currently has no committed top-level `LICENSE` file and GitHub does not identify a repository license. That means this inventory **cannot** conclude that the current public repository/distribution strategy satisfies the AGPL obligations of MuPDF/PyMuPDF/PyMuPDF4LLM, nor can it conclude that a proprietary/commercial distribution is authorized. This is tracked as a `BLOCKED` item in `REMAINING.md`.

Do not infer that “the source is public” is equivalent to deliberate AGPL compliance. A project-wide license choice, notices/source-offer obligations, and the intended distribution model still need to be made explicitly. If the intended strategy is not AGPL-compatible, obtain and document appropriate Artifex commercial licensing before distribution.

## Current browser runtime dependencies

Versions below are resolved by `web-app/package-lock.json`; the automated report is the authoritative current-version view. npm `integrity` values in the lockfile pin package tarballs. Individual copied WASM/model files are not separately vendored in Git and therefore do not currently have repository-recorded per-file hashes.

| Item | Purpose | Code/artifact license | Weight/data terms | Browser redistribution / commercial implications | Source-disclosure implications | Source/version/hash | Review |
|---|---|---|---|---|---|---|---|
| `@tesseract.js-data/eng` | English OCR traineddata copied to `dist/tessdata` | npm package metadata: `MIT` | `eng.traineddata.gz` is a model/data artifact distributed by the package. Upstream training-corpus provenance was not independently re-audited in this step; no separate repository dataset is bundled. | MIT permits commercial redistribution subject to preserving its license/copyright notice. | No copyleft source-disclosure requirement beyond the MIT notice. | Manifest `^1.0.0`; lockfile tarball URL + integrity; copied path `4.0.0_best_int/eng.traineddata.gz`. | `APPROVED_WITH_NOTE` |
| `tesseract.js` | Browser-local OCR worker/runtime | `Apache-2.0` | No weights included by the runtime itself; weights are reviewed separately above. | Commercial redistribution permitted subject to Apache-2.0 notices. | No strong copyleft source-disclosure requirement. | Manifest `^7.0.0`; lockfile URL/integrity. | `APPROVED` |
| `tesseract.js-core` (transitive, explicitly copied) | Tesseract WebAssembly core copied into the offline bundle | `Apache-2.0` in the locked package | No model weights. | Commercial redistribution permitted subject to Apache-2.0 notices; treat copied WASM as shipped software. | No strong copyleft source-disclosure requirement. | Version/license reported by `npm run license:report`; lockfile URL/integrity. | `APPROVED_WITH_NOTE` |
| `pdfjs-dist` | PDF parsing/rendering and PDF.js WASM copied into the offline bundle | `Apache-2.0` | No model weights/data. | Commercial redistribution permitted with Apache notices. | No strong copyleft source-disclosure requirement. | Manifest `^5.4.149`; lockfile URL/integrity; `vite.config.js` copies `pdfjs-dist/wasm/*`. | `APPROVED` |
| `mupdf` | Browser PDF/vector parsing/rendering; JS/WASM copied into PWA bundle | lockfile: `AGPL-3.0-or-later`; Artifex also offers commercial licensing | No ML weights/data. | Technically redistributable under AGPL if obligations are satisfied, or under an applicable commercial license. This is a strategic licensing decision, not an attribution-only dependency. | AGPL can impose strong corresponding-source/network-use obligations. Exact obligations depend on distribution/use and should be reviewed before release. | Manifest `^1.28.1`; currently locked `1.28.1`; npm integrity in lockfile; `vite.config.js` copies MuPDF JS/WASM. | `BLOCKED_STRATEGY_REVIEW` |
| `dompurify` | Sanitization of untrusted preview/reconstructed markup | `(MPL-2.0 OR Apache-2.0)` in lockfile | N/A | Redistribution can be made under the applicable offered license; current gate watches expression drift. | If relying on Apache-2.0 option, no strong copyleft source-disclosure requirement. | Manifest `^3.2.6`; lockfile URL/integrity. | `APPROVED` |
| `docx` | Browser DOCX/OOXML generation | `MIT` | N/A | Commercial redistribution permitted with MIT notice. | None beyond MIT notice. | Manifest `^9.5.1`; lockfile URL/integrity. | `APPROVED` |
| `fflate` | Local ZIP creation/validation | `MIT` | N/A | Commercial redistribution permitted. | None beyond MIT notice. | Manifest `^0.8.2`; lockfile URL/integrity. | `APPROVED` |
| `idb` | Browser IndexedDB persistence | `ISC` | N/A | Commercial redistribution permitted. | None beyond ISC notice. | Manifest `^8.0.3`; lockfile URL/integrity. | `APPROVED` |
| `marked` | Markdown parsing | `MIT` | N/A | Commercial redistribution permitted. | None beyond MIT notice. | Manifest `^16.2.1`; lockfile URL/integrity. | `APPROVED` |
| `@esbuild/win32-x64` | Optional Windows build binary | `MIT` | N/A | Build-only; not intentionally shipped as GlyphMend runtime. | None beyond MIT notice if redistributed. | Manifest `^0.28.2`; lockfile URL/integrity. | `BUILD_ONLY` |
| `@rollup/rollup-win32-x64-msvc` | Optional Windows Rollup build binary | `MIT` | N/A | Build-only; not intentionally shipped as GlyphMend runtime. | None beyond MIT notice if redistributed. | Manifest `^4.63.1`; lockfile URL/integrity. | `BUILD_ONLY` |

### Browser dev/build dependencies

`@babel/preset-modules`, `@playwright/test`, `jsdom`, `vite`, `vite-plugin-pwa`, `vite-plugin-static-copy`, and `vitest` are development/build/test tooling, not intended production runtime payloads. Their transitive inventories remain available in `package-lock.json`. The Step 24 automated gate intentionally focuses on direct production dependencies and explicitly copied runtime assets; introducing a dev tool into the shipped bundle requires reclassification and review.

## Current Python runtime dependencies

The Python project does not currently commit a resolver lockfile, so Step 24 gates the set of declared runtime package names in `pyproject.toml` and records external license findings here. Pin/hash verification is therefore weaker than the browser lockfile path.

| Item | Purpose | Code license | Model/data terms | Commercial / redistribution implications | Source-disclosure implications | Source/version | Review |
|---|---|---|---|---|---|---|---|
| `pymupdf==1.28.2` | PDF parsing/rendering/extraction | Dual licensed: GNU AGPL v3 or Artifex commercial license | N/A | Commercial/proprietary distribution requires either AGPL compliance or an applicable Artifex commercial license. | Strong AGPL obligations may apply. | PyPI/GitHub Artifex package, pinned `1.28.2`. | `BLOCKED_STRATEGY_REVIEW` |
| `pymupdf4llm==1.28.2` | Structured PDF→Markdown extraction | Dual licensed: GNU AGPL v3 or Artifex commercial license | N/A | Same strategic concern as PyMuPDF; 1.28.2 is explicitly documented by upstream as AGPL across its stack. | Strong AGPL obligations may apply. | PyPI/GitHub Artifex package, pinned `1.28.2`. | `BLOCKED_STRATEGY_REVIEW` |
| `python-docx>=1.1.2,<2` | Python DOCX generation | `MIT` | N/A | Commercial redistribution permitted with MIT notice. | None beyond MIT notice. | PyPI/GitHub `python-openxml/python-docx`; version range in `pyproject.toml`. | `APPROVED` |

Build/dev-only Python entries (`hatchling`, `build`, `pytest`, `ruff`) remain tooling rather than shipped runtime dependencies. If packaging begins vendoring any of them, they must be promoted into the production inventory.

## Renderers, generated formats, and runtime status

| Component | Current state | License position | Review |
|---|---|---|---|
| Mermaid | GlyphMend currently emits a constrained Mermaid textual subset; it does **not** bundle the Mermaid renderer/runtime. | No new Mermaid runtime license is currently shipped. Any future renderer package requires a separate exact-artifact review. | `NOT_BUNDLED` |
| PlantUML | GlyphMend emits a constrained PlantUML sidecar but bundles no PlantUML renderer. | Upstream PlantUML offers multiple licenses; the default project distribution is GPL-3.0-or-later, with alternative licensed builds also available. Do not integrate an arbitrary JAR/package without recording the exact artifact/license selected. | `DEFERRED` |
| Vega-Lite | GlyphMend can emit Vega-Lite JSON but bundles no Vega-Lite renderer/runtime. | Upstream Vega-Lite is BSD-3-Clause. A future browser renderer also brings Vega/runtime/transitive dependencies that need bundle/license review. | `DEFERRED` |
| Custom SVG renderer | In-repository deterministic renderer/sanitizer. | Covered by whatever project license GlyphMend ultimately adopts; project license is currently unresolved. | `BLOCKED_PROJECT_LICENSE` |
| ONNX Runtime Web | Research candidate only; not installed. | Upstream runtime is MIT. Runtime license does not cover any model weights loaded through it. | `LICENSE_COMPATIBLE_CANDIDATE`, `NOT_BUNDLED` |
| OpenCV/OpenCV.js 4.5+ | Candidate deterministic local CV runtime only; not installed. | Apache-2.0 for OpenCV 4.5+. Exact JS/WASM artifact and transitive notices still need review before integration. | `LICENSE_COMPATIBLE_CANDIDATE`, `NOT_BUNDLED` |

## Model / weight / dataset candidates from the upgrade research

No candidate below is a production dependency today. **All remain unbundled unless both the executable/runtime license and the exact weight/data terms are documented.**

| Candidate | Intended purpose | Code license | Weight license | Training-data terms | Browser/commercial implications | Review |
|---|---|---|---|---|---|---|
| Texo | Formula image → LaTeX | Research identified repository as `AGPL-3.0` | Not independently verified in this step as a separate distributable grant | Not independently verified | Even if technically attractive for browser use, AGPL code plus unresolved weight/data terms must not be silently bundled. | `BLOCKED_UNBUNDLED` |
| UniMERNet | Formula image → LaTeX | Research identified code repository as `Apache-2.0` | Not independently verified | UniMER-1M is relevant training data; dataset terms must be audited separately from code | Apache code alone is insufficient to approve redistribution of model weights. | `BLOCKED_UNBUNDLED` |
| PP-FormulaNet S/L | Formula image → LaTeX | PaddleOCR ecosystem code is Apache-2.0; Hugging Face model metadata for `PaddlePaddle/PP-FormulaNet-S` and `-L` reports `apache-2.0` | Hugging Face metadata reports `apache-2.0` for those model repositories | Training-data terms/provenance not independently cleared in this step | Promising licensing signal, but still not production-approved until exact chosen files, hashes, notices, conversion/runtime path, and data terms are documented. | `BLOCKED_UNBUNDLED` |
| pix2tex / LaTeX-OCR | Formula image → LaTeX | Code licensing has not been revalidated as part of this gate | Exact production weight grant not verified | Dataset/training terms not verified | Do not infer from repository code licensing. | `BLOCKED_UNBUNDLED` |
| Flowchart2Mermaid / other research VLMs | Raster diagram → editable structure | No production artifact selected | No production weights selected | Not reviewed | Research mention is not a redistribution grant. | `BLOCKED_UNBUNDLED` |
| Future visual-provider model | Optional local diagram/visual recognition | Unknown until selected | Unknown until selected | Unknown until selected | Existing provider seam may be used only after exact model/runtime review. | `BLOCKED_UNBUNDLED` |

## Fonts and datasets

- **Fonts:** no vendored `.ttf`/`.otf`/`.woff` font assets were found in the current repository tree during Step 24. CSS/system fonts therefore do not create a current bundled-font license entry. Any future bundled font requires an explicit license row and file hash.
- **Benchmark/training datasets:** GlyphMend does not currently ship an external ML training dataset. Hand-authored local benchmark fixtures are test material, not a third-party training corpus. If a benchmark corpus is imported from research datasets, its dataset license/terms must be recorded independently.

## WASM and other binary redistribution inventory

`web-app/vite.config.js` deliberately copies these files into the production/PWA bundle, so they are treated as redistributed artifacts:

- `pdfjs-dist/wasm/*` → governed by the reviewed `pdfjs-dist` package license;
- `mupdf/dist/mupdf.js`, `mupdf-wasm.js`, `mupdf-wasm.wasm` → governed by MuPDF's AGPL/commercial licensing strategy;
- `tesseract.js-core/*.{wasm,wasm.js}` → governed by the locked `tesseract.js-core` Apache-2.0 license;
- `tesseract.js/dist/worker.min.js` → governed by `tesseract.js` Apache-2.0;
- `@tesseract.js-data/eng/.../eng.traineddata.gz` → MIT-licensed model/data package artifact reviewed separately above.

The npm lockfile `integrity` field authenticates the package tarball used to obtain these artifacts. If future model packs or standalone binaries are checked directly into the repository, record the **file-level SHA-256** here rather than relying only on a package-level integrity hash.

## Release decision summary

### Currently acceptable under the engineering gate

Permissive runtime dependencies with recorded license expressions may continue to ship subject to their notices and the project-wide license decision.

### Blocked before a licensing/distribution decision

1. **Project license strategy:** no top-level GlyphMend `LICENSE` exists.
2. **MuPDF browser runtime:** `AGPL-3.0-or-later` unless a commercial license applies.
3. **PyMuPDF and PyMuPDF4LLM:** AGPL v3 / Artifex commercial licensing strategy must align with the product distribution model.
4. **All unselected math/visual model weights:** remain unbundled until exact weight and relevant dataset terms are reviewed.

### What this gate prevents

- adding a new production dependency and forgetting to review its license;
- silently accepting a lockfile license-expression change;
- treating ONNX/OpenCV runtime licensing as if it also licensed models;
- treating a model repository's source-code license as if it automatically covered weights/data;
- shipping a candidate PlantUML/model/runtime artifact just because the technology fits.

## Primary sources reviewed in Step 24

- MuPDF / Artifex licensing: https://mupdf.com/licensing/ and Artifex commercial licensing materials.
- PyMuPDF / PyMuPDF4LLM package licensing: https://pypi.org/project/pymupdf/ and https://pypi.org/project/pymupdf4llm/.
- OpenCV licensing: https://opencv.org/license/.
- ONNX Runtime repository/license: https://github.com/microsoft/onnxruntime.
- PlantUML licensing: https://plantuml.com/license and upstream multi-license documentation.
- Vega-Lite BSD-3-Clause: https://github.com/vega/vega-lite.
- PP-FormulaNet Hugging Face model metadata: `PaddlePaddle/PP-FormulaNet-S` and `PaddlePaddle/PP-FormulaNet-L`.
- Repository manifests/lockfiles and `research/GlyphMend Upgrade Research.md`.

When an external source changes, update this inventory only after reviewing the exact version/artifact intended for GlyphMend. Do not upgrade a license status from `BLOCKED` merely because a project homepage uses the phrase “open source.”
