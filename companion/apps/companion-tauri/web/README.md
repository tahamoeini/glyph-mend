# Packaged web adapter

The packaging step copies the ordinary GlyphMend web build and injects a narrow
`globalThis.GlyphMendCompanion` adapter. Only this adapter imports
`@tauri-apps/api`; the ordinary `web-app/` build remains browser-only.
