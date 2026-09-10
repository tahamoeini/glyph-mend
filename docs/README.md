# GlyphMend documentation

> **Faithful document reconstruction from PDF to structured Markdown.**

| Guide | Use it for |
| --- | --- |
| [Branding](branding.md) | Product name, slogan, logo, runtime overrides, and compatibility policy. |
| [Browser edition](browser.md) | Local browser extraction, OCR, recovery, deployment, and troubleshooting. |
| [Architecture](architecture.md) | Repository layout, module boundaries, tests, and automation. |
| [Desktop GUI](gui.md) | The Python/Tkinter interface. |
| [Project README](../README.md) | Product overview, Python CLI reference, and semantic-output contract. |
| [Browser README](../web-app/README.md) | Browser build commands, verification, configuration, and licensing. |

The browser edition is the primary GlyphMend product surface. The Python CLI and desktop GUI remain supported for native workflows and share the same reconstruction core. The historical `pdf-sanitizer` command and `pdf_sanitizer` module remain compatibility aliases; new integrations should use `glyphmend`.
