# Visual evolution round 13: Path-aware Story Trail

## Reader problem

Archify could play named guided views and let Semantic Camera frame each selection, but the transition still read like a sequence of static screenshots. The viewer named the chapter without showing the ordered semantic stops or making the relationships inside that chapter visibly move. Ambient trace animation helped a demo feel alive, but it did not answer the reader's more important question: **what is moving in this view, and which direction is real?**

## Patterns worth borrowing

- [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) reinforces that visual richness works best when line color and dash style retain semantic meaning rather than becoming decoration.
- [G6 animation guidance](https://g6.antv.vision/en/manual/animation/animation/) treats persistent ant-line and breathing effects as element-level animation, with local animation able to override a global default.
- [React Flow's Edge API](https://reactflow.dev/api-reference/types/edge) scopes animation to an individual edge instead of making motion a canvas-wide property.
- [React Flow's animated-edge examples](https://reactflow.dev/examples/edges/animating-edges) reuse the actual computed edge path for SVG motion and keep the path definition separate from the animation lifecycle.

The useful borrowing is not “make every line move.” It is **bind motion to the exact semantic subgraph currently being explained**.

## Archify decision

Story Trail is derived entirely from an existing guided view; it adds no schema fields and performs no topology inference beyond the rendered semantic hooks.

- The ordered `meta.views[].focus` list becomes a compact textual rail.
- Consecutive stops show `→` only when the rendered graph contains that forward edge, `←` when it contains only the reverse edge, and `·` when the ordering is thematic rather than a direct relationship.
- The motion overlay includes every real rendered edge whose source and target are both selected, not merely consecutive focus entries. This preserves branches, joins, and repeated sequence messages.
- Overlay shapes clone only path/line/polyline geometry. They carry no marker, edge key, relationship metadata, label, or interaction state; the overlay is inserted below the authored edge layer so original colors, dash patterns, arrowheads, labels, and z-order stay authoritative.
- Playback owns the moving overlay. Paused or deep-linked views keep a restrained static path glow.
- `prefers-reduced-motion` disables trail and stop animation while retaining the readable ordered rail and static selected subgraph.
- SVG/raster export removes the overlay, Story Trail state, node step variables, semantic focus, and camera transform before serialization.
- The same viewer contract covers architecture, workflow, sequence, data-flow, and lifecycle renderers.

## Browser-led corrections

The first in-app-browser artifact looked visually strong but exposed a correctness bug that static contract tests did not reveal. The initial rail rendered `→` between every ordered focus entry. Some guided views are thematic subgraphs, so `External API → Context Store → Trace Log` falsely implied an edge that does not exist.

The corrected artifact renders `External API · Context Store → Trace Log`, while the diagram overlay animates both real internal edges (`External API → Trace Log` and `Context Store → Trace Log`). A reverse relationship similarly renders `←` rather than silently changing its direction.

The browser pass also verified:

- Presentation Stage kept all selected nodes inside the semantic camera at roughly 2× scale.
- The safety view produced exactly three marker-free trail shapes while the original security edge retained its `a-security` class, dashed marker, and trace metadata.
- At 390px, the rail stayed 21px tall inside a 253px contained horizontal reading surface; the document itself remained exactly 390px wide and the SVG stayed at the mobile 100% model.
- Pause removes the playing state without deleting the static trail, and navigation/deep links rebuild the overlay from the newly selected subgraph.

## What we deliberately did not borrow

Archify does not add an animation timeline schema, moving nodes, editable keyframes, a graph runtime, or arbitrary path authoring. Story Trail is a truthful reading layer over compiled SVG semantics. If the source graph does not contain a relationship, the viewer does not invent one for visual continuity.
