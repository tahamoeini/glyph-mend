---
name: Precision Slate Glass
colors:
  surface: '#f9f9ff'
  surface-dim: '#d6dae7'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#eaeefb'
  surface-container-high: '#e4e8f5'
  surface-container-highest: '#dee2ef'
  on-surface: '#171c25'
  on-surface-variant: '#414754'
  inverse-surface: '#2c313a'
  inverse-on-surface: '#ecf0fe'
  outline: '#717786'
  outline-variant: '#c0c6d6'
  surface-tint: '#005db8'
  primary: '#005ab3'
  on-primary: '#ffffff'
  primary-container: '#0073e0'
  on-primary-container: '#fefcff'
  inverse-primary: '#aac7ff'
  secondary: '#555f6e'
  on-secondary: '#ffffff'
  secondary-container: '#d6e0f2'
  on-secondary-container: '#596373'
  tertiary: '#006b25'
  on-tertiary: '#ffffff'
  tertiary-container: '#008730'
  on-tertiary-container: '#f7fff2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#00468d'
  secondary-fixed: '#d9e3f5'
  secondary-fixed-dim: '#bdc7d9'
  on-secondary-fixed: '#121c29'
  on-secondary-fixed-variant: '#3d4756'
  tertiary-fixed: '#6cff82'
  tertiary-fixed-dim: '#47e266'
  on-tertiary-fixed: '#002106'
  on-tertiary-fixed-variant: '#00531a'
  background: '#f9f9ff'
  on-background: '#171c25'
  surface-variant: '#dee2ef'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: -0.005em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.01em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system establishes an environment of serene, uncompromised utility for professional desktop document manipulation. Drawing directly from Apple Human Interface Guidelines and modern desktop ergonomics, the system prioritizes local-first document fidelity, structural clarity, and ambient calm. The visual style merges **Minimalism** and tailored **Glassmorphism**: functional frosted surfaces, ultra-fine hairline structural frames, and fluid transitions that elevate content above interface scaffolding.

Every element is tuned to recede during deep focus and deliver tactile precision when engaged. The experience rejects web-application tropes and SaaS ornament, favoring native desktop conventions: floating multi-segment utility bars, fluid pan-and-zoom states, crisp document canvas isolation, and optical hierarchy engineered for multi-hour production workflows.

## Colors

The palette leverages high-acuity neutrals engineered to prevent optical fatigue during intense technical reading and markup editing.

### Light Appearance
- **Window Base Background:** `#EEF2F6` (Provides structural separation behind the document canvas).
- **Primary Canvas / Active Panel:** `#FFFFFF` (Document viewport, context drawers, high-focus tool palettes).
- **Secondary Surface:** `#F8FAFC` (Sidebars, navigation rails, inspector panels).
- **Primary Label / Glyphs:** `#131821` (High-legibility deep obsidian for typography and active icons).
- **Secondary Label:** `#4F5968` (Context metadata, inactive tool states, auxiliary labels).
- **Accent:** `#0A84FF` (Selection states, active primary actions, document anchor highlights).
- **Border / Hairline:** `rgba(19, 24, 33, 0.08)` (1px physical separations).

### Dark Appearance
- **Window Base Background:** `#171A1F`
- **Primary Canvas / Active Panel:** `#1F242C`
- **Secondary Surface:** `#252C35`
- **Primary Label / Glyphs:** `#F3F5F7`
- **Secondary Label:** `#8A94A6`
- **Accent:** `#4DA2FF`
- **Border / Hairline:** `rgba(243, 245, 247, 0.10)`

Functional status colors are strictly reserved for document validation, PDF pre-flight checks, and engine statuses:
- **Success / OCR Ready:** `#30D158`
- **Warning / Unflattened Annotations:** `#FF9F0A`
- **Destructive / Error:** `#FF453A`

## Typography

The typography scale utilizes **Inter** across all system controls, status heads, and document inspection modules, with **JetBrains Mono** reserved for PDF object structures, coordinates, font tables, and signature hash inspection.

- **Display & Panel Titles (`headline-lg`, `headline-md`):** Tight letter tracking, medium-heavy weights for contextual window headers and modal configuration sheets.
- **Section & Document Groupings (`headline-sm`):** Defines document tree layers, bookmarks, and thumbnail galleries.
- **Interactive UI & Document Inspection (`body-md`, `label-md`):** Optimized for high-density sidebars, metadata inspection grids, and inline annotations.
- **Micro UI (`label-sm`, `code-sm`):** Page dimensions, bounding box coordinates, color space tags (e.g., `DeviceCMYK`), and file compression footprints.

## Layout & Spacing

The layout is built for native desktop canvas ergonomics using a **3-pane structural layout**:
1. **Source Navigator (Collapsible):** Width `240px` to `320px` (Page thumbnails, bookmark hierarchy, signature validation pane).
2. **Document Viewport (Fluid Canvas):** Responsive center viewport hosting the rendered page surface, equipped with dynamic canvas panning buffers (minimum `32px` gutter around active document bounds).
3. **Inspector & Tool Deck (Collapsible):** Fixed `280px` or `320px` width for layer attributes, text metrics, and OCR parameters.

### Spacing Scale
- `space-xs` (4px): Micro-spacing between segmented controls and inline status indicators.
- `space-sm` (8px): Icon-to-label gaps, toolbar button padding, dense list items.
- `space-md` (12px): Standard form element vertical spacing, structural shelf padding.
- `space-lg` (16px): Content block padding inside inspector drawers and tool panels.
- `space-xl` (24px): Dialog padding, empty-slate illustration margins.

## Elevation & Depth

Visual depth is achieved through layered translucent surfaces and hairline physical delineations, avoiding muddy drop shadows.

- **Frosted Top Navigation Toolbar:**
  - Light mode: `background: rgba(255, 255, 255, 0.72); backdrop-filter: blur(20px) saturate(180%);`
  - Dark mode: `background: rgba(31, 36, 44, 0.75); backdrop-filter: blur(20px) saturate(190%);`
  - Encased with a bottom 1px hairline border: `rgba(0, 0, 0, 0.08)` (light) or `rgba(255, 255, 255, 0.10)` (dark).
- **Document Page Canvas:**
  - Light mode shadow: `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(19, 24, 33, 0.06);`
  - Dark mode shadow: `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.4);`
- **Floating HUD & Contextual Popovers:**
  - Elevated glass container: `backdrop-filter: blur(24px) saturate(200%);`
  - Subtle directional ambient rim: `box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15) inset, 0 8px 32px rgba(0, 0, 0, 0.12);`

## Shapes

The geometry reflects deliberate, proportional tiering:

- **Large Structural Surfaces (`24px`):** Outer floating utility containers, quick-look modal viewports, export dialog cards.
- **Medium Surfaces (`16px`):** Inspector grouping panels, contextual floating tool docks, thumbnail item selection envelopes.
- **Interactive Controls (`12px`):** Buttons, segmented switches, text fields, menu item hover plates, and dropdown selectors.
- **Micro Targets (`6px` to `8px`):** Page number badges, color picker chips, tagging dots.

## Components

### Buttons
- **Primary:** Background `#0A84FF` (light) / `#4DA2FF` (dark), label `#FFFFFF` / `#131821`, border-radius `12px`, padding `6px 14px`. Subtle top highlight: `inset 0 1px 0 rgba(255, 255, 255, 0.2)`.
- **Secondary / Ghost:** Background `transparent`, hover background `rgba(0, 0, 0, 0.05)` (light) / `rgba(255, 255, 255, 0.08)` (dark), label primary text color.
- **Icon Tool Action:** Fixed `32x32px` square with `8px` or `12px` radius, center-aligned SVG icon (`16px`), instant hover feedback with spring transitions (`150ms ease-out`).

### Floating Action / Quick Tool HUD
- Floating pill dock housing high-frequency actions (Highlight, Redact, Note, Sign, Zoom).
- Border radius `16px` or `9999px`, background translucent frosted glass, bound by standard hairline borders.

### Input Fields & Comboboxes
- Height `32px`, border-radius `12px`.
- Background `rgba(0, 0, 0, 0.03)` (light) / `rgba(255, 255, 255, 0.05)` (dark).
- Focused state: Hairline ring `#0A84FF` with `0 0 0 3px rgba(10, 132, 255, 0.2)`.

### Checkboxes & Segmented Controls
- **Segmented Switch:** Capsule rail with sliding active indicator background `#FFFFFF` (light) / `#252C35` (dark), elevation `0 1px 3px rgba(0,0,0,0.1)`.
- **Checkbox:** `16x16px`, `4px` corner radius, checked background `#0A84FF` featuring a crisp white vector glyph.

### Thumbnail Sidebar Cards
- Rounded `12px` thumbnail frames, displaying rendered pages with active accent rings (`2px` solid `#0A84FF`), metadata footer depicting page index and rotation state.