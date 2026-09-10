# Visual Evolution Round 39 — Story Horizon

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build **Story Horizon**: a restrained, static preview of the one immediate
next Story Beat.

Archify's story system can now explain the present unusually well. Story Follow
Camera frames the previous, current, and next authored stops; Story Director
Strip names the current route, relationship, responsibility, and context; the
Story Trail preserves the past; exact moment links restore one stable beat; and
Presentation Stage removes most playback chrome. The remaining visual gap is
not another missing control. It is that the diagram does not distinguish the
immediate future from the rest of the future.

The current beat state is only:

```text
past -> active -> pending -> pending -> ...
```

Round 39 should make it:

```text
past -> active -> next -> pending -> ...
```

`next` must be derived only from the next stable ID in the current authored
story. It should make the next node and any exact authored connector(s)
discoverable without moving the camera early, synthesizing an edge, changing
the diagram, or adding a new panel. The result is a clearer visual time axis:
the reader sees where they are, what remains behind them, and where the story
will go next before the camera moves.

## Why this is the highest-leverage next slice

### Current worktree evidence

The shared viewer already records every story node as `data-story-step` and
every exact story connector as `data-story-beat-step`. However,
`setStoryBeat()` currently classifies both with the same three-way ternary:
`past`, `active`, or `pending`
([viewer implementation](../archify/assets/template.html)).

The current CSS then makes:

- pending story nodes `0.22` opacity and pending story edges `0.16` opacity;
- past nodes `0.72` and past edges `0.58`; and
- the active node and edge fully visible.

This hierarchy explains history and the current moment, but every future stop
looks equally remote. That is especially visible because Story Follow already
frames `previous + current + next`: the camera deliberately reserves room for
the next stop, while its presentation state still looks like any other pending
node
([Story Follow contract](../archify/test/story-follow-camera.test.mjs)).

The current 11 Proof Lab artifacts contain 33 authored chapters, 150 resolved
story stops, and 117 non-final transitions. Re-reading their current compiled
HTML gives 80 single forward transitions, 1 single reverse transition, 4
multiple-edge transitions, and 32 grouped transitions with no direct authored
edge. So Story Horizon has a real state to show on 117 beats, and it has concrete
cases proving why it must not invent a connector. The 33 final beats must show
no horizon at all.

### Product consequence

Story Horizon improves perceived polish through anticipation, not decoration.
The reader can see a bounded destination before the next scene change, which
makes the camera move feel intentional and encourages another step. It also
strengthens paused, manually selected, shared, mobile, Still, and reduced-motion
states because the future cue remains useful without animation.

Another toolbar, minimap, inspector, style preset, playback mode, or ambient
motion layer would compete with surfaces Archify already has. Story Horizon
instead increases the value of Story Follow and Story Director by completing
their temporal hierarchy.

## Primary-source comparison

### Fireworks Tech Graph: sequence the semantic change, keep the scene stable

At current fixed commit
[`50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44),
Fireworks draws existing routes in semantic order, keeps nodes, labels,
containers, marker geometry, and the camera fixed, and holds the completed
topology long enough to inspect. Its motion contract also explicitly excludes
many decorative effects from reviewed scenes
([official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md),
[official repository](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)).

**Borrow:** one semantic route owns attention at a time; immutable diagram
geometry remains the visual world; every moving sequence has a settled state.

**Adapt:** Archify should create expectation with one static immediate-next
state inside its live viewer rather than render another GIF timeline. The
existing Story Follow transaction remains the only camera owner.

**Skip:** animated particles, additional style catalogues, halos, ripples,
background motion, a frame renderer, and an infinite loop.

### Structurizr: authored reveal plus explicit reader control

Structurizr animations reveal authored elements or relationships in steps and
retain previous/next and keyboard control. Presentation mode removes toolbar
chrome so the diagram remains primary
([official animation documentation](https://docs.structurizr.com/ui/diagrams/animation),
[official presentation documentation](https://docs.structurizr.com/ui/diagrams/presentation)).

**Borrow:** authored order, discrete steps, and a readable current scene.

**Adapt:** unlike a strict reveal, Archify should retain its stable topology and
show one future stop as orientation. `next` is a viewer perspective over the
same authored SVG, not a new view or model fact.

**Skip:** completely hiding every future element, adding a perspective picker,
or creating a separate presentation artifact.

### LikeC4: dynamic steps remain separate from the architecture model

LikeC4 dynamic views define ordered, reverse, continuous, and parallel steps;
steps can carry notes and navigation while staying within a view rather than
polluting the underlying model. Its renderer exposes walkthrough as a viewer
capability
([official dynamic-view documentation](https://likec4.dev/dsl/views/dynamic/),
[official React viewer documentation](https://likec4.dev/tooling/react/)).

**Borrow:** preserve authored direction and multiplicity; keep walkthrough
state separate from architecture truth.

**Adapt:** reuse Archify's existing `forward`, `reverse`, `multiple`, and
`grouped` Story Step classification. A grouped transition may preview the real
next node but must show no connector; a multiple transition may preview only
the exact authored edge set already resolved by that step.

**Skip:** another DSL, a dynamic-view runtime, Mantine/XYFlow, or a new schema
for a fact that already exists in `meta.views[].focus`.

### D2: progression should inherit context and remain bounded

D2 `steps` inherit from the preceding board, while layers and scenarios use
different inheritance rules. Its export guidance warns that too many animated
boards can make readers confused or force them to wait through a loop
([official composition model](https://d2lang.com/tour/composition/),
[official steps](https://d2lang.com/tour/steps/),
[official composition formats](https://d2lang.com/tour/composition-formats/)).

**Borrow:** keep already established context while introducing one bounded
increment.

**Adapt:** `past` is inherited context, `active` is the current increment,
`next` is the one foreseeable increment, and all later stops remain pending on
one stable canvas.

**Skip:** board replacement, multi-file scenes, autoplaying animated SVG/GIF,
and composition semantics in Archify's source schema.

### React Flow: frame the current semantic target, not the whole graph

React Flow's official slideshow tutorial focuses the initial and current slide
with a node-subset `fitView`, then supports click, explicit controls, and
keyboard navigation. Its `FitViewOptions` accepts an exact node subset, padding,
zoom bounds, duration, easing, and interpolation
([official slideshow tutorial](https://reactflow.dev/learn/tutorials/slide-shows-with-react-flow),
[official fit-view options](https://reactflow.dev/api-reference/types/fit-view-options)).

**Borrow:** current-step framing uses explicit semantic IDs; navigation state is
explicit and user-operable.

**Adapt:** retain Story Follow's existing `previous + current + next` subset.
Story Horizon supplies spatial expectation inside that frame; it must not move
the viewport toward the next node before the beat changes.

**Skip:** a slide-grid layout, draggable canvas data, React state, and the React
Flow dependency.

### Cytoscape.js and D3: newest intent wins; do not create an animation queue

Cytoscape.js can fit a viewport to a selected element collection, animate that
fit with explicit duration, and stop/clear queued viewport animations. D3
specifies that a same-name transition interrupts the active transition and
cancels earlier pending transitions
([official Cytoscape.js viewport and animation API](https://js.cytoscape.org/#animations),
[official D3 transition control flow](https://d3js.org/d3-transition/control-flow)).

**Borrow:** rapid manual navigation must leave only the latest current/next
state and camera receipt alive.

**Adapt:** Story Horizon itself is static. `setStoryBeat()` writes the whole
temporal state atomically; the existing camera generation/cancellation contract
continues to own movement.

**Skip:** ghost copies, springs, default-state transitions, animation queues,
and either dependency.

### W3C: preserve meaning without requiring motion

The WAI carousel pattern requires explicit previous/next and stop/restart
control for automatic sequences. WCAG's animation guidance recommends honoring
motion preferences and eliminating unnecessary movement
([official carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/),
[official animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions),
[Media Queries 5 `prefers-reduced-motion`](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)).

**Borrow:** a story must remain understandable when automatic movement is
paused or removed.

**Adapt:** keep the same static `next` hierarchy in Live, Still, and
`prefers-reduced-motion`. Do not add another automatic `aria-live`
announcement; Story Director remains the sole spoken current-step explanation.

**Skip:** auto-start, hover-triggered progression, and a looping attention
effect.

## Borrow / Adapt / Skip summary

| Decision | Round 39 contract |
| --- | --- |
| Borrow | One semantic change owns attention; previous/current/next are discrete and reader-controlled. |
| Borrow | Explicit semantic IDs determine both viewport framing and narrative state. |
| Borrow | The diagram remains useful when motion is paused or removed. |
| Adapt | Add exactly one `next` state to the existing Story Beat state machine. |
| Adapt | Preserve real forward, reverse, multiple, and grouped truth. |
| Adapt | Keep Story Follow as the only camera owner and Story Director as the only spoken caption owner. |
| Skip | Another panel, minimap, editor, dependency, schema field, layout pass, or export format. |
| Skip | Infinite motion, particles, breathing glows, early camera drift, or cloned future topology. |

## Unique recommendation: Story Horizon

### Minimum implementation contract

1. In `setStoryBeat(index)`, classify story nodes and exact story edge elements
   atomically as `past`, `active`, `next`, or `pending`.
2. `next` means only `step === storyBeatIndex + 1`. There is at most one next
   story node; the final beat has none.
3. For an exact forward or reverse transition, mark the already resolved
   authored connector element(s) for that next step. Never reverse SVG geometry
   or rewrite its label, marker, or dash pattern.
4. For `multiple`, mark every exact authored connector already contained in the
   next `storyStep.edges` set. For `grouped`, mark the next node and no edge.
5. Use opacity and saturation as the primary visual ordering. A safe starting
   hierarchy is `active 1.00 > past 0.72 > next 0.50 > pending 0.22` for nodes
   and `active 1.00 > past 0.58 > next 0.34 > pending 0.16` for exact story
   edges. Tune only after browser readback across all presets.
6. Do not change the authored edge's stroke, dash array, marker, label, or path.
   If a non-color cue is needed, use a small static viewer-only bracket/ring
   around the next node, not a replacement connector and not a looped glow.
7. Add a short `Next · <existing node label>` suffix to the existing Story
   Director detail only if it fits without adding a row or increasing the
   Presentation HUD height. On narrow mobile, visual node state is sufficient;
   truncation must not hide current-step facts.
8. Applying a manual beat, Play, Pause, previous/next, and exact
   `#view=<id>&beat=<node-id>` restoration must produce the same state before the
   first painted frame. No autoplay is introduced.
9. Story Follow may continue to frame previous/current/next, but it must not
   pre-pan, pre-zoom, or pulse the next node. The camera moves only when that beat
   becomes current.
10. Live, Still, and reduced-motion share the same static next state. Still and
    reduced-motion add no pulse, scale, pan, or transition.
11. Clear all next state on final beat, Show all, chapter replacement, focus or
    route takeover, print, export, and viewer teardown.
12. Keep ordinary embed behavior unchanged; a story-enabled shared embed may
    inherit Horizon only through its existing explicit story boundary.

### Explicit non-goals

- no chapter autoplay or cold-open animation;
- no default chapter inference;
- no future-path routing, graph prediction, or transitive-edge inference;
- no branch chooser, timeline scrubber, thumbnail strip, or new card;
- no new semantic state in the canonical SVG or JSON schema;
- no topology reveal/hide, layout change, or cloned graph; and
- no ambient, infinite, or independently scheduled animation.

## Failure modes to prevent

1. **All future nodes become bright.** The feature loses its horizon meaning
   and restores the same visual noise it was meant to remove.
2. **The next state outranks the current state.** A glow or high opacity steals
   attention from the actual beat.
3. **Past context becomes weaker than next.** The reader loses the route already
   taken; temporal hierarchy should stay `active > past > next > pending`.
4. **A grouped transition gains a synthetic connector.** This creates a false
   architecture fact.
5. **One edge is guessed from a multiple transition.** This hides real
   multiplicity and makes the story nondeterministic.
6. **A new dashed preview line overwrites semantic dash meaning.** Async, read,
   write, security, and failure relationships may already use line style as
   authored meaning.
7. **The camera drifts early.** The reader's current subject moves before their
   intent changes.
8. **Fast stepping leaves stale next state or stale camera completion.** Latest
   reader intent must win atomically.
9. **Exact moment restoration flashes the wrong next node.** Restoration must
   resolve current and next before presentation becomes visible.
10. **The final beat retains a horizon.** This falsely implies the story is not
    complete.
11. **A new caption line regrows the Round 38 HUD.** The canvas-height gain must
    remain intact.
12. **Viewer state leaks into export.** Canonical SVG, PNG, print, and normal
    embed must remain clean.

## Acceptance criteria

1. All five typed renderers inherit one shared Story Horizon implementation.
2. Every non-final beat has exactly one logical next node; every final beat has
   zero.
3. Current Proof Lab coverage proves forward, reverse, multiple, grouped, and
   final cases using authored facts only.
4. Exact story edges receive `next` only when already resolved for that step;
   grouped transitions receive no connector preview.
5. Visual hierarchy is readable in Classic, Signal Flow, and Blueprint without
   depending on glow or color alone.
6. Play, Pause, manual beat activation, previous/next, reverse navigation, and
   exact moment restoration produce identical deterministic state.
7. Rapid repeated beat changes leave no stale state and no stale Story Follow
   camera completion.
8. Story Follow moves only for the active beat; Horizon remains a static
   orientation cue.
9. Still and `prefers-reduced-motion` show the same semantic hierarchy with no
   pulse, zoom, pan, or transition.
10. At 390px mobile width, Story Horizon adds no horizontal overflow, no new
    control row, and no loss of 44px touch targets.
11. Presentation playback keeps the Round 38 compact HUD height; Pause and
    previous/next remain operable.
12. Ordinary embed, print, canonical SVG, SVG/PNG export, and clean serialization
    contain no Horizon runtime state or viewer overlay.
13. In-browser readback covers start, middle, final, forward, reverse, multiple,
    grouped, exact-link, Still, reduced-motion, mobile, and export states with
    zero console warnings or errors.

## Decision

Implement Story Horizon now. It is the smallest truthful change that makes the
existing story system feel more cinematic: not by adding more animation, but by
turning the canvas into a readable past-present-future composition. It directly
amplifies Story Follow Camera and Story Director Strip, remains useful without
motion, and preserves Archify's strongest product boundary—one stable,
inspectable, deterministic artifact.
