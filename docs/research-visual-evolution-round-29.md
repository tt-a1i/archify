# Visual Evolution Round 29 — Motion Governor

Date: 2026-07-20
Status: research recommendation for the next bounded viewer slice

## Executive decision

Build a **Motion Governor** before adding another chapter transition effect.

Archify now has enough good motion primitives. Its next visual-quality problem is
that they do not yet have one conductor. A normal artifact can run a header pulse,
Signal Flow scan, authored trace edges and nodes, and a reader-triggered story or
route signal at the same time. Guided Story playback owns its own timer, but it
does not own the rest of the page's motion budget. The result can look busy at the
exact moment a chapter is supposed to become clear.

The next slice should therefore add:

1. one visible `Live` / `Still` control near the top of the artifact;
2. one viewer-level motion mode, initialized before first paint;
3. one replaceable motion owner at a time;
4. automatic suppression of ambient motion while a chapter, focus, route, lens,
   or bounded preview owns the reader's attention;
5. complete static fallbacks that preserve every semantic state;
6. a dynamic reduced-motion and page-visibility response;
7. no schema, renderer geometry, graph copy, dependency, or export-state change.

This is not an accessibility-only cleanup. It improves the product's visual
hierarchy: when Story Trail moves, only the story moves; when the reader asks a
route question, only the route answers; when the reader chooses Still, the same
beautiful artifact remains completely readable.

The promising **shared-anchor Chapter Handoff** belongs immediately after this
foundation. Adding it first would introduce another transition into a viewer that
still has ungoverned infinite motion.

## Scope and method

This recommendation is based on:

- the current `codex/archify-visual-evolution` worktree, not an older package;
- the complete visual-evolution trail: the initial Fireworks review plus Rounds
  2–28;
- current viewer CSS and runtime ownership paths;
- fixed open-source commits and official standards/product documentation;
- the existing Archify boundary: one deterministic self-contained HTML artifact,
  one canonical SVG, zero runtime dependencies, stable semantic IDs, and no
  layout mutation in viewer interactions.

No source, schema, fixture, generated artifact, or test was changed during this
research. This document is the only Round 29 file.

## What Rounds 1–28 already cover

The existing research is unusually complete. The next slice must not rename or
duplicate one of these layers.

| Rounds | Existing product surface |
|---|---|
| Initial review, 2 | Fireworks comparison; stable IDs; focus; gallery; bounded guided views |
| 3 | timed Play/Pause over existing views |
| 4–5 | question-first recipes and one generated proof per recipe |
| 6 | Classic / Signal Flow / Blueprint identities and wide-mobile containment |
| 7 | Presentation Stage over the live artifact |
| 8 | Semantic Node Finder |
| 9 | proof-first landing stage |
| 10–11 | Relationship Lens and exact-edge preview |
| 12 | Semantic Camera with bounded desktop fitting and contained-mobile scroll |
| 13 | path-aware Story Trail |
| 14–16 | one-shot share playback, Share Chapter Cue, and Semantic Story Beats |
| 17 | Semantic Passport |
| 18 | Semantic Radar |
| 19 | finite Intent Trace |
| 20–21 | Route Probe and searchable endpoints |
| 22 | Diagram Guide |
| 23 | Reading Depth / semantic zoom |
| 24 | Semantic Lens |
| 25 | finite selection-triggered Semantic Flow and finite Intent Trace |
| 26 | finite exact-edge Relationship Pulse |
| 27 | selective Semantic Legend Bridge |
| 28 | Named Chapter Rail |

The pattern across the later rounds is already clear: motion should answer an
explicit question, have one owner, be finite where possible, and leave the
canonical graph untouched. That discipline exists inside several individual
features, but not yet at the whole-viewer level.

## Current Archify evidence

### The viewer has several independent animation clocks

The shared template currently declares these visible moving surfaces:

| Surface | Current trigger | Current lifetime | Semantic role |
|---|---|---:|---|
| `.pulse-dot` | every normal artifact | `2s infinite` | decorative live status |
| Signal Flow scan | every Signal Flow artifact | `6s infinite` | decorative preset atmosphere |
| Semantic Radar live dot | Radar open | `2.4s infinite` | orientation-panel status |
| Route Probe flow | a route result | `1.45s infinite` | exact directed path |
| Story Trail flow | active Story playback | `0.78s infinite`, bounded by the story timer | current authored chapter |
| authored trace edges | `meta.animation = "trace"` | `2.4s infinite` | ambient whole-graph direction |
| authored trace nodes | `meta.animation = "trace"` | `3.6s infinite` | ambient active-node signal |
| Lens / Intent / Relationship pulses | explicit selection or preview | one finite pass | bounded reader question |

The declarations are visible in the current template's
[header and preset styling](../archify/assets/template.html#L519-L632),
[Radar styling](../archify/assets/template.html#L705-L752), and
[motion rules](../archify/assets/template.html#L2635-L2936).

Ten of the eleven proof fixtures currently opt into trace motion, and five of
those also use Signal Flow. The simultaneous-motion case is therefore a primary
product path, not an exotic combination.

### Guided Story does not own the ambient layer

The one-shot share path deliberately pauses authored trace through the
`data-share-playback` selector. Manual Story playback does the opposite: its
`startPlayback()` removes `data-share-playback`, activates the Story layer, and
starts the 3.2-second chapter timer. Authored trace can therefore continue under
Story Trail, while Signal Flow scan and the header pulse also keep running.

Relevant current paths:

- [ambient trace pause selectors](../archify/assets/template.html#L2933-L2936);
- [manual Story start](../archify/assets/template.html#L5467-L5483);
- [chapter activation and Semantic Camera reveal](../archify/assets/template.html#L5536-L5555).

This does not corrupt state, but it weakens direction. The reader sees more than
one moving explanation and must infer which motion belongs to the selected
chapter.

### Reduced motion is strong locally but incomplete globally

The current media query correctly disables Signal Flow scan, authored trace,
Story, Radar, route, Lens, preview, and camera/detail transitions. It does not
include `.pulse-dot`. Several runtime modules also call `matchMedia()`
independently, and only some listen for a live preference change.

The result is a collection of good per-feature fallbacks rather than one
inspectable effective policy. A user without an OS-level reduced-motion setting
also has no visible way to stop automatic motion.

See the current [reduced-motion block](../archify/assets/template.html#L2998-L3047)
and the feature-specific media-query reads around Guided Views, Intent Trace,
Relationship Pulse, and Semantic Camera.

### Hidden-page and embed ownership are partial

Guided playback already pauses on `visibilitychange`, which is correct. Ambient
CSS trace and decorative preset motion have no shared hidden-page state. Browsers
may throttle them, but Archify has not expressed an application invariant.

Embed mode hides most chrome and pauses authored trace, yet the Signal Flow
container scan is not governed by the embed trace selector. The normal embed
should be still; `?embed=1&play=1#view=...` should permit exactly the requested
bounded Story and nothing else.

### The existing `Archify.motion` name is already taken

`Archify.motion` is the public WebM recording surface with `canRecord()` and
`recordWebm()`. A governor must not replace or silently change this API. Use a
distinct owner such as `Archify.motionGovernor` and keep explicit motion export
separate from live-viewer preference.

See [the current recording implementation](../archify/assets/template.html#L3920-L4025)
and [animation contract tests](../archify/test/animation.test.mjs).

## Primary-source findings

### 1. WCAG requires a visible stop mechanism for long automatic motion

WCAG 2.2 Success Criterion 2.2.2 applies when moving or blinking content starts
automatically, lasts longer than five seconds, and appears alongside other
content. It requires a pause, stop, or hide mechanism unless the motion is
essential
([SC 2.2.2](https://www.w3.org/TR/WCAG22/#pause-stop-hide),
[Understanding 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)).

WAI Technique G186 is unusually direct for Archify: the control must be
keyboard-accessible, named, and near the top or adjacent to the motion, and **one
control may stop all moving or blinking content on the page**
([G186](https://www.w3.org/WAI/WCAG22/Techniques/general/G186)).

WCAG 2.3.3 also says non-essential motion triggered by interaction can be
disabled
([Animation from Interactions](https://www.w3.org/TR/WCAG22/#animation-from-interactions)).
It is Level AAA, but it matches Archify's stated quality target and existing
reduced-motion behavior.

**Borrow:** one obvious top-level control; all automatic movement must obey it;
interaction-triggered camera/pulse motion must have a static alternative.

**Do not borrow narrowly:** a Story Play/Pause button controls only Story. It is
not a sufficient whole-page stop mechanism for trace, scan, status pulse, Radar,
and route motion.

### 2. Media Queries and CSS Animations distinguish preference, pause, and stop

Media Queries Level 5 defines `prefers-reduced-motion: reduce` as a request to
remove or replace non-essential motion that can cause vestibular discomfort or
attention distraction
([Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)).

CSS Animations Level 1 defines `animation-play-state: paused` as retaining the
animation's current progress and resuming from that point later
([CSS Animations Level 1](https://www.w3.org/TR/css-animations-1/#animation-play-state)).
That is appropriate for a reader-paused semantic timeline. It is not always the
best treatment for atmosphere: a frozen half-invisible pulse or partial packet
can look broken. Ambient decoration should return to its complete static base;
finite runtime overlays should clean up; an intentionally paused Story should
retain its explicit semantic beat state.

**Borrow:** initialize from the OS preference before paint; centralize the live
media-query listener; distinguish stopping ambient decoration from freezing a
reader-owned semantic story.

**Skip:** a blanket `* { animation-play-state: paused }` as the whole contract.
It leaves stale overlay DOM and arbitrary partial visual phases.

### 3. Fireworks proves that motion is strongest when the changing area is small

The comparison remains pinned to
[`fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44).
Its reviewed motion contract keeps nodes, labels, containers, markers, and camera
fixed while routes draw and carry direction; the measured reference loops change
only a small percentage of the canvas
([motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L26-L52)).

That same artifact is an infinitely looping GIF, while its interactive HTML
viewer is a separate small pan/zoom/export surface. The viewer removes
transitions for reduced motion but exposes no page-level motion controller
([interactive viewer](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L223-L328)).

**Borrow:** fixed geometry, semantic direction, small moving area, validated
motion roles, and a clean viewer/export boundary.

**Skip:** treating an infinite showcase loop as the default live reading mode.
Archify's interactive artifact can offer reader control that a GIF cannot.

### 4. Mapbox shows that a new camera owner replaces the old one and motion is optional

The comparison is pinned to
[`mapbox-gl-js@e3dec292`](https://github.com/mapbox/mapbox-gl-js/tree/e3dec29241663b30725d13ae9a3b5c29e994db50).
Its animation options include `animate: false`, duration/easing, and an explicit
`essential` escape hatch. `easeTo()` stops the preceding ease before starting a
new one and reduces duration to zero when the preference requires it; `flyTo()`
falls through to an immediate jump
([camera options and implementation](https://github.com/mapbox/mapbox-gl-js/blob/e3dec29241663b30725d13ae9a3b5c29e994db50/src/ui/camera.ts#L100-L145),
[ease replacement](https://github.com/mapbox/mapbox-gl-js/blob/e3dec29241663b30725d13ae9a3b5c29e994db50/src/ui/camera.ts#L1324-L1459),
[reduced-motion fallback](https://github.com/mapbox/mapbox-gl-js/blob/e3dec29241663b30725d13ae9a3b5c29e994db50/src/ui/camera.ts#L1589-L1594)).

**Borrow:** replacement instead of stacking; zero-duration semantic completion;
camera motion must never be marked essential for a technical diagram.

**Skip:** dramatic fly arcs, prolonged zoom-out, inertial scene travel, or a
second persistent camera model. Archify's current 480ms bounded fit is enough.

### 5. reveal.js demonstrates stable matching and mandatory cleanup between transitions

The comparison is pinned to
[`reveal.js@a3b9406`](https://github.com/hakimel/reveal.js/tree/a3b940695648aa1c5b0680bc9a5b905cf43020e5).
Auto-Animate only connects compatible slide pairs, uses stable matching, can
explicitly restart rather than imply continuity, and calls `reset()` before a
new run. Reset removes target attributes and the injected transition stylesheet
([AutoAnimate source](https://github.com/hakimel/reveal.js/blob/a3b940695648aa1c5b0680bc9a5b905cf43020e5/js/controllers/autoanimate.js#L23-L125),
[official Auto-Animate guide](https://revealjs.com/auto-animate/)).

This is valuable evidence for the deferred Chapter Handoff: only stable shared
semantic IDs can justify continuity, and every transition needs atomic cleanup.
It also supports the governor itself: a new owner must clean the prior owner's
runtime layer before beginning.

**Borrow now:** reset-before-run and owner-token cleanup.

**Borrow later:** shared stable IDs as chapter anchors.

**Skip:** FLIP-transforming graph nodes, SVG morphing, full unmatched-element
fades, or reveal.js's slide/runtime dependency.

### 6. LikeC4 has a compelling chapter handoff, but it should follow the governor

The comparison is pinned to
[`likec4@f0ce898`](https://github.com/likec4/likec4/tree/f0ce898be4868a4fc57f80630d6e8b09c0439eb2).
Its navigation state reads the current viewport, preserves the screen position
of a node that exists in both views, and only then settles the target viewport;
when no corresponding node exists it uses a bounded fallback rather than
pretending there is a shared anchor
([navigation state](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/likec4diagram/state/machine.state.navigating.ts)).
Its embed and export pages deliberately disable or fix interactive viewer state
([EmbedPage](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/likec4-spa/src/pages/EmbedPage.tsx),
[ExportPage](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/likec4-spa/src/pages/ExportPage.tsx)).

**Borrow later:** choose a stable shared node as an anchor, preserve its screen
position for the first transition phase, cap duration, and cut when continuity
cannot be proved.

**Skip now:** adding this extra movement before Archify can guarantee that
ambient trace, scan, pulse, route, and Story do not compete with it. Also skip
LikeC4's graph replacement, state-machine/framework stack, and viewport history.

### 7. Hidden documents need an explicit lifecycle decision

The HTML Living Standard exposes `Document.visibilityState` and the bubbling
`visibilitychange` event for visible/hidden transitions
([HTML page visibility](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility)).

**Borrow:** hidden means no active viewer motion and no CPU-only animation
ownership. Existing Story pause behavior should become the system rule.

**Do not automatically restart:** returning to visible may restore ambient Live
only when the reader has not selected Still. A paused Story, route pulse, or
one-shot preview never restarts without a new explicit action.

## Candidate matrix

Scores use `1` (weak) to `5` (strong). Risk is inverted: `5` means low product
risk / a good fit for the current architecture.

| Candidate | Immediate reader value | Direction / continuity | Visual restraint | Accessibility closure | Mobile / embed fit | Architecture risk | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| **Motion Governor: Live/Still + one owner** | 5 | 5 | 5 | 5 | 5 | 4 | **Build now** |
| Shared-anchor Chapter Handoff | 4 | 5 | 3 before governance | 2 before governance | 3 | 3 | Later, directly after Governor |
| Chapter Compass in Rail/Radar | 3 | 4 | 3 | 4 | 2 | 4 | Later only with reader evidence |
| Longer fly-to / overview waypoint transition | 3 | 4 | 2 | 2 | 2 | 3 | Skip |
| Scroll-driven chapter activation | 2 | 3 | 2 | 2 | 1 | 2 | Skip |
| Layout morphing or moving shared nodes | 2 | 2 | 1 | 1 | 1 | 1 | Skip |

### Why the Governor wins this round

The Named Chapter Rail already solves discovery. Semantic Camera already supplies
a bounded transition. Story Trail and Story Beats already provide truthful
direction. The next visual gain does not come from another animation shape; it
comes from guaranteeing that the right existing shape is the only thing moving.

The Governor also unlocks the best later candidate safely. Once a Story chapter
can be the sole owner, a shared-anchor camera handoff can be added without
competing with trace, scan, node pulse, Route Probe, or preview motion.

## Recommended runtime contract

### 1. State vocabulary

Use viewer-only HTML state, never SVG authoring state:

- `html[data-motion="live"]`: motion is permitted;
- `html[data-motion="still"]`: no visible viewer motion is permitted;
- `html[data-motion-owner="ambient|story|focus|route|lens|intent|relationship|legend|radar|none"]`:
  the one semantic surface allowed to spend the motion budget;
- an internal monotonically increasing owner token prevents a stale
  `animationend`, timer, or cleanup callback from releasing a newer owner.

Expose a distinct runtime object:

```js
Archify.motionGovernor = {
  mode(),
  owner(),
  setMode("live" | "still", options),
  claim(name, cleanup),
  release(token),
  suspend(reason)
}
```

Keep the existing `Archify.motion.canRecord()` and
`Archify.motion.recordWebm()` export surface untouched.

### 2. Initialization before first paint

The existing early `<head>` bootstrap should set effective motion before the
body becomes visible:

1. `prefers-reduced-motion: reduce` → `still`;
2. normal `?embed=1` → `still`;
3. otherwise → `live`;
4. `?embed=1&play=1#view=...` may enter `live/story` only after the explicit
   one-shot contract is resolved, and every ambient selector remains off;
5. a media-query change to `reduce` forces Still immediately;
6. a later change back to `no-preference` does not automatically restart a
   Story or one-shot effect.

Do not add a JSON field, URL hash field, or required storage dependency. A
best-effort Still preference may be remembered under one namespaced browser key
only if access is exception-safe. An OS reduced-motion preference initializes
Still; a reader may explicitly choose Live for the current document, but that
override is never persisted across reload and a new system change to `reduce`
forces Still again.

### 3. Visible control

Add one native button to the top toolbar, adjacent to Theme / Present rather than
inside Guided Views:

- visible copy is `Live` or `Still` plus a non-color icon;
- while Live, its accessible action name is `Turn diagram motion off`;
- while Still, its accessible action name is `Turn diagram motion on`;
- the action is reachable before moving diagram content;
- the status is understandable without color, hover, tooltip, or animation;
- it is at least 44 by 44 CSS pixels on a 390px or 320px viewport;
- it remains visible in Presentation Stage;
- it is hidden in embed and print because those surfaces have their own fixed
  contract;
- it creates no second pause button inside Story, Route, Radar, or a row.

The existing Story Play/Pause remains the control for progression. The Governor
controls permission to move.

### 4. Owner replacement

`claim(name, cleanup)` must:

1. stop and clean the previous transient owner before publishing the new owner;
2. increment the token;
3. call the old cleanup at most once;
4. never let an old timer/event clear a newer owner;
5. pause all ambient motion whenever the owner is not `ambient`;
6. deny visible animation when the effective mode is Still while still allowing
   the semantic operation to complete instantly.

`release(token)` returns to `ambient` only when:

- the token still matches;
- the document is visible;
- effective mode is Live;
- no durable reader state such as active Story/focus/route/lens still owns the
  scene.

Otherwise it resolves to `none` with a complete static diagram state.

### 5. Motion classification

| Current surface | Governor treatment |
|---|---|
| header `.pulse-dot` | ambient only; static visible dot in Still |
| Signal Flow scan | ambient only; absent in Still and under every reader owner |
| authored trace edge/node | ambient only; complete authored graph remains visible when stopped |
| Radar live dot | Radar owner only; static status mark in Still |
| Story progress, beats, flow, share cue | Story owner only; existing pause freezes semantic beat, not a meaningless partial overlay |
| Semantic Camera | subordinate to the current semantic owner; zero duration in Still |
| Route Probe flow | Route owner; change the signal to one finite pass, then preserve the static exact route |
| Intent Trace | finite Intent owner; release on animation end/cancel/exit |
| Semantic Flow | finite Lens owner; density guard unchanged |
| Relationship Pulse | finite Relationship owner; existing cleanup unchanged |
| Legend preview | Legend owner only while preview is active; no moving flow until explicit Lens activation |
| panel entrance transitions / smooth scroll | allowed only in Live; instant in Still |

No original edge, marker, label, node, route, or camera coordinate is hidden or
mutated when motion stops.

### 6. Guided Views and chapter switching

The active Guided View should own the scene even while its playback is paused:

- selecting a chapter claims `story` before focus/camera/trail updates;
- ambient trace, Signal Flow scan, header pulse, and unrelated preview motion
  stop before the chapter becomes current;
- the current Semantic Camera transition is subordinate to `story`, not a
  competing owner;
- Story Trail and all selected nodes/relationships remain statically readable
  in Still;
- Play animates only Story progress, beats, and exact Story flow;
- focusing the Named Chapter Rail pauses progression but keeps the Story owner
  and static selected chapter;
- changing chapters replaces the Story instance atomically; the old beat timer,
  progress animation, and overlay cannot survive;
- Show all or Escape releases Story. Ambient motion may return only if the
  reader's effective mode is Live;
- switching Still during playback pauses at the exact current semantic beat and
  never auto-resumes when Live is restored;
- switching Live while a chapter is selected does not start Play. It only makes
  the explicit Play action available again.

This makes chapter direction easier to read without adding a new transition:
only the current authored Story can move.

### 7. Reduced motion and lifecycle

- Keep the CSS `@media (prefers-reduced-motion: reduce)` block as a no-JS safety
  net.
- Add `.pulse-dot` and every missing ambient/entrance selector to that fallback.
- Centralize one live `matchMedia` listener in the Governor.
- A change to `reduce` cancels camera easing, smooth scroll, Story timers, finite
  overlays, route flow, ambient trace, scan, and status pulses atomically.
- The selected nodes, exact route, Lens receipt, current Story beat, rail state,
  Passport, labels, and accessible names remain.
- `document.hidden` suspends all motion and pauses Story.
- Returning visible never replays a completed/cancelled one-shot and never
  restarts a reader-paused Story. Ambient may return only in Live with no stronger
  owner.
- A Still state must never be implemented by making content `display:none` when
  that content carries semantic meaning.

### 8. Mobile and touch

- The toolbar may wrap, but no control may overlap the Named Chapter Rail,
  diagram navigation, or horizontal reading surface.
- The Live/Still hit target is at least 44 by 44 CSS pixels.
- Still uses `behavior: "auto"` for chapter centering, Radar recentering, and
  contained wide-diagram reveal.
- Touch chapter activation remains one tap. It does not require hover preview or
  a second tap to stop motion.
- Motion state does not change page width, SVG width, mobile 720px reading
  surface, or scroll position.
- A manual swipe, pan, pinch, or zoom cancels the current camera motion and
  pauses Story as today; it must not restart ambient over the reader's gesture.

### 9. Embed, print, and export

#### Embed

- Ordinary `?embed=1` is still by default.
- The control is absent because the host owns surrounding interaction.
- `?embed=1&play=1#view=<id>` permits only the bounded Story owner; trace, scan,
  pulse, Radar, route, and preview motion remain off.
- Reduced motion turns that one-shot into the current complete static chapter
  and `Still` Share Chapter Cue state.
- Embed introduces no global keyboard shortcut and cannot capture a parent page's
  keys.

#### Print

- Print always shows the full, undimmed, complete diagram.
- No Live/Still control, root motion state, owner state, runtime overlay,
  transition, or animation appears.

#### Canonical SVG and raster

- `data-motion` and `data-motion-owner` stay on HTML, never on canonical SVG.
- SVG serialization strips any transient owner/overlay state exactly as today.
- The exported SVG retains authored `meta.animation="trace"` semantics; a
  viewer-only Still preference does not silently rewrite source intent.
- PNG/JPEG/WebP/copy remain canonical full-diagram exports and contain no viewer
  control or state.
- Export during a Story, owner replacement, Still transition, or cancelled
  overlay must keep the canonical-state receipt true.

#### WebM

- Preserve the existing explicit `Download WebM — 6s motion` action and
  `Archify.motion` API.
- Recording is an explicit export request, not ambient viewer playback; the
  Governor must not rename, corrupt, or serialize itself into the recording.
- A reader in Still does not need to watch live canvas motion in order to produce
  the offscreen explicit export.

## Borrow now / later / skip

### Borrow now

1. WAI's single top-of-page control for all automatic movement.
2. One effective Live/Still state initialized before paint.
3. One tokenized owner with reset-before-run cleanup.
4. Story as the sole motion owner while any named chapter is active.
5. Ambient trace/scan/pulse only when no reader question owns the scene.
6. A finite Route Probe signal followed by a complete static result.
7. Dynamic reduced-motion and visibility response.
8. Static semantic completion for every operation.
9. Existing stable geometry, bounded camera, embed, print, and export boundaries.

### Borrow later, after this slice is verified

1. **Shared-anchor Chapter Handoff.** Choose the closest stable ID in
   `previous.focus ∩ next.focus`, preserve its initial screen position, then
   settle through the existing Semantic Camera. If no shared ID or truthful
   boundary exists, cut directly; never invent a connector.
2. A compact `02 → 03 · via Gateway` transition receipt derived from existing
   chapter and node labels, not a persistent new panel.
3. Live Semantic Radar viewport feedback during a chapter handoff only when the
   reader already opened Radar; never auto-open it, especially on mobile.
4. A 180–360ms distance-capped transition once the Governor can make it the only
   moving surface.

### Deliberately skip

- No new animation DSL, keyframe schema, motion field, or chapter-transition IR.
- No Web Animations library, React, XState, graph runtime, Mapbox, reveal.js, or
  LikeC4 dependency.
- No moving/re-laying out graph nodes, edges, labels, lanes, containers, or
  boundaries.
- No dramatic fly arc, parallax, spring physics, zoom tunnel, cross-canvas wipe,
  or full-diagram blur.
- No automatic chapter activation from scroll position.
- No infinite reader-triggered Route, Intent, Lens, Relationship, or chapter
  handoff loop.
- No per-feature collection of Pause buttons.
- No hidden preference that only honors OS reduced motion; ordinary readers also
  get the visible Still control.
- No mutation of canonical SVG to reflect transient viewer preference.
- No automatic restart of a paused Story or one-shot when visibility or motion
  preference changes.

## Concrete acceptance criteria

### State and control

1. Every generated HTML artifact contains exactly one native Live/Still button
   in the top toolbar.
2. Live and Still use both visible text and a non-color visual cue.
3. The button's accessible name describes the action that activation will take.
4. Keyboard Enter and Space produce the same single toggle as pointer/touch.
5. The control is available before the moving diagram content in document order.
6. No renderer, guided panel, route row, Radar, or preview adds a duplicate
   motion toggle.
7. The root exposes exactly one effective `data-motion` value and at most one
   `data-motion-owner` value.
8. `Archify.motionGovernor` exists without replacing or renaming
   `Archify.motion` WebM methods.

### Owner arbitration and cleanup

9. At most one owner token is current at any instant.
10. Claiming a new owner invokes the preceding transient cleanup at most once.
11. A stale timeout, `animationend`, `animationcancel`, promise, or
    `requestAnimationFrame` callback cannot release a newer owner.
12. Ambient header pulse, Signal Flow scan, trace edges, and trace nodes run only
    in Live with `ambient` ownership.
13. Any Story/focus/route/lens/intent/relationship/legend owner suppresses all
    ambient motion before its own visible effect begins.
14. Releasing the final reader owner restores ambient only in visible Live mode.
15. Still mode resolves every claim to a complete static semantic state without
    starting visible motion.
16. Repeated owner replacement leaves zero duplicate runtime overlays, timers,
    progress animations, or moving classes.

### Guided Views and direction

17. Selecting any Named Chapter Rail item claims Story before camera/focus/trail
    state updates.
18. A selected but paused chapter keeps ambient trace, scan, and header pulse
    still.
19. Story Play animates only the current Story progress, beat nodes, reached
    relationships, and exact Story flow.
20. Manual chapter change clears the old beat timer, progress state, and Story
    overlay before the new chapter becomes current.
21. Focusing the chapter rail pauses playback but keeps the selected chapter's
    complete static semantic state.
22. Switching to Still during playback freezes the truthful current beat and
    accessible status, and does not jump to Show all or another chapter.
23. Switching back to Live never auto-resumes playback; Play remains explicit.
24. Show all and Escape release Story; ambient returns only when Live.
25. Existing Prev/Next, `[`, `]`, hash restoration, Share Cue, Presentation,
    Story Trail, and Named Chapter Rail behavior stay functional.

### Motion inventory

26. `.pulse-dot` is static under OS reduced motion and reader-selected Still.
27. Signal Flow scan, authored trace edges, and authored trace nodes are absent
    or reset to their complete static base in Still.
28. Route Probe motion completes one finite pass under five seconds and leaves
    the exact directed route readable without an infinite animation.
29. Intent Trace, Semantic Flow, and Relationship Pulse retain their existing
    finite direction, density, and cleanup contracts.
30. Camera transforms and smooth scroll resolve immediately in Still while final
    framing/scroll position remains correct.
31. Panel entrance transitions add no motion in Still.
32. No Still treatment hides semantic nodes, edges, labels, route receipts,
    Passport facts, Story stops, or Lens counts.

### Preference and lifecycle

33. Initial OS `prefers-reduced-motion: reduce` reaches Still before the first
    visible animated frame.
34. A live media-query change to `reduce` atomically stops ambient motion,
    pauses Story, cancels camera motion, and cleans finite overlays.
35. Returning to `no-preference` does not restart a paused Story or completed
    one-shot automatically.
36. `document.hidden` suspends every viewer motion source, not only Story timers.
37. Returning visible restores only permitted ambient Live state; deliberate
    effects require a new reader action.
38. The no-JS CSS reduced-motion fallback still produces a complete static
    artifact.

### Mobile, embed, print, and export

39. At 390px and 320px, the control target is at least 44 by 44 CSS pixels and
    does not overlap the rail, nav, diagram, or export control.
40. Still chapter centering and contained-wide reveal use immediate scroll and
    preserve zero page-level horizontal overflow.
41. Touch activation has full parity and never requires hover or a second tap.
42. Ordinary embed starts still, shows no Governor control, and has zero ambient
    trace/scan/pulse motion.
43. `embed=1&play=1` permits only the bounded Story owner; reduced motion produces
    the truthful complete static chapter.
44. Print contains the complete graph and no Governor control, owner attribute,
    moving overlay, or dimmed viewer state.
45. SVG export during every mode/owner transition keeps the canonical-state
    receipt true and contains no Governor state.
46. PNG, JPEG, WebP, copied PNG, and standalone SVG remain non-empty and
    deterministic under Live and Still.
47. Explicit WebM recording remains available for trace artifacts through the
    existing `Archify.motion` API and contains no Governor UI/state.
48. Embed, print, canonical SVG, raster output, schema, validators, renderer
    geometry, stable IDs, and package dependencies are unchanged in meaning.

### Verification surface

49. Focused tests enumerate every moving selector so a new `infinite` animation
    cannot bypass the Governor silently.
50. Contract tests cover owner token replacement, stale callback rejection,
    Story takeover, Still mid-play, no auto-resume, visibility, live media-query
    changes, embed, print, and canonical export.
51. In-app browser validation covers a Signal Flow + trace Workflow artifact, a
    non-Signal-Flow trace artifact, and one Architecture or Lifecycle artifact.
52. Browser validation covers desktop, 390px, 320px, dark/light, Live/Still,
    Story playback, chapter switch, route result, Presentation Stage, embed,
    export during motion, and zero console errors.
53. A final screenshot shows one active named Story chapter with its exact flow
    as the only moving explanation and a visible Live/Still status.
54. The complete unit suite, Proof Lab, ZIP doctor/demo/check, generation
    freshness, and `git diff --check` remain green.

## Decision

Round 29 should implement **Motion Governor: Live/Still + one motion owner**.

The project has already earned rich interaction: named chapters, semantic
camera, Story Trail, Story Beats, route signals, relationship pulses, ambient
trace, multiple presets, and exportable motion. The highest-value next step is
not to add another independently attractive effect. It is to make the whole
artifact behave like one designed instrument.

The success test is simple: a reader should always know why something is moving.
If a Story is playing, only the Story moves. If a route is answering, only the
route moves. If the reader selects Still, nothing moves and nothing meaningful
is lost.

After that invariant is proven, the shared-anchor Chapter Handoff becomes a
strong Round 30 candidate rather than another source of visual competition.
