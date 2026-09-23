# GlyphMend documentation

> **Faithful document reconstruction from PDF to structured Markdown.**

| Guide | Use it for |
| --- | --- |
| [Branding](branding.md) | Product name, slogan, logo, runtime overrides, and compatibility policy. |
| [Browser edition](browser.md) | Local browser extraction, OCR, recovery, deployment, and troubleshooting. |
| [Architecture](architecture.md) | Current product boundaries, repository layout, and implementation responsibilities. |
| [Companion runtime](companion-engine.md) | Diagnostic REST runtime, limits, pairing, and the provider seam. |
| [Active roadmap](roadmap.md) | The sole active project backlog. |
| [CI guide](ci.md) | Workflow triggers, local Docker checks, and cleanup behavior. |
| [Desktop GUI](gui.md) | The Python/Tkinter interface. |
| [Project README](../README.md) | Product overview, Python CLI reference, and semantic-output contract. |
| [Browser README](../web-app/README.md) | Browser build commands, verification, configuration, and licensing. |

The Browser edition is the primary GlyphMend product surface. The Python CLI and desktop GUI are separate implementations for native workflows; they do not share the Browser extraction core. The historical `pdf-sanitizer` command and `pdf_sanitizer` module remain compatibility aliases.
