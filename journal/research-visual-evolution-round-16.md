# Visual evolution round 16: Semantic Story Beats

## Reader problem

Story Trail already knew the author's ordered semantic stops, but playback treated the selected subgraph as one simultaneous animation. Every selected node pulsed and every internal edge flowed at once. The text described an order that the diagram itself did not perform.

Round 15 made the chapter and route legible. Round 16 makes the motion tell the same story.

## Patterns worth borrowing

- [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) starts its approved GIFs without connectors, draws routes in semantic order, then holds the complete topology with live flow before reset. The important idea is staged topology followed by a readable settled state, not perpetual decoration.
- [D2 Steps](https://d2lang.com/tour/steps/) represent a sequence of events where every step inherits from the previous one. [D2 composition exports](https://d2lang.com/tour/composition-formats/) deliberately recommend animated SVG/GIF only for a small number of steps or scenarios because a long loop becomes confusing.
- [LikeC4 dynamic views](https://likec4.dev/dsl/views/dynamic/) describe ordered relationship instances for one use case without polluting the durable model. They preserve forward and reverse direction, support continuous and parallel steps, and allow per-step notes.
- [Structurizr dynamic views](https://docs.structurizr.com/dsl/language#dynamic-view) likewise render ordered instances of relationships already defined in the static model; explicit ordering changes the behavioral explanation without inventing another architecture.

The useful fusion is **progressive viewer state derived from existing stable semantic IDs**.

## Archify decision

Every manual Story Trail playback and one-shot shared chapter now uses Semantic Story Beats:

- The existing ordered `focus` IDs are the only timeline source. No schema field, second diagram, or generated path is introduced.
- A 3.2-second chapter divides its lifetime evenly across the authored stops. Eight stops become eight 400ms beats; shorter views give each stop proportionally more reading time.
- The current node is fully illuminated, past nodes settle at medium emphasis, and future nodes remain visible at low emphasis.
- A real relationship becomes active only when both of its endpoints have been reached. Its beat is `max(sourceStep, targetStep)`, so the viewer never lights a future connection early. Edge labels follow the same temporary state.
- The active relationship carries bounded flow. Past relationships become quiet evidence; future relationships stay faint. The underlying authored edge remains in place throughout.
- Share Chapter Cue replaces the long note with `Step NN / NN · Current node` while playing or paused. It restores the authored note after the path settles.
- Pressing pause freezes the current node, edge, progress rail, and step copy. Natural completion removes every temporary beat state and restores the complete selected subgraph for reading.
- The live region is disabled during rapid beat updates and restored for Paused, Settled, and Still announcements, preventing eight polite screen-reader interruptions in 3.2 seconds.
- Reduced-motion one-shot links skip the beat timeline and render the same complete static path with `Still` state.
- Beat attributes and overlay geometry are viewer-only and are explicitly removed from canonical SVG/raster exports.

## Browser receipts

The generated Signal Flow workflow was exercised in the built-in browser:

- At 1.15 seconds, the cue and SVG both reported beat `3/8`: User and Chat Surface were `past` at opacity `0.72`, Agent Planner was `active` at `1`, and the five future nodes were `pending` at `0.22`.
- At beat `4/8`, future authored edges measured `0.16`, past edges `0.58`, and only the Planner-to-Tool Router relationship carried the active flow overlay.
- A keyboard pause froze `Step 04 / 08 · Tool Router`, preserved the active edge at opacity `0.92`, removed its animation, and froze chapter progress at `0.387188`.
- After 3.2 seconds, the cue reported `Settled`, the SVG carried no active beat or playback attribute, all eight selected nodes returned to opacity `1`, and the temporary beat-state count was zero.
- At 390px, the dynamic step copy remained visible, the cue fit at 374px with no page overflow, and its 67px bottom stayed well above the first node at 116px.

## What we deliberately did not borrow

Archify does not add D2-style inherited boards, a parallel-step DSL, a second dynamic-view schema, animated canonical SVG exports, or an endless loop. Story Beats are a bounded reading aid over one stable technical diagram, not a presentation authoring platform.
