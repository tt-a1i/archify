---
name: Archify
description: A precise, vivid technical instrument for trustworthy interactive architecture maps.
colors:
  canvas: "#020617"
  mask: "#0F172A"
  ink: "#FFFFFF"
  muted: "#94A3B8"
  dim: "#475569"
  border: "#1E293B"
  frontend: "#22D3EE"
  backend: "#34D399"
  database: "#A78BFA"
  cloud: "#FBBF24"
  security: "#FB7185"
  messagebus: "#FB923C"
  external: "#94A3B8"
typography:
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.625rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0.12em"
rounded:
  precise: "0.2rem"
  control: "0.5rem"
  panel: "1rem"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  page: "2rem"
components:
  toolbar-button:
    backgroundColor: "{colors.mask}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
    height: "2.75rem"
  diagram-panel:
    backgroundColor: "{colors.mask}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1.5rem"
  search-field:
    backgroundColor: "{colors.mask}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.58rem 0.65rem"
  evidence-beacon:
    backgroundColor: "{colors.mask}"
    textColor: "{colors.backend}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    size: "30px × 12px"
---

# Design System: Archify

## Overview

**Creative North Star: "The Evidence Console"**

Archify is a composed technical instrument, not a drawing suite. The canvas carries one spatial narrative; restrained controls and progressive disclosure let a reader move from the primary path to exact authored relationships, metadata, and verified code evidence without losing orientation.

The visual system is precise, dark-first, and vivid only where semantics earn it. Light mode and Blueprint preserve the same vocabulary rather than becoming separate products. Motion has one bounded owner, finishes, and never carries meaning that disappears in a still frame. Desktop is the primary surface; narrow screens receive containment, not a second interface.

**Key Characteristics:**

- One dominant technical canvas with compact, low-interference chrome.
- A fixed semantic color vocabulary shared by nodes, edges, legends, focus, and evidence.
- Mono-forward typography, small labels, and deliberate density for engineering review.
- Viewer state stays outside canonical exports; proof remains portable and deterministic.
- State transitions are 140–200ms; authored story motion may be longer but finite and reader-controlled.

## Colors

The palette is a midnight console with seven semantic signals; color identifies meaning, never decoration.

### Primary

- **Verified Cyan** (`frontend`): the main focus, navigation, and frontend signal. Its scarcity establishes hierarchy.

### Secondary

- **Proof Green** (`backend`): backend semantics, verified evidence, and successful state.
- **Repository Violet** (`database`): persisted state, stores, and inward relationships.

### Tertiary

- **Boundary Rose** (`security`): policy, security, and guarded paths.
- **Cloud Amber** (`cloud`), **Transit Orange** (`messagebus`), and **External Slate** (`external`): stable semantic categories, never interchangeable accents.

### Neutral

- **Midnight Canvas** (`canvas`) and **Ink Mask** (`mask`): the dark workspace and opaque geometry mask.
- **Instrument Ink** (`ink`), **Quiet Copy** (`muted`), **Dim Annotation** (`dim`), and **Structural Border** (`border`): the text and containment ladder.

### Named Rules

**The Semantic Color Rule.** Every saturated color maps to a node or relationship meaning; never add an accent merely to make a surface lively.

**The Theme Parity Rule.** Light, dark, Signal Flow, and Blueprint may change material and contrast, but must preserve category identity and information priority.

## Typography

**Display Font:** JetBrains Mono (with system monospace fallbacks)<br>
**Body Font:** JetBrains Mono (with system monospace fallbacks)<br>
**Label/Mono Font:** JetBrains Mono

**Character:** A single mono family makes the artifact feel authored by an engineering instrument. Hierarchy comes from weight, scale, spacing, and case rather than a decorative display face.

### Hierarchy

- **Headline** (700, `1.5rem`, 1.2): artifact title only.
- **Title** (600, `0.875rem`, 1.4): panels, cards, and selected semantic objects.
- **Body** (400, `0.75rem`, 1.55): explanatory copy and relationship details.
- **Label** (700, `0.625rem`, `0.12em`, uppercase): state, modes, metadata, and compact proof markers.

### Named Rules

**The One Voice Rule.** UI and diagram chrome remain mono-forward; never introduce a display font inside the generated artifact.

**The Legibility Floor Rule.** Tiny labels are metadata, not prose. If a reader must parse a sentence, promote it to body size or disclose it on focus.

## Elevation

Archify is flat and tonal by default. Borders and surface contrast establish structure; shadows appear only on floating controls, temporary panels, active focus, or the Signal Flow atmosphere. Blueprint removes glow and squares materials to keep the review surface exact.

### Shadow Vocabulary

- **Canvas Lift** (`0 28px 80px rgba(0,0,0,0.34)`): Signal Flow diagram surface only.
- **Floating Panel** (`0 18px 48px rgba(0,0,0,0.30)`): temporary discovery panels and the Semantic Passport.
- **Action Feedback** (`0 0 7px var(--frontend-stroke)`): active SVG focus only, never an idle decoration.

### Named Rules

**The Flat-at-Rest Rule.** A static card or control uses border and tone; a shadow must explain layering or state.

**The Canonical Clean Rule.** Viewer glow, overlays, focus, and temporary marks are removed from visual exports unless the export explicitly owns that narrative.

## Components

### Buttons

- **Shape:** compact rounded rectangle (`0.5rem`), or precise corners (`0.2rem`) in Blueprint.
- **Primary:** translucent toolbar material, one-pixel structural border, mono body label, and at least `2.75rem` height.
- **Hover / Focus:** 150ms border/background response; `2px` cyan focus ring with `2px` offset.
- **Secondary / Ghost:** transparent within menus; never add a second saturated fill hierarchy.

### Chips

- **Style:** quiet bordered capsules for semantic metadata; selected state uses the owning semantic color.
- **State:** a chip may summarize focus, mode, count, or evidence, but must not become an unlabeled icon-only control.

### Cards / Containers

- **Corner Style:** composed panel corners (`1rem`), reduced to `0.35rem` in Blueprint.
- **Background:** tonal panel over the canvas, with a one-pixel border.
- **Shadow Strategy:** flat by default; floating or Signal Flow surfaces use the elevation vocabulary.
- **Internal Padding:** `1.25rem`–`1.5rem` for panels; compact proof blocks may use `0.5rem`–`0.75rem`.

### Inputs / Fields

- **Style:** one continuous bordered field, `0.5rem` corners, muted placeholder, and compact mono body text.
- **Focus:** no browser outline; shift the border to Verified Cyan and add a restrained two-pixel halo.
- **Error / Disabled:** preserve readable text and add a non-color cue; never rely on opacity alone for failure.

### Navigation

- **Style:** the diagram remains dominant. Toolbar, guided views, map, search, and passport appear only when relevant and reuse familiar labels.
- **Default / Hover / Active:** 140–200ms state response; active state combines text, border, shape, or marker—not color alone.
- **Narrow screens:** contain and stack existing controls safely; do not create a dedicated mobile product surface.

### Semantic Passport

One focused node opens one compact proof surface containing stable ID, authored metadata, relationships, and optional revision-pinned sources. It is the single destination for details; new capabilities should route here before proposing another panel.

### Verified Source Beacon

An evidence-backed node receives one viewer-only `SRC n` capsule in its upper-right corner. It inherits node state, adds no tab stop, and is stripped from every canonical visual export.

### Authored Reachability

Semantic Passport offers two native, count-bearing actions: `Upstream` follows authored incoming relationships and `Downstream` follows authored outgoing relationships. The canvas keeps the focused origin plus the complete reachable subgraph strong while unrelated topology recedes. Upstream uses Repository Violet, downstream uses Proof Green, and Blueprint removes glow. The receipt says nodes, links, and maximum hops; it never says blast radius or breakage.

## Do's and Don'ts

### Do:

- **Do** make the primary path legible before adding secondary relationships or detail.
- **Do** derive every focus, reachability query, route, story, source link, receipt, and count from authored or locally verified evidence.
- **Do** keep ordinary artifacts source-free and make repository evidence explicitly opt-in.
- **Do** use 140–200ms transitions for control state and honor `prefers-reduced-motion`.
- **Do** preserve keyboard access, visible focus, semantic labels, dark/light parity, and non-color state cues.
- **Do** keep runtime exploration outside canonical SVG, raster, Share Card, and WebM backgrounds.

### Don't:

- **Don't** build generic Mermaid beautifiers that change themes without improving information architecture.
- **Don't** turn Archify into WYSIWYG drawing suites whose editing chrome becomes the product.
- **Don't** ship motion-first graph demos that imply relationships or activity not present in the authored source.
- **Don't** use dense dashboard shells, endless identical card grids, decorative glass, gradient text, and other AI-generated interface clichés.
- **Don't** add vendor-icon catalogues or product-name matching that weaken Archify's portable semantic vocabulary.
- **Don't** create another permanent panel when the Semantic Passport, Node Finder, or existing canvas can carry the capability.
- **Don't** call graph reachability runtime impact, blast radius, or breakage without independent code-analysis evidence.
- **Don't** change the README Hero as a side effect of artifact or viewer iteration.
