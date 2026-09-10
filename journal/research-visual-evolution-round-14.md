# Visual evolution round 14: Share-ready one-shot chapters

## Reader problem

Archify could deep-link a named view and manually play a complete guided story, but a shared `#view=` URL opened on a still frame. The landing-page proof selector had a more serious mismatch: its link named a guided view while the embedded artifact loaded only the generic diagram. Ambient trace loops also meant a proof grid could keep moving long after it had communicated its point.

The product needed a compact “show me this chapter” contract, not another animation system.

## Patterns worth borrowing

- [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) demonstrates the marketing value of showing motion before explaining it, but also reinforces that the motion needs a clear visual subject rather than a wall of simultaneous effects.
- [React Flow's animated-edge examples](https://reactflow.dev/examples/edges/animating-edges) bind animation to the real computed path and keep animation lifecycle separate from path calculation. Archify keeps that separation: Story Trail owns viewer motion while typed renderers remain geometry compilers.
- [WCAG 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) requires a pause/stop/hide mechanism for qualifying auto-starting moving content that lasts more than five seconds. A single 3.2-second chapter stays below that boundary and leaves a stable reading surface.
- [MDN's `prefers-reduced-motion` reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) and [`matchMedia()` reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia) provide the CSS and JavaScript sides of the same operating-system preference.

The useful borrowing is **motion with an explicit subject, lifetime, and handoff back to the reader**.

## Archify decision

`?play=1#view=<id>` is a viewer-only share contract:

- The hash selects one existing authored view; no topology or new chapter is invented.
- Only that chapter plays, for the existing 3.2-second view interval, and it never advances to another view.
- Without `#view`, the first authored view plays without rewriting the URL.
- `prefers-reduced-motion: reduce` keeps the selected view and readable Story Trail but suppresses auto motion.
- A node click, view change, zoom, pan, mobile swipe, hidden document, or manual pause immediately gives control to the reader.
- `data-autoplay="pending|playing|complete|interrupted|reduced-motion"` makes the lifetime inspectable without introducing UI or schema state.
- Embed mode and `?play=1` share mode pause ambient trace loops. Gallery previews therefore remain static; the landing page opts one iframe into one named chapter; a direct proof action combines `?present=1&play=1#view=...`. Ambient motion resumes only when the reader deliberately starts the full story.
- The README motion reel captures the same named-chapter URL instead of relying on an unrelated continuous trace loop.
- Typed JSON, rendered SVG geometry, authored markers/styles, and canonical exports do not change.

## What we deliberately did not borrow

Archify does not autoplay all gallery cards, add scroll-triggered timelines, loop shared chapters, auto-advance a hidden carousel, or introduce an animation schema. Manual Play remains the deliberate full-story control; share autoplay is one bounded demonstration followed by a still diagram.
