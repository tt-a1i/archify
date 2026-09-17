# Visual Style Picker Research

Date: 2026-07-23
Status: implementation decision for `codex/visual-style-picker`

## Decision

Turn the existing Style cycle button into a direct, accessible picker for the
four bundled visual presets. Keep <kbd>S</kbd> as the fast cycle shortcut.

This is a discoverability improvement over one stable visual system, not a
fifth preset, theme DSL, or graph-state feature.

## Evidence

- [Fireworks Tech Graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)
  puts named visual styles directly in its public showcase. The useful lesson
  is visibility: readers can see that style is a deliberate product surface.
- [D2 themes](https://d2lang.com/tour/themes/) are catalogued, named choices.
  Special themes can change typography and material as well as color while the
  diagram language remains the same.
- [AntV G6 themes](https://g6.antv.antgroup.com/en/manual/theme/overview) can be
  switched at runtime and coordinate canvas, node, edge, state, and animation
  styling. Theme choice is explicit rather than hidden behind repeated clicks.

Archify already has the stronger invariant for this use case: Classic, Flow,
Blueprint, and Editorial render the exact same canonical SVG geometry and
semantic identity. The missing piece is a visible choice surface.

## Interaction contract

1. The toolbar Style button opens a menu showing all four named presets.
2. Each option has a small, preset-specific material sample, a name, and a
   concise audience cue.
3. The active option uses `menuitemradio` plus `aria-checked`; color is not the
   only selected-state signal.
4. Arrow keys, Home, End, Escape, Tab, outside click, and trigger focus follow
   the existing Export menu-button conventions.
5. Choosing an option updates the page and canonical SVG together, then closes
   the menu and returns focus to the trigger.
6. <kbd>S</kbd> continues to cycle without opening the menu.
7. Opening Style closes Export; opening Export closes Style, so toolbar popups
   never stack.

## Stability boundaries

- `classic` remains the renderer and schema default.
- Authored `meta.visual_preset` remains the initial selection.
- The reader choice remains session-only: no URL, history, local storage,
  cookies, source rewrite, or preference persistence.
- Passive embeds and print keep the picker unavailable.
- SVG elements, coordinates, authored facts, topology, stable IDs, schema,
  renderer layout, export formats, dependencies, and mobile product scope do
  not change.
- Ordinary SVG/raster/Share Card/Route Card/Reach Card/WebM exports continue to
  consume the current canonical preset exactly as before.

## Acceptance evidence

- all five renderers expose the same four-option picker;
- active state and button copy stay synchronized after authored, direct, and
  shortcut-driven selection;
- keyboard and dismissal behavior pass focused tests and real browser checks;
- geometry equivalence across all four presets remains byte-identical after
  normalizing only `data-preset`;
- desktop dark/light and narrow containment show no clipping or popup overlap;
- full tests, WebM visual matrices, Gallery freshness, and packaged ZIP smoke
  remain green.
