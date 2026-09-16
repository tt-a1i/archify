# Visual Evolution Round 26 — Exact-edge Directional Flow Pulse

Research date: 2026-07-20 (Asia/Shanghai)

## Executive decision

Archify should add one **finite, source-to-target Directional Flow Pulse** to the
relationship row that Relationship Preview already owns.

- A fine pointer entering a row, or keyboard focus entering it, previews the
  exact relationship and plays one pass over the already-authored edge.
- The pass is short (target `1.0–1.3s`), has exactly one iteration, and removes
  its transient SVG overlay when it finishes or loses ownership.
- The authored edge, arrow marker, endpoint emphasis, row copy, node positions,
  route geometry, camera, schema, and IR remain unchanged.
- Touch does not simulate hover or require a two-tap mode. The existing large
  relationship row stays one predictable activation target and continues to
  navigate to the neighboring node.
- **Do not add a Replay button to every relationship row now.** Re-entry or
  re-focus is sufficient replay for an optional visual explanation. A per-row
  replay control would duplicate tab stops, compete with the row's existing
  navigation action, and either require invalid nested interactive content or a
  noisier split-control layout.

This is a motion *explanation*, not motion *content*. Direction remains fully
legible after the pulse and when all animation is disabled.

## Current Archify evidence

The recommendation fits the viewer that exists today rather than inventing a new
surface:

- Every renderer already emits stable relationship hooks:
  `data-edge-key`, `data-edge-from`, and `data-edge-to`.
- [`template.html`](../archify/assets/template.html) already resolves each
  Relationship Lens row to one exact edge key and its real source and target.
  Pointer hover and keyboard focus own temporary Relationship Preview; row
  activation follows the neighboring node.
- The existing row is itself a `<button>`. Its visible `OUT →`, `← IN`, or
  `LOOP` label, relationship label, arrow marker, source/target color, and exact
  edge highlight already convey the complete static meaning.
- Intent Trace, Route Probe, Story Trail, and Semantic Lens already establish a
  reusable viewer-only overlay pattern: clone edge geometry, keep it
  pointer-transparent and `aria-hidden`, arbitrate one owner, and strip it from
  canonical export.
- Round 25 made passive Intent Trace and Semantic Flow finite. The relationship
  pulse should reuse that restrained grammar rather than add a new perpetual
  animation system.

No renderer, schema, compiler, layout algorithm, or runtime dependency is
missing. The product gap is only exact-edge motion feedback at the moment a
reader asks for it.

## Primary-source findings

### 1. fireworks-tech-graph: borrow the packet head and ownership discipline, not the loop

The inspected first-party snapshot is
[`yizhiyanhua-ai/fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44).
Its public motion contract is a validated semantic-SVG-to-GIF pipeline. The
default artifact is a 5.75-second, 20fps, 115-frame GIF that loops infinitely;
it is not a live selection behavior
([motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L1-L36)).

The useful visual primitive is smaller than that delivery system. After an edge
draws in, Fireworks creates a marker-free stream body and a brighter, shorter
packet head on the same source geometry. Both advance in the authored
source-to-target direction. The head sits immediately ahead of the body; nodes,
labels, regions, marker geometry, and camera do not move
([timeline and visual contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L38-L52),
[body/head implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L987-L1117)).

The implementation also models strong overlay ownership:

- motion lives in a dedicated `aria-hidden`, pointer-transparent group inserted
  before the node layer;
- clones lose IDs and all source `data-*` identity;
- markers and filters are removed from motion clones; and
- every sampled frame asserts that the static DOM remains unchanged
  ([overlay and clone preparation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L822-L919),
  [frame guard](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L2337-L2351)).

Its “finite capture” is real but should not be misread as finite playback. Frame
selection is bounded to `0..renderedFrameMax`, the renderer caps a request at 500
frames and 600 million rendered pixels, but the produced GIF still loops
infinitely
([bounded frame API](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L2341-L2351),
[render budgets](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L2735-L2782)).

**Archify inference:** borrow the one bright head, exact path direction, immutable
base DOM, bounded lifetime, and explicit cleanup. Do not borrow the body stream,
reset loop, scene metadata, Puppeteer/Chromium/FFmpeg pipeline, or whole-diagram
autoplay.

### 2. G6: animation belongs to an interaction or lifecycle stage

G6 treats hover or click feedback as element state, with styles attached to
states such as `active`, `selected`, `highlight`, and `inactive`. Edge animation
is separately configurable by lifecycle stage (`enter`, `update`, `exit`,
`show`, `hide`, `collapse`, `expand`) and can be disabled globally or per stage
([official edge state and animation reference](https://g6.antv.antgroup.com/en/manual/element/edge/base-edge)).

Its official path-in example computes the edge length and runs one 500ms dash
animation when a Connect action creates the edge. It does not turn all edges into
an ambient loop
([official example source](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/site/examples/animation/basic/demo/enter-edge-path-in.js#L3-L11),
[action that owns the animation](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/site/examples/animation/basic/demo/enter-edge-path-in.js#L36-L57)).

**Archify inference:** Relationship Preview entry is the owning lifecycle stage.
No durable “animation selected” state is needed once the pulse completes.

### 3. yFiles: decorate the graph; do not mutate it

yFiles explicitly separates selection, focus, and highlight decoration from the
graph elements they indicate. Highlighting is managed by a separate
`HighlightIndicatorManager`, and the official hover example clears the previous
decoration before adding the newly hovered edge plus its source and target nodes
([selection/focus/highlight model](https://docs.yworks.com/yfiles-html/dguide/view/view_selection.html),
[official hover-decoration example](https://docs.yworks.com/yfiles-html/dguide/customizing_view/custom_item_indication.html)).

Its `ItemHoverInputMode` exposes both the new item and `oldItem`, including `null`
when the pointer leaves, which makes ownership transfer and teardown first-class
([ItemHoverInputMode events](https://docs.yworks.com/yfiles-html/api/ItemHoverInputMode.html)).
The CSS item-style guide also warns that visually changing edge width can diverge
from the library's hit testing and that exported SVG needs explicit stylesheet
handling
([CSS item-style caveats](https://docs.yworks.com/yfiles-html/dguide/styles-css_item_class/)).

**Archify inference:** keep the original edge as the hit target and semantic
artifact. A pointer-transparent overlay may be brighter, but it must not change
edge hit geometry, labels, markers, or export bytes.

### 4. Sigma: edge hover is opt-in and identity-bound

Sigma exposes distinct `enterEdge`, `leaveEdge`, and `clickEdge` events. Their
payload contains the stable edge ID, and edge hover/click/wheel events are
disabled by default unless the application explicitly enables them
([official event reference](https://www.sigmajs.org/docs/advanced/events/)).

This is an important restraint: edge feedback is a reader-requested mode, not a
background assumption. Archify already has a better hit target—the named
relationship row—so it should not enable direct thin-edge picking merely to start
the pulse.

### 5. Cytoscape.js: mouse preview and touch activation are different contracts; cleanup is work

Cytoscape documents `mouseover`/`mouseout` separately from touch events and also
offers normalized `tap` events for click-or-touch activation. This supports a
fine-pointer preview plus a direct touch activation, rather than pretending a
touchscreen has durable hover
([official input-event reference](https://js.cytoscape.org/#events/user-input-device-events)).

Its animation API requires active cleanup: `ani.stop()` removes the animation
from associated queues, improves per-frame work, and allows garbage collection;
collection `stop(clearQueue, jumpToEnd)` and `clearQueue()` are explicit
([animation stop contract](https://js.cytoscape.org/#ani.stop),
[element animation cleanup](https://js.cytoscape.org/#eles.stop)).

**Archify inference:** a CSS-only one-shot is smaller than a queued animation
runtime, but it still needs equal ownership hygiene: remove the previous overlay
before starting a new one, and remove completed/cancelled overlays rather than
leaving inert clones in the SVG.

### 6. SVG and CSS provide the zero-dependency primitive

SVG 2 defines `pathLength` as author calibration for distance-along-path
operations, including stroke operations. Setting `pathLength="1"` on a clone lets
the same normalized dash grammar work across short, long, bent, and curved edges
without per-frame `getPointAtLength()` calls
([SVG 2 path-length definition](https://svgwg.org/svg2-draft/paths.html#PathLengthAttribute)).

CSS Animations defines `animationend` for a completed animation and
`animationcancel` for cancellation such as an ancestor becoming `display:none`.
One owner can listen for both and remove its overlay; state-exit cleanup remains
necessary because cancellation can occur before completion
([CSS Animations event model](https://drafts.csswg.org/css-animations/#events)).

This supports a deterministic implementation with one cloned shape, one class,
one finite CSS animation, and no render loop, timer farm, layout pass, network
fetch, worker, canvas, or dependency.

### 7. Accessibility and HTML semantics argue against a per-row Replay control

WCAG 2.2 requires non-essential interaction-triggered motion to be disableable
and recognizes `prefers-reduced-motion` as the relevant mechanism. Its pause/stop
guidance lists animation that ends within five seconds as a sufficient pattern
([Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions),
[Pause, Stop, Hide techniques](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html),
[Media Queries preference](https://drafts.csswg.org/mediaqueries-5/#prefers-reduced-motion)).

Focus itself must not trigger a change of context. A temporary visual pulse is
compatible with that requirement only because it does not navigate, move focus,
change the viewport, or alter meaning; Enter/Space remains the explicit
navigation action
([WCAG On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus)).

An Archify relationship row is already a button. The HTML Standard forbids
interactive descendants or descendants with `tabindex` inside a button
([button content model](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element)).
A sibling Replay button would be conforming HTML, but it would double row targets
and focus stops. WCAG's focus-order guidance specifically warns about controls
that appear to receive focus multiple times, while its target-size guidance would
require the extra target to retain adequate size/spacing
([Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order),
[Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)).

Because motion carries no unique information, that cost has no corresponding
reader benefit today.

## Replay-affordance decision

### Build now: automatic one-shot on true preview entry

Use one-shot playback when the active relationship changes from none/another key
to this key:

- `pointerenter` semantics for a fine, hover-capable pointer;
- `focusin` for keyboard navigation;
- re-entry or leaving and focusing again intentionally replays;
- moving between descendants of the same row does not replay; and
- a parked pointer or focus never loops or periodically retriggers.

The existing row remains one control with one primary action: preview on entry,
follow the relationship on activation. This mirrors the existing node model
(preview before commitment) and preserves fast scanning.

### Do not build now: a Replay button on every row

Reject all three obvious variants:

1. **Nested replay icon:** invalid inside the existing button.
2. **Sibling split button:** adds visual chrome and a second focus/touch target to
   every relationship even though the animation is redundant.
3. **Change row click to replay first, navigate second:** surprising two-step
   touch behavior and a regression from current direct navigation.

### Later, only if evidence demands it

If usability testing shows that readers deliberately want repeated direction
inspection, add at most **one contextual “Replay direction” action** in the Lens
header or preview footer while a relationship is active. It must not be repeated
inside every row, must remain a separate valid button, and must not be required to
understand the relationship. Instrumented demand or repeated user reports should
precede this addition.

## Concrete interaction contract

1. The relationship row remains the sole hit target and navigation control.
2. Preview entry resolves the exact existing `data-edge-key`; it never guesses by
   endpoint pair or label.
3. Motion direction always follows compiled `data-edge-from → data-edge-to`, even
   for an incoming row. “Incoming to the focused node” must not reverse the
   authored path.
4. Create at most one runtime `<g>` owned by Relationship Preview. It is
   `aria-hidden`, pointer-transparent, and inserted in the established edge
   overlay layer before nodes so packets appear to enter/leave endpoints rather
   than paint over cards and labels.
5. Clone only the matching edge's drawable `path`, `line`, or `polyline`. Preserve
   the owning group transform when necessary; do not copy labels, markers, IDs,
   filters, roles, accessible names, hit areas, or semantic `data-*` identity.
6. Set `pathLength="1"`, keep the authored edge as the quiet rail, and animate one
   short rounded dash/head from source to target with normalized
   `stroke-dasharray` / `stroke-dashoffset`.
7. Use the current preset vocabulary rather than introduce a new theme system:
   Classic is restrained, Signal Flow may be slightly brighter, and Blueprint is
   square-capped and filter-free.
8. Duration targets `1.0–1.3s`, linear travel, iteration count `1`, no long delay,
   no alternate/reverse pass, no `infinite`, and no automatic restart while the
   same preview owner remains active.
9. On `animationend` or `animationcancel`, remove the pulse overlay but keep the
   static exact-edge and endpoint preview until the row itself loses ownership.
10. Starting another row atomically removes the old pulse and preview before
    installing the new owner. At no time may two relationship pulses coexist.
11. Clear the overlay on pointer/focus exit, Focus clear, Escape, relationship
    navigation, Lens/Route/Story takeover, page hiding, embed entry, print, and
    viewer teardown.
12. Under `prefers-reduced-motion: reduce`, create no moving pulse. Retain the
    current static preview, arrow, direction word, edge label, and endpoint colors.
    If the preference changes while open, remove any active pulse immediately.
13. Coarse/touch pointer events do not start hover motion. Tap/click continues to
    activate the relationship row once, without long press or a preview-only first
    tap.
14. Canonical SVG and all raster/video export paths remove the runtime group and
    report canonical state as clean. Print and embed never expose the overlay.
15. The feature owns no URL/hash state, schema/IR field, renderer-specific branch,
    camera action, viewBox mutation, node movement, route recalculation, or runtime
    dependency.

## Borrow now / Later / Skip

### Borrow now

- Fireworks' bright packet head on fixed, authored source-to-target geometry.
- Fireworks' marker-free, filter-light, identity-stripped decoration clone and
  static-DOM invariant.
- G6's interaction/lifecycle ownership: the event starts a bounded visual stage.
- yFiles' separate decoration manager mental model and old-owner-before-new-owner
  teardown.
- Sigma's opt-in edge feedback and stable edge identity.
- Cytoscape's separate hover vs normalized touch activation and explicit cleanup
  mindset.
- SVG `pathLength="1"`, a single finite CSS animation, reduced-motion suppression,
  and canonical export stripping.

### Later, after evidence

- One contextual replay action for the currently previewed relationship, only if
  user testing shows a real repeat-inspection need.
- A distinct self-loop head treatment only if normalized dash motion proves
  visually ambiguous on current loop geometries.
- Very small preset-specific differences that preserve the same timing and
  meaning; verify them against real gallery artifacts before keeping them.
- A shared internal overlay utility after the relationship pulse proves that
  Intent Trace, Semantic Flow, Route Probe, and Relationship Preview truly have
  enough stable common behavior. Do not refactor first merely for symmetry.

### Skip

- Per-row Replay buttons, nested controls, split-button rows, and two-tap touch
  preview modes.
- Infinite or ambient relationship motion; particle showers; random phases;
  multiple packets; whole-graph synchronized blinking; moving nodes, labels,
  boundaries, or camera.
- Direct thin-edge picking or enlarged invisible edge hit targets when the named
  relationship row already provides a better accessible target.
- Reversing incoming edges toward the currently focused node, because that lies
  about authored direction.
- Copying Fireworks' body stream, scene-specific trains/cards/cursors, reset
  timeline, GIF loop, motion metadata, Chrome/Puppeteer/FFmpeg pipeline, or
  per-frame geometry sampling.
- New schema/IR/compiler fields, layout passes, Canvas/WebGL graph engines,
  timers, workers, network calls, or dependencies.
- Any motion state in print, embed, canonical SVG, PNG/JPEG/WebP, copied PNG, or
  other portable artifacts.

## Acceptance criteria

1. All five typed renderers inherit Directional Flow Pulse through the shared
   template and existing edge hooks; no renderer-specific relationship registry
   and no schema/IR change exists.
2. A relationship row resolves exactly one stable `data-edge-key`; duplicate
   endpoint pairs and duplicate labels cannot select the wrong source edge.
3. The pulse travels from real `data-edge-from` to real `data-edge-to` for
   outgoing, incoming, reverse-layout, bent, curved, straight, and self-loop
   relationships.
4. Pointer entry plays only for a fine, hover-capable pointer. Touch/coarse input
   does not synthesize an ambient preview or require a second tap.
5. Keyboard `focusin` plays the same single pulse without navigating, moving
   focus, scrolling the camera, changing the URL, or announcing redundant motion
   content.
6. Each true owner entry creates no more than one overlay group and one cloned
   drawable per source-edge representation. Moving among a row's child spans does
   not restart it.
7. A parked pointer or focus produces exactly one iteration. No pulse CSS uses
   `infinite`; total motion ends well below five seconds.
8. Re-entering or leaving and re-focusing may replay. Repeated event bubbling for
   the same active row may not.
9. The cloned shape preserves exact geometry and required owner transform, has
   `pathLength="1"`, and contains no original ID, edge key/from/to/label, marker,
   filter, role, accessible name, tabindex, or pointer hit target.
10. The original edge subtree, marker, label, coordinates, transform, path data,
    dash variant, node positions, viewBox, and camera remain unchanged before,
    during, and after playback.
11. Relationship Preview remains fully understandable after the overlay removes:
    row direction text, relationship label, arrow, exact edge highlight, and
    source/target emphasis all remain visible.
12. A new preview owner atomically clears the old overlay. Pointer/focus exit,
    Focus clear, Escape, route/story/lens takeover, page hiding, and teardown each
    leave zero relationship-pulse overlays.
13. `animationend` and `animationcancel` cleanup are both covered so a hidden or
    cancelled animation cannot leave a stale clone.
14. `prefers-reduced-motion: reduce` starts no moving pulse and switching to reduce
    during playback removes the active overlay while preserving static meaning.
15. Classic, Signal Flow, and Blueprint show distinct but restrained treatments;
    Blueprint has no glow/filter. None changes timing, direction, or geometry.
16. Embed and print contain zero visible pulse overlays and no replay-only control.
17. Canonical SVG serialization strips the overlay and transient attributes, and
    its canonical-state receipt stays `true` when export occurs mid-pulse.
18. PNG, JPEG, WebP, copied PNG, and any motion-capture/export path cannot capture
    Relationship Preview's transient pulse as authored diagram content.
19. The relationship row remains one valid `<button>` with one predictable click,
    Enter, and Space activation. There is no nested interactive descendant and no
    duplicate per-row replay tab stop.
20. The implementation introduces no dependency, fetch, timer farm,
    `requestAnimationFrame` loop, `getPointAtLength()` animation loop, worker,
    canvas, layout recomputation, URL state, or schema/IR field.
21. Automated tests cover source-to-target direction, exact stable-key matching,
    one iteration, one-owner replacement, child-event deduplication, touch gating,
    reduced motion, cancellation cleanup, and canonical export cleanliness.
22. In-app browser validation exercises at least one incoming and one outgoing
    relationship, a bent/curved route, keyboard row traversal, repeated re-entry,
    reduced-motion static fallback where emulation is available, export during an
    active pulse, and console errors. Visual review confirms that the head is
    noticeable at normal zoom without obscuring labels or endpoints.

## Expected reader outcome

The diagram should feel alive only when life answers a question. A reader moves
onto “writes orders → PostgreSQL”, sees one packet travel along that exact real
edge toward PostgreSQL, and then the diagram becomes still again. The motion
confirms direction; the stable graph remains the product.
