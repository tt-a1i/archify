# Visual evolution round 11: Relationship Preview

## Reader problem

Relationship Lens made edge names and directions readable, but it still left a high-degree-node reader to visually match a text row with one of several nearby paths. The panel answered “what is this relationship called?” without instantly answering “which exact line is it?”

## Patterns worth borrowing

- [G6 HoverActivate](https://g6.antv.antgroup.com/manual/behavior/hover-activate) treats hover activation as a bounded behavior with direction-aware neighbors and explicit active/inactive states.
- [G6 element states](https://g6.antv.antgroup.com/en/manual/element/state) allow selected, highlighted, active, and inactive states to coexist instead of replacing one another.
- [React Flow `getConnectedEdges`](https://reactflow.dev/api-reference/utils/get-connected-edges) resolves the exact relationship set from semantic endpoints rather than estimating from rendered pixels.
- [Cytoscape.js events](https://js.cytoscape.org/index.html#events) expose pointer-over and pointer-out alongside keyboard-independent graph state, a useful reminder that preview and activation are separate actions.

## Archify boundary

Add a read-only, exact-path preview layered over the existing one-hop focus—not direct edge picking or graph editing.

- Every Lens row carries the renderer's stable edge key plus its actual source and target IDs.
- Pointer hover and keyboard focus use the same preview function and visual state.
- The other focused relationships temporarily recede while the exact edge, source, and target remain fully visible.
- The edge keeps its original solid/dashed relationship language; preview only changes opacity, weight, and a restrained theme-aware shadow.
- Source and target receive different semantic accents so direction is readable before activation.
- On narrow screens, an active preview collapses the long Lens into a one-row Peek card and pins it to the half opposite the focused node. This preserves the exact source, target, and path; leaving the row restores the complete list.
- Click/Enter still follows the relationship to the neighboring node; preview never mutates graph data, coordinates, or the URL.
- Preview attributes are explicitly stripped from the cloned SVG and included in the canonical-export cleanliness receipt.
- Blueprint uses a reduced shadow, and reduced-motion mode remains motion-free because preview adds no animation.
- One shared implementation and contract tests cover architecture, workflow, sequence, data-flow, and lifecycle renderers.

## What we deliberately did not borrow

Archify does not add enlarged edge hit zones, an editable canvas, a graph runtime, or a third-party rendering library. Direct edge interaction would compete with pan/zoom on dense and mobile diagrams. The accessible Relationship Lens remains the interaction surface, while SVG geometry stays a deterministic compiled artifact.
