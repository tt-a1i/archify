# Visual Evolution Round 20 — Route Probe
Research date: 2026-07-19 (Asia/Shanghai)

## Reader gap

Archify already supports authored Story Trails, one-hop Intent Trace, durable
node focus, relationship inspection, search, and overview navigation. Those
surfaces answer “what is this?”, “what touches it?”, and “what story did the
author prepare?” They do not answer an unplanned reader question that appears
constantly in architecture review: **what exact directed route connects this
component to that one?**

## Primary-source lessons

- [Neo4j Bloom's default actions](https://neo4j.com/docs/bloom-user-guide/current/bloom-appendix/bloom-appendix/)
  make Path a two-selection action that shows the shortest path. The valuable
  idea is the compact question—two known endpoints—not Bloom's database,
  editing model, or scene expansion.
- [Cytoscape.js graph algorithms](https://js.cytoscape.org/#collection/algorithms)
  return an ordered path containing both nodes and the edges between them, and
  let the caller explicitly choose directed traversal. Archify should likewise
  preserve authored direction and exact edge identity instead of merely
  highlighting a set of connected nodes.
- [Graphology's shortest-path package](https://graphology.github.io/standard-library/shortest-path.html)
  exposes an unweighted shortest path and returns `null` when no path exists.
  Archify has no authored costs, so “fewest real relationship hops” is a more
  honest contract than inventing weights from screen distance or color.
- [yFiles shortest-path documentation](https://docs.yworks.com/yfiles-html/api/ShortestPath/)
  separates graph analysis from the visual highlight applied to the result and
  treats directed traversal as an explicit property. Its
  [selection/focus/highlight model](https://docs.yworks.com/yfiles-html/dguide/view/view_selection.html)
  also keeps transient highlights independent from focus and selection. That
  matches Archify's existing separation between Intent Trace, Focus, Story,
  and exported geometry.

## Borrow / skip decision

### Borrow

1. Ask for exactly two endpoints and treat order as direction.
2. Compute the smallest number of authored directed relationship hops.
3. Preserve the exact ordered node and edge result.
4. Present analysis as temporary viewer highlighting, not graph mutation.
5. Give no-route outcomes an explicit, readable state.

### Skip

- No graph-analysis dependency, weighted-cost schema, A* heuristic, database
  query, arbitrary path enumeration, or editor selection model.
- No fallback to an undirected path. Showing a visually convenient reverse
  route would contradict renderer-owned arrow direction.
- No node movement, scene expansion, or generated geometry.
- No second path source in JSON. The compiled semantic relationships remain
  the only topology contract.

## Archify implementation

**Route Probe** is a viewer-only mode available from `PATH` or <kbd>R</kbd>.

1. If a node is already focused, it becomes the source; otherwise the reader
   picks a source on the canvas.
2. A deterministic unweighted BFS follows `data-edge-from` to `data-edge-to`
   in authored DOM order. Before the destination is picked, only reachable
   semantic nodes remain strong, preventing a mystery dead end.
3. Picking a destination reveals the ordered route, highlights only its exact
   nodes and edges, frames it with Semantic Camera, and emits a compact route
   receipt with node count and directed hop count.
4. A cloned, marker-free, `pathLength="1"` overlay sends a restrained signal
   over the result. Reduced-motion readers receive the same static path.
5. `#route=<source>~<target>` restores and shares the query through stable IDs.
6. Pointer and Enter/Space endpoint selection are equivalent. Escape clears
   the route before focus or Presentation Stage.

The mode is absent from embed and print surfaces. Canonical SVG export removes
the route root state, endpoint/path attributes, and all cloned signal geometry.
No schema, IR, renderer layout, authored edge, or dependency changes.
