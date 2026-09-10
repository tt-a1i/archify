# Visual Evolution Round 18 — Semantic Radar

Date: 2026-07-19

## Question

What should Archify add after Node Finder, Semantic Camera, Relationship Lens,
Story Trail, and Semantic Passport so that large diagrams remain pleasant to
navigate without turning the standalone artifact into a canvas editor?

## Primary-source findings

### React Flow treats the minimap as a live model of the viewport

React Flow's official MiniMap reference says the component renders every node
as an SVG element and visualizes the current viewport relative to the complete
flow. It supports clicking nodes, panning by dragging, zooming, semantic node
colors, and an explicit accessible name.

- Reference: <https://reactflow.dev/api-reference/components/minimap>
- Source: <https://github.com/xyflow/xyflow/blob/main/packages/react/src/additional-components/MiniMap/MiniMap.tsx>

The source keeps a diagram-space `viewBB`, computes a combined bounding box,
and draws the viewport as an even-odd mask. It also compares rectangle values
before rerendering, which reinforces that the overview should update from
viewport state rather than clone the full application tree.

### GoJS uses an Overview as both orientation and navigation

GoJS documents an Overview as a view of all diagram parts plus a representation
of the observed diagram's viewport. Clicking or dragging inside the Overview
scrolls the main diagram. The overview intentionally does not reproduce every
rich surface: animations, images, and SVG are omitted.

- Reference: <https://gojs.net/latest/intro/overview.html>

This is a useful boundary for Archify: the overview should preserve spatial
meaning while simplifying rendering aggressively.

### Structurizr keeps navigation redundant and keyboard-addressable

Structurizr's viewer documents dedicated shortcuts for zooming, fitting width,
fitting height, fitting content, presentation mode, descriptions, metadata,
tooltips, and animation steps. Its quick-navigation surface also supports
typing, arrow-key selection, and Enter activation.

- Shortcuts: <https://docs.structurizr.com/ui/diagrams/keyboard-shortcuts>
- Quick navigation: <https://docs.structurizr.com/ui/quick-navigation>

The lesson is not to hide existing navigation behind the new map. The map must
remain an additional spatial route while Finder, zoom buttons, node focus, and
keyboard shortcuts stay fully usable.

## Borrow

1. A compact SVG overview derived from semantic node bounds.
2. A live viewport rectangle synchronized with zoom, pan, semantic framing,
   resize, and mobile horizontal scroll.
3. Node colors derived from Archify's authored semantic kinds.
4. Click a radar node to focus and reveal it in the main diagram.
5. Drag or click the radar surface to recenter an already-zoomed diagram.
6. An accessible toggle, accessible name, visible focus states, Escape close,
   and keyboard panning.

## Deliberately skip

- Do not clone the canonical SVG into the radar. It would duplicate IDs,
  filters, text, animation, and export-sensitive state.
- Do not introduce React Flow, GoJS, Canvas, or another runtime dependency.
- Do not make the radar a layout editor or allow node movement.
- Do not display the radar in embed, print, or exported SVG output.
- Do not open it automatically and cover authored content; keep the reader in
  control through one compact toolbar toggle.

## Archify synthesis

Build a dependency-free **Semantic Radar** inside the shared HTML template. It
will render only simplified semantic node bounds and one viewport rectangle,
using the same type colors as the diagram. The radar becomes memorable through
an instrument-panel treatment — terse status copy, a live indicator, and exact
viewport motion — while the interaction remains quiet and production-oriented.

Acceptance requires all five typed renderers to inherit the same surface,
canonical SVG serialization to remain clean, and real desktop/mobile Browser
validation to prove that the panel neither overflows nor obstructs primary
node-reading workflows.
