# Visual Evolution Round 21 — Searchable Route Endpoints

Research date: 2026-07-19 (Asia/Shanghai)

## Reader gap

Route Probe can already trace the shortest authored directed route between two
semantic nodes. Direct canvas picking works well when both endpoints are in
view, but it becomes needlessly difficult on a wide mobile diagram or a dense
system whose destination is off-screen. Node Finder already solves discovery,
yet before this round it always converted a result into normal semantic focus
and therefore cleared an in-progress route question.

## Primary-source lessons

- [Neo4j Bloom's search bar](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/search-bar/)
  describes Bloom as a search-first graph environment. Suggestions can be
  filtered and activated by keyboard as well as pointer, and the same search
  surface can initiate graph actions. The useful lesson for Archify is to reuse
  one familiar navigator in the context of the current task instead of adding
  another endpoint modal.
- [Neo4j Bloom's default actions](https://neo4j.com/docs/bloom-user-guide/current/bloom-appendix/bloom-appendix/)
  defines Path as the shortest path between two selected nodes. That reinforces
  a visible two-step endpoint contract: source first, destination second.
- [yFiles' shortest-path API](https://docs.yworks.com/yfiles-html/api/ShortestPath/)
  models source and sink separately and accepts explicit item collections for
  either side. Its
  [path analysis guide](https://docs.yworks.com/yfiles-html/dguide/analysis-paths/)
  also keeps directed traversal explicit. Archify should therefore filter the
  destination choice by authored direction, not merely search every node and
  explain failure afterward.
- [yFiles' interaction guide](https://docs.yworks.com/yfiles-html/dguide/interaction-support/)
  treats tap as the touch equivalent of click for selection. Search-assisted
  picking must complement direct pointer/keyboard selection, not replace it.

## Borrow / skip decision

### Borrow

1. Let the existing Finder inherit the active graph task.
2. Give source and destination steps different titles, placeholders, colors,
   result labels, and accessible action names.
3. Offer only nodes with real outgoing authored edges as source suggestions.
4. Offer only destinations reachable from the chosen source, and report their
   directed hop distance before selection.
5. Preserve pointer, Enter/Space, Escape, and direct-canvas behavior.

### Skip

- No database-backed suggestion service, fuzzy-search dependency, graph editor,
  scene mutation, or second search component.
- No disabled wall of impossible destinations. In a bounded endpoint picker,
  invalid options add noise and make mobile scanning worse.
- No undirected fallback and no distance inferred from pixels.
- No schema, IR, layout, or canonical SVG changes.

## Archify implementation

While Route Probe is choosing a source or destination, <kbd>/</kbd>, the normal
Finder control, or the receipt's contextual `Find start` / `Find target` action
opens **Node Finder in endpoint mode**.

- Source mode lists only nodes that can begin at least one authored directed
  route and marks each result as `START`.
- Destination mode lists only nodes reachable from the selected source and
  previews the shortest directed hop count for every result.
- Choosing a source hands control back to Route Probe, reveals that area with
  Semantic Camera, and advances to destination mode. Choosing a destination
  renders the same ordered route receipt and shareable `#route=` result as
  direct canvas selection.
- Escape closes Finder without discarding the in-progress route. On narrow
  screens the underlying Route Probe receipt temporarily recedes so two panels
  never cover each other.
- Outside Route Probe, Finder retains its existing focus behavior and
  relationship-count results.

The handoff is viewer-only. Export, embed, print, semantic IDs, authored edges,
and renderer geometry remain unchanged.
