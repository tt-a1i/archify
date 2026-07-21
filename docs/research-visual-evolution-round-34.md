# Visual Evolution Round 34 — Direct Relationship Pin

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Accept the hypothesis and build **Direct Relationship Pin** as the next bounded
viewer slice.

Archify already exposes authored relationships in every typed renderer and can
explain them precisely after a reader focuses a node. The remaining orientation
gap is the first step: a visible line still behaves like illustration, so the
reader must infer which node to focus, open its Relationship Lens, and then find
the matching row. The current viewer has enough semantic identity and existing
chrome to remove that detour without becoming an editor
([relationship renderer contract](../archify/renderers/shared/cli.mjs),
[current Relationship Lens](../archify/assets/template.html),
[current relationship tests](../archify/test/relationship-lens.test.mjs)).

Round 34 should make the authored line itself a forgiving, accessible entry point:

- a viewer-only invisible hit path follows the existing edge geometry;
- pointer hover and keyboard focus preview the exact relationship transiently;
- click, tap, `Enter`, or `Space` pins one relationship;
- the pinned state reuses the existing Relationship Lens and exact preview row;
- `Escape`, background activation, or activating the same relationship again
  clears the pin;
- one relationship button participates in the page Tab order while arrow keys,
  `Home`, and `End` rove through the remaining authored relationships; and
- export, print, embed, geometry, schema, and compiled SVG meaning remain unchanged.

This recommendation borrows React Flow's separate invisible edge hit path and
keyboard-selectable edge wrapper, Cytoscape.js's single-selection and normalized
touch events, and yFiles' explicit separation of focus, selection, and temporary
highlight. It adapts those editor-oriented primitives into a read-only semantic
inspection state. It does **not** add edge editing, reconnect handles, multi-edge
selection, a context menu, a new floating inspector, or serialized viewport
state.

The primary-source evidence does not point to a higher-value competing
orientation interaction. Archify already has node focus, one-hop intent,
fewest-hop routes, semantic-kind comparison, chapter stories, beat navigation,
an overview map, and exact-moment links. Direct relationship activation is the
remaining basic graph noun that is visible but not directly operable.

## Focused research question

> Should an Archify reader be able to interact with an authored relationship
> directly, and if so how should hit area, focus, touch, transient preview,
> pinned state, deep-link identity, motion, and export cleanliness work without adding
> another editor-like surface?

This note uses first-party documentation, first-party source, and W3C guidance as
of 2026-07-20. Product conclusions and proposed Archify behavior are explicitly
marked as recommendations or inferences rather than vendor claims.

## Current Archify baseline

### Relationships already have compiled semantic identity

All five typed renderers emit `data-edge-from`, `data-edge-to`, an optional
`data-edge-label`, and a `data-edge-key`. The shared helper performs only escaping
and attribute emission; it does not alter the visible geometry
([shared renderer helper](../archify/renderers/shared/cli.mjs)). The current
regression suite verifies that each source relationship receives one unique key
across architecture, workflow, sequence, dataflow, and lifecycle output, even
when more than one SVG element represents the same relationship
([relationship renderer tests](../archify/test/relationship-lens.test.mjs)).

The Round 34 audit artifact contains 11 unique authored relationships and zero
focusable/direct edge targets. Nodes are already focusable buttons, so this is a
measured interaction asymmetry rather than a speculative feature gap
([current workflow gallery artifact](gallery/artifacts/agent-tool-call.workflow.html),
[shared node accessibility helper](../archify/renderers/shared/cli.mjs)).

The duplication matters. An edge can have a primary path plus a separate label
group carrying the same semantic attributes, and sequence relationships can be a
group containing multiple line/path shapes. A direct interaction layer therefore
must de-duplicate by `data-edge-key` and derive geometry from the primary edge
shape; it must not turn every matching label/detail element into a separate focus
stop
([current generated gallery artifact](gallery/artifacts/agent-tool-call.workflow.html),
[current relationship geometry helper](../archify/assets/template.html)).

### The explanation surface already exists

After a reader focuses one node, `relationshipsFor()` groups exact authored
relationships into outgoing, incoming, and self-loop rows. Each row has the key,
source, target, direction, neighbor, and label. Hover or focus previews the exact
edge and both endpoints; row activation follows the neighbor. The list supports
`ArrowUp`, `ArrowDown`, `Home`, and `End`, and its touch layout keeps the active
row visible
([Relationship Lens implementation](../archify/assets/template.html),
[Relationship Lens tests](../archify/test/relationship-lens.test.mjs)).

The gap is consequently not “invent an edge inspector.” It is “let the line open
the inspector state Archify already has.” Reusing the existing panel is important
because the viewer already has toolbar menus, diagram navigation, Guided Story,
the Semantic Lens, Route Probe, focus passport, overview map, and presentation or
embed variants
([shared viewer chrome](../archify/assets/template.html)).

### Preview, motion, and canonical output are already separated

Relationship Preview is a viewer-only state. It writes temporary attributes to
the live SVG, highlights the exact relationship and endpoints, and may add one
finite pulse overlay. Reduced motion and embed suppress the pulse. Canonical SVG
export removes preview attributes and runtime overlays, while CSS changes only
opacity, filter, and stroke emphasis rather than coordinates or transforms
([preview and pulse implementation](../archify/assets/template.html),
[export-clean regression tests](../archify/test/relationship-lens.test.mjs),
[pulse regression tests](../archify/test/relationship-pulse.test.mjs)).

The Motion Governor already recognizes `data-relationship-preview-active` as the
`relationship` owner, after higher-priority story, chapter, and route states. A
new direct pin should reuse that owner rather than introduce another animation
channel
([Motion Governor implementation](../archify/assets/template.html),
[Motion Governor tests](../archify/test/motion-governor.test.mjs)).

### Current URL state has one semantic owner, but relationships lack durable IDs

Focus, route, semantic Lens, and guided chapter state each replace the fragment
with their own semantic mode. Round 33 allows `view` and `beat` together because
the beat is a coordinate inside that chapter, but unrelated modes do not
accumulate in the same URL
([focus, route, Lens, and Guided Story hash readers](../archify/assets/template.html),
[Round 33 decision](research-visual-evolution-round-33.md)).

A relationship pin would need to follow that rule, but the current relationship
key is the source-array position passed to `focusEdgeAttrs()`, not a
schema-required author-controlled ID
([shared renderer helper](../archify/renderers/shared/cli.mjs),
[typed renderer examples](../archify/examples)). Therefore Round 34 should keep
the pin as in-page viewer state and leave the URL unchanged. A relationship link
that can silently retarget after source reordering is worse than no relationship
link.

## Primary-source findings

### 1. React Flow / Xyflow: the visible stroke and interaction target are different objects

React Flow defines `interactionWidth` as the width of an invisible path rendered
around an edge so it is easier to click or tap. The current edge type also exposes
a unique string `id`, `selectable`, `selected`, `focusable`, `ariaLabel`,
`ariaRole`, and a DOM-attribute escape hatch
([official Edge API](https://reactflow.dev/api-reference/types/edge)).

The first-party `BaseEdge` source makes the separation concrete: it renders the
authored visible path, then a second path with zero stroke opacity and a default
`interactionWidth` of 20. The helper path is interaction geometry, not a visual
stroke-width change
([official `BaseEdge` source at a fixed commit](https://github.com/xyflow/xyflow/blob/dd308ab401d49518f73d1e91c43faf254ff5a4c9/packages/react/src/components/Edges/BaseEdge.tsx#L34-L58)).

React Flow makes edges focusable by default. Its accessibility guide documents
`Tab` navigation between nodes and edges, `Enter`/`Space` selection, `Escape`
clearing selection, and deletion keys for selected elements. The top-level API
also exposes `edgesFocusable` and `elementsSelectable` independently
([official accessibility guide](https://reactflow.dev/learn/advanced-use/accessibility),
[official ReactFlow API](https://reactflow.dev/api-reference/react-flow)).

The current `EdgeWrapper` implementation derives focusability and selectability
separately, gives a focusable edge `tabIndex=0`, supplies a default accessible
name “Edge from source to target,” and maps click plus selection keys to selected
state. `Escape` unselects and blurs the edge
([official `EdgeWrapper` source at a fixed commit](https://github.com/xyflow/xyflow/blob/dd308ab401d49518f73d1e91c43faf254ff5a4c9/packages/react/src/components/EdgeWrapper/index.tsx#L124-L214)).

The official touch example explicitly treats touch as a first-class input and
recommends increasing small targets when necessary
([official Touch Device example](https://reactflow.dev/examples/interaction/touch-device)).

**Borrow:** clone interaction geometry instead of thickening the authored line;
give each de-duplicated relationship one semantic focus target; support click,
tap, `Enter`, `Space`, and `Escape`; derive the accessible name from real source,
target, and label metadata.

**Adapt:** Archify is a viewer, so activation means “inspect/pin this authored
relationship,” not select for deletion, reconnection, or editing. Keep the
visible edge style and the compiled graph immutable.

**Skip:** deletion keys, reconnect handles, drag editing, multi-selection,
editable labels, edge z-index mutation, React state, and the default generic
“group” semantics. A pin behaves as a two-state command, so a toggle-button
contract is clearer for Archify.

### 2. Cytoscape.js: touch selection is normal, but canvas rendering needs an application accessibility layer

Cytoscape.js documents tap-to-select on touch and desktop, background gestures to
unselect, modifier-assisted multi-selection on desktop, and common event names
that normalize mouse and touch input. Its gesture contract applies tap directly
to graph elements rather than requiring a separate toolbar action
([official gesture documentation](https://js.cytoscape.org/#notation/gestures),
[official user-input event documentation](https://js.cytoscape.org/#events/user-input-device-events)).

Its default `selectionType` is `single`: selecting a new element replaces the
previous selection. The API distinguishes durable `selected()` / `select()` /
`unselect()` state from gesture events such as `tapselect` and `tapunselect`
([official selection documentation](https://js.cytoscape.org/#collection/selection),
[official initialization options](https://js.cytoscape.org/#core/initialisation)).

The first-party renderer uses different rendered-pixel hit tolerances for desktop
and touch, adding the tolerance to half the visible edge width. At fixed commit
`22716bf`, the relevant constants are 8 rendered pixels for desktop and 24 for
touch
([official hit-test source](https://github.com/cytoscape/cytoscape.js/blob/22716bfb75834b56fa6679648b0abb06f4ae691c/src/extensions/renderer/base/coord-ele-math/coords.mjs#L75-L87),
[official edge-width hit calculation](https://github.com/cytoscape/cytoscape.js/blob/22716bfb75834b56fa6679648b0abb06f4ae691c/src/extensions/renderer/base/coord-ele-math/coords.mjs#L157-L164)).

`touchTapThreshold` is a movement threshold for recognizing a tap; it is not an
edge target-width setting. Likewise, documented overlay padding is visual
overlay extent, not a public hit-area API
([official initialization options](https://js.cytoscape.org/#core/initialisation),
[official style documentation](https://js.cytoscape.org/#style/overlay)).

Cytoscape.js renders graph items into shared canvas layers rather than one DOM
element per edge. Its public documentation provides no per-edge Tab/Enter/ARIA
surface comparable to React Flow. The conclusion that an application must supply
a parallel DOM accessibility surface is an inference from the first-party canvas
renderer and documented APIs, not an official accessibility claim
([official canvas renderer source](https://github.com/cytoscape/cytoscape.js/blob/22716bfb75834b56fa6679648b0abb06f4ae691c/src/extensions/renderer/canvas/index.mjs#L46-L105)).

**Borrow:** touch and pointer should invoke the same semantic command; pin one
relationship at a time; background activation clears the pin; keep transient
input events separate from durable selection.

**Adapt:** Archify already has SVG and can create genuine focusable DOM targets,
so it should not inherit the keyboard and screen-reader limitations of a canvas
renderer.

**Skip:** additive selection, box selection, three-finger gestures, draggable
graph items, and viewport-owned canvas state.

### 3. yFiles: focus, selection, and highlight are different states

yFiles explicitly models three independent decorations: selection, focus, and
highlight. Selection can contain one or more items and drives commands; focus
marks one current item; highlight is programmatic and is not bound to an
interaction by default. Edge selection receives its own line decoration rather
than modifying the graph model
([official Selection, Focus, and Highlight guide](https://docs.yworks.com/yfiles-html/dguide/view_selection/)).

Its viewer/editor input modes treat click, tap, and stylus activation uniformly.
When an item is activated it is focused and selected in that order, while item
types can be independently configured as clickable, selectable, or focusable.
The guide also documents keyboard navigation and selection as separate actions
([official interaction guide](https://docs.yworks.com/yfiles-html/dguide/interaction-support/)).

yFiles' custom-style guidance says fuzzy hit testing is especially important for
edge paths or points, because a single pixel is difficult to hit. Its hit-test
radius is expressed in view coordinates so behavior does not change with zoom
([official custom hit-test guidance](https://docs.yworks.com/yfiles-html/dguide/customizing_styles/custom-styles_advanced-functionality.html),
[official `IHitTestable` API](https://docs.yworks.com/yfiles-html/api/IHitTestable.html)).

**Borrow:** keep three concepts distinct in the state machine: DOM focus,
transient preview/highlight, and pinned semantic selection. Keep interaction
width stable in screen space rather than allowing zoom to make edges impossible
to target.

**Adapt:** Archify needs one pinned relationship, not yFiles' editor command
selection. The existing Relationship Lens can present the pinned state while
the invisible hit geometry remains independent of the authored edge.

**Skip:** editor focus managers, clipboard semantics, lasso/marquee selection,
cyclic hit menus, label editing, and commercial framework dependencies.

### 4. W3C: a thin SVG line still needs a usable target and correct toggle semantics

WCAG 2.2 Target Size (Minimum) treats a target smaller than 24 by 24 CSS pixels
as undersized unless an exception applies. The guidance explicitly discusses
complex clickable SVG shapes through their bounding boxes and notes that the
criterion helps touch, mouse, and pen users by reducing accidental activation
([W3C understanding document for SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).

The relationship list already supplies an equivalent target for each edge once
a node is focused, but direct manipulation should still aim for a 24 CSS-pixel
interaction corridor rather than rely on the equivalent-target exception. A
non-scaling invisible stroke is the closest SVG analogue to yFiles' view-space
radius. This is an Archify implementation recommendation based on the W3C and
yFiles guidance, not a W3C prescription for a specific SVG technique.

The ARIA Authoring Practices button pattern says `Space` and `Enter` activate a
focused button. For a two-state button it prescribes `aria-pressed`, and it warns
that the button label should not change when the pressed state changes
([W3C APG Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)).

**Borrow:** expose the focusable relationship target as a toggle button with one
stable accessible name, `aria-pressed=false/true`, visible focus indication,
`Space`/`Enter` activation, and an `Escape` clear path.

The APG Toolbar Pattern documents roving focus as a way to keep a group of three
or more controls to one Tab stop: arrows move among controls and optional `Home`
and `End` move to the first and last control
([W3C APG Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)).
Archify should borrow the focus-management technique, not claim that diagram
edges visually constitute a toolbar: wrap them in a labelled relationship group,
keep exactly one relationship button at `tabindex=0`, put the others at `-1`,
and document the arrow-key instruction with `aria-describedby`.

**Skip:** a hover-only tooltip as the sole explanation. Hover does not provide a
persistent touch state, a keyboard command, or toggle semantics.

### 5. Graphviz: downstream edge identity must be author-controlled and unique

Graphviz lets authors provide an `id` for graphs, clusters, nodes, and edges so
the identifier is included in SVG or map output. Its documentation warns that an
internally generated ID is unpredictable to the graph author and that the author
is responsible for uniqueness; the `\E` edge substitution is not unique for
multi-edges
([official Graphviz `id` attribute](https://graphviz.org/docs/attrs/id/)).

React Flow likewise requires a unique edge ID, and Cytoscape.js describes its
element `data.id` as the unique element identifier
([official React Flow Edge API](https://reactflow.dev/api-reference/types/edge),
[official Cytoscape.js data API](https://js.cytoscape.org/#collection/data)).

**Borrow later:** if Archify adds relationship links, use an author-controlled
unique ID. Never derive durable identity from DOM order, path geometry, label
position, or endpoints alone; parallel relationships make `from→to` insufficient.

**Decision for Round 34:** do **not** deep-link the pin. `data-edge-key` is unique
inside one compiled artifact and correctly de-duplicates runtime fragments, but
the current renderers pass the source relationship's numeric array position as
that key. Source reordering can therefore make the same key name a different
relationship. Source/target/label guard parameters would reduce accidental
retargeting but would still expose a verbose, implementation-shaped URL and
would fail on benign label edits.

**Skip now:** a `#relation=<numeric-key>` grammar, a guarded multi-parameter
workaround, a renderer-generated DOM `id`, path index, `d` geometry, or endpoint
pair. Revisit links only with an optional authored relationship ID and a versioned
schema decision backed by usage evidence.

## Hypothesis evaluation

| Question | Evidence | Decision |
|---|---|---|
| Are edges expected to be directly operable in mature graph viewers? | React Flow and yFiles make edges clickable/selectable; Cytoscape normalizes taps on graph elements. | Yes. Direct relationship activation is a normal graph interaction, not editor-only novelty. |
| Should the visible line become thick? | React Flow separates the visual edge from a 20-pixel invisible helper; yFiles uses a view-space hit radius. | No. Add viewer-only hit geometry and preserve the authored stroke. |
| Is hover enough? | yFiles separates highlight from selection; Cytoscape separates pointer events from selected state; touch has no durable hover. | No. Preview transiently, then offer a pinned state. |
| Should pin create new UI? | Archify already has an exact Relationship Lens row and is chrome-dense. | No. Reuse and contextualize the existing Lens. |
| Should keyboard users still go through a node first? | React Flow exposes edge focus/activation; APG documents roving focus to reduce Tab stops. | No. Make every de-duplicated relationship operable, but keep only one at a time in the page Tab order. |
| Is current identity sufficient for a deep link? | Graphviz requires author-controlled unique IDs; Archify's key is a source-order number. | No. Keep the pin local in Round 34 and do not emit a relation URL. |
| Is another orientation feature more valuable first? | Node, neighborhood, route, kind, chapter, beat, overview, and exact story-moment orientation already exist; direct authored edges are the remaining non-operable visible semantic primitive. | No competing gap has stronger evidence in the current viewer. |

### Verdict on the audited implementation contract

The local audit proposed runtime-only 20-pixel rails, one roving keyboard target,
transient exact-edge pulse, click/tap/Enter pinning into the existing source
Semantic Passport and relationship row, no deep link, and no embed/print/export
residue. The research verdict is:

- **Accept** runtime-only invisible rails, exact existing preview/pulse,
  source-passport/Lens reuse, one pinned relationship, one roving Tab stop, no new
  panel, no deep link, and strict output cleanup.
- **Revise** 20 pixels to **at least 24 rendered CSS pixels**. React Flow's 20 is
  a library default, not an accessibility target; WCAG's minimum and
  Cytoscape.js's touch tolerance both support 24 as the safer floor.
- **Enable direct touch pinning on the widened rail.** Preserve node → Lens as an
  alternate exact route, not as the only touch path; otherwise the main
  hypothesis remains unsolved for touch readers.
- **Accept** finite pulse on pointer/focus entry only under the Motion Governor;
  suppress repetition, reduced-motion, Still, embed, print, and hidden-document
  motion.
- **Accept** no relationship hash in this round because the current key is a
  source-order number. Do not disguise it as durable identity.

## Recommended product slice

### Name and reader promise

Feature name: **Direct Relationship Pin**.

Reader promise:

> Point at, tab to, or tap any authored relationship to understand exactly what
> connects which nodes. Activate it once to keep that explanation pinned.

The wording should use “relationship,” not “edge,” in reader-facing labels.
“Edge” is an implementation term; “relationship” is the meaning already used by
the current Lens.

### Interaction geometry

At runtime, group canonical SVG elements by `data-edge-key`. For each unique key:

1. resolve one consistent `{key, from, to, label}` record;
2. locate the primary path/line/polyline geometry, including shapes nested in a
   sequence edge group;
3. clone geometry only into a viewer-owned interaction overlay inserted above
   authored edges but below nodes;
4. strip marker, class, animation, style, filter, semantic edge attributes, and
   authored IDs from the clone;
5. render a transparent 24 CSS-pixel non-scaling stroke with
   `pointer-events: stroke`; and
6. make one wrapper per relationship semantically named, with roving
   `tabindex=0/-1` so the relationship group contributes one page Tab stop.

The overlay should be inert in canonical SVG, print, and embed. The primary line
remains the visible truth. Nodes stay above the hit overlay so a target corridor
does not steal node activation near endpoints.

The 24-pixel corridor is a minimum. Browser measurement must verify that zoom,
mobile layout, semantic camera transforms, and Blueprint/Signal Flow presets do
not shrink the rendered hit target. If SVG hit-testing proves inconsistent for a
transparent non-scaling stroke in a supported browser, the implementation should
use the same cloned geometry with a transparent painted stroke rather than
falling back to a visibly thicker line.

### State model

| State | Trigger | Visual/semantic result | Persists after exit? | URL |
|---|---|---|---|---|
| Idle | Load or clear | Canonical diagram | — | Unchanged |
| Transient pointer preview | Fine-pointer enter | Exact edge + endpoints emphasized; existing finite pulse may run once | No, clears on pointer leave | Unchanged |
| Transient focus preview | `Tab`, arrows, `Home`, or `End` | Same exact emphasis plus visible focus cue; finite pulse may run once per newly focused relation | No, unless activated | Unchanged |
| Pinned relationship | Click, tap, `Enter`, or `Space` | Exact edge + endpoints remain emphasized; existing Lens opens on the source passport with exact row active; finite pulse may run once | Yes, until explicit clear or another relation | Unchanged |
| Replaced pin | Activate a different relationship | Single selection moves atomically to new relation | Yes | Unchanged |
| Cleared pin | Same relation again, `Escape`, or true background activation | Preview and contextual Lens state clear; DOM focus is not stolen | No | Unchanged |

Pointer hover must ignore touch input. Focus and pointer preview can converge on
one `activePreviewKey`, but a `pinnedKey` has precedence and must not disappear on
`pointerout` or `focusout`. A transient preview must not rewrite history or create
an aria-live announcement on every pointer move. Its pulse, if motion is allowed,
is the existing finite one-shot only; repeated `pointermove` events may not
restart it.

### Accessible semantics

Each relationship wrapper should have:

- roving `tabindex="0"` for the current relationship and `"-1"` for all others;
- `role="button"`;
- `aria-pressed="false"` or `"true"`;
- a stable name such as `Inspect relationship: Agent Planner to Tool Router,
  connects to` or the authored label in place of the fallback;
- a visible focus cue applied to the real edge and endpoints, not only the
  transparent path; and
- `Enter` and `Space` activation with default scrolling prevented for `Space`.

The labelled relationship group contributes one Tab stop. `ArrowLeft`/`ArrowUp`
move to the previous authored relationship, `ArrowRight`/`ArrowDown` move to the
next, and `Home`/`End` move to the first/last. Focus may wrap for arrow keys but
not for `Home`/`End`. The last focused relationship remains the group's Tab entry
until the viewer state is rebuilt.

The accessible label must remain unchanged when pinned; state is conveyed through
`aria-pressed`. `Escape` clears without navigating. Relationship activation must
not move DOM focus into the Lens automatically, because pointer/touch activation
should not produce surprise focus changes. The Lens summary may make one polite
announcement when a pin changes.

Keyboard order should follow unique authored relationship order. Duplicate label
elements sharing a key must not create duplicate controls. Unlike giving every
edge `tabindex=0`, roving focus adds exactly one stop before the current node
stops; browser validation should reject the implementation if hidden runtime
elements, detail labels, or overlay fragments enter the page Tab sequence.

### Reuse of existing Relationship Lens

Pinning should call the existing focus/Lens machinery with `updateUrl: false` and
`toggle: false`, seed it with the relationship source, then activate the exact
row by `data-relationship-key`. The panel keeps the source Semantic Passport and
connected list; the pinned row is visibly persistent. No new inspector, popover,
tooltip, toolbar button, or bottom sheet is added.

While a relation is pinned:

- the existing Copy action is explicitly labelled **Copy node** and retains its
  ordinary source-node focus-link semantics;
- the current row remains the neighbor-follow action;
- choosing the neighbor transitions to ordinary node focus;
- clearing the focus panel clears the pin; and
- desktop and mobile placement reuse the current collision-aware Lens behavior.

This contextual reuse is the central chrome constraint. A direct line that opens
another floating card would solve the two-step problem by creating a layering
problem.

### Deep-link decision

Round 34 emits no relationship URL, does not write history, and does not restore a
pin from the hash. The current `data-edge-key` remains correct runtime identity
for de-duplicating the compiled SVG, but it is not durable public identity because
it is a source-order number. Existing focus, route, Lens, chapter, and story-moment
URLs continue to work unchanged.

The source Semantic Passport still exposes its existing node link. To avoid
implying that this copies the pinned relation, the contextual button text should
say **Copy node** while a relation is pinned. A future relationship-link slice
requires an author-controlled unique relationship ID; it should not be smuggled
into this viewer-only interaction change.

### Motion and mode ownership

Direct pointer/focus preview and pin activation may invoke the existing finite
Relationship Pulse once per newly active relationship, but only when:

- the Motion Governor is live;
- reduced motion is not requested;
- the document is visible;
- the artifact is not embedded or printing.

The pulse never loops and must not restart on `pointermove`, repeated focus events
for the same key, or Lens placement. Still/reduced-motion readers receive the same
static edge and endpoint emphasis.

Pinning is a top-level semantic mode. Before applying it, use the same interaction
gateway rules as Semantic Lens and Route Probe to settle guided playback/handoff,
clear route picking/route output, clear Semantic Lens/legend preview, clear
Intent Trace, and replace ordinary focus. Transient hover/focus should be blocked
while a story handoff, route picker, chapter preview, or other explicit canvas
owner is active; it should not silently preempt those modes merely because the
pointer crosses a line.

One `data-relationship-preview-active` value continues to tell the Motion
Governor which semantic mode owns visible emphasis. A second viewer-only pinned
attribute may distinguish persistence, but it must not introduce a new motion
owner.

### Export, embed, print, and dependency boundary

Direct Relationship Pin remains viewer-only:

- remove the interaction overlay, pinned attributes, focus/preview attributes,
  and pulse clones from canonical SVG export;
- hide the overlay and Relationship Lens in print and embed;
- do not add the targets to standalone canonical SVG output;
- do not alter any authored `d`, points, line endpoints, transforms, markers,
  labels, node positions, or viewBox;
- do not serialize pin state into PNG, SVG, WebM, GIF, or source JSON;
- do not add a schema field, migration, server, storage, dependency, or editor
  API; and
- expose at most a small read-only `Archify.relationship` receipt/API for testing
  and embedding parity.

## Explicit borrow / adapt / skip decision

### Borrow now

- Invisible interaction geometry separate from the authored stroke.
- At least a 24 CSS-pixel target corridor that stays stable through zoom.
- One semantic button per unique compiled relationship with one roving page Tab
  stop and arrow/Home/End navigation.
- Pointer, touch, and keyboard parity.
- Transient preview distinct from pinned selection.
- Single relationship selection with background/Escape clear.
- Stable accessible label plus `aria-pressed` state.
- Existing Relationship Lens, finite pulse, Motion Governor, and export-cleaning
  machinery.

### Adapt carefully

- React Flow selection becomes semantic inspection, never mutation.
- Cytoscape single-selection becomes one pinned relationship, never an additive
  canvas selection set.
- yFiles focus/highlight/selection separation becomes DOM focus, transient
  preview, and pinned semantic state.
- 24-pixel SVG hit geometry is verified in rendered CSS pixels rather than
  assumed from source units.
- `data-edge-key` remains local runtime identity only because current keys are
  compiler-generated positions, not user-authored permanent IDs.

### Skip

- Edge deletion, reconnection, dragging, bend editing, label editing, or handles.
- Multi-edge selection, lasso, marquee, cyclic hit menus, or modifier grammar.
- A new edge inspector, tooltip-only explanation, modal, context menu, or toolbar
  toggle.
- Visible stroke inflation, geometry changes, camera serialization, or viewport
  restoration.
- Repeated hover/focus pulse, autoplay, infinite motion, or URL changes.
- Making edge detail/label fragments separate focus stops.
- Any relationship deep-link grammar based on the numeric key.
- A new schema relationship ID before stable cross-version links are proven as a
  real user need.
- Server-side share records, localStorage pin persistence, analytics, or a new
  runtime dependency.

## Bounded acceptance contract

Round 34 is accepted only if all of the following are true.

### Semantic correctness

1. Architecture, workflow, sequence, dataflow, and lifecycle each produce one
   direct interaction target per unique `data-edge-key`.
2. Every target resolves the exact compiled `{key, from, to, label}` relationship
   and exact endpoint nodes; duplicate geometry/detail fragments do not create
   duplicate targets.
3. Self-loops, unlabeled relationships, parallel relationships, reversed
   relationships, dashed paths, orthogonal paths, and grouped sequence geometry
   all resolve without approximation.
4. Inconsistent duplicate metadata fails closed and does not create an operable
   target.

### Pointer and touch

5. Fine-pointer hover previews one relationship and clears on exit unless pinned.
6. Touch never depends on hover; one tap pins and a second tap on the same
   relationship clears.
7. The target corridor measures at least 24 CSS pixels through supported camera
   zoom ranges and mobile layout, while the visible authored stroke width is
   byte-for-byte unchanged.
8. Node activation wins near endpoints, panning does not trigger a pin, and a
   relation pin does not fall through to the background-clear handler.
9. Crossings resolve deterministically to the topmost authored relationship;
   the Lens list remains an exact alternate target when two corridors overlap.

### Keyboard and assistive technology

10. Each unique relationship exists as one semantic button with a meaningful
    source/target/label name and `aria-pressed`, while the relationship group
    contributes exactly one page Tab stop.
11. Focus alone previews without pinning or changing the URL; `Enter` and `Space`
    pin; arrows plus `Home`/`End` move roving focus; `Escape` clears; `Space` does
    not scroll the page.
12. Focus-visible styling exposes the same exact edge and endpoints in both
    Signal Flow and Blueprint, dark and light themes, without relying on color
    alone.
13. Pin activation does not steal DOM focus. A polite status announces one
    user-initiated pin change, not pointer movement.

### Persistence and URL

14. Pinned state survives pointer/focus exit and is replaced atomically by the
    next pin; transient state never survives exit.
15. Preview and pin leave the current URL byte-for-byte unchanged; reload starts
    neutral and no `relation` parameter is parsed or written.
16. While pinned, the existing link action is unambiguously labelled Copy node
    and continues to copy only the source-node focus link.
17. A relationship button never exposes the numeric key as a public URL or DOM ID
    promise; duplicate-key conflicts fail closed.
18. Node focus, route, semantic Lens, chapter, and story-moment activation clear
    the local relation pin through the normal single-owner gateway.

### Motion, chrome, and output integrity

19. A newly hovered, focused, or pinned relation may pulse once; repeated move or
    focus events do not restart it, and reduced motion, Still mode, hidden
    documents, embed, and print never pulse.
20. Guided Story, Handoff, Route Probe, Semantic Lens, Intent Trace, focus, and
    Relationship Pin have deterministic single-owner transitions with no stale
    overlay after rapid changes.
21. The existing Relationship Lens is reused; no new floating panel, toolbar
    button, modal, context menu, dependency, storage, service, or schema field is
    introduced.
22. Desktop and mobile Lens placement remains within the visible diagram area and
    does not increase global chrome height or horizontal overflow.
23. Canonical SVG export, PNG, print, and embed contain no hit overlay, pinned
    attributes, focus metadata, preview state, or pulse clone; authored geometry,
    labels, markers, and semantic relationship attributes remain unchanged.
24. The complete existing suite, new direct-relation regression tests, gallery
    build, Proof Lab, README showcase, ZIP doctor/demo/check, and in-app browser
    checks all pass.

## Required browser validation matrix

The implementation should not be considered proven by regex tests alone. In the
in-app browser, validate at least:

| Surface | Required check |
|---|---|
| Signal Flow dark | Hover an unlabeled edge, focus it, pin it, and inspect the exact endpoints and existing Lens row; verify URL is unchanged. |
| Blueprint light | Verify visible focus cue and pinned distinction without animation or color-only dependence. |
| Sequence | Activate a grouped message relationship and confirm only one tab stop and exact geometry. |
| Lifecycle | Activate a self-loop or reverse/branch relationship if available. |
| Mobile narrow viewport | Tap several relationships near nodes; verify 24-pixel corridor, no accidental pan, current Lens docking, and zero horizontal overflow. |
| Keyboard only | Tab into the relationship group once; traverse every edge with arrows/Home/End, activate with `Enter` and `Space`, clear with `Escape`, then Tab to node controls. |
| Reduced motion / Still | Confirm preview and pin remain legible and static; no pulse clone exists. |
| Presentation | Pin a relationship without clipping the existing Lens or changing viewport chrome height. |
| Embed / print | Confirm no relationship targets or Lens chrome are exposed and the canonical visual remains unchanged. |
| Export while pinned | Download SVG and inspect it for absence of hit/pin/preview/pulse runtime state. |
| Reload / existing links | Reload after a pin and open valid focus/route/view/beat links; no relation state is restored and existing modes remain unchanged. |
| Rapid ownership changes | Pin relation → open route → chapter → focus node; latest state wins and no stale attributes remain. |

## Risks and mitigations

### Dense crossings create overlapping invisible corridors

Large targets improve acquisition but increase overlap at crossings. Keep node
targets visually and interactively above the edge overlay, preserve deterministic
authored order at edge crossings, and retain the existing Lens row as an exact
alternate. Do not add a cyclic-selection menu in this slice.

### Edge focus can lengthen the Tab sequence

Roving tabindex keeps the group to one page stop while preserving direct access
to every relationship. De-duplication is still non-negotiable. Browser validation
must count one group entry, exercise all arrow/Home/End moves, and ensure runtime
geometry fragments remain unfocusable.

### Current keys are stable only within the compiled relationship order

Use the numeric key only for runtime grouping and fail closed on conflicting
metadata. Round 34 emits no relationship link. If usage proves persistent
cross-version relationship links are core, introduce an optional authored ID in
a separately versioned schema decision.

### Reusing node focus can accidentally create a misleading link action

Seed the Lens with `updateUrl: false` and set the local relation state only after
the exact row resolves. Label the existing link action Copy node while pinned so
it cannot be mistaken for a relationship share action.

### Transient hover can fight stories and analytical modes

Block transient direct preview while another explicit canvas mode owns the
diagram. User activation may perform the normal deterministic gateway transition;
mere pointer movement may not preempt state or motion.

## Source and link-check ledger

Every external source below is first-party. Each URL was fetched with redirects
enabled on 2026-07-20 and returned HTTP 200.

| Source | Role in decision | Check |
|---|---|---|
| [React Flow Edge API](https://reactflow.dev/api-reference/types/edge) | Unique identity, selection/focus fields, invisible interaction width | 200 |
| [React Flow accessibility guide](https://reactflow.dev/learn/advanced-use/accessibility) | Tab, Enter/Space, Escape keyboard contract | 200 |
| [ReactFlow API](https://reactflow.dev/api-reference/react-flow) | Global edge focus/select controls | 200 |
| [React Flow `BaseEdge` source](https://github.com/xyflow/xyflow/blob/dd308ab401d49518f73d1e91c43faf254ff5a4c9/packages/react/src/components/Edges/BaseEdge.tsx#L34-L58) | Separate visible and 20-pixel helper paths | 200 |
| [React Flow `EdgeWrapper` source](https://github.com/xyflow/xyflow/blob/dd308ab401d49518f73d1e91c43faf254ff5a4c9/packages/react/src/components/EdgeWrapper/index.tsx#L124-L214) | Focus, click, keyboard selection, accessible name | 200 |
| [React Flow touch example](https://reactflow.dev/examples/interaction/touch-device) | First-class touch and larger-target recommendation | 200 |
| [Cytoscape.js documentation](https://js.cytoscape.org/) | Gestures, events, selection, element identity, style semantics | 200 |
| [Cytoscape.js edge hit source](https://github.com/cytoscape/cytoscape.js/blob/22716bfb75834b56fa6679648b0abb06f4ae691c/src/extensions/renderer/base/coord-ele-math/coords.mjs#L75-L87) | Desktop/touch rendered-pixel tolerances | 200 |
| [Cytoscape.js width calculation](https://github.com/cytoscape/cytoscape.js/blob/22716bfb75834b56fa6679648b0abb06f4ae691c/src/extensions/renderer/base/coord-ele-math/coords.mjs#L157-L164) | Tolerance plus visible edge half-width | 200 |
| [Cytoscape.js canvas renderer](https://github.com/cytoscape/cytoscape.js/blob/22716bfb75834b56fa6679648b0abb06f4ae691c/src/extensions/renderer/canvas/index.mjs#L46-L105) | Shared-canvas accessibility boundary | 200 |
| [yFiles selection/focus/highlight guide](https://docs.yworks.com/yfiles-html/dguide/view_selection/) | Independent focus, selection, highlight state | 200 |
| [yFiles interaction guide](https://docs.yworks.com/yfiles-html/dguide/interaction-support/) | Mouse/touch/stylus parity and item selection | 200 |
| [yFiles custom hit-test guide](https://docs.yworks.com/yfiles-html/dguide/customizing_styles/custom-styles_advanced-functionality.html) | View-space fuzzy hit radius for edges | 200 |
| [yFiles `IHitTestable`](https://docs.yworks.com/yfiles-html/api/IHitTestable.html) | Hit-radius API contract | 200 |
| [WCAG 2.2 Target Size understanding](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 24 CSS-pixel target guidance | 200 |
| [WAI-ARIA APG Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) | Toggle semantics and keyboard activation | 200 |
| [WAI-ARIA APG Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | Roving focus, one Tab stop, arrows, Home, and End | 200 |
| [Graphviz `id` attribute](https://graphviz.org/docs/attrs/id/) | Author-controlled unique edge identity and multi-edge warning | 200 |

## Final recommendation

Proceed with **Direct Relationship Pin** exactly as the bounded contract above.

The feature is small in UI surface but high in perceived quality: it makes the
diagram answer the question a reader naturally asks when pointing at a line,
works with mouse, touch, and keyboard, and composes with Archify's existing
semantic Lens instead of adding more chrome. It also strengthens the
product's defining boundary: compiled semantic meaning becomes easier to inspect,
while authored geometry and canonical output remain deterministic and clean.
