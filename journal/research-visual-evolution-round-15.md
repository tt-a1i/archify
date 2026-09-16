# Visual evolution round 15: Share Chapter Cue

## Reader problem

Round 14 made a shared chapter play exactly once, but embed mode deliberately hides the full Guided Views controls. A reader could see motion without knowing the chapter title, the authored route, whether playback was still running, or why a reduced-motion device stayed still. The animation had a bounded lifetime, but not enough visible meaning.

The missing surface was a compact narrative layer, not more graph decoration.

## Patterns worth borrowing

- [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) now pairs a broad diagram/style gallery with deliberately staged motion: routes establish topology first, then live data keeps moving briefly over the settled graph. The useful lesson is that motion should communicate a named system behavior and end in a readable state.
- [LikeC4 dynamic views](https://likec4.dev/dsl/views/dynamic/) keep use-case stories separate from the durable architecture model. A dynamic view has a title, an ordered set of steps, navigation, and per-step notes without polluting the underlying model.
- [React Flow edge labels](https://reactflow.dev/learn/customization/edge-labels) place rich informational UI in an HTML layer outside the SVG edge layer. That separation lets the graph own geometry while the viewer owns legible narrative UI.
- [React Flow animated edges](https://reactflow.dev/examples/edges/animating-edges) likewise keeps path construction and motion lifecycle separate.

The useful fusion is **an HTML chapter cue over an unchanged semantic SVG**.

## Archify decision

`?embed=1&play=1#view=<id>` now exposes a viewer-only Share Chapter Cue:

- It names the current authored view and reports `Chapter NN / NN`.
- It derives the visible route from the same Story Trail stops and relationship directions already rendered for that view; it never invents a path.
- It reports an honest lifecycle: `Ready`, `Playing`, `Settled`, `Paused`, or `Still` for reduced motion.
- A two-pixel progress rail follows the existing 3.2-second one-shot lifetime and freezes at the actual interruption point.
- The cue lives outside the SVG, is removed from print/export with the other viewer controls, and introduces no schema field or dependency.
- Desktop uses a restrained glass overlay above the phase rail. At widths up to 720px, the diagram reserves a separate top band so the cue cannot cover the first row of nodes; the optional note is hidden and the route becomes its own line.
- Manual full-story playback still owns the complete Guided Views panel and removes the share cue. The cue appears only for the bounded embed/share contract.

## Browser receipts

The generated Signal Flow workflow was exercised in the built-in browser rather than inspected only as source:

- At 1280px, the cue measured 832px wide with no page overflow. Its title retained a 216px readable column while the route used the remaining 468px.
- Playback reported `Playing` with a fractional progress transform, then `Settled` with a full rail after 3.2 seconds.
- A same-document change from `#view=happy-path` to `#view=safety-gate` interrupted playback, froze progress at `0.223438`, changed the cue to `Paused`, and updated the title and route to the new authored chapter.
- At 390px, the cue remained within the viewport at 374px wide with no horizontal overflow. Its bottom was 63.9px, the SVG started at 68px, and the first node row began at 116.3px, proving the narrative layer no longer obscures the graph.

## What we deliberately did not borrow

Archify does not add a timeline authoring schema, put HTML into the SVG export, duplicate the Guided Views toolbar inside embeds, loop a decorative status pulse forever, or guess labels from layout. The cue is a compact explanation of authored semantic state, not a second diagram system.
