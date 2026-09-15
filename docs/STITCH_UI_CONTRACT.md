# Stitch UI contract and completion gates

## Authority and scope

This consolidates the owner's instructions from the UI redesign conversation.
Baseline: main a2872946950a1b4e1e94843f8bab59339c2586c0 (PR #32 merged).
Source of truth: `research/stitch_glyphmend_desktop_interface_design/`, including
the `precision_slate_glass/DESIGN.md` guide and the HTML plus PNG in each screen folder.
The screen layouts take priority over earlier generic Apple/liquid-glass styling.

- Redesign the structure, flow, and layout, not merely colors and borders.
- Keep every existing feature, extraction option, export, review action, log,
  source-preview control, import/recovery action, and persistence behavior.
- Controls may move; their services and effects must remain unchanged.
- Preserve local/offline processing, current limits, accessibility, and themes.
- Do not copy mock data, fabricated success/accuracy metrics, profile accounts,
  batch tools, or other nonfunctional mock controls into the live application.
- No Playwright dependency or heavyweight E2E suite. Lightweight unit/DOM tests
  and a real visual review are distinct required checks.
- Work on a new main-based branch, create one PR, review it, then merge only
  after checks and visual acceptance. A successful build alone is insufficient.

## Reference mapping

| App surface | Exact reference folder | Required composition |
| --- | --- | --- |
| Desktop landing | desktop_main_light, desktop_main_dark | Hero/engine left; intake/recovery right; footer below |
| Mobile landing | mobile_main_light, mobile_main_dark | Hero; upload card with visible Choose PDF; separate recovery list; reset; footer |
| Desktop workspace | desktop_dashboard_light, desktop_dashboard_dark | Navigation/source, settings, fluid document, results inspector; full viewport |
| Mobile workspace | mobile_document_workspace_light, mobile_document_workspace_dark | Document identity; view tabs; readable canvas; accessible bottom actions |
| Mobile settings | settings_panel_component_mockup | Separate sheet; document range; extraction; cleanup; advanced controls |
| Mobile export | quality_export_panel_component_mockup | Separate export sheet; formats readily reachable; quality/review still available |

Tablet uses the document-first sheet flow when permanent columns cannot fit.
The desktop reference widths are proportions, not a reason to squeeze the canvas
to zero. Mock Copy All and Save Profile buttons have no existing corresponding
service: do not fabricate them or replace Extract with a misleading Save label.

## Root causes confirmed in the merged implementation

1. Unlayered legacy rules override named layers regardless of source order.
2. Earlier-layer important declarations outrank later-layer important declarations,
   defeating the attempted four-column repair.
3. CSS used 1200px for desktop; JavaScript treated 1040px as non-sheet layout.
4. Tablet resize handling closed sheets even within the medium layout.
5. Both upload titles appeared on desktop, while mobile hid the Choose PDF visual.
6. Mobile sheet headings were CSS-generated and lacked explicit close controls.

## Implementation plan

1. Remove superseded unlayered and final override compositions; establish one
   named shell layer. Preserve component, token, accessibility, and content rules.
2. Set explicit desktop grid areas and a viewport-bound workspace with independent
   pane scrolling. Keep the sidebar collapse function usable.
3. Use one 1200px desktop threshold in both presentation and sheet state handling.
4. Compose mobile landing and mobile sheets as the reference flows, with real
   semantic headings/close controls and unchanged business handlers.
5. Verify IDs and input contracts against main, parse CSS, run existing tests and
   build. Review light/dark landing, loaded workspace, settings, and export at
   mobile/tablet/desktop widths. Fix any findings before merge.

## Acceptance checklist — must not be inferred from CI

- [ ] Screens compared at 360, 390, 768, 1024, 1199, 1200, 1440, 1920 CSS px.
- [ ] Light and dark checked, including disabled and destructive controls.
- [ ] No unintended horizontal page overflow or detached dashboard rail.
- [ ] All four document tabs, long content, source canvas and logs remain usable.
- [ ] Both sheets open, close, restore focus, and retain access to every setting.
- [ ] Sidebar collapse, touch targets, keyboard flow and narrow/short screens work.
- [ ] Imports, extraction, pause/cancel, review and exports smoke-tested.
- [ ] No extraction/storage/export service changes in the diff.
- [ ] PR checked against latest main and required checks pass before merging.

Unchecked items remain unverified; do not describe this repository as finalized.

## Follow-up from main 7a8ca15 — visual completion work

The previous merge did not complete the acceptance checklist above. Treat it as
a baseline, not proof that the design matches Stitch.

### Consolidated non-negotiables

- Use the checked-in screen PNGs and HTML together. Do not reinterpret the
  desktop dashboard as three columns: its navigation/source region is distinct
  from settings, document, and results. Component mockups define the mobile
  settings and export surfaces; mobile is not a compressed desktop dashboard.
- Keep light/dark parity, readable text/background pairs, usable heights, widths,
  gutters, scrolling, touch targets, and keyboard access. Controls can relocate,
  but their effects, defaults, options, and formats must not change.
- Preserve the current main's extraction fidelity work. Do not restore stale
  app.js files, change extraction versions, or replace business handlers.
- One new branch and one PR for this pass; review and merge only after actual
  acceptance. Never repeat the earlier “CI green therefore visually complete”
  conclusion. A blocked visual check remains blocked, not implicitly passed.

### Findings and implementation sequence

1. Live desktop landing inspection: composition is now present, but engine
   status remains a contrasting technical black card in light mode. Correct
   its semantic surface/text colors and the footer surface.
2. Existing progress, pause, and cancel controls live inside settings. Move
   those exact nodes to a document status surface so mobile users need not
   open settings to see progress or stop a job. Keep IDs and handlers intact.
3. At 1200px, the prior fixed columns leave only 380px for the document. Use a
   bounded navigation width and 290px inspector, leaving 450px at that boundary.
4. Preserve the complete export/settings sheets, and retain Word settings beside
   the prioritized export formats. Remove unnecessary mobile hero decoration.
5. Run lightweight contract tests/build, then test loaded PDF/Markdown, all tabs,
   sheets, focus, running actions and exports on the branch preview. Compare
   desktop/mobile/light/dark renders before merge.

### Current evidence

- Live production desktop landing inspected during this follow-up.
- Loaded-workspace browser file selection stalled and the browser session lost
  its state. No loaded-workspace visual pass is claimed from that attempt.
- Follow-up branch changes remain pending full visual acceptance.
