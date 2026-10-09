# Hierarchy and Tree Renderer

Render `diagram_type: "tree"` JSON files into the standard Archify HTML template.

```bash
node archify/renderers/tree/render-tree.mjs input.tree.json output.html
```

The renderer validates input against `archify/schemas/tree.schema.json` with the
bundled standalone validator. If `output.html` is omitted, it uses
`meta.output` or falls back to `tree.html`. `--layout-json` prints the placed
nodes and links instead of writing HTML.

## Input

```json
{
  "schema_version": 1,
  "diagram_type": "tree",
  "meta": { "title": "Payment platform capabilities" },
  "nodes": [
    { "id": "platform", "label": "Payment platform" },
    { "id": "orders", "label": "Orders", "parent": "platform" }
  ]
}
```

A node has `id`, `label`, and optional `parent`, `sublabel`, `collapsed`, and
`sources`. Children are read in declaration order. Links are containment only;
the first slice has no cross-branch relationships.

## Structure checks

The hierarchy is exactly what the author declared; nothing is attached or
inferred.

| Code | Refused input |
| --- | --- |
| `tree/missing-parent` | `parent` names an undeclared node |
| `tree/root-count` | zero or more than one node without `parent` |
| `tree/cycle` | a parent chain that loops; every node beneath the loop is unreachable, so this one diagnostic covers them |
| `tree/duplicate-id` | an id declared twice |

## Layout

Each generation shares one band: a row for `layout.direction: "down"` (the
default) and a column for `"right"`. Along the other axis every subtree owns a
contiguous span, so unequal branch widths and depths never overlap. A parent is
centred over its first and last child (exactly over a middle child that sits
within a few pixels of that midpoint, so the stem never jogs; edge drawing also snaps stems aligned within 2px after rounding); going right,
nodes are left-aligned in their column.

Going down, a run of three or more consecutive leaf siblings is stacked as an
indented list under its parent, sharing one width and reached along a spine,
instead of fanning out across the row. This keeps a real hierarchy such as a
repository readable at one screen's scale; shorter runs and every branch keep
the row layout. Leaves are quiet cards; the root and branches carry the tone.

Nodes size to their label between `layout.nodeW` (140) and `layout.nodeMaxW`
(220 down, 200 right). Labels and sublabels wrap between words (CJK at any
character), at the narrowest width that keeps the same number of lines, so a
long label becomes a balanced box; a single word may widen a node to 1.5 × `nodeMaxW` before it is
split, so nothing is truncated. `gapX`/`gapY` set the sibling and generation
gaps.

An automatic canvas declares `data-reader-fit="intrinsic-height"` and a 7.5px
reader text floor, so a deep rightward tree scrolls instead of shrinking.

## Expand and collapse

Every node with children gets a toggle on its outgoing side, a separate
focusable button after the node, with `aria-expanded` and a localized label
that states how many descendants it hides. The Viewer module
`viewer/tree-branches.js` owns the state:

- Collapsing hides descendants and their links only. Positions are computed
  once for the complete tree, so nothing visible moves and the reader keeps
  their place. A collapsed node shows a stacked card and its hidden count.
- Keyboard: Enter/Space on a toggle; ArrowLeft collapses and ArrowRight expands
  the focused branch node. Focus stays on the control that was used.
- **Expand all** appears at the top-left while any branch is collapsed and
  restores the authored hierarchy.
- Selecting a hidden node through Finder, Node Outline, guided views, or a
  shared link expands its ancestors first.
- `collapsed: true` only sets the initial Viewer state. The SVG always contains
  the complete tree.

Export scope is explicit: every SVG/PNG/JPEG/WebP export is the complete tree,
whatever is collapsed on screen. Export Cleanup removes the collapsed state from
the clone and leaves the live view unchanged.

## Tested size

`examples/archify-repository.tree.json` (31 nodes, depth 4, unbalanced, four
stacked lists) renders in about 0.2s and passes the showcase gates;
a toggle updates the DOM in under a few milliseconds.
