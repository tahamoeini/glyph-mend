# GlyphMend branding configuration

GlyphMend keeps product identity separate from extraction behavior. The canonical source configuration is [`../branding.json`](../branding.json).

The browser build runs `npm run brand:sync` before development, tests, previews, and production builds. That copies the configured runtime branding and logo into `web-app/public/` and regenerates the PWA manifest.

The browser loads `branding.json` at runtime. A deployment can replace the runtime file and referenced logo to change the visible product name, slogan, description, or logo path without recompiling extraction code. PWA install metadata is generated at build/sync time; rerun brand sync and rebuild when it needs to change.

Brand configuration does not affect extraction fingerprints or invalidate saved checkpoints. The Rust Companion identifies itself as GlyphMend Companion and reports its own engine version in Semantic Document IR v2.
