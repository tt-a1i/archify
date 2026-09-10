# Visual Evolution Round 23 — Reading Depth
Research date: 2026-07-19 (Asia/Shanghai)

## Reader gap

Round 22 made Archify's rich viewer actions discoverable. The next problem is
not another missing action: it is **simultaneous information density**. At the
whole-system view, every node sublabel, relationship label, tag, classification,
and annotation competes at once even when some of that text is too small to be
useful. Zooming enlarges the same crowded picture instead of revealing meaning
in deliberate stages.

The next improvement should therefore make the existing diagram easier to read
without adding another toolbar button, panel, query language, or graph model.

## Primary-source lessons

- [yFiles' feature guide](https://docs.yworks.com/yfiles-html/dguide/features/index.html)
  treats level-of-detail rendering as a first-class graph capability: a coarse
  overview can become more detailed as the reader zooms in.
- [yFiles' large-graph performance guide](https://docs.yworks.com/yfiles-html/dguide/advanced/large_graph_performance.html)
  makes the product lesson more explicit. Labels that are too small to read do
  not need to be displayed at low zoom, edge labels create substantial visual
  noise, and higher zoom levels can restore progressively richer styles. The
  transferable value for Archify is readability, not yFiles' renderer or
  performance stack.
- [Cytoscape.js' official documentation](https://js.cytoscape.org/)
  recommends `min-zoomed-font-size` so labels remain absent while physically
  unreadable and appear after the user zooms in. It also notes that edge labels
  are expensive and often unnecessary in the overview.
- [Sigma.js' settings](https://v4.sigmajs.org/reference/settings/)
  exposes a rendered-size threshold plus density-based label culling. Archify's
  graphs are much smaller and deterministic, so it can use explicit authored
  detail tiers rather than a probabilistic density algorithm.
- [G6's FixElementSize behavior](https://g6.antv.antgroup.com/en/manual/behavior/fix-element-size)
  listens to viewport changes to preserve readable labels and line widths while
  zooming. Archify should likewise make the zoom control describe a reading
  state, not merely report a number.

## Competing candidate: Semantic Lens

The parallel competitor scan also identified a valuable later feature:
**Semantic Lens**, an interactive category legend over existing
`data-node-kind` values. The strongest supporting sources were
[G6's Legend plugin](https://g6.antv.antgroup.com/en/manual/plugin/legend),
[Cytoscape.js selectors and collections](https://js.cytoscape.org/#selectors),
and [Linkurious' filter panel](https://doc.linkurious.com/user-manual/latest/page.html#filter-panel__).
It could focus one semantic kind or compare two kinds with exact directed
cross-class counts.

Semantic Lens is deliberately postponed. It would add a `LENS` control, a
persistent panel, URL state, and another interaction arbitration path
immediately after Diagram Guide solved control discoverability. Reading Depth
improves every current action without adding any new action surface. Lens
remains a good future candidate when comparison evidence outweighs that UI cost.

## Borrow / skip decision

### Borrow now

1. Define deterministic, renderer-owned detail roles rather than guessing from
   font size at runtime.
2. Keep structure and primary node labels visible at the whole-system view.
3. Restore node context and relationship labels at the first zoom threshold.
4. Restore tags, step numbers, classifications, and notes at the second zoom
   threshold.
5. Let stronger semantic intent—focus, Intent Trace, Route Probe, Story Trail,
   or Relationship Preview—reveal only its exact matching detail immediately.
6. Name the zoom states in the existing control so the behavior is legible:
   `MAP`, `READ`, and `FULL`.

### Skip

- No label-density heuristic, collision engine, Canvas/WebGL renderer, graph
  store, runtime dependency, or user-configurable threshold panel.
- No new schema or JSON IR field. Renderers already know which text is a primary
  label, context, relationship label, or fine annotation.
- No element deletion or geometry mutation. Hidden detail remains in the DOM,
  accessible native titles and Semantic Passport remain complete, and all
  authored coordinates stay fixed.
- No incomplete print or export. Those surfaces must always contain the full
  diagram independent of the current viewer zoom.

## Archify implementation

Every typed renderer emits two explicit viewer roles:

- `data-detail="context"` for node sublabels and relationship labels;
- `data-detail="fine"` for tags, step numbers, classifications, and notes.

Primary labels remain unclassified and always visible. Nodes with context also
mark their primary label as a detail anchor; MAP mode moves that label eight SVG
units toward the visual center while its sublabel is absent.

The shared viewer maps zoom state to three stable levels:

| Level | Trigger | Visible information |
|---|---:|---|
| `MAP` | `100%` | structure, lanes/regions/stages, nodes, primary labels |
| `READ` | `125%–150%` | MAP plus node context and relationship labels |
| `FULL` | `175%+` | complete authored text including fine annotations |

Semantic Camera always chooses FULL even when fitting a neighborhood below
175%. Intent Trace, focus, Route Probe, Story Trail, and Relationship Preview
also reveal the exact matched detail while the rest of the diagram remains at
the current global level. The transition uses only opacity and an eight-unit
label translation, is disabled for `prefers-reduced-motion`, and never moves a
node, edge, route, or boundary.

Print forces every detail role visible and resets label anchors. Standalone SVG
serialization removes the viewer role attributes after cloning, so the exported
artifact contains the complete diagram and no current reading-depth state.

## Browser evidence

On the generated Agent Tool Call workflow:

- MAP reported `MAP 100%`; context and fine-detail computed opacity were both
  `0`, primary labels were centered, and the console was clean.
- One zoom step reported `READ 125%`; context opacity became `1`, fine detail
  remained `0`, and primary-label anchors returned to authored positions.
- Two additional steps reported `FULL 175%`; both detail tiers were visible.
- Reset followed by focusing Agent Planner activated Semantic Camera at
  `AUTO 132%`, selected FULL automatically, and showed its sublabel, tag,
  relationship labels, and Semantic Passport without a console error.
