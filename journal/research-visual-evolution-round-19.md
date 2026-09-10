# Visual Evolution Round 19 — Intent Trace

Research date: 2026-07-19 (Asia/Shanghai)

## Product question

Archify has strong committed exploration after a reader clicks a node: Semantic
Camera frames its neighborhood, Semantic Passport explains it, Relationship Lens
lists exact connections, and Semantic Radar preserves spatial context. The first
exploration moment is weaker. Before clicking, a node only gains a glow, so a new
reader cannot tell whether the click will reveal metadata, navigate away, or edit
the diagram.

Can Archify make the diagram feel immediately explorable without adding another
toolbar, tooltip, editor mode, or persistent animation?

## Primary-source findings

### AntV G6: hover is a bounded graph behavior

G6 documents `hover-activate` as a built-in data-exploration behavior. Its
configuration separates degree, edge direction, active state, inactive state,
animation, and enablement. That is a useful boundary: hover feedback is not a
selection model and should be independently suppressible when another interaction
owns the canvas.

- <https://g6.antv.antgroup.com/en/manual/behavior/overview>
- <https://g6.antv.antgroup.com/manual/behavior/hover-activate>

### Sigma.js: preview and commitment are distinct events

Sigma's node event model exposes `enterNode` and `leaveNode` separately from
`clickNode`. The event payload includes the stable node ID. Archify should keep
the same semantic split: entering previews one-hop traffic; clicking continues to
own durable focus, URL state, and details.

- <https://www.sigmajs.org/docs/advanced/events/>

### Cytoscape.js: pointer and touch have different contracts

Cytoscape documents mouseover/mouseout as separate from normalized tap events,
and notes that labels or details can be delayed until tap/mouseover. Archify
should not invent a hover dependency for touch users. Touch stays click-to-focus;
hover is an enhancement for fine pointers, with keyboard focus as its accessible
equivalent.

- <https://js.cytoscape.org/#events/user-input-device-events>

### React Flow: node mouse handlers receive semantic node data

React Flow's `NodeMouseHandler` receives both the pointer event and the node that
triggered it. Archify already has the equivalent stable identity in
`data-node-id`; it does not need a graph runtime to implement a small preview
behavior.

- <https://reactflow.dev/api-reference/types/node-mouse-handler>

### SVG and motion preferences: normalize the path, respect the reader

SVG 2 defines `pathLength` as a calibration mechanism for distance-along-a-path
calculations, including stroke operations. A viewer-only clone can therefore use
`pathLength="1"` so a short edge and a long edge carry the same restrained motion
rhythm. Media Queries Level 5 defines `prefers-reduced-motion` for replacing or
removing non-essential animation; the trace must become a static highlight under
that preference.

- <https://svgwg.org/svg2-draft/paths.html#PathLengthAttribute>
- <https://drafts.csswg.org/mediaqueries-5/#prefers-reduced-motion>

## Decision

Add **Intent Trace**, a geometry-neutral, viewer-only preview layered before
durable focus.

1. Pointer hover on a fine pointer, or keyboard focus on a semantic node, previews
   exactly its one-hop incoming, outgoing, and loop relationships.
2. Related nodes and authored edges remain clear while unrelated graph elements
   recede gently.
3. A runtime SVG overlay clones only edge geometry, removes markers and semantic
   attributes, normalizes every shape with `pathLength="1"`, and animates a short
   directional signal. Incoming and outgoing signals use distinct existing theme
   colors.
4. Click/Enter/Space keeps the existing durable focus behavior. Intent Trace owns
   no URL, selection, camera, schema, or geometry state.
5. Embed/share playback, persistent focus, relationship preview, story playback,
   and canvas panning suppress the temporary trace.
6. Touch goes directly to durable focus. Reduced-motion mode keeps the one-hop
   contrast but removes the moving signal.
7. A visually hidden live region gives keyboard users connection counts and the
   instruction to press Enter for details.
8. Export clones remove all trace attributes and overlays.

## Borrow / skip boundary

Borrow:

- hover as a separate, bounded behavior;
- stable-ID event handling;
- one-hop and direction-aware activation;
- keyboard parity and reduced-motion fallback;
- a lightweight preview before durable selection.

Skip:

- generic tooltips that duplicate Semantic Passport;
- direct edge picking, enlarged edge hit areas, or graph editing;
- touch hover simulation or long-press modes;
- persistent ambient movement on every edge;
- changing authored dash patterns, markers, node coordinates, or JSON IR.

## Acceptance evidence

- All five typed renderers inherit the same preview behavior.
- Hover/focus highlights the exact one-hop set and direction-classed runtime edge
  overlay; leaving clears it without changing the URL or camera.
- Clicking still opens Semantic Passport and clears the temporary preview.
- Embed, touch, active story/focus/relationship preview, and panning do not start
  Intent Trace.
- Reduced motion produces no trace animation.
- Export serialization contains no Intent Trace overlay or transient attributes.
- Desktop and mobile browser checks show no overflow, stuck preview, control
  collision, or regression to tap-to-focus.
