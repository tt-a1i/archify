# Visual evolution round 10: Relationship Lens

## Reader problem

Archify could already focus a node and highlight its one-hop neighborhood, but the reader still had to decode arrow direction and small edge labels directly from the canvas. Focus answered “what is near this node?” without answering “what comes in, what leaves, what is the relationship called, and where can I go next?”

## Patterns worth borrowing

- [LikeC4 relationships](https://likec4.dev/dsl/relationships/) treat the relationship title as first-class model information and can navigate from a relationship into a more detailed view.
- [React Flow `useNodeConnections`](https://reactflow.dev/api-reference/hooks/use-node-connections) and [`getIncomers`](https://reactflow.dev/api-reference/utils/get-incomers) expose connections by source and target instead of forcing consumers to rediscover direction from pixels.
- [G6 behaviors](https://g6.antv.antgroup.com/en/manual/behavior/overview) keep focus, hover, zoom, drag, and selection as separate exploration behaviors; its element states distinguish selected, highlighted, and inactive content.

## Archify boundary

Add a read-only Relationship Lens, not an editor sidebar or graph-analysis runtime.

- Every renderer emits escaped `data-node-label`, `data-edge-label`, and stable per-diagram `data-edge-key` metadata alongside the existing semantic IDs and endpoints.
- Single-node focus opens a compact panel grouped into outgoing, incoming, and self-loop relationships.
- Each relationship row names the neighboring node and the edge, and follows that edge on click or keyboard activation.
- Arrow keys, Home, and End move through the relationship list; the existing node keyboard and deep-link contracts stay unchanged.
- Guided multi-node views hide the Lens because direction becomes ambiguous across a selection.
- The Lens is an HTML exploration surface. It is hidden in embed and print output, never enters SVG serialization, and does not change a single coordinate.
- All five typed renderers share the same implementation and contract test.

## What we deliberately did not borrow

Archify remains a technical-diagram compiler that produces a self-contained artifact. It does not add draggable editing, a global graph store, plugin installation, layout mutation, or relationship drill-down DSL in this slice. A future multi-view drill-down should be justified by real diagrams that cannot be understood through named one-hop traversal and bounded guided views.
