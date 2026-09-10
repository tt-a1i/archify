# Visual Evolution Round 24 — Semantic Lens

Research date: 2026-07-19 (Asia/Shanghai)

## Product question

Reading Depth now answers “how much detail should I see at this zoom?” The next
unanswered reader question is categorical rather than spatial:

> Where are the security, database, backend, waiting, or failure elements, and
> how do those semantic kinds connect?

Finder can locate a known node, Intent Trace can preview one node's neighborhood,
and Route Probe can connect two known endpoints. None of them gives a whole-graph
comparison by semantic kind. The highest-leverage next capability is therefore
an interactive, counted **Semantic Lens** over the semantics Archify already
compiled—not a generic database-style filter builder.

## Current Archify evidence

- [`focusNodeAttrs()`](../archify/renderers/shared/cli.mjs) already emits a stable
  `data-node-kind` together with node ID, label, sublabel, tag, and context. All
  five typed renderers call this helper, so a kind lens needs no schema or IR
  change.
- Compiled relationships already expose stable `data-edge-from`, `data-edge-to`,
  and deduplicating edge keys in the shared viewer. Category counts and exact
  touching/cross-kind relationship counts can therefore be computed from the
  artifact itself.
- Existing renderer legends are intentionally heterogeneous. Architecture's
  legend describes node kinds, while Sequence and Data Flow mainly explain edge
  variants. Retrofitting every in-SVG legend into one universal filter would
  conflate different authored meanings. The shared viewer should derive a
  separate Lens from `data-node-kind` instead.
- The viewer already owns temporary focus, route, story, camera, URL, print, and
  export state in [`template.html`](../archify/assets/template.html). Lens belongs
  in that same viewer boundary and must not modify canonical SVG geometry.

## Primary-source findings

### G6: a legend is an interaction surface, not merely a color key

[G6's Legend documentation](https://g6.antv.antgroup.com/manual/plugin/legend)
defines node, edge, and combo classification fields and supports hover or click
as the legend trigger. Its
[Legend source](https://github.com/antvis/G6/blob/v5/packages/g6/src/plugins/legend.ts)
maps each category to element IDs, applies an `active` state for hover and a
toggleable `selected` state for click, and fades unselected legend items. The
transferable pattern is a clean split between transient preview and durable,
multi-category selection.

Archify should borrow that interaction grammar, not G6's plugin/canvas stack or
generic state engine.

### Sigma.js: visual reduction can be derived without mutating graph data

[Sigma.js reducers](https://www.sigmajs.org/docs/advanced/data/#dynamic-attribute-transformation-reducers)
transform node and edge display attributes immediately before rendering without
changing the underlying Graphology graph. Its official
[reducer example](https://github.com/jacomyal/sigma.js/blob/main/packages/storybook/stories/1-core-features/4-use-reducers/index.ts)
greys nonmatching nodes, preserves matching labels, and suppresses unrelated
edges while search or hover state is active.

Archify already has the simpler SVG equivalent: set viewer-only match/context
attributes and let CSS change emphasis. No data copy, layout pass, or dependency
is needed.

### Linkurious: counts and an explicit reset make filtering understandable

[Linkurious' Filter panel](https://doc.linkurious.com/user-manual/latest/filter-panel/)
lists detected node categories and edge types with counts, category selection,
visibility toggles, an Applied Filters area, and Reset Filters. Notably, elements
described as “hidden” remain light grey in the visualization. That preserves the
reader's mental map while making the active slice unmistakable.

The useful lesson is smaller than the product: show exact counts, keep the active
set visible, and offer an obvious reset. Archify does not need nested property
trees, numeric ranges, dates, schema inference, or a full investigation sidebar.

### Cytoscape.js: hard hiding changes graph behavior

[Cytoscape.js selectors](https://js.cytoscape.org/#selectors) can express rich
data predicates, but its
[visibility contract](https://js.cytoscape.org/#style/visibility) explains why
hard filtering is wrong here: `display: none` removes an element from fitting and
interaction, makes a node a point for layout purposes, and hides its incident
edges. Opacity, by contrast, preserves layout, fitting, and interaction.

Archify is a fixed-geometry technical-diagram compiler. A semantic lens should
therefore reduce contrast rather than delete nodes, alter bounds, or silently
break authored routes.

### yFiles: filtering can preserve the original graph, but still creates a new view

[yFiles' filtering guide](https://docs.yworks.com/yfiles-html/dguide/filtering/)
uses `FilteredGraphWrapper` to expose a live subset while preserving the wrapped
graph. Nodes that fail a predicate disappear from the filtered collections, and
their incident edges disappear automatically. This is a strong model for graph
applications that want a real subgraph.

It is excessive for Archify. The compiled diagram is the authoritative view;
creating a second topology would complicate focus, shortest paths, stories,
camera bounds, and export semantics. Borrow predicate-like determinism, but keep
one graph and one geometry.

## Candidate decision

| Candidate | Reader value | Boundary cost | Decision |
|---|---:|---:|---|
| Counted Semantic Lens over `data-node-kind` | High | Low | **Build next** |
| Full facets over kind, tag, context, lane, property, and edge type | Medium | High | Postpone; several fields are free text or not normalized across modes |
| Hard category filtering / subgraph view | Medium | High | Skip; it hides topology and changes fitting/interaction semantics |
| Collapse or regroup nodes by kind | Medium | Very high | Skip; it mutates authored geometry and diagram meaning |
| Make every existing SVG legend item interactive | Uneven | Medium | Skip; current legends classify different concepts per renderer |

## Recommended interaction contract

1. Add one compact `LENS` viewer control and <kbd>L</kbd> shortcut. The existing
   Diagram Guide should expose it as “Compare semantic kinds.” Do not open it on
   first load.
2. Derive one chip per distinct `data-node-kind`, in deterministic count-descending
   then label order. Each chip shows the existing semantic swatch, a human-readable
   label, and its exact node count. Kinds absent from the diagram never appear.
3. Clicking/pressing a chip toggles it with `aria-pressed`; at most two kinds may
   be pinned so the resulting comparison remains legible. An explicit Reset
   action clears the set.
5. With one kind selected, keep its nodes and all touching relationships strong;
   keep the opposite endpoints at medium contrast so the reader can understand
   what the kind talks to. Unrelated content recedes but remains visible.
6. With two kinds selected, keep only the selected nodes and their direct
   cross-kind relationships strong. Report each authored direction separately;
   unrelated content stays quiet but spatially present.
7. Report an exact receipt such as `Backend → Database: 3 · Database → Backend: 1
   · 4 direct relationships`. Count each compiled relationship once by its stable
   edge key, not once per path/label DOM fragment.
8. Lens never moves nodes, reroutes edges, changes zoom, or deletes DOM. Matching
   detail should be readable through the existing Reading Depth override.
9. Durable graph modes remain unambiguous: starting Focus, Route Probe, Story
   Trail, or Relationship Preview clears Lens; pinning a Lens first clears those
   modes. Fine-pointer hover previews are suppressed while another durable mode
   owns the diagram.
10. A pinned selection is shareable as canonical stable-kind state such as
    `#lens=backend~database`; unknown and duplicate values are ignored. Closing
    the panel does not discard a pinned lens, while Escape clears the lens before
    closing the surface.

## Borrow / skip boundary

### Borrow now

- Category chips built from actual compiled semantics.
- Counts, toggle-on-click, a bounded two-kind comparison, and explicit reset.
- Display-only emphasis derived from an immutable semantic graph.
- Soft filtering that preserves spatial and relationship context.
- A compact quantitative receipt and shareable stable state.

### Deliberately skip

- No G6, Sigma, Cytoscape, yFiles, Graphology, React, Canvas, or WebGL runtime.
- No query language, nested facet builder, property-type inference, range/date
  controls, database search, or user-authored filtering expressions.
- No new schema field, JSON IR concept, renderer layout rule, graph copy, or
  category-specific authored coordinates.
- No hard hiding, topology mutation, automatic relayout, category grouping, or
  collapsed supernodes.
- No filtering of canonical print or standalone SVG export. Those remain complete
  and viewer-state-free.

## Concrete acceptance criteria

1. Every typed artifact derives the same Lens from its existing semantic node
   hooks; no renderer-specific category list is hard-coded.
2. Chip order and counts are deterministic, and the sum of chip counts equals the
   number of semantic nodes. Artifacts with fewer than two distinct kinds expose
   no dead interactive control.
3. Keyboard/pointer selection, pinned single-kind state, pinned two-kind state,
   reset, Escape, and URL restoration all have focused tests.
4. Node, touching-edge, contextual-endpoint, cross-kind-direction, and unrelated
   sets are computed from exact IDs/endpoints and deduplicated edge keys.
5. Lens state never changes element coordinates, viewBox, authored edge geometry,
   camera transform, schema output, or relationship order.
6. Lens composes with Reading Depth by revealing matched context/fine detail, and
   its arbitration with Focus, Intent Trace, Route Probe, Story Trail, Semantic
   Radar, and Relationship Preview cannot leave mixed or stuck states.
7. Chips are real buttons with visible focus, `aria-pressed`, arrow/Home/End
   navigation, a live count receipt, touch parity, and no hover-only requirement.
8. Mobile layout remains contained and scannable without covering the nav or
   diagram; reduced-motion mode removes emphasis transitions.
9. Embed may restore a shared `#lens=` view without showing editing/navigation
   chrome. Print and standalone SVG export always contain the full canonical
   diagram and no Lens attributes, overlays, controls, or dimming.
10. Browser validation covers at least one architecture/workflow artifact and one
    lifecycle artifact on desktop plus a 390px viewport, including multi-kind
    comparison, Escape/reset, restored links, and zero console errors.

## Recommendation

Build **Semantic Lens** next. It is the rare post-Reading-Depth feature that makes
the graph feel richer while making the implementation conceptually smaller: one
viewer-derived semantic index, one compact interaction surface, and no new
authoring burden. It turns Archify's existing colors and node kinds from passive
decoration into a question-answering tool, while preserving the zero-dependency
technical-diagram compiler boundary.
