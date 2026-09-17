# Visual evolution round 12: Semantic Camera

## Reader problem

Archify could select nodes, name relationships, and play guided views, but desktop `reveal()` returned without changing the viewport. In Presentation Stage, tall or dense diagrams could remain centered at overview scale even when only four nodes mattered. The system knew the reader's semantic intent but did not give that intent the frame.

## Patterns worth borrowing

- [G6 `focusElement`](https://g6.antv.antgroup.com/en/api/element) centers one or more semantic element IDs and accepts a bounded viewport animation.
- [G6 FocusElement behavior](https://g6.antv.antgroup.com/en/manual/behavior/focus-element) keeps focusing separate from drag and zoom behavior, with configurable duration and easing.
- [React Flow `FitViewOptions`](https://reactflow.dev/api-reference/types/fit-view-options) combines selected nodes, padding, minimum/maximum zoom, duration, easing, and interpolation into one explicit camera contract.
- [Cytoscape.js viewport manipulation](https://js.cytoscape.org/index.html#cy.fit) separates `fit`, `center`, pan/zoom, and animated viewport operations instead of mutating model positions.

## Archify boundary

Add a semantic, viewer-only camera—not auto-layout, node movement, or a graph runtime.

- The authored SVG `getBBox()` values are the only geometry source; Semantic Camera maps their union through the current `viewBox` and `preserveAspectRatio` letterboxing.
- Node focus frames the frozen one-hop seed set, never a transitively expanding connected component.
- Relationship traversal and Finder selection frame the new node's one-hop neighborhood.
- Guided views fit exactly their authored nodes with 48px base padding, a 2.15× ceiling, and a 480ms ease-out transition.
- Relationship Lens reserves a left-side safe zone so selected nodes cannot land under the panel.
- The reset control shows `AUTO` only when semantic framing actually zooms above 100%.
- Manual zoom or drag stops the camera and pauses guided playback. Show all and Escape restore the complete 100% overview.
- At 720px and below, transforms normalize to 100%. Wide diagrams keep the existing contained horizontal-scroll model; user swiping pauses playback after programmatic scrolling has settled.
- `prefers-reduced-motion` removes the transition, and Presentation Stage re-fits after its layout changes.
- Camera mode lives on the HTML container. SVG export still strips the transform and `data-view-scale`; no camera state or coordinate enters the artifact.
- One implementation and contract test cover architecture, workflow, sequence, data-flow, and lifecycle.

## Browser-led corrections

The first in-app-browser pass exposed three defects that static contracts could not:

1. A mutable neighbor set expanded one-hop focus into the whole connected component. Freezing the original seed IDs restored semantic parity.
2. Desktop Show all could be mislabeled `manual` by a non-user container scroll event. Manual scroll takeover is now limited to the narrow wide-diagram surface.
3. A desktop transform survived a desktop-to-mobile resize. Narrow reveal now normalizes scale and translation before horizontal positioning.

## What we deliberately did not borrow

Archify does not add wheel zoom, inertial physics, a minimap, editable node positions, or a persistent camera model in JSON. The camera interprets semantic selections inside a compiled artifact; it never becomes part of the diagram source of truth.
