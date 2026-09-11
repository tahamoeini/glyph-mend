# GlyphMend accessibility checklist

GlyphMend follows system accessibility preferences by default. The appearance controls are an explicit override for theme only; motion, transparency, contrast, forced-colors, and pointer sizing continue to follow the browser and operating-system signals.

## Implemented checks

- Keyboard: the primary workflow is reachable with Tab; document-view tabs use a roving tab stop and arrow/Home/End navigation; Escape closes compact settings and quality sheets; Tab is trapped inside an open compact sheet and focus returns to its invoking control.
- Reduced motion: elastic, morphing, scale, and sheet transitions are removed under `prefers-reduced-motion: reduce`.
- Reduced transparency: glass chrome becomes opaque content-elevated/frosted surfaces and removes backdrop filtering.
- Increased contrast: foreground tokens, boundaries, focus rings, and glass edges strengthen together; the treatment does not depend on color alone.
- Forced colors: system colors are preserved and an explicit `data-forced-colors` fallback keeps panels, borders, controls, and selected states legible when media-query propagation is incomplete.
- Coarse pointer: interactive controls use the larger hit-size tokens.
- Progress/review announcements: extraction progress and review selection are exposed through polite live regions.
- Review queue: source evidence and proposed reconstruction are both text-labelled, so comparison does not require color, transparency, or visual crops.
- Math: display-math source is emitted with a semantic MathML container and a plain-text label. This is an accessibility representation of the preserved source, not a claim that every browser provides identical MathML visual rendering.
- VisualIR: accepted visual descriptions include deterministic node labels, shapes, and directed/undirected connections as an accessible textual fallback.

## Manual verification matrix

Run the core workflow with keyboard only in Chromium and Firefox:

1. Open a Markdown or PDF workspace without using a pointer.
2. Move through settings, extraction, editor tabs, preview/source controls, review items, and export controls with Tab.
3. Open each compact sheet, verify focus enters the sheet, wraps at both ends, and returns to the invoking button after Escape.
4. Select a review item and confirm a screen reader announces the source-evidence/reconstruction comparison and disposition without relying on the status badge color.
5. Enable reduced motion and confirm there is no scale, elastic, or morphing transition.
6. Enable reduced transparency and confirm glass chrome is opaque; document canvases and content remain calm, non-glass surfaces.
7. Test increased contrast and forced colors in the operating-system/browser settings, including focus visibility and disabled controls.
8. Test a coarse pointer or touch device and verify controls remain comfortably targetable and no capability is available only through hover.

Known limitation: the repository does not bundle an external accessibility scanner or a full MathML speech renderer. Automated checks cover structural contracts and deterministic fallback text; the browser/screen-reader matrix above remains a manual release check.
