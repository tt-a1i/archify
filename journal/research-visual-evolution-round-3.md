# Archify visual evolution research — round 3

Research date: 2026-07-19 (Asia/Shanghai)

## Decision

The next viewer improvement is **bounded guided-story playback**, not a canvas
editor, arbitrary animation timeline, or GIF scene engine.

D2 demonstrates that a small sequence of inherited `steps` can be exported as
an animated SVG and explicitly warns that too many boards confuse the viewer.
Its CLI uses a fixed interval for short compositions. Fireworks Tech Graph
independently demonstrates a useful motion constraint: nodes, labels,
containers, and camera stay fixed while semantic routes change in a reviewed
order. These are compatible with Archify's existing maximum-five `meta.views`
contract and immutable base SVG geometry.

Primary sources:

- [D2 composition model](https://d2lang.com/tour/composition/)
- [D2 composition export formats](https://d2lang.com/tour/composition-formats/)
- [Fireworks focused motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/motion-effects.md)

## Bounded contract

- Playback exists only when typed `meta.views` exists; the schema remains
  capped at five views.
- One explicit Play/Pause control and the `P` shortcut advance the existing
  views every 3.2 seconds and stop after the final view. There is no infinite
  loop and no automatic playback on page load.
- Base nodes, edges, routes, labels, and camera remain fixed. Playback changes
  only the existing semantic focus set and its explanation.
- Page visibility changes, manual step controls, direct node exploration, and
  deep-link changes pause playback immediately.
- `prefers-reduced-motion` disables the timer rail animation; playback itself
  remains an explicit user action.
- Canonical SVG/raster/WebM exports continue to ignore temporary view and
  playback state.

## Why this belongs in Archify

The feature turns a technically dense artifact into a short product demo or
review narrative without adding a second diagram model. It makes motion serve
explanation, preserves zero-install delivery, and reuses the already validated
semantic IDs, focus sets, deep links, and accessibility live region.

## Verification

1. All five renderer modes must embed the same playback controller without
   changing base SVG geometry.
2. Static tests must retain the fixed interval, Play/Pause surface, visibility
   pause, keyboard shortcut, and zero-install template.
3. Browser tests must prove timed advancement, final-stop behavior, manual
   pause, node-exploration pause, deep-link recovery, dark/light appearance,
   mobile fit, and a clean page console.
4. The generated Proof Lab and packaged ZIP must be rebuilt from source and
   pass their existing freshness and installed-skill checks.
