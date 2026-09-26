# Visual Evolution Round 27 — Semantic Legend Bridge

Research date: 2026-07-20 (Asia/Shanghai)

## Product question

Archify already has two category surfaces:

1. each renderer draws a compact in-diagram legend; and
2. the shared viewer derives a counted, interactive **Semantic Lens** from the
   compiled `data-node-kind` hooks.

The remaining friction is visible in the finished artifact: the reader sees a
semantic swatch and label at the bottom of the diagram, but must discover the
separate `LENS` control or <kbd>L</kbd> shortcut before the swatch becomes useful.
The question for this round is therefore deliberately narrow:

> Should a compatible static legend item become a direct, counted entry into
> the existing Semantic Lens, and can that feel alive without turning Archify
> into a filtering dashboard?

**Recommendation: yes, selectively.** Build a viewer-owned **Semantic Legend
Bridge** for legend rows that explicitly map to one real `data-node-kind`.
Activation should enter the existing Semantic Lens; hover/focus may offer a
temporary static preview. Keep edge-style, mixed-domain, and ambiguous legend
items explanatory and non-interactive.

This is a discoverability and feedback improvement, not a second filtering
system.

## Current Archify evidence

### The Lens already owns the authoritative category model

[`Archify.semanticLens`](../archify/assets/template.html) currently:

- deduplicates semantic nodes by stable `data-node-id`;
- derives kinds and exact node counts from `data-node-kind`;
- sorts kinds deterministically by count and label;
- maps authored relationships by stable edge key;
- supports one-kind traffic and bounded two-kind comparison;
- owns `aria-pressed`, Reset, arrow/Home/End navigation, `#lens=` restoration,
  viewer-state arbitration, Reading Depth overrides, and canonical export
  cleanup.

A direct legend entry must call that same owner. It must not copy count logic,
relationship matching, URL state, or dimming rules into a renderer.

### Renderer legends do not all mean the same thing

- [`render-architecture.mjs`](../archify/renderers/architecture/render-architecture.mjs)
  dynamically emits exactly one swatch per component type that is actually
  present. This is a lossless map to `data-node-kind` and is the best first
  bridge.
- [`render-workflow.mjs`](../archify/renderers/workflow/render-workflow.mjs)
  uses five node-kind colors (`frontend`, `backend`, `security`, `messagebus`,
  `database`) under domain labels such as “User UI” and “Agent logic.” These
  rows can be bridged only when the renderer marks their exact kind.
- [`render-lifecycle.mjs`](../archify/renderers/lifecycle/render-lifecycle.mjs)
  has exact rows for `active`, `waiting`, `success`, and `failure`, but not for
  every lifecycle kind (`start` and `decision` can also occur). Marked rows can
  be bridged; the bridge must not imply complete kind coverage.
- [`render-sequence.mjs`](../archify/renderers/sequence/render-sequence.mjs)
  explains message/edge variants such as request and return. It is not a node
  category legend and must remain static.
- [`render-dataflow.mjs`](../archify/renderers/dataflow/render-dataflow.mjs)
  mixes edge variants with one data-store node swatch. Making only the last row
  interactive would give identical-looking entries different hidden behavior.
  Keep the whole mixed legend static in this slice.

Round 24 correctly rejected making *every* SVG legend item interactive. Now
that Semantic Lens exists, the safer refinement is not to reverse that decision;
it is to add an explicit semantic marker only where the mapping is exact.

## Primary-source findings

### 1. Fireworks Tech Graph proves that legend meaning must stay authored

The comparison is pinned to
[`yizhiyanhua-ai/fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44).
Its approved interactive architecture artifact keeps the SVG legend as an
authored `data-graph-role="legend"` group whose entries explain **edge roles**:
“primary API path,” “prompt / tools,” and “governance”
([fixed legend source](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/examples/interactive-architecture.html#L181-L188)).
Those rows are decorative SVG lines and text, not buttons, filters, or node
facets.

At the same time, Fireworks puts true viewer actions in native HTML controls
with visible hover/focus treatment, a focusable stage, an `aria-live` status,
and documented keyboard shortcuts
([viewer controls](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L236-L265),
[pointer/keyboard implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L290-L328)).
It also disables transitions under reduced motion
([preference guard](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L238-L246)).

**Borrow:** preserve the authored legend's domain and keep interaction in a
viewer-owned layer with explicit focus and cleanup. **Do not borrow:** the lack
of legend interactivity as a product ceiling, or Fireworks' direct serialization
of the live SVG for Archify's export path. Archify already has a stronger
canonical-clone boundary and should keep runtime decorations out of export.

This source is also a useful negative test: a legend can look like Archify's
legend and still classify edges rather than node kinds. Shape and color alone
are not sufficient evidence that a row may drive Semantic Lens.

### 2. G6 separates transient `active` from durable `selected`

The official G6 Legend documentation says a legend is used both to communicate
classification and to highlight/locate corresponding elements, with `hover` or
`click` as the configured trigger
([official overview and options](https://g6.antv.antgroup.com/manual/plugin/legend#%E6%A6%82%E8%BF%B0)).

At pinned G6 source snapshot
[`7b7ff8e`](https://github.com/antvis/G6/tree/7b7ff8e2b52609486840963dc1608d9f565e7f66),
the plugin:

- builds field maps from a category to exact element IDs
  ([field-map construction](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/plugins/legend.ts#L228-L240),
  [data reduction](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/plugins/legend.ts#L291-L330));
- uses a temporary `active` state for mouse entry and clears it on leave
  ([hover state](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/plugins/legend.ts#L179-L206));
- toggles a durable `selected` state on click
  ([click state](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/plugins/legend.ts#L161-L177)); and
- fades unselected legend markers and labels instead of removing them
  ([legend feedback](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/plugins/legend.ts#L208-L225)).

The exact count badge is an Archify inference from the same category-to-ID
principle: for a marked kind, the honest count is the number of distinct
semantic node IDs already returned by `semanticLens.kinds()`, never the number
of swatches, DOM descendants, path fragments, or touching edges.

**Borrow:** the `active`/`selected` split and category-to-ID determinism.
**Improve:** G6's legend event table is mouse-oriented (`mouseenter`,
`mouseleave`, `click`)
([event source](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/plugins/legend.ts#L243-L248));
Archify must add keyboard, focus, touch, semantic state, and target-size behavior
rather than copying the plugin literally.

### 3. Sigma and yFiles favor visual state over data mutation for highlighting

Sigma's official data guide describes node and edge reducers as transformations
immediately before rendering that do not modify the underlying Graphology graph
([reducers](https://www.sigmajs.org/docs/advanced/data/#dynamic-attribute-transformation-reducers)).
Its official interactivity tutorial sets custom node/edge/graph state on hover,
greys the inactive subgraph, refreshes without rebuilding the spatial index,
and restores the graph on leave
([highlight contract](https://v4.sigmajs.org/get-started/add-interactivity/#wire-up-the-custom-states)).

yFiles makes the same boundary more explicit: selection, focus, and arbitrary
highlighting are independent decorations managed separately from graph elements
([selection/focus/highlight guide](https://docs.yworks.com/yfiles-html/dguide/view/view_selection.html)).
This distinction maps cleanly to Archify:

- keyboard focus belongs to the legend control;
- transient hover/focus preview is a viewer decoration;
- pressed Lens state is the durable selection;
- authored nodes, edges, coordinates, and labels remain unchanged.

**Borrow:** visual-only, reversible state and clear ownership. **Do not add:** a
second graph model, a re-layout pass, or renderer-specific selection state.

### 4. Cytoscape.js and yFiles show why hard filtering is the wrong default

Cytoscape.js documents materially different behavior for `display`,
`visibility`, and `opacity`. A `display: none` node hides incident edges, becomes
a point for layouts, leaves viewport fitting, and is no longer interactive;
opacity preserves space, fitting, and interaction
([official visibility contract](https://js.cytoscape.org/#style/visibility)).

yFiles' official filtering guide uses `FilteredGraphWrapper` to expose a real
subset: dependent elements disappear, incident edges of hidden nodes disappear,
and graph events are forwarded only for exposed items
([filtering contract](https://docs.yworks.com/yfiles-html/dguide/filtering/)).
That is appropriate for applications asking for a new subgraph. It is not the
right behavior for an authored architecture diagram whose geometry, route
meaning, and complete print/export are part of the product.

**Decision:** legend activation must keep using Semantic Lens's soft emphasis.
Matched nodes and relationships stay strong; peers preserve context; unrelated
content recedes but remains spatially present and recoverable. Do not call this
“Filter” in the UI. Use “Inspect,” “Compare,” or “Lens.”

### 5. Accessibility requires a real toggle contract, not just a cursor

The WAI-ARIA Button Pattern requires a toggle button to expose `aria-pressed`,
retain a stable accessible label, and activate with both <kbd>Space</kbd> and
<kbd>Enter</kbd>
([button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)). A horizontal
group of three or more controls may use the Toolbar Pattern's single tab stop,
roving `tabindex`, Left/Right navigation, and optional Home/End
([toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)).

For Archify's SVG-hosted legend rows, this means:

- group compatible rows as a labelled `toolbar` only when there are at least
  three actionable rows;
- give each actionable row `role="button"`, a stable accessible name including
  its visible exact count, and synchronized `aria-pressed`;
- implement Space/Enter explicitly because an SVG `g` is not a native HTML
  button;
- use roving `tabindex` plus Left/Right/Home/End, reusing the Lens panel's
  navigation grammar; and
- keep focus on the activated legend item unless activation deliberately opens
  the existing Lens dialog, in which case move focus into that dialog and
  return it to the originating row when closed.

WCAG 2.2's target-size criterion specifies a 24 by 24 CSS-pixel target or
sufficient spacing/equivalent control
([Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)).
The hit region should therefore cover swatch, label, and count rather than only
the tiny swatch. At responsive sizes, browser acceptance must measure the real
`getBoundingClientRect()`, not assume SVG user units equal CSS pixels. Where the
inline row cannot meet the size target, the existing large `LENS` trigger and
panel remain the equivalent touch path; the implementation should prefer
expanding the whole row before relying on that exception.

A visible focus state should be an approximately 2 CSS-pixel perimeter or an
equivalent high-contrast change
([Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance)).
Selected state also needs a non-color cue—a check/notch, heavier outline, or
explicit pressed treatment—because WCAG does not allow color to be the sole
means of communicating action or state
([Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)).

### 6. Hover preview is valuable only as a finite, parity-safe preview

G6 and Sigma both demonstrate the comprehension benefit of a transient hover
state. Archify should borrow it, with stricter limits:

- only on `(hover: hover) and (pointer: fine)`;
- only when no stronger owner (Focus, Intent Trace, Route Probe, Story Trail,
  Relationship Preview, or Presentation) is using the graph;
- keyboard focus produces the same static preview, so hover is not the only path;
- preview never changes `aria-pressed`, the URL, the Lens receipt, camera, or
  panel visibility;
- preview never starts Semantic Lens's direction-flow animation; activation may
  keep the existing finite signal;
- leaving/blurring restores the previously pinned Lens exactly; and
- with one pinned kind, previewing a second compatible kind may temporarily show
  the cross-kind relationship slice, but two pinned kinds suppress further
  preview.

If hover/focus reveals additional panel content, WCAG requires that content to
be dismissible, hoverable, and persistent, and it must also appear on keyboard
focus
([Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)).
The simplest compliant design is **not to open the Lens panel on preview**.
Change only the diagram's reversible visual state. Explicit activation may open
the panel and is not a hover disclosure.

Touch has no preview phase: a tap activates the same toggle action as click or
Space/Enter. No two-tap “first hover, second activate” trap.

## Recommended product contract

### Build now: Semantic Legend Bridge

1. Render exact node-kind legend entries as one wrapper with a passive,
   viewer-readable marker such as `data-legend-kind="backend"`. This is compiled
   presentation metadata, not a new JSON schema or IR concept.
2. Start with Architecture, where coverage is dynamic and exact. Extend the same
   marker to Workflow and Lifecycle only for their explicitly matching
   node-kind rows. Do not infer semantics from a CSS class, fill color, visible
   label, or renderer mode.
3. Leave Sequence and Data Flow legends static in this slice. Their entries
   describe edges or mixed domains, so connecting them to a node-kind Lens would
   be semantically false.
4. The shared viewer upgrades marked rows at runtime. It derives counts from the
   same deduplicated `collectKinds()` result as the Lens panel, appends one quiet
   count badge, creates the enlarged hit/focus region, and delegates activation
   to `Archify.semanticLens`.
5. A count is a node count only. Keep relationship totals and authored direction
   in the existing Lens receipt. Do not overload a tiny badge with two metrics.
6. If a renderer carries a marked explanatory kind that has zero nodes, show a
   muted visible `0` if space permits but do not expose a dead toggle or add it
   to the tab sequence. Architecture should never have this case because its
   legend is generated from kinds in use.
7. Click, tap, Space, or Enter pins/unpins the kind and synchronizes every mirror
   (`aria-pressed`, count badge treatment, Lens chip, trigger, hash, status).
   There is one state owner and no event echo loop.
8. Explicit activation may open the existing Lens panel to reveal the complete
   receipt and reset/copy controls. If it does, focus transfer and return must be
   deliberate; hover/focus preview never opens the panel.
9. Fine-pointer hover and keyboard focus may preview as defined above. Treat it
   as a static viewer decoration with finite cleanup, not a new durable mode.
10. Selected state uses shape/outline plus color. Focus and selected state must
    remain distinguishable when both are present.

### Integration boundaries

- **Reading Depth:** both preview and pinned Lens may reveal the exact matched
  local detail through the existing Lens override; neither changes the user's
  `MAP` / `READ` / `FULL` preference or zoom.
- **Existing Lens:** the bridge calls the current index, select, clear, URL,
  receipt, flow, and arbitration paths. Add only a small preview/sync API if the
  current public surface is insufficient.
- **Other durable modes:** mere hover/focus must never clear another mode.
  Explicit activation follows the same `prepareForLens()` arbitration already
  used by Lens chips.
- **Embed:** a shared `#lens=` view may still restore. Inline legend rows remain
  passive in embed mode unless the embed has a complete, visible clear/status
  affordance; the initial slice should keep them passive.
- **Print:** print the complete authored diagram and static legend. Hide runtime
  count badges, hit regions, focus/pressed decoration, preview state, and flow
  overlays.
- **Standalone SVG export:** clone the canonical diagram, remove every runtime
  bridge node/role/tabindex/pressed/preview attribute, and retain original
  legend geometry/text. Passive `data-legend-kind` may be stripped with other
  viewer hooks if canonical equality requires it.
- **Reduced motion:** suppress Lens flow animation and all bridge transitions;
  static focus, selected, count, and soft-highlight states remain fully usable.
- **Dependencies/schema:** zero new runtime dependency, no Graphology, no G6,
  no new author field, no schema/validator change, no geometry mutation, and no
  renderer-specific category state machine.

## Borrow / later / skip

### Borrow now

- G6's clear transient `active` versus durable `selected` grammar.
- G6's exact category-to-element mapping, implemented through Archify's existing
  compiled semantic IDs rather than a plugin.
- Sigma's reversible display-state update without graph-data mutation or spatial
  re-indexing.
- yFiles' separation of focus, selection, and highlight decorations.
- Fireworks' respect for authored legend meaning and viewer-owned accessibility.
- WAI toggle-button semantics, Space/Enter activation, roving keyboard focus,
  visible focus, non-color selection feedback, and measurable target regions.
- Soft emphasis with the full authored map preserved.

### Later, after evidence

- Edge-semantic legend lenses for Sequence and Data Flow, but only after Archify
  has a normalized compiled `data-edge-kind` contract and a reader problem that
  justifies it. Do not retrofit them through text parsing.
- A compact “all kinds” inline legend for modes whose current authored legend is
  incomplete, if gallery/browser evidence shows users prefer it to the existing
  Lens panel.
- Optional second-kind hover comparison while one kind is pinned, after the
  simpler one-kind preview is proven stable and not visually noisy.
- Keeping count badges in print/export as authored information, only if the
  canonical product contract is intentionally changed rather than accidentally
  leaking viewer decorations.

### Deliberately skip

- Hard filtering, `display: none`, subgraph creation, relayout, regrouping, or
  camera auto-fit after legend activation.
- Making every colored legend item interactive by class name or visual
  resemblance.
- A generic facet/query builder, OR/NOT logic, free-text predicates, or more
  than the existing two pinned kinds.
- Separate legend and Lens selections that can drift.
- Count estimates, count animation, relationship totals inside the node badge,
  or counts derived from DOM child fragments.
- Hover-only behavior, coarse-pointer hover emulation, two-tap activation,
  focus-triggered durable selection, or a panel that appears merely on focus.
- New dependencies, schema fields, layout passes, or persistent mutations inside
  exported SVG.

## Acceptance criteria

The slice is ready only when automated tests and the in-app browser prove all of
the following.

1. Architecture emits one `data-legend-kind` wrapper for every distinct kind
   actually present, in its current deterministic order; no CSS-color or label
   parsing is used.
2. Workflow/Lifecycle upgrade only explicitly marked exact node-kind rows.
   Sequence and Data Flow contain no interactive semantic legend controls.
3. Every visible count equals the corresponding value returned by
   `Archify.semanticLens.kinds()` after deduplication by `data-node-id`.
   Architecture's badge sum equals its semantic node count.
4. A zero-count marked explanatory row, if any, is visibly honest but is not
   focusable or activatable. Unknown markers fail closed.
5. There is one state owner: activating an inline entry, a Lens chip, a restored
   `#lens=` hash, Reset, or Escape synchronizes every legend entry, chip,
   trigger, graph attribute, receipt, and URL without duplicate toggles.
6. Click/tap and Space/Enter have identical pin/unpin results. The accessible
   name remains stable and includes kind label plus exact node count;
   `aria-pressed` reflects durable state only.
7. With at least three actionable rows, the inline group exposes one labelled
   toolbar stop and supports Left/Right plus Home/End with roving `tabindex`.
   Focus order follows the visual/DOM order.
8. A keyboard-visible focus perimeter and a distinct non-color selected cue are
   present in Classic, Signal Flow, and Blueprint presets, light and dark.
9. The pointer hit region covers the whole swatch-label-count row. Browser tests
   record real CSS-pixel bounds at desktop and 390px; each active touch target is
   at least 24 by 24 CSS pixels or the test proves the visible equivalent Lens
   control and sufficient spacing path.
10. Fine-pointer entry and keyboard focus produce the same one-kind static
    preview without changing hash, `aria-pressed`, panel visibility, camera, or
    Reading Depth. Leave/blur restores the exact prior pinned state.
11. Preview is suppressed on coarse/touch pointers, with two pinned kinds, and
    while Focus, Intent Trace, Route Probe, Story Trail, Relationship Preview,
    Presentation, or another stronger owner is active. Suppression never blocks
    explicit activation.
12. Preview starts no Semantic Lens flow overlay. Explicit pinning may run the
    existing bounded flow once; dynamic reduced-motion switching removes that
    overlay and leaves a clear static selection.
13. Selecting a kind through the legend preserves coordinates, viewBox, camera
    transform, edge routes, relationship order, and the current
    `MAP` / `READ` / `FULL` depth while revealing matched local detail.
14. One-kind and two-kind Lens receipts remain numerically identical whether the
    first kind was selected from the legend, panel, or restored hash.
15. Explicit legend activation yields cleanly to the existing Lens arbitration;
    mere hover/focus does not clear or mix with any durable reader mode.
16. In `data-embed="true"`, restored Lens state still works but legend rows have
    no runtime role, tabindex, badge, cursor, or hidden interactive target.
17. Print shows the full, undimmed canonical graph and original static legend,
    with no runtime badge, focus/pressed indicator, preview, or Lens signal.
18. SVG export during preview, during a pinned Lens, and during a focus-visible
    state is canonical: original legend geometry/text remain, while runtime
    bridge nodes, `role`, `tabindex`, `aria-pressed`, preview state, Lens state,
    and overlays are absent.
19. Reduced-motion mode has no bridge transition or Lens flow animation but
    preserves exact counts, focus, pressed state, soft highlighting, and reset.
20. No schema/validator/IR changes and no new dependency appear in the package;
    all five renderer outputs and ZIP doctor remain green.
21. In-app browser validation covers at least the web-app Architecture artifact
    and one Workflow or Lifecycle artifact on desktop, plus Architecture at
    390px, exercising hover/focus preview, tap/click/keyboard activation, panel
    synchronization, Reset/Escape, restored hash, and zero console errors.
22. A final browser screenshot leaves a counted semantic legend entry visibly
    selected together with the exact highlighted graph slice, making the feature
    understandable without reading documentation.

## Decision

Build the **Semantic Legend Bridge** next, beginning with Architecture and
extending only to explicitly marked node-kind rows in Workflow/Lifecycle. It is
a small but high-value product improvement: the static legend stops being a dead
key, exact counts become visible at the point of curiosity, and the existing
Semantic Lens becomes discoverable through the diagram itself.

The quality bar is restraint. The bridge must make the diagram answer one more
question without changing what the legend means, hiding the authored map, or
creating a second state system. If an entry cannot prove a one-to-one semantic
kind mapping, it stays beautifully static.
