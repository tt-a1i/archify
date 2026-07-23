# Editorial Preset Research

Date: 2026-07-23
Status: implementation decision for `codex/visual-proof-evolution`

## Why this slice

Archify already has the deeper reading product: exact semantic identity, search,
route and reach inspection, guided stories, source evidence, stable export, and
five validated diagram modes. The remaining first-impression gap is visual
choice. A new reader can recognize only three visual identities before learning
the richer interaction model.

The goal is therefore not another panel or motion owner. It is one immediately
recognizable, optional visual identity that preserves every existing truth and
stability boundary.

## Primary-source comparison

### Fireworks Tech Graph

[Fireworks Tech Graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)
puts visual breadth directly in its showcase: twelve named styles, each attached
to a distinct engineering scenario, while its shared composition contract keeps
routing and spacing comparable. The useful product lesson is that a style must
be visible, named, and executable rather than described as a loose palette.

- **Borrow:** one named, memorable visual identity with an explicit audience.
- **Adapt:** keep Archify's exact existing SVG geometry and semantic palette;
  express the identity through CSS variables, publication typography, material,
  and chrome.
- **Skip:** a large style matrix, vendor icon catalogue, renderer-specific
  scenes, GIF-only motion contracts, or copied style names and assets.

### D2

[D2](https://github.com/terrastruct/d2) treats themes as a first-class output
choice while keeping the diagram language and layout engine separate. It also
keeps the stable default intact and lets authors deliberately choose another
theme.

- **Borrow:** presentation is optional and orthogonal to topology.
- **Adapt:** one `meta.visual_preset` enum value shared by all five renderers,
  the viewer Style cycle, both themes, and every export path.
- **Skip:** pluggable layout engines, a user-authored theme DSL, font packaging,
  or a breaking change to existing files.

### AntV G6

[AntV G6](https://github.com/antvis/G6) exposes themes and palettes alongside
interaction and rendering, reinforcing that visual identity must remain
coherent during selection, focus, and animation—not only in a static screenshot.

- **Borrow:** verify the style across interaction and export states.
- **Adapt:** exercise Route and Reach cards, Story, trace motion, dark/light,
  and canonical SVG through Archify's existing gates.
- **Skip:** a graph runtime, editable nodes, WebGL, new dependencies, or a
  second state owner.

## Chosen direction: Editorial

`editorial` is a warm publication-minded identity for architecture reviews,
launch notes, and narrative technical documentation:

- warm paper / charcoal surfaces;
- deep ink and restrained vermilion emphasis;
- ruled structure and field-note marks;
- Georgia only for publication headings, while SVG labels remain the existing
  technical monospace for fit stability;
- muted, accessible semantic colors rather than neon or decorative gradients;
- low-radius panels and quiet shadows instead of generic glass cards.

It is intentionally not “Notion style” or a Fireworks clone. It aligns with
Archify's own landing-page paper identity and remains recognizable in both dark
and light themes.

## Stability contract

1. `classic` remains the schema and renderer default.
2. Editorial changes no SVG element, coordinate, route, label, stable ID,
   authored fact, or validation threshold.
3. The same topology must produce byte-identical canonical SVG markup after
   normalizing only `data-preset` across all four presets.
4. All five schemas accept exactly the new `editorial` value; unknown presets
   still fail closed.
5. Reader Style cycling is session-only and disabled in passive embeds.
6. Both themes, canonical SVG, raster, Share Card, Route Card, Reach Card,
   finite motion, print cleanup, reduced motion, and narrow containment remain
   covered by existing or extended tests.
7. No dependency, schema version, URL, storage, layout algorithm, hosted
   service, or dedicated mobile surface is added.

## Acceptance evidence

- all five renderers accept and emit Editorial through HTML and canonical SVG;
- four-preset topology identity test passes;
- Route and Reach visual matrices produce eight distinct 1200x630 PNGs;
- Proof Lab regenerates with 99/99 checks;
- validator freshness, package/golden tests, and full `npm test` pass;
- desktop and narrow built-in-browser inspection covers Style cycling,
  dark/light, Story/focus controls, export menu, and zero console errors.
