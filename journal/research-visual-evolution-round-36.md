# Visual Evolution Research — Round 36

Date: 2026-07-20

## Question

How can Archify borrow the appeal of richer animated diagram products without weakening its strongest boundary: one offline, inspectable, deterministic HTML artifact built from authored semantics?

## Primary-source read

### fireworks-tech-graph

The current repository presents twelve visual styles, semantic SVG-to-GIF motion, offline interactive HTML, explicit geometry contracts, and a bounded render → structural validation → PNG readback → targeted revision loop. Its most transferable lesson is not “add more moving pixels”; it is that motion and visual variety become trustworthy when each has an executable contract and a visible validation receipt.

Source: <https://github.com/yizhiyanhua-ai/fireworks-tech-graph>

Relevant current claims:

- motion is focused and semantic rather than an unconstrained ambient effect;
- each style keeps a distinct scenario while sharing geometry, text-fit, routing, and motion gates;
- deterministic checks precede perceptual readback;
- the iteration loop is bounded and does not claim visual verification when readback is unavailable.

### Cytoscape.js animation API

Cytoscape’s graph animation API separates ordered animation, viewport framing, pause/stop, and progress. Queued animations run in order; pause keeps current progress; stop removes work from queues; viewport fit/center is an explicit animation target. This reinforces a small ownership model for Archify: one finite route scheduler, one exact current position, one camera request, and immediate cancellation on manual navigation.

Source: <https://js.cytoscape.org/#animations>

### W3C WCAG 2.2 — Pause, Stop, Hide

W3C distinguishes intentional activation from movement that starts through incidental focus, hover, or scrolling. It also explicitly describes pause-and-resume-from-the-same-point as the right behavior for non-real-time explanatory content. Route playback therefore must start only from a native Play button, pause on focus/manual navigation, and resume the remaining dwell instead of jumping ahead.

Source: <https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide>

### MDN — prefers-reduced-motion

`prefers-reduced-motion` is a widely available signal for removing, reducing, or replacing non-essential animation. Large panning and scaling are specifically relevant vestibular triggers. Archify should retain manually inspectable route positions under reduced motion while disabling automatic journey playback and using instant camera framing.

Source: <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion>

## Borrow / adapt / skip

| Decision | What | Archify interpretation |
| --- | --- | --- |
| Borrow | Semantic, finite motion | Animate one exact authored incoming edge for one route position; never synthesize a relationship. |
| Borrow | Bounded visual QA | Keep deterministic tests, rebuild generated examples, then inspect desktop/mobile/embed/export in the real browser. |
| Adapt | Animation timeline | Use a reader-controlled Route Journey inside the existing Route Probe instead of producing a separate GIF runtime. |
| Adapt | Viewport animation | Frame previous/current/next through the existing Semantic Camera; manual navigation always wins. |
| Adapt | Visual variety | Make the same state legible in Classic, Signal Flow, and Blueprint rather than adding a new unvalidated style. |
| Skip | Continuous autoplay | No animation on route creation, URL restoration, focus, hover, or page load. |
| Skip | New graph/runtime dependency | Ordered nodes and exact edges already exist in Route Probe; a second graph engine would duplicate truth. |
| Skip | Journey state in URLs | Share the durable endpoint question only; playback position remains temporary reader state. |
| Skip | Canonical/export mutation | Journey overlays and state remain viewer-only and are stripped from standalone SVG export and print. |

## Round 36 product decision

Build **Route Journey** as an inspectable layer over Route Probe:

1. Keep the full shortest authored route visible as context.
2. Turn route chips into native buttons with one roving Tab stop.
3. Let readers inspect any position manually in Still or Live mode.
4. Make Play explicit, finite, pausable, and resumable from the remaining dwell.
5. Assign position `i > 0` to `activeEdges[i - 1]` exactly; position zero owns no incoming edge.
6. Let the existing Semantic Camera frame the previous/current/next slice.
7. Use layered Escape: pause → overview → clear route.
8. Keep `#route=<source>~<target>` endpoint-only and restore into Overview with no autoplay.
9. Remove all transient Journey state from print, embed, and exported SVG.

## Success evidence

- all five renderers inherit the same controls and state machine;
- exact-edge ownership and finite scheduling have focused contract tests;
- reduced motion and Motion Still preserve manual inspection while disabling Play;
- mobile controls meet the existing 44 px touch target;
- browser validation covers interaction, visual state, reload, embed, export, and console cleanliness;
- no schema, dependency, layout engine, or editor surface is added.
