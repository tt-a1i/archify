# Visual Evolution Round 35 — Stable Relationship Links and Route Journey Research

Research date: 2026-07-20 (Asia/Shanghai) Status: stable relationship links selected; Route Journey retained as the next research candidate

## Executive verdict

Archify should **not** add another minimap, another semantic-zoom layer, or another standalone search panel in Round 35. Those capabilities already exist in the shared viewer:

- Semantic Radar is a runtime-built overview with a live viewport rectangle;
- MAP / READ / FULL already provide deterministic semantic zoom;
- Semantic Camera already frames selected semantic nodes;
- Node Finder already searches stable node IDs and reader-facing metadata;
- Route Probe already computes one deterministic shortest authored directed path and preserves it as a static result;
- Story Beats already step through an authored chapter;
- Direct Relationship Pin already makes every exact authored relationship directly operable.

The next useful gap is narrower:

> After Route Probe answers “what is the shortest directed route?”, let the reader inspect that answer one hop at a time without losing the complete path.

The recommended slice is **Route Journey**. It reuses the existing Route Probe panel, ordered `activeNodeIds`, exact ordered `activeEdges`, Semantic Camera, one-shot route signal, Motion Governor, route hash, and export cleanup. It adds no new panel, graph model, schema field, dependency, storage, service, layout algorithm, or editor behavior. The complete path remains statically visible at all times. One optional, explicitly started journey may move a current-step emphasis from source to destination. The reader can pause, resume, go to the previous or next position, or activate any route-position chip directly. Still mode and reduced-motion readers retain the same discrete controls but no automatic progression or camera animation. An optional author-controlled relationship ID plus direct relation permalink is a sound **later** foundation, but it is not the best next comprehension slice. It improves sharing and durable identity, not immediate understanding of a multi-hop result.

### Implementation decision after the research review

The shipped Round 35 slice deliberately takes the report's smaller identity candidate first: optional author-controlled relationship IDs plus `#relation=<id>`. Round 34 had already exposed direct relationship operation but intentionally stopped at private source-order keys, so this closes a concrete trust and sharing gap before adding another playback state machine. The change proved bounded in implementation: one optional field across the five existing relationship collections, shared uniqueness validation, renderer propagation, viewer restoration/copy behavior, examples, and focused compatibility tests. It adds no panel, dependency, storage, layout behavior, server, or editor surface. Route Journey remains the strongest next comprehension experiment, but is no longer described as already implemented by this report.

## Research question

What should Archify borrow from current graph viewers and technical-diagram projects to help a reader understand a complex graph faster while preserving:

- one stable authored topology;
- static readability before, during, and after interaction;
- clean SVG, raster, print, and embed surfaces;
- five typed renderers;
- mobile and keyboard access;
- reduced-motion truth;
- zero viewer dependencies;
- the generator-plus-viewer boundary rather than an editor platform?

## Method and evidence boundary

This recommendation uses:

1. a direct audit of the current Archify worktree after Round 34;
2. the current public `fireworks-tech-graph` repository and source at commit `50c819d68fd4fee330b3010988cd13e98b678d44`;
3. official React Flow / XYFlow documentation;
4. official Cytoscape.js documentation;
5. official yFiles documentation;
6. official Graphviz documentation;
7. W3C specifications and WAI guidance.

No secondary article is used as evidence for a product or API claim. External URLs listed in the source register were requested on 2026-07-20. All returned HTTP 200 at the time of research.

## Current Archify audit: do not solve an already-solved problem

### Semantic Radar already covers overview and minimap navigation

The shared template contains a viewer-only Semantic Radar at [`archify/assets/template.html`](../archify/assets/template.html). It derives simplified rectangles from stable semantic node bounds rather than cloning the canonical SVG. It tracks the logical viewport through desktop pan/zoom and mobile contained horizontal scroll. It can focus a stable node, recenter the main diagram, and expose keyboard panning. The cross-renderer contract is covered by [`archify/test/semantic-radar.test.mjs`](../archify/test/semantic-radar.test.mjs). React Flow describes its MiniMap as an SVG overview of every node plus the current viewport, with optional click, pan, zoom, semantic color, and an accessible name ([official MiniMap reference](https://reactflow.dev/api-reference/components/minimap)). That external pattern is already substantially adapted in Archify. Adding a second overview would duplicate orientation state and increase panel competition without creating a new reader answer.

### Semantic zoom already covers level of detail

The shared viewer has deterministic MAP, READ, and FULL thresholds. Renderers identify context and fine detail explicitly. Semantic intent can reveal exact matching detail even when the rest of the map stays quiet. Print and canonical export force full information. The cross-renderer contract is covered by [`archify/test/semantic-zoom.test.mjs`](../archify/test/semantic-zoom.test.mjs). A second zoom policy, density heuristic, or fisheye lens would compete with the existing detail state and risk moving or distorting deliberate geometry.

### Finder already covers node search

Node Finder indexes node ID, label, semantic type, sublabel, context, tag, and visible node text. It also becomes a reachability-aware Route Probe endpoint picker. The current contract lives in [`archify/test/finder.test.mjs`](../archify/test/finder.test.mjs). Relationship-aware search remains a plausible later adaptation, especially now that Direct Relationship Pin exists, but another search surface is not the next highest-value interaction.

### Route Probe already contains the data needed for a journey

Route Probe reads exact compiled `data-edge-from` and `data-edge-to` semantics. It uses deterministic authored-order BFS. The result already stores:

- an ordered node array;
- an ordered exact edge array;
- source and destination IDs;
- a complete static route highlight;
- ordered `data-route-step` attributes;
- a route receipt with source-to-destination node chips;
- a one-shot route signal;
- a camera fit over all result nodes;
- a stable `#route=<source>~<target>` link.

Its current node chips are non-interactive `span` elements. That is the concrete unused affordance Round 35 should activate. The existing contract is covered by [`archify/test/route-probe.test.mjs`](../archify/test/route-probe.test.mjs).

### Story Beats do not make Route Journey redundant

Story Beats traverse an **authored named chapter** from `meta.views[].focus`. They preserve authorial narrative order even when adjacent stops have reverse, missing, grouped, or multiple relationship truth. Route Probe instead answers an **ad hoc reader question** between two chosen nodes and guarantees a directed BFS result. Route Journey therefore has a distinct boundary:

- Story Beat: “tell me the authored explanation.”
- Route Journey: “walk me through the exact route I just asked for.”

Route Journey must not create a chapter, mutate `meta.views`, add a story beat, or reuse story URLs.

## Current fireworks-tech-graph snapshot

The public repository is [`yizhiyanhua-ai/fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph). At the 2026-07-20 snapshot, GitHub's official repository API reported 8,965 stars, the `main` default branch, and an MIT license ([official repository API](https://api.github.com/repos/yizhiyanhua-ai/fireworks-tech-graph)). The inspected `main` commit is [`50c819d68fd4fee330b3010988cd13e98b678d44`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44). Its strongest current lessons for this round are not minimap or search.

### Its offline viewer is intentionally basic

The current single-file viewer exposes pan, zoom, reset, theme, copy SVG, and SVG / PNG / JPEG / WebP export ([viewer source](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L215-L327)). The inspected viewer source does not implement a semantic minimap, graph search, relationship selection, shortest-path explorer, or route scrubber. Archify is already ahead on those viewer semantics. Copying that viewer would be a regression in interaction depth.

### Its motion contract preserves the mental map

The project documents a constrained SVG-to-GIF pipeline rather than arbitrary animation. Existing routes draw in semantic order. Nodes, labels, containers, markers, and the camera remain fixed ([official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L27-L52)). Its README also makes validation, exact semantic direction, static-DOM preservation, and bounded correction visible product promises ([official README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L137-L189)). The transferable lesson is:

> Move the reading signal through fixed semantic geometry; do not move the geometry to manufacture excitement.

Archify already adapted that lesson into finite relationship and route signals. Round 35 should apply it to a reader-controlled route sequence rather than add more ambient effects.

### What not to copy from its motion delivery

Its approved GIF timeline is a fixed rendered media artifact and loops indefinitely ([official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L27-L52)). Archify's HTML viewer can respond live to Still, reduced motion, visibility, keyboard focus, and reader pause. It should keep that advantage. No GIF runtime, Chromium dependency, FFmpeg dependency, style-specific carrier, or fixed movie timeline belongs in Route Journey.

## Primary-source findings from graph viewers

### Cytoscape.js: a path is an ordered semantic sequence

Cytoscape.js documents shortest-path results as ordered collections. For Dijkstra, `pathTo(node)` starts with the source node and includes edges between nodes, so an edge at index `i` is bracketed by its previous and next node. Its A* result likewise returns an ordered `path` collection ([official Cytoscape.js algorithms documentation](https://js.cytoscape.org/#collection/algorithms)). The useful lesson for Archify is not to recompute a journey from geometry or labels. Use the already ordered semantic result.

### yFiles: exact ordered edges are authoritative

yFiles defines a path as a sequence of edges connecting a sequence of nodes. Its shortest-path guide emphasizes exact path edges in a directed result ([official path-analysis guide](https://docs.yworks.com/yfiles-html/dguide/analysis-paths/)). The `Path` API exposes ordered `edges` and ordered `nodes`. It explicitly warns that nodes alone may be ambiguous when multi-edges exist ([official `Path` API](https://docs.yworks.com/yfiles-html/api/Path/)). This maps directly to a critical Archify invariant:

> Route Journey must step through the existing ordered `activeEdges`; it must never rediscover a hop by matching only consecutive endpoint IDs.

That preserves the exact BFS-selected authored relationship when parallel edges exist.

### React Flow and yFiles: fit a semantic subset, not a stored viewport

React Flow's `fitView` accepts a specific set of nodes plus optional duration, padding, and zoom limits ([official `ReactFlowInstance` reference](https://reactflow.dev/api-reference/types/react-flow-instance)). yFiles provides `ensureVisible`, `fitContent`, and `zoomToAnimated`, and exposes ways to disable or customize viewport animation ([official `GraphComponent` API](https://docs.yworks.com/yfiles-html/api/GraphComponent/), [official view-management guide](https://docs.yworks.com/yfiles-html/dguide/view_graphcontrol/)). The product lesson is to derive the current camera target from semantic items. Do not serialize a pixel viewport into the route or URL. For Route Journey, the current semantic window is the current node plus its incoming and outgoing route neighbor when present.

### Stable relationship identity is real infrastructure, not a string trick

React Flow's Edge type requires a unique string `id` ([official Edge reference](https://reactflow.dev/api-reference/types/edge)). Cytoscape.js uses `data.id` to uniquely identify every element and treats ID, source, and target as topology-defining normally immutable fields ([official Cytoscape.js element data documentation](https://js.cytoscape.org/#notation/elements-json), [official data API](https://js.cytoscape.org/#collection/data)). Graphviz lets the author provide an `id` for graph objects, including edges. It says uniqueness is the provider's responsibility, warns that `\E` is not unique for multiedges, and says its generated internal ID is unpredictable to the graph writer ([official Graphviz `id` attribute](https://graphviz.org/docs/attrs/id/)). These sources validate Round 34's decision not to create a relation permalink from source order, endpoints, label text, or geometry. They also show the correct later solution: an optional author-controlled edge identity with uniqueness validation.

D3's official link-force API makes the same distinction indirectly: it assigns each link a zero-based runtime `index`, while named source and target resolution comes from an explicit node-ID accessor ([official D3 link-force reference](https://d3js.org/d3-force/link)). D3 does not define that link index as a durable public relationship identity. The Archify inference is therefore explicit: `data-edge-key` may remain a useful compiled-order key, but only a separate author-controlled relationship ID can honestly back `#relation=<id>`.

### Edge concentration trades exactness for density

Graphviz's `concentrate=true` merges multiedges and makes partially parallel edges share portions of their paths. The partial-path feature is limited to `dot`, and the attribute only works for non-contiguous nodes ([official Graphviz `concentrate` attribute](https://graphviz.org/docs/attrs/concentrate/)). That can reduce line density in some automatically laid-out graphs. It is a poor match for Archify now because:

- deliberate route geometry is part of the authored output;
- Direct Relationship Pin needs one exact relationship target;
- Relationship Lens needs exact direction and metadata;
- Route Journey needs one exact ordered edge per hop;
- parallel relationships may carry different meaning;
- canonical export must retain the authored topology without viewer-only rerouting.

Do not add bundling or concentration as a viewer toggle.

## Accessibility and motion findings

### Current step has a native semantic token

WAI-ARIA defines `aria-current="step"` for the current item in a step-based process and says only one element in a related set should be current ([WAI-ARIA 1.2 `aria-current`](https://www.w3.org/TR/wai-aria/#aria-current)). Route-position buttons should use that token. They should not invent a slider role.

### Automatic progression must remain reader-controlled

The WAI-ARIA carousel pattern requires an explicit rotation control. It also says automatic rotation stops when keyboard focus enters the carousel and does not resume until the reader activates the rotation control ([official APG carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)). Route Journey is not a carousel, but this is a useful control precedent:

- playback starts only by deliberate Play activation;
- pause is adjacent and always reachable;
- focusing or activating an individual route position pauses playback;
- replacing the route pauses playback;
- page visibility restoration never silently resumes playback.

### Reduced motion means removing non-essential motion

Media Queries Level 5 defines `prefers-reduced-motion: reduce` as a request to remove or replace non-essential motion that can trigger discomfort or distraction ([official Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)). Under reduced motion, Route Journey keeps direct position activation, Previous, and Next. It disables automatic Play and uses instant semantic framing.

### Pause remains useful even for a finite sequence

WCAG 2.2 guidance explains that automatically moving or auto-updating content presented alongside other content needs a usable pause, stop, or hide mechanism under the criterion's conditions. It also distinguishes intentional activation from hover or focus ([official SC 2.2.2 explanation](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)). Route Journey is deliberately activated and finite, but it may exceed five seconds on a longer path. Providing Pause is still the clearer and safer product contract.

### Controls must be targetable and visibly focused

WCAG 2.2's minimum target guidance uses 24 by 24 CSS pixels unless an exception applies ([official SC 2.5.8 explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)). WCAG also requires a visible keyboard focus mode ([official SC 2.4.7 explanation](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible)). Route-position controls should meet at least 24 CSS pixels everywhere and use 44-pixel minimum height in the current narrow mobile layout.

## Candidate comparison

| Candidate | New reader answer | Reuse | Schema / renderer cost | UI cost | Export risk | Decision |
|---|---|---:|---:|---:|---:|---|
| Another minimap / overview | None; Semantic Radar already answers it | Low | None | High duplicate | Medium | **Skip** |
| Another semantic zoom / fisheye | None; MAP / READ / FULL already answer it | Low | Medium | Hidden complexity | High geometry risk | **Skip** |
| Edge bundling / concentration | Fewer visible strokes | Low | High | New toggle | Very high exactness risk | **Skip** |
| Separate graph-search panel | Some additional discovery | Medium | Low | High duplicate | Low | **Hold** |
| Relationship-aware Finder results | Find a named relationship | High | Low | Low | Low | **Adapt later** |
| Optional relationship IDs + permalink | Share one durable relationship | Medium | High across five modes | Low | Low after validation | **Adopt later** |
| Focus-history breadcrumb | Revisit prior focus jumps | Medium | None | Medium | Low | **Hold** |
| Route Journey | Explain the route already selected | Very high | None | Low, same panel | Low | **Adopt now** |

## Candidate A: optional relationship ID plus direct permalink

### Why it is correct in principle

Round 34 correctly refused to deep-link `data-edge-key` because that key is the source array position. Reordering relationships changes it. Endpoints are insufficient for parallel edges. Labels are editable and may be absent. Geometry is a presentation detail. React Flow, Cytoscape.js, and Graphviz all reinforce author-controlled unique element identity rather than derived display identity ([React Flow Edge](https://reactflow.dev/api-reference/types/edge), [Cytoscape.js elements](https://js.cytoscape.org/#notation/elements-json), [Graphviz ID](https://graphviz.org/docs/attrs/id/)).

### Correct eventual Archify shape

Add an optional `id` to each relationship-bearing record:

- architecture `connections[]`;
- workflow `edges[]`;
- sequence `messages[]`;
- data-flow `flows[]`;
- lifecycle `transitions[]`.

Use the shared semantic ID grammar. Validate uniqueness within the diagram's relationship collection. Emit `data-edge-id` separately from the existing numeric `data-edge-key`. Keep the numeric key as the internal grouping identity for multi-shape compiled geometry. Only a relationship with a valid authored ID receives **Copy relationship**. Use `#relation=<encoded-id>`. On restoration, resolve exactly one authored ID and fail closed if missing, duplicated, or inconsistent. Restore a static pin without autoplay, pulse, focus theft, or URL churn. Never synthesize a durable ID from endpoints, label, order, or SVG `d` data.

### Why it is not Round 35

This change touches:

- five schemas;
- generated validators;
- five renderer call sites;
- shared compiler helpers;
- examples and authoring docs;
- duplicate-ID validation;
- URL arbitration;
- focus and relationship copy semantics;
- compatibility tests for optional IDs.

That cost can be justified when direct relationship sharing is the product goal. It does not make a multi-hop route easier to read today. The current goal is complex-graph comprehension, so Candidate A should remain a well-defined later infrastructure slice.

## Candidate B: Route Journey

### Why it is the best next slice

Route Probe already owns every required semantic input. Its current receipt already displays the ordered route. The static SVG already exposes exact route step numbers. The current camera already frames semantic ID sets. The Motion Governor already owns route motion precedence. The route hash already restores the source/destination question. Route Journey activates information already computed instead of inventing a new model.

### Product sentence

> Trace the shortest authored route, then inspect or play it one exact hop at a time while the full path stays visible.

### Reader value

The current Route Probe result answers topology but asks the reader to scan an entire highlighted path at once. On a longer architecture, that still requires matching:

- a chip to a node;
- a node to an edge;
- an edge to its label;
- the edge direction to the next node;
- the current viewport to the full-route receipt.

Route Journey binds those pieces into one current position and one exact incoming hop. It is details-on-demand over a result, not another global mode.

## Recommended product contract

### 1. Preserve the complete static route

The full route remains visible whenever Route Probe is in result state. Journey never hides non-current route nodes or edges. Non-route content can keep the current Route Probe dimming. Within the route:

- all nodes and edges remain readable;
- the current position receives a stronger non-color cue;
- the current incoming edge receives the strongest cue;
- before/current/after position is not communicated by color alone.

When no journey position is active, the current complete route result is unchanged.

### 2. Turn existing route node chips into native buttons

Keep the current horizontal receipt. Render one native button for each ordered route node. The first button represents the source position before any hop. Every later button represents arrival through `activeEdges[index - 1]`. Each button names:

- its position and total;
- the node label;
- the stable node ID when useful;
- for positions after the source, the exact incoming source, target, and relationship label when present.

Use `aria-current="step"` on exactly one active position. Do not use `role="slider"`, an `input[type=range]`, or an unlabeled progress dot.

### 3. Use one roving Tab stop

The route-position set adds one page Tab stop, not one stop per node. Arrow Left / Up moves to the previous position. Arrow Right / Down moves to the next position. Home moves to the source. End moves to the destination. Enter or Space activates the focused position. Escape clears the journey first; a second Escape follows the current Route Probe clear behavior. Focus movement alone may preview the receipt but must not move the camera or start playback.

### 4. Add compact controls inside the existing panel

Use the existing Route Probe panel and action area. Add:

- Previous;
- Play / Pause;
- Next;
- Route overview when a position is active.

Do not add a new toolbar button or floating panel. For a one-hop route, direct position buttons and Previous / Next remain useful; Play may be omitted or disabled because no sequence explanation is needed.

### 5. Playback is explicit, finite, and resumable

Playback begins only after Play activation. It never begins when:

- a route is first computed;
- a route hash is restored;
- a route-position button receives focus;
- the pointer enters the panel;
- the artifact enters Presentation; or
- the page becomes visible again.

Playback advances through the finite ordered route once. Pause retains the exact current position and camera. Resume continues from that position. At the destination, playback ends, reports completion, and keeps the final static route available. The reader can select Route overview to frame the complete result again.

### 6. The exact active edge is authoritative

For position `i > 0`, the current incoming edge is exactly `activeEdges[i - 1]`. Do not query all edges by endpoint pair. Do not select all parallel edges. Do not use `data-edge-key` order as a public identity. Do not infer a label from visible proximity. The existing BFS result already chose the correct edge.

### 7. Camera framing is semantic and context-preserving

Manual activation frames:

- the previous route node when present;
- the current route node;
- the next route node when present.

That three-position window preserves direction context better than isolating one node. Use the existing Semantic Camera / `Archify.view.reveal` transaction. Use bounded padding and zoom limits. Do not store camera scale, transform, scroll offset, or pixel bounds in state or URL. On desktop Live mode, the existing bounded camera transition may run. On mobile contained scroll, use the existing horizontal reveal behavior. On Still or reduced motion, settle the target immediately.

### 8. Motion follows only the current exact edge

During Live playback, one short, finite signal may traverse the current incoming edge from authored source to authored target. The full route remains statically highlighted beneath it. The overlay is:

- `aria-hidden`;
- pointer-transparent;
- marker-free;
- stripped of semantic identity;
- normalized with `pathLength="1"` where needed;
- removed before the next step.

At most one journey signal exists. Do not replay the existing all-route flow on every position. Do not loop after arrival.

### 9. Pause and ownership rules

Pause immediately on:

- Pause activation;
- direct position activation;
- Previous or Next;
- keyboard focus entering a position after Play;
- route replacement;
- Route Probe clear;
- Story, Chapter, Lens, Focus, or relationship takeover;
- Motion Governor switching to Still;
- live reduced-motion change;
- document hiding;
- print; or
- export start.

Visibility restoration does not resume. The reader must activate Play again. Use one generation/token owner so stale timers cannot advance a replaced route.

### 10. URL contract remains endpoint-only

Keep `#route=<source>~<target>` unchanged. The URL means “show this deterministic route.” It does not mean “play it” or “restore step 4.” Copy link while paused or playing still copies only the endpoint route. Reload restores the complete static route with no active journey position and no autoplay. Do not add `step`, numeric edge key, camera, dwell, playback, or pause state to the hash.

## Five-renderer compatibility

Route Journey must remain entirely in the shared HTML template.

### Architecture

Use exact compiled `connections[]` order already represented in the Route Probe result. Orthogonal, straight, and via-routed path geometry remains unchanged.

### Workflow

Use exact compiled `edges[]`, including main, branch, async, return, and exception semantics. Journey does not rewrite `mainPath` or claim that a computed route is the happy path.

### Sequence

Use exact ordered messages as directed relationships. Grouped message geometry remains one semantic hop. No timeline, activation bar, or participant position changes.

### Data flow

Use exact compiled `flows[]` and their classification/labels. Journey does not turn a shortest structural route into lineage certainty beyond the authored directions.

### Lifecycle

Use exact directed transitions. Existing Route Probe exclusions for self-loop traversal remain authoritative. Journey never invents a transition to make a smoother sequence.

## Surface boundaries

### Embed

Ordinary embed already suppresses Route Probe chrome. It must expose no journey controls, position state, timer, overlay, or live announcement. The canonical static diagram remains.

### Print

Print contains the full authored diagram. It contains no Route Probe panel, current-position emphasis, journey overlay, camera transform, or playback state. If printing begins during playback, playback stops synchronously.

### Canonical SVG and raster export

Clone cleanup must remove:

- journey overlay groups;
- journey root attributes;
- current/before/after attributes;
- `aria-current` or runtime tabindex added inside runtime chrome;
- inline route-step viewer styles;
- any active camera transform already covered by canonical export reset.

Authored nodes, edges, labels, markers, classifications, and coordinates remain unchanged. PNG, JPEG, WebP, clipboard image, and standalone SVG continue to serialize the complete canonical diagram rather than the current journey frame.

### Reduced motion and Still

Previous, Next, and direct position activation remain available. Camera settlement is immediate. No edge signal runs. Play is disabled or replaced by clear copy such as `Manual steps in Still`. Switching to Still during playback pauses on the current truthful position. Returning to Live does not auto-resume.

### Mobile

The current route receipt remains horizontally scrollable inside the panel. The active button scrolls into view without moving the page horizontally. Position and transport controls use at least 44 CSS-pixel height at the narrow breakpoint. The panel continues to choose top/bottom docking around relevant route nodes. Contained wide-diagram scroll remains authoritative over transform-based pan. Page overflow must remain zero at 390 CSS pixels.

### Accessibility

Use native buttons. Keep one roving Tab stop in the position set. Expose one visible focus indicator. Use `aria-current="step"` on only the active position. Play and Pause share one stable accessible name that reflects the current action. The existing polite status may announce: `Step 3 of 6 · API to Cache · cache lookup`. Do not announce every animation frame. Do not steal focus when the camera moves. Do not rely on color, motion, or sound as the only current-step cue.

## Strong-owner arbitration

Route Journey is a substate of the existing Route owner. It is not a new top-level owner. Entering Route Probe already clears or yields competing focus/lens/story state. The journey should reuse that gateway. Within a route result:

- route result owns the full static path;
- journey position owns the stronger current-hop cue;
- journey playback owns at most one finite signal and one camera transaction;
- Direct Relationship Pin remains blocked while Route owns the diagram;
- clearing Journey returns to the same complete Route result, not to an empty graph state.

This last distinction matters. `Escape` should be layered:

1. playing -> pause;
2. active journey position -> clear position and show full route;
3. full route -> clear Route Probe using current behavior.

## Runtime state sketch

The minimum additional state is:

```text
journeyIndex        -1 for full-route overview, otherwise 0..nodes.length-1
journeyPlaying      boolean
journeyGeneration   monotonically increasing token
journeyTimer        at most one dwell timer
journeyOwnerToken   existing Motion Governor owner lease when available
```

The semantic source remains:

```text
activeNodeIds[index]
activeEdges[index - 1]
```

No duplicate graph array is needed. No stored viewport is needed. No persistent state is needed.

## Suggested implementation sequence

1. Refactor `renderPath(ids)` to accept the current exact route result.
2. Render node chips as native buttons with stable runtime position indexes.
3. Add one roving focus helper for Arrow keys, Home, End, Enter, and Space.
4. Add `setJourneyIndex(index, options)` that updates only route substate.
5. Resolve the exact incoming edge from `activeEdges[index - 1]`.
6. Add current position and current edge attributes without hiding the full route.
7. Reuse `Archify.view.reveal` for the previous/current/next semantic window.
8. Add Previous, Play/Pause, Next, and Overview controls to the current panel.
9. Add one generation-owned scheduler with pause and stale-callback rejection.
10. Reuse exact edge geometry for at most one finite journey overlay.
11. Integrate Motion Governor, reduced-motion, visibility, print, clear, and owner-preemption paths.
12. Extend canonical clone cleanup and the canonical-clean predicate.
13. Add focused shared-template tests across all five renderers.
14. Validate desktop, Blueprint, sequence, lifecycle, mobile, Still, embed, export, and rapid replacement in the in-app browser.

## Concrete acceptance criteria

Round 35 is accepted only if all of the following are true.

1. All five typed renderers inherit Route Journey through the shared template.
2. No schema, generated validator, renderer IR, layout, dependency, storage, or server surface changes.
3. The unchanged Route Probe result still shows the same complete static route before a journey position is selected.
4. Every route node becomes one native position button with a meaningful name.
5. The position set contributes exactly one page Tab stop.
6. Arrow keys, Home, End, Enter, Space, and layered Escape work without a keyboard trap.
7. Exactly one active position exposes `aria-current="step"`.
8. Focus remains visibly indicated in Signal Flow, Blueprint, dark, and light themes.
9. Position activation does not move DOM focus unexpectedly.
10. Position zero represents the source before any hop.
11. Position `i > 0` resolves exactly `activeEdges[i - 1]`.
12. Parallel relationships do not cause multiple edges to become current.
13. Reverse-direction or visually backtracking routes retain authored source to target direction.
14. The full route remains visible while one position and incoming edge receive stronger emphasis.
15. Current state is not communicated by color or motion alone.
16. Manual activation frames previous/current/next route nodes when available.
17. Mobile framing uses contained scroll and does not apply an incompatible desktop transform.
18. Route overview returns to the complete route framing without recomputing the path.
19. Play starts only after explicit activation.
20. A freshly computed or hash-restored route never autoplays.
21. Playback advances through the finite result at most once.
22. Pause retains the exact current position.
23. Resume continues from the paused position rather than restarting silently.
24. Direct position activation, Previous, Next, route replacement, and layered Escape pause first.
25. A route replacement invalidates every stale journey timer and camera callback.
26. Page hiding pauses and page visibility restoration never auto-resumes.
27. Switching to Still or live reduced motion pauses synchronously.
28. Still and reduced-motion readers can use every manual position control with zero camera animation and zero edge signal.
29. At most one journey signal overlay exists.
30. The journey signal follows the exact authored edge geometry and direction.
31. The signal is finite, marker-free, pointer-transparent, and `aria-hidden`.
32. Direct Relationship Pin, Lens, Focus, Story, Chapter, and Intent Trace cannot leave mixed owner state with Journey.
33. Journey clear returns to the complete Route result; Route clear still returns to the ordinary diagram.
34. `#route=<source>~<target>` remains the only route URL grammar.
35. Copy route during playback produces the same endpoint-only link.
36. Reloading that link restores no current step, playback, dwell, or camera snapshot.
37. Mobile position and transport controls measure at least 44 CSS pixels high.
38. The route receipt stays within the panel and causes zero page horizontal overflow at 390px.
39. Embed exposes zero journey controls and zero journey runtime attributes.
40. Print exposes zero journey chrome or transient emphasis.
41. Canonical SVG and raster exports contain the complete authored diagram and zero journey overlays or attributes.
42. Authored node, edge, label, marker, route geometry, and viewBox values remain unchanged.
43. A one-hop route behaves truthfully and does not present a pointless autoplay loop.
44. Empty, invalid, stale, or unreachable routes fail closed through existing Route Probe behavior.
45. Focused tests cover all five renderers, parallel-edge exactness, keyboard, playback, pause, stale callbacks, Still, reduced motion, mobile, embed, print, URL restoration, and export cleanup.
46. The complete Archify test, golden, schema, gallery, README-proof, and ZIP gates remain green after implementation.

## In-app browser validation matrix

| Surface | Required inspection |
|---|---|
| Signal Flow dark workflow | Create a 4+ hop route, activate middle positions, Play, Pause, resume, and return to overview. |
| Blueprint light architecture | Confirm square/quiet focus treatment and readable current state without glow dependence. |
| Sequence | Step through grouped message geometry and verify one exact edge per arrival. |
| Data flow | Confirm flow labels/classification remain static and current direction is truthful. |
| Lifecycle | Step a branched route and confirm no invented self-loop hop. |
| Parallel-edge fixture | Confirm ordered `activeEdges` selects only the BFS-owned exact edge. |
| Keyboard only | Enter the route set once, traverse with arrows/Home/End, activate, Play/Pause, and unwind Escape layers. |
| 390 × 844 mobile | Verify 44px controls, active-chip centering, docking, contained scroll, and zero page overflow. |
| Still | Verify direct steps work, Play is unavailable/quiet, camera is instant, and no signal exists. |
| Dynamic reduced motion | Switch while playing; verify immediate pause and no automatic resume. |
| Hidden/visible | Hide mid-dwell, return, and verify the current truthful position is retained. |
| Presentation | Verify panel and current position remain inside the viewport without changing stage height. |
| Embed | Verify zero Journey/Route chrome and one clean canonical diagram. |
| Print preview | Verify full static authored diagram and no current-step residue. |
| SVG/raster export | Export while playing and inspect zero journey attributes, overlay shapes, or transforms. |
| Rapid replacement | Start route A, Play, replace with route B before dwell settles, and verify only B can advance. |
| Reload route link | Verify complete static route with no autoplay or restored journey step. |

## Risks and mitigations

### Risk: Route Journey feels like duplicated Story playback

Mitigation: keep the source and language distinct. Journey exists only after an ad hoc Route Probe result and never reads or writes `meta.views`.

### Risk: camera movement causes disorientation

Mitigation: keep the full path statically visible, frame a three-position semantic window, make Play explicit, provide Pause and Overview, and settle instantly under reduced motion.

### Risk: a long route creates excessive automatic duration

Mitigation: finite one-pass playback, adjacent Pause, direct step activation, and no autoplay on restore. Do not compress a long path into unreadably fast movement merely to stay under five seconds.

### Risk: parallel edges highlight the wrong relationship

Mitigation: use ordered `activeEdges`, not endpoint re-query. yFiles' warning that nodes can be ambiguous for multi-edges is directly relevant ([official `Path` API](https://docs.yworks.com/yfiles-html/api/Path/)).

### Risk: route chips increase Tab burden

Mitigation: one roving Tab stop and arrow-key traversal.

### Risk: current position obscures static truth

Mitigation: stronger emphasis only; never remove other route items.

### Risk: stale timers mutate a replaced route

Mitigation: one monotonically increasing generation token and at most one timer.

### Risk: URL semantics become overloaded

Mitigation: endpoint-only route hash; no step or play parameters.

### Risk: another control row crowds mobile

Mitigation: reuse the current panel, use compact transport controls, allow the path row to scroll horizontally, and validate docking at 390px.

### Risk: author-controlled relationship ID gets postponed indefinitely

Mitigation: keep Candidate A documented as the next identity foundation when the product goal becomes relationship sharing or relationship-aware Finder. Do not weaken its eventual contract with an interim synthetic ID.

## Adopt / Adapt / Skip

### Adopt now

- Ordered path semantics from the existing exact BFS result.
- Exact ordered edge ownership for every hop.
- One current position over a still-readable full route.
- Native discrete position buttons with `aria-current="step"`.
- Previous, Play/Pause, Next, direct position, and Route overview.
- Explicit, finite, pausable playback.
- Semantic subset framing through the existing camera.
- One finite exact-edge signal in Live.
- Still/reduced-motion manual parity.
- Existing route owner, hash, panel, cleanup, and export boundary.
- Generation-token cancellation and last-intent-wins behavior.

### Adapt later

- Optional author-controlled relationship IDs.
- Direct relationship permalink/copy only for valid authored IDs.
- Relationship-aware results inside the existing Finder.
- Stable relation IDs as a prerequisite for cross-version analytics or saved relationship references.

### Skip

- A second minimap or overview panel.
- A second semantic-zoom/fisheye system.
- Graphviz-style edge concentration in viewer state.
- Automatic layout or rerouting.
- A generic graph runtime.
- Canvas/WebGL migration.
- A new Route Journey panel or toolbar mode.
- A range-slider scrubber that hides semantic node names.
- Autoplay on route selection, hash restoration, hover, focus, or visibility.
- Infinite route motion.
- Moving nodes, labels, boundaries, or authored geometry.
- Journey step, edge-array index, dwell, playback, or camera state in the URL.
- A synthetic relationship permalink derived from order, endpoints, label, or path geometry.
- GIF, FFmpeg, Puppeteer, React Flow, Cytoscape.js, yFiles, or Graphviz as a new Archify dependency.
- Editing, reconnecting, deleting, or reordering graph relationships.

## Source register and URL verification

The following primary-source URLs returned HTTP 200 on 2026-07-20.

| Source | Used for | Status |
|---|---|---:|
| [fireworks-tech-graph repository](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) | Current public project | 200 |
| [fireworks-tech-graph repository API](https://api.github.com/repos/yizhiyanhua-ai/fireworks-tech-graph) | Snapshot metadata | 200 |
| [fireworks README at inspected commit](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L137-L189) | Viewer/motion/validation claims | 200 |
| [fireworks interactive viewer source](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L215-L327) | Current viewer controls | 200 |
| [fireworks motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L27-L52) | Fixed geometry and semantic motion | 200 |
| [React Flow MiniMap](https://reactflow.dev/api-reference/components/minimap) | Overview, viewport, accessibility | 200 |
| [React Flow instance](https://reactflow.dev/api-reference/types/react-flow-instance) | Semantic subset fit and duration | 200 |
| [React Flow Edge](https://reactflow.dev/api-reference/types/edge) | Unique edge ID | 200 |
| [Cytoscape.js](https://js.cytoscape.org/) | Element IDs and ordered shortest paths | 200 |
| [D3 link force](https://d3js.org/d3-force/link) | Runtime link index versus named semantic IDs | 200 |
| [yFiles paths guide](https://docs.yworks.com/yfiles-html/dguide/analysis-paths/) | Directed shortest-path semantics | 200 |
| [yFiles Path API](https://docs.yworks.com/yfiles-html/api/Path/) | Ordered edges/nodes and multi-edge warning | 200 |
| [yFiles GraphComponent](https://docs.yworks.com/yfiles-html/api/GraphComponent/) | Ensure-visible and animated/instant camera | 200 |
| [Graphviz concentrate](https://graphviz.org/docs/attrs/concentrate/) | Edge merging/concentration tradeoff | 200 |
| [Graphviz ID](https://graphviz.org/docs/attrs/id/) | Author-owned unique object identity | 200 |
| [WAI-ARIA aria-current](https://www.w3.org/TR/wai-aria/#aria-current) | Current-step semantics | 200 |
| [APG carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/) | Play/pause and focus ownership precedent | 200 |
| [Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion) | Reduced-motion preference | 200 |
| [WCAG Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) | Reader control of progression | 200 |
| [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | Minimum pointer target | 200 |
| [WCAG focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible) | Visible keyboard focus | 200 |

## Final recommendation

Proceed with **Route Journey** as Round 35. The slice should activate the existing Route Probe receipt rather than add a new surface. The full route stays visible. One exact ordered position becomes current. The reader can inspect directly or start one finite, pausable pass. The camera follows semantic neighbors, not saved pixels. Still, reduced motion, mobile, keyboard, embed, print, and canonical export keep their current boundaries. Keep optional authored relationship IDs as the next durable-identity candidate, but do not block Route Journey on them: the current ordered `activeEdges` already provide exact local hop identity. This is the strongest available balance of visual delight, comprehension, stability, and implementation restraint.
