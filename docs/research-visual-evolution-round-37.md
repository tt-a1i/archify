# Visual Evolution Round 37 — Story Follow Camera

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build a **Story Follow Camera** as the next bounded visual-comprehension slice.

Archify already has the major viewer primitives that modern graph tools use to
make a large diagram approachable:

- Semantic Radar gives a simplified whole-diagram map and a live viewport;
- MAP / READ / FULL progressively reveal authored detail;
- Semantic Camera fits an explicit semantic subset with padding and zoom caps;
- focus, Finder, Relationship Lens, Direct Relationship Pin, Semantic Lens, and
  Route Probe answer reader questions without changing topology;
- Guided Views, Story Trail, Story Beats, chapter handoff, exact-moment links,
  and Route Journey provide bounded narrative sequences;
- Motion Governor gives reader intent one motion owner; and
- Presentation Stage removes surrounding page chrome without replacing the
  live artifact.

The remaining gap is now visible rather than theoretical. In the current
1280×720 Presentation Stage, a tall workflow is a small centered column. An
eight-stop chapter still spans most of that tall topology, so activating the
chapter does not make its individual steps materially larger. Story Beat
playback changes emphasis and may pulse one exact relationship, but
`centerStoryStop()` only centers the **HTML beat button in the rail**. It does
not ask Semantic Camera to frame the current SVG node or relationship
([Guided Story implementation](../archify/assets/template.html),
[Semantic Camera implementation](../archify/assets/template.html)).

The next slice should connect those two existing owners:

> When the reader deliberately plays or selects a Story Beat, frame a bounded
> semantic window around that beat—normally previous, current, and next—while
> keeping the canonical SVG, authored route, complete chapter, and reader
> controls intact.

This is higher leverage than another minimap, stronger chapter-wide zoom,
topology collapse, or a foreground-cloning layer. It makes the existing story
legible at the moment the reader asks to follow it, reuses the same camera
discipline already proven by Route Journey, and requires no schema, renderer,
layout, dependency, graph store, or editor surface.

## Research question and evidence boundary

How do current graph and diagram viewers use overview, subset framing,
progressive disclosure, bounded animation, and narrative steps to improve
first-glance hierarchy and reading comprehension—and what should Archify add
after its existing Radar, Camera, Reading Depth, Guided Story, Route Journey,
Motion Governor, and presentation features?

This note uses:

1. the current Archify worktree and generated Proof Lab artifacts;
2. direct browser evidence from the current Presentation Stage at 1280×720;
3. official product documentation, official repositories, and W3C guidance as
   available on 2026-07-20; and
4. explicit product inferences where a source supplies a primitive rather than
   an Archify-specific recommendation.

No external source claims that a particular interaction is “beautiful.” In this
report, first-impression beauty means a calm, intentional visual hierarchy:
important content is large enough to read, unrelated content remains stable
context, and motion explains one semantic change rather than decorating the
whole page.

## Current Archify baseline: do not rebuild solved layers

### Overview and orientation already exist

Semantic Radar derives a simplified map from stable semantic nodes, represents
the viewport, supports node activation and panning, and remains outside the
canonical SVG. It already covers the core overview/minimap pattern
([Semantic Radar implementation](../archify/assets/template.html),
[Semantic Radar tests](../archify/test/semantic-radar.test.mjs)).

The default SVG `viewBox` plus `width: 100%` already provides a complete cold-open
overview. The camera's reset state is explicitly `{ scale: 1, x: 0, y: 0,
mode: 'overview' }`. Another fit-all subsystem would duplicate that contract
rather than solve the observed tall-diagram problem
([shared viewer CSS and camera](../archify/assets/template.html)).

### Progressive disclosure already exists

Reading Depth keeps structure and primary labels at MAP, restores relationship
labels and node context at READ, and restores tags and fine annotations at FULL.
Exact semantic intent can reveal matching detail without changing geometry.
This is deterministic author-aware disclosure, not a density heuristic
([Reading Depth implementation](../archify/assets/template.html),
[Reading Depth research](research-visual-evolution-round-23.md)).

### Narrative structure already exists

All 11 current Proof Lab sources have three authored views: 33 chapters total.
Across those artifacts, the first authored chapter contains 52 of 112 semantic
nodes, with a mean artifact-level share of 47%. This demonstrates that authors
already provide useful bounded subsets, but it does **not** prove that array
position means “default opening.” Archify should not infer cold-open intent from
the first array item.

Within a selected chapter, Story Trail already derives ordered stable IDs,
distinguishes exact forward, exact reverse, and grouped/no-direct-edge steps,
and exposes each beat as a native control. Shareable Story Moment restores one
exact `view + beat` semantic state. The missing operation is framing that exact
state in the SVG viewport
([Story Beat tests](../archify/test/story-beat-navigator.test.mjs),
[shareable moment research](research-visual-evolution-round-33.md)).

### The camera and cancellation substrate already exists

Semantic Camera can fit a semantic ID subset, include neighbors, reserve screen
space for viewer chrome, cap scale, resolve instantly for reduced motion, and
return a transaction receipt. Manual zoom, pan, mobile scroll, replacement, and
other semantic owners can interrupt it. Route Journey already requests a
bounded camera frame for an ordered path position
([camera implementation](../archify/assets/template.html),
[Route Journey tests](../archify/test/route-journey.test.mjs)).

The new slice therefore needs a new **request policy**, not a new camera.

## Primary-source findings

### 1. React Flow: fit the semantic subset, with explicit padding and zoom bounds

React Flow's top-level `fitView` option fits all initially supplied nodes. Its
`FitViewOptions` also accepts a specific node subset, padding, minimum and
maximum zoom, duration, easing, and interpolation
([official ReactFlow viewport API](https://reactflow.dev/api-reference/react-flow),
[official FitViewOptions](https://reactflow.dev/api-reference/types/fit-view-options)).

Its MiniMap is a separate SVG overview with a mask for the current viewport.
Panning and zooming through the map are optional rather than inherent
([official MiniMap API](https://reactflow.dev/api-reference/components/minimap)).

**Borrow:** frame explicit semantic IDs; reserve padding; cap zoom; keep fit-all
and subset-fit as different operations.

**Adapt:** Story Follow should send a two- or three-node semantic window to
Archify's existing camera. It should not store a React Flow viewport or make the
minimap the camera owner.

**Skip:** another minimap, React state, draggable nodes, controlled viewport
serialization, and a React Flow dependency.

### 2. Cytoscape.js: viewport animation is a finite, stoppable transaction

Cytoscape.js can animate a viewport fit or center over selected elements with
padding, duration, and easing. Its queue is explicit; `stop()` stops active
viewport animations and can clear queued work. Individual animation objects can
pause while retaining progress or stop while removing themselves from queues
([official animation API](https://js.cytoscape.org/#animations)).

**Borrow:** one finite camera transaction at a time; newest reader intent
replaces old work; manual navigation stops the current transaction and clears
pending progression.

**Adapt:** Archify should not queue camera moves ahead of the reader. The Story
Beat scheduler should request only the current frame, then schedule the next
beat from the settled state.

**Skip:** a generic animation queue, canvas renderer, graph mutation API, and
the Cytoscape runtime.

### 3. D3: interrupt is normal control flow, not an error case

D3's named transition control specifies that `selection.interrupt()` interrupts
the active transition and cancels pending transitions with the same name. Its
transition promise rejects when interrupted or cancelled
([official D3 transition control](https://d3js.org/d3-transition/control-flow)).
D3 zoom separately exposes bounded scale and translation contracts rather than
letting a tour lose the visual world
([official d3-zoom](https://d3js.org/d3-zoom)).

**Borrow:** last intent wins; cancellation must settle cleanup; camera bounds
must keep the reader in the same stable diagram.

**Adapt:** Archify already has camera transaction IDs and settlement receipts.
Use them to prevent a stale Story Beat callback from moving the camera after a
new beat, route, focus, resize, or manual pan.

**Skip:** chained precomputed transitions, transform state in URLs, and an
additional D3 dependency.

### 4. Structurizr: narrative reveal is authored and reader-controlled

Structurizr animations are authored steps that reveal diagram elements or
relationships, with forward/back controls and keyboard navigation
([official animation documentation](https://docs.structurizr.com/ui/diagrams/animation)).
Its viewer separately provides fit-width, fit-height, fit-content, animation
start/stop, previous/next step, fullscreen, and an explicit back-to-last-view
action
([official diagram viewer](https://docs.structurizr.com/server/diagrams/viewer)).
The DSL also allows an author to nominate a default view rather than deriving
one from graph centrality
([official DSL language reference](https://docs.structurizr.com/dsl/language#default)).

**Borrow:** authored order, explicit Play/Pause and Previous/Next, and a
separate whole-diagram return path.

**Adapt:** Archify's authored order is already `meta.views[].focus`; its Story
Beat rail and Show all control already expose the required navigation. Add only
the missing per-beat viewport frame.

**Skip:** hiding all not-yet-revealed topology, a separate presentation file,
and automatic animation on page load.

### 5. LikeC4 and D2: overview and progressive scenes are author decisions

LikeC4 treats views as model projections for different scopes and levels of
detail. A specially named `index` view is the default; if absent, LikeC4
generates one from top-level elements. The official tutorial starts with a
bird's-eye Landscape view before adding scoped detail views
([official LikeC4 views](https://likec4.dev/dsl/views/),
[official tutorial](https://likec4.dev/tutorial/)).

D2 Steps represent a sequence of events and inherit from the previous step.
Layers, scenarios, and steps are separate boards, and its exporters accommodate
those compositions as dynamic media
([official D2 Steps](https://d2lang.com/tour/steps/),
[official composition overview](https://d2lang.com/tour/composition/)).

**Borrow:** an overview remains a named, reachable context; narrative order is
authored rather than inferred; previous state remains intelligible while the
next step arrives.

**Adapt:** Archify should preserve one SVG and express past/current/pending by
viewer emphasis. Its frame window may include the previous and next authored
stop so the reader retains local continuity.

**Skip:** multiple board layouts, inferred default chapters, automatic
drill-down, hidden descendants, and re-layout between story stops.

### 6. W3C: reduce overload, but keep orientation changes under reader control

W3C's cognitive accessibility supplemental guidance says important information
should stand out rather than be lost in noise, and explains that too much
simultaneous content can cause overload and loss of focus
([Avoid Too Much Content](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p03-manageable-quantity/)).
It also says key content should be visible without requiring scrolling or hover
([Make Important Information Easy to Find](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p04-page-important/)).

The same guidance warns that route and orientation changes should be initiated
by user request or have an easy way to turn them off and return to the previous
context
([Let Users Control When Content Moves or Changes](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p01-motion/),
[Let Users Go Back](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p02-back-undo/)).
The WAI-ARIA carousel pattern provides a useful control precedent: automatic
rotation has an explicit control, stops when focus enters, and does not resume
until the reader explicitly requests it
([official APG carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)).

**Borrow:** make one current beat prominent; start follow only from deliberate
story playback or beat activation; pause on reader interaction; keep an obvious
Overview/Show all path.

**Adapt:** an exact `#view=&beat=` restoration may apply its semantic frame
instantly because the reader requested that moment. It must not start playback,
pulse, or move DOM focus.

**Skip:** cold-open fly-ins, incidental hover camera moves, silent resume after
focus/page visibility changes, and forced auto-follow under reduced motion.

## Strict candidate decision

| Candidate | Reader value | Cost / risk | Decision |
|---|---|---|---|
| Another minimap or always-open overview | Duplicates Semantic Radar and the full SVG overview | More chrome and another navigation owner | **Skip** |
| Stronger fit of the complete chapter | Makes some chapters larger | Tall eight-stop paths remain tall and small; still no current-step frame | **Skip** |
| Cold-open first chapter or automatic camera tour | Curated first impression | Array order is not explicit opening intent; unexpected orientation change; hides the safest overview | **Skip** |
| Runtime collapse / expand | Reduces visible elements | Mutates perceived topology, route truth, links, and export expectations | **Skip** |
| Density-based label culling | Reduces text | Reading Depth already provides deterministic semantic tiers | **Skip** |
| Active-subgraph foreground cloning | Can lift a path above crossings | Duplicated visual DOM, marker/filter fidelity, z-order, export cleanup, and hit-target risk | **Adapt later**, only if beat framing leaves a measured occlusion problem |
| Opening-view schema flag | Lets authors nominate a first subset | Cross-schema authoring cost; does not fix tiny beats inside tall chapters | **Hold** |
| **Story Follow Camera** | Makes the current authored beat and local transition readable in every tall/dense story | Reuses existing semantic IDs, camera, scheduler, controls, cancellation, and export cleanup | **Borrow + Adapt now** |

## Highest-leverage next slice: Story Follow Camera

### Product sentence

> Play or select a Story Beat, and Archify follows that exact authored moment
> with a calm, bounded camera while the complete diagram remains one reset away.

### 1. Preserve the whole-system opening

An unqualified artifact still opens at the complete `viewBox` overview. Do not
autoplay, choose the first chapter, or fly the camera on load. Semantic Radar
remains the optional global map. This preserves the reader's initial mental map
and makes the new behavior a consequence of explicit story intent.

### 2. Derive one small frame window from existing story truth

For beat index `i`, frame only stable authored IDs already present in
`storySteps`:

- first beat: current + next;
- middle beat: previous + current + next;
- final beat: previous + current.

The current node is the visual center. If the transition from previous to
current has one or more exact authored edges, those edges remain highlighted by
the existing Story Beat state. Camera bounds are still derived from node boxes,
not SVG path geometry. If a step is grouped or has no direct edge, frame the
real neighboring nodes but do not invent a connector or direction.

This window is a presentation policy over existing semantics. It does not alter
`storySteps`, focus membership, the chapter, layout, or canonical topology.

### 3. Reuse the existing bounded camera

Call the already-public `Archify.view.reveal(ids, options)` from a small
story-owned request helper rather than copying `frameDesktop()` or adding a
second camera.

Recommended initial bounds:

- padding: 64 CSS pixels, with existing chrome avoidance;
- maximum scale: `1.65`, matching Route Journey's conservative framing;
- camera duration: 280–360 ms, capped by the current camera transaction;
- minimum meaningful zoom: keep the current `1.08` threshold;
- mobile: reuse contained horizontal scroll and never widen the page; and
- reduced motion, Motion Still, hidden document, print, and initial exact-link
  restoration: settle instantly.

Do not serialize scale, translation, padding, or duration.

### 4. Give each beat enough settled reading time

The current story divides a 3.2-second chapter interval by the number of beats.
For an eight-stop chapter that is about 400 ms per beat—roughly the duration of
one camera move. Camera follow would become a rapid fly-through unless the beat
scheduler changes.

Use a per-beat dwell near Route Journey's existing `1100 ms`. A camera move may
consume at most 360 ms of that budget, leaving a stable readable interval before
the next step. Schedule from one generation-owned timeout; never preload a queue
of camera moves. The maximum current chapter is eight stops, so one pass remains
finite and bounded at roughly nine seconds.

### 5. Follow only explicit story intent

Camera follow runs when:

- the reader presses Play or Resume;
- the reader activates a Story Beat button; or
- a valid `#view=<id>&beat=<stable-node-id>` is restored.

For an exact-link restore, apply the frame instantly and remain paused. Merely
focusing or hovering a chapter/beat control must not move the diagram. Activating
a chapter without a beat keeps the current chapter-wide Semantic Camera fit.

### 6. Manual navigation always wins

Pointer pan, wheel/pinch zoom, zoom controls, Radar navigation, Finder, focus,
Route Probe/Journey, Semantic Lens, relationship pinning, chapter replacement,
resize replacement, and page visibility changes cancel the current story camera
transaction. If Story playback is running, they pause it while preserving the
current beat and elapsed dwell. Resume recomputes the semantic window from the
current beat; it does not continue toward a stale pixel target.

Use the existing generation counters and camera transaction settlement. A stale
`finished` callback must check both the story generation and current beat before
scheduling the next step.

### 7. Keep motion ownership singular

The Story owner should cover:

- the camera transaction;
- the current exact-edge pulse, when one unambiguous edge exists; and
- the finite dwell scheduler.

Do not run a story pulse while another semantic owner has replaced Story. Do not
allow authored trace, Signal Flow scan, or ambient header motion to compete with
the followed beat. Motion Governor already provides this precedence; Story
Follow must join it rather than add a second budget.

### 8. Retain complete static truth

The followed frame changes only the live viewer transform and existing emphasis
attributes. It never removes nodes, edges, labels, regions, or Story Trail data.
Show all and the existing `0` reset restore the complete overview. When playback
finishes, keep the destination beat statically framed; do not snap back
automatically.

For reduced motion or Motion Still:

- beat buttons, Previous/Next, receipts, and exact links remain usable;
- manual beat selection frames instantly;
- automatic Play is disabled, matching Route Journey's reduced-motion policy;
  and
- no pulse or animated camera is substituted with another moving effect.

### 9. Keep accessibility and URLs semantic

The current beat button retains `aria-current="step"`; the existing note remains
the polite receipt for manual changes. Camera movement never moves DOM focus to
the SVG. Focus entering the story controls pauses playback and does not silently
resume it.

Keep `#view=<view-id>&beat=<node-id>` unchanged. The exact semantic moment is
enough to reconstruct the frame. Do not add `camera`, `zoom`, `x`, `y`,
`playing`, `elapsed`, or `follow` URL parameters.

Embed may honor an explicitly linked `view + beat` as one static instant frame,
but it must not autoplay; an unqualified embed stays at overview. Print and
standalone SVG export always use the complete authored diagram and strip live
viewer transforms and transient overlays.

## Implementation boundary

Expected scope:

- one shared Story-to-Camera request path in
  [`archify/assets/template.html`](../archify/assets/template.html);
- one story-owned caller of the existing public `Archify.view.reveal` method,
  with no duplicated fitting math;
- a per-beat dwell constant and generation-safe scheduling;
- Motion Governor integration for story camera ownership;
- focused shared-template tests; and
- regenerated examples / Proof Lab artifacts for browser validation.

Explicit non-goals:

- no schema or JSON IR change;
- no renderer-specific code;
- no new toolbar button, panel, mini-map, tour DSL, or default-view field;
- no graph engine, animation library, or runtime dependency;
- no node/edge cloning for foreground z-order in this slice;
- no topology collapse, re-layout, edge bundling, or scene boards;
- no cold-open animation; and
- no canonical SVG, PNG, print, or embed-state mutation.

## Acceptance evidence

### Contract tests

- all five typed renderers inherit Story Follow through the shared template;
- first, middle, and final beats resolve the correct two- or three-node window;
- exact forward, exact reverse, parallel-edge, self-loop, and grouped/no-edge
  steps never invent topology;
- one story camera transaction replaces the previous transaction;
- stale timers and settlement callbacks cannot advance an old beat;
- manual pan/zoom pauses playback and preserves the current beat;
- Still/reduced motion retain instant manual frames and disable Play;
- `#view=&beat=` restores one paused instant frame without focus theft or pulse;
- Show all/reset restores the complete overview; and
- exported SVG contains no live transform, Story Follow attribute, or overlay.

### Browser evidence

Validate at minimum:

1. the current tall eight-stop workflow in 1280×720 Presentation Stage;
2. a wide architecture chapter on desktop;
3. contained-scroll mobile at 390×844;
4. exact-moment reload and browser Back/Forward;
5. manual interruption during an in-flight camera transaction;
6. Live, Still, and OS reduced-motion modes;
7. explicit embedded `view + beat` and unqualified embed;
8. PNG, SVG, print, and Presentation exit; and
9. console cleanliness throughout repeated play/pause/resume cycles.

The visible pass criterion is simple: during the tall workflow story, the
current beat's two- or three-node neighborhood must be materially readable,
camera movement must settle before the next beat, and one manual pan must stop
the follow immediately without losing the semantic receipt.

## Final recommendation

**Borrow** subset fitting, explicit padding/zoom caps, finite step controls,
transaction cancellation, and return-to-overview behavior.

**Adapt** them into a Story Follow Camera over Archify's existing stable IDs,
Story Beat truth, Semantic Camera, Route Journey timing discipline, Motion
Governor, and exact-moment URLs.

**Skip** another overview, cold-open autoplay, inferred default chapters,
topology collapse, multi-board scenes, foreground cloning, serialized pixel
viewports, and any new graph or animation dependency.

Story Follow Camera is the highest-leverage next slice because it fixes the
observed legibility failure at the exact point Archify's narrative becomes most
valuable: one reader-started semantic moment inside a tall or dense technical
diagram.

## Source register

Primary sources accessed 2026-07-20:

- React Flow: [ReactFlow API](https://reactflow.dev/api-reference/react-flow),
  [FitViewOptions](https://reactflow.dev/api-reference/types/fit-view-options),
  [MiniMap](https://reactflow.dev/api-reference/components/minimap)
- Cytoscape.js: [Animations](https://js.cytoscape.org/#animations)
- D3: [Transition control](https://d3js.org/d3-transition/control-flow),
  [d3-zoom](https://d3js.org/d3-zoom)
- Structurizr: [Animation](https://docs.structurizr.com/ui/diagrams/animation),
  [Diagram viewer](https://docs.structurizr.com/server/diagrams/viewer),
  [DSL language](https://docs.structurizr.com/dsl/language#default)
- LikeC4: [Views](https://likec4.dev/dsl/views/),
  [Getting Started](https://likec4.dev/tutorial/)
- D2: [Steps](https://d2lang.com/tour/steps/),
  [Composition](https://d2lang.com/tour/composition/)
- W3C WAI: [Avoid Too Much Content](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p03-manageable-quantity/),
  [Make Important Information Easy to Find](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p04-page-important/),
  [Control Content Movement](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p01-motion/),
  [Let Users Go Back](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p02-back-undo/),
  [APG Carousel Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)
