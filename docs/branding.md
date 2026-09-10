# GlyphMend branding configuration

GlyphMend keeps product identity separate from extraction behavior. The canonical source configuration is [`../branding.json`](../branding.json).

Default identity:

- **Name:** GlyphMend
- **Slogan:** Faithful document reconstruction from PDF to structured Markdown.
- **CLI:** `glyphmend`
- **Repository slug:** `glyph-mend`

## Change the brand without editing application code

Edit `branding.json` for the source checkout. The browser build runs `npm run brand:sync` automatically before development, tests, previews, and production builds. That copies the runtime branding file and logo into `web-app/public/` and regenerates the web manifest.

The browser deliberately loads `branding.json` at runtime rather than bundling the values into JavaScript. A deployment may therefore replace `dist/branding.json` after build to change the visible product name, slogan, description, or logo path without recompiling the extractor. The last successfully loaded brand is cached locally so the app still has its configured identity when offline.

The installable PWA name and icon are manifest metadata and are generated at build/sync time. Re-run `npm run brand:sync` and rebuild when those install-time values must change too.

## Python overrides

Python reads the repository `branding.json` when running from a source checkout. Installed distributions fall back to the built-in GlyphMend defaults.

To use another JSON file:

```bash
GLYPHMEND_BRAND_CONFIG=/path/to/branding.json glyphmend --help
```

Individual environment variables override JSON values:

- `GLYPHMEND_NAME`
- `GLYPHMEND_SHORT_NAME`
- `GLYPHMEND_SLUG`
- `GLYPHMEND_CLI_NAME`
- `GLYPHMEND_SLOGAN`
- `GLYPHMEND_DESCRIPTION`
- `GLYPHMEND_LOGO_PATH`
- `GLYPHMEND_LOGO_ALT`

The Python loader validates values and ignores blank overrides.

## Compatibility

`glyphmend` is the canonical distribution and command name. `pdf-sanitizer`, `pdf-sanitizer-gui`, and the `pdf_sanitizer` Python namespace remain compatibility surfaces for existing integrations. They are not the product identity and may be deprecated only in a future explicit breaking release.
