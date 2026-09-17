# Visual Evolution Round 32 — Story Beat Navigator

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build **Story Beat Navigator** as the next bounded viewer slice.

Archify already turns each authored `meta.views[].focus` list into a visible Story
Trail and can advance `past / active / pending` beat states during playback. The
trail itself is still a row of non-interactive `<span>` labels, however. A reader
can watch the story but cannot pause on a specific beat, revisit one exact step,
or inspect the exact authored relationship that carries that step.

Round 32 should turn those existing trail stops into native, directly activatable
beat controls. Clicking, tapping, or pressing Enter/Space on a stop pauses any
running story and pins that exact beat. The viewer emphasizes the active stable-ID
node and, only when it exists, the exact authored relationship(s) between the
previous and current stop. With motion enabled, one finite connector-only signal
may traverse a single unambiguous path; Still and reduced-motion retain the same
static truth. The chapter, focus set, URL, camera, layout, and canonical SVG do not
change.

This is the sharper answer to the motion appeal of `fireworks-tech-graph`: motion
that a user can stop, inspect, and resume from the same semantic moment, rather
than another ambient or infinitely looping effect.

## Why this slice is real in current Archify

The implementation substrate already exists in
[`Archify.guidedViews`](../archify/assets/template.html):

- `renderStoryTrail(view)` resolves stable node IDs, renders ordered stops, marks
  nodes with `data-story-step`, and creates exact-path Story Trail overlays;
- `setStoryBeat(index)` is already the shared writer for `past / active /
  pending` node, edge, and trail presentation;
- `startStoryBeats()` currently advances that writer on a timer;
- `pausePlayback()` already stops story and chapter timers without leaving the
  guided viewer;
- an activated chapter is already framed by Semantic Camera, so inspecting one
  beat does not require another camera transaction;
- Show all, chapter activation, visibility changes, print, embed, and canonical
  export already have centralized Story cleanup paths.

Parsing the current 11 generated Proof Lab artifacts gives:

- **33** authored chapters;
- **150** real resolved story stops, or 4.55 stops per chapter on average;
- a minimum of 3 and a maximum of 8 stops per chapter;
- **117** adjacent stop transitions: 84 exact forward relationships, 1 exact
  reverse relationship, and 32 honest grouped transitions with no direct
  authored relationship.

Those counts were derived from current
`docs/gallery/artifacts/*.html`, using only `archify-guided-views-data` and exact
`data-edge-from` / `data-edge-to` endpoints. They prove both the common path case
and the cases that must not be inferred:

- `agent-tool-call.workflow.html` / `happy-path` has eight stops and seven exact
  forward steps;
- its `evidence-loop` transition `external → store` is a grouped transition with
  no direct authored edge;
- `incident-response.workflow.html` / `escalate-and-communicate` beat 3 narrates
  `escalate → update`, while the authored edge points `update → escalate`.

## Primary-source findings

### fireworks-tech-graph: motion works when geometry stays still

At fixed commit
[`fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44),
the public motion contract is generated semantic SVG → validated GIF. The default
artifact is a 5.75-second, 20fps, 115-frame, infinitely looping GIF. Its own rules
keep nodes, labels, containers, marker geometry, and camera fixed while connectors
draw on and settled routes carry bounded operating signals
([official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md)).
The checked-in showcase manifest proves twelve 115-frame style samples and one
69-frame 3×4 overview, all 5.75 seconds long
([official showcase manifest](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/assets/samples/showcase-gif-manifest.json)).

**Borrow:** stable geometry, connector-only semantic motion, explicit route
direction, and a readable settled state. **Adapt:** let deliberate beat activation
request one finite signal over one exact Archify path, while the static beat
remains inspectable afterward. **Skip:** infinitely looping viewer motion, twelve
scene-specific motion contracts, frame rendering, a GIF dependency, moving every
eligible path at once, or hiding connectors before the reader can understand the
base graph.

### LikeC4: a walkthrough is directly controllable state

LikeC4 dynamic views describe ordered, continuous, parallel, and nested scenario
steps, including per-step notes
([official dynamic-view documentation](https://likec4.dev/dsl/views/dynamic/)).
At fixed commit
[`likec4@f0ce898`](https://github.com/likec4/likec4/tree/f0ce898be4868a4fc57f80630d6e8b09c0439eb2),
its active walkthrough UI provides explicit Stop, Previous, Next, and `current /
total` controls
([official walkthrough controls](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/navigationpanel/walkthrough/ActiveWalkthroughControls.tsx)).
Its state machine also accepts a direct edge click, marks edges as active,
processed, skipped, or pending, dims unrelated nodes, supports arrow-key stepping,
and restores the pre-walkthrough viewport when the walkthrough ends
([official walkthrough state](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/likec4diagram/state/machine.state.ready.walkthrough.ts)).

**Borrow:** direct step activation, exact `current / total`, persistent semantic
states, previous/next continuity, and restoring rather than corrupting base state.
**Adapt:** Archify already has an authored stable-ID node sequence, a fixed SVG,
and one framed chapter, so its stops themselves can be the controls. **Skip:** a
new dynamic-view schema, nested/parallel flow authoring, node/edge model mutation,
XState, XYFlow, an outline panel, and per-beat viewport fitting.

### reveal.js: incremental content has a direct index, not only a timer

reveal.js fragments are stepped in a deterministic order; explicit
`data-fragment-index` can override DOM order, and exactly one fragment may carry
the `current-fragment` state
([official fragment contract](https://revealjs.com/fragments/)). Its public API can
navigate directly to a fragment index and separately exposes previous and next
fragment operations
([official navigation API](https://revealjs.com/api/)).

**Borrow:** one integer playhead, direct indexed navigation, a single current
state, and previous/next semantics. **Adapt:** Archify's authored `focus` order is
already the index; do not introduce another ordering field. **Skip:** hiding
canonical nodes until their fragment is reached, slide replacement, URL fragment
indices, full-deck state, and presentation dependencies.

### D2: steps are semantic sequence, but board inheritance is the wrong model

D2 defines a Step as a step in a sequence of events, with each board inheriting
from the prior board
([official Steps documentation](https://d2lang.com/tour/steps/)). Composition also
distinguishes independent layers, base-inheriting scenarios, and prior-step-
inheriting steps
([official Composition documentation](https://d2lang.com/tour/composition/)).

**Borrow:** make the authored sequence visible and addressable as steps.
**Adapt:** change only viewer emphasis over one persistent graph. **Skip:** board
inheritance, new boards, SVG board swapping, opacity loops, layout or geometry
recomputation, and any claim that prior Archify beats mutate the graph.

### React Flow: focusability and camera movement are separate choices

React Flow makes nodes and edges keyboard-focusable and operable, exposes
configurable accessible labels, and treats automatic pan-on-node-focus as an
independent option
([official accessibility guide](https://reactflow.dev/learn/advanced-use/accessibility)).

**Borrow:** native keyboard operation, explicit accessible instructions, and the
principle that focused content must remain visible. **Adapt:** keep focus on the
HTML beat button; the active chapter has already framed all its nodes. **Skip:**
moving focus into SVG nodes, draggable behavior, automatic pan, React/XYFlow, and
new live-region chatter.

### W3C: rotation stops on focus, current step is explicit, motion is optional

The WAI carousel pattern says automatic rotation stops when any element inside
the carousel receives keyboard focus and does not resume until the user activates
the rotation control. It recommends native buttons and treats direct slide-picker
controls as a first-class surface
([WAI carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)).
WCAG 2.2.2 explains that pausing and resuming where the reader left off is best
for non-real-time content
([Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)).

WAI-ARIA 1.2 defines `aria-current="step"` for the one current item in a
step-based process
([ARIA current state](https://www.w3.org/TR/wai-aria/#aria-current)). WCAG 2.5.8
requires pointer targets of at least 24×24 CSS pixels unless an exception applies
([Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)).
WCAG 3.2.1 requires focus alone not to initiate a context change
([On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus)), and WCAG 2.3.3
requires nonessential interaction-triggered animation to be disableable
([Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)).

**Borrow:** pause on focus, resume from the same playhead only after an explicit
Play, native buttons, one current-step announcement, 24px targets, activation-not-
focus, and a static reduced-motion equivalent. **Skip:** autoplay on focus,
hover-only beat changes, forced focus movement, a custom slider role, or announcing
every automatic beat through a live region.

## Candidate comparison

| Candidate | Product value | Main failure | Decision |
|---|---|---|---|
| More ambient particles on all edges | Immediately flashy | Repeats existing trace motion, competes with reading, cannot explain a specific step | Skip |
| Free-running GIF-like Story loop | Strong marketing motion | No direct inspection, repeats Fireworks' control limitation | Skip |
| Continuous range slider | Familiar media metaphor | Story beats are discrete and semantically unequal; touch/ARIA/time math become misleading | Skip |
| Per-beat thumbnails | Visually rich | Duplicates the SVG/camera and expands mobile/export complexity | Skip |
| Directly activatable Story Beat rail | Reuses authored truth, converts motion into understanding, works on touch and keyboard | Requires one playback/playhead owner and strict edge truth | **Build** |

## Borrow / adapt / skip summary

| Decision | Archify contract |
|---|---|
| Borrow | Fireworks' fixed geometry and connector-only semantic signal. |
| Borrow | LikeC4's explicit Previous / Next / current-total walkthrough control and active/processed/pending state. |
| Borrow | reveal.js's directly addressable fragment index. |
| Borrow | W3C pause-on-focus, resume-from-here, native button, current-step, target-size, and reduced-motion guidance. |
| Adapt | Turn the existing Story Trail into the direct beat picker; do not add another panel or authoring field. |
| Adapt | Reuse one exact adjacent-edge classifier for visible link glyph, static emphasis, finite pulse, and accessible copy. |
| Skip | New schema/IR/layout/dependency, camera travel, drag scrubbing, thumbnails, infinite loops, hover preview, parallel-flow authoring, and URL beat state. |

## Exact semantic contract

For active normalized view `V` and zero-based beat index `i`:

```text
activeNode  = V.focus[i]
previousNode = i > 0 ? V.focus[i - 1] : null
pastNodes   = V.focus[0 .. i-1]
pendingNodes = V.focus[i+1 .. end]

forwardEdges = exact authored edges previousNode -> activeNode
reverseEdges = exact authored edges activeNode -> previousNode
stepEdges    = forwardEdges + reverseEdges, preserving canonical DOM order
```

Only stable node IDs and exact `data-edge-from` / `data-edge-to` values
participate. Do not infer a relationship from labels, proximity, lanes, shared
kinds, geometry, route overlap, DOM adjacency, or Story order.

Relationship presentation is fail-closed:

1. `i = 0`: `start`; no incoming Story edge or pulse.
2. Exactly one forward edge and no reverse edge: `forward`; emphasize it and,
   when motion is allowed, signal in its authored source→target direction.
3. Exactly one reverse edge and no forward edge: `reverse`; emphasize it and
   signal in its authored source→target direction, even though the narrative is
   walking the pair in reverse.
4. No exact edge: `group`; emphasize the active node only and state “grouped · no
   direct authored relationship.”
5. Multiple or bidirectional exact edges: `multiple`; emphasize all matching
   authored edges statically, report their exact count, and do not choose an
   arbitrary moving path.

Nonconsecutive internal chapter edges are canonical context, not Story steps.
They must not acquire a beat number merely because both endpoints appear in the
chapter. This tightens the current overlay rule: only exact adjacent focus pairs
may receive a Story beat step.

The Story state never means graph mutation. “Past”, “current”, and “upcoming” are
narrative positions only. Human copy must not say created, added, deleted,
removed, deployed, or destroyed.

## Exact interaction contract

1. Render every resolved Story stop as a native `button type="button"` with its
   visible two-digit position and display label. Keep the current horizontal
   Story Trail; add no panel and no slider.
2. Group the controls under the existing “Story trail” label. Each button has an
   accessible name such as “Story beat 3 of 8: Planner. From Chat through one
   authored forward relationship.”
3. Focus changes button styling and pauses active playback once, but does not
   select a beat. Only click, tap, Enter, or Space changes the playhead.
4. Manual activation calls the same `setStoryBeat` writer used by automatic
   playback. Parallel manual and automatic state writers are not acceptable.
5. Exactly one selected/playing stop carries `aria-current="step"`; all others
   omit the attribute. `aria-pressed` and `role="tab"` are not used.
6. Manual activation pauses Story and chapter timers, clears transient chapter
   preview, settles any Story pulse, selects the requested beat, and remains
   pinned until another explicit reader action.
7. Selecting a beat never changes active chapter, selected chapter focus IDs,
   Story Trail ordering, `aria-current` on the chapter rail, URL/hash/history,
   Semantic Camera state, SVG transform, diagram/page scroll, or authored data.
8. Center the chosen button inside the Trail by setting only the Trail's own
   `scrollLeft`. Do not use an unbounded `scrollIntoView` call that can move the
   page or diagram.
9. Re-activating the already-current beat is state-idempotent. It may replay the
   one finite exact-path signal when motion is allowed.
10. Show all, another chapter, a hash-driven chapter, direct-node exploration,
    and viewer teardown clear the beat selection and every pulse atomically.
    Hidden document, print entry, and motion-preference changes cancel timers and
    pulses but preserve the selected beat as static reading state; returning to a
    visible/live state never resumes automatically.
11. A chapter handoff has priority. Destination beat controls remain disabled
    until handoff settles; a handoff-time activation cannot create a stale beat
    after settlement.
12. Manual beat activation is explicit Guided Story intent. It must not coexist
    with Route Probe, Lens, Relationship Preview, Intent Trace, Legend Preview,
    or Chapter Preview presentation. Use the same centralized owner cleanup as
    chapter activation rather than ad hoc CSS precedence.
13. Escape retains the existing viewer contract: Chapter Preview is dismissed
    first when present; otherwise Escape exits the active guided chapter. Do not
    add a hidden two-Escape beat mode.
14. Expose a read-only deterministic receipt such as
    `Archify.guidedViews.beat()` returning `{index, total, nodeId, relation,
    edgeKeys}` for tests; do not expose mutation APIs or authoring syntax.

## Exact playback contract

1. There is one playhead: `storyBeatIndex`. Manual selection, Pause, Resume,
   automatic playback, share playback, and visible Story state all read it.
2. Starting a story from Show all begins chapter 1, beat 1 as today. Starting from
   an active chapter with no beat begins that chapter at beat 1.
3. Pause preserves the current beat and its elapsed dwell fraction. Play after a
   mid-beat pause uses only the remaining dwell; manual selection resets the
   selected beat to the start of one full dwell. Either path then advances to the
   next beat and never silently restarts the chapter from beat 1.
4. After the final beat's dwell, playback enters the existing Chapter Handoff to
   the next chapter. The next chapter does not start its beat timer until the
   handoff settles.
5. At the final beat of the final chapter, playback reaches Complete. A later
   explicit Replay retains the existing full-story replay meaning.
6. Use one generation-owned scheduler. Pause, replacement, visibility change,
   Still, reduced motion, print, and teardown invalidate all callbacks from an
   older generation; `setInterval` and an independent chapter timeout must not
   race to write the playhead.
7. Chapter progress begins at the truthful completed fraction after a resume and
   advances over only the remaining dwell time. It must not jump to zero while a
   later beat remains visibly current.
8. Automatic playhead movement never moves DOM focus and never announces every
   frame or beat. Manual activation may produce one bounded status update.

## Exact visual and motion contract

1. Reuse the existing `past / active / pending` states, but strengthen the active
   stop with position, outline/weight, and `aria-current`, not color alone.
2. Keep all active-chapter nodes and canonical edges visible. Past and pending
   items may be softly subdued; the active node and its exact step edge(s) remain
   highest contrast.
3. A restrained receipt in existing Guided View chrome reads, for example,
   `Beat 03 / 08 · Chat → Planner`, `Beat 03 / 04 · reverse authored link`, or
   `Beat 02 / 03 · grouped · no direct link`. It must not change panel height.
4. With Live motion, deliberate activation of exactly one unambiguous edge may
   create one marker-free, pointer-free, `aria-hidden` path clone that traverses
   source→target once in at most 900ms and then disappears. Nodes, text, labels,
   containers, canonical paths, markers, viewBox, and camera never move.
5. Multiple/bidirectional and group transitions remain static. Truth is more
   important than animation coverage.
6. The finite signal reuses the existing Story motion owner. Do not add another
   reader preference, looping timer, global animation, or Motion Governor owner
   label.
7. Still and `prefers-reduced-motion: reduce` keep the complete static selected
   beat and suppress every pulse, transition, scroll animation, and intermediate
   camera frame.
8. A live preference change or Motion Governor pause removes a running pulse in
   the same task and leaves the destination beat fully selected.
9. Blueprint uses a crisp, square, filter-free signal; Signal Flow may use its
   restrained glow. Classic remains neutral. Role meaning survives grayscale.

## Accessibility contract

- Use native buttons; do not synthesize button behavior on spans.
- Every beat target contains at least a 24×24 CSS-pixel box. Mobile targets should
  be 32px or larger when the existing panel geometry allows it.
- Keyboard focus pauses playback but does not activate a beat. Playback never
  resumes merely because focus leaves.
- Enter and Space select the focused beat. Ordinary Tab / Shift+Tab navigation
  remains browser-native; do not trap focus in the Trail.
- Exactly one current beat uses `aria-current="step"`. The chapter rail keeps its
  separate current chapter.
- The Trail must not inherit the broad current `aria-live="polite"` region in a
  way that announces every timer-driven state change. Scope live copy to one
  manual status, or explicitly keep automatic beat state `aria-live="off"`.
- Visible position, label, exact relationship direction/count, and grouped
  fallback are available to assistive technology. SVG clones are unfocusable and
  `aria-hidden="true"`.
- Focus outline, current-step marker, past/current/pending distinction, and
  forward/reverse/group copy are not color-only.
- No hover preview is added. Hover may style the native button only.

## Mobile contract

- First tap selects the beat immediately; no first-tap hover preview, long press,
  or second-tap activation.
- At 320px and 390px the Trail scrolls horizontally inside its own row, the
  selected stop is brought into that local viewport, and there is no document-
  level horizontal overflow.
- Touching and horizontally dragging the Trail must not pan the diagram or page.
  Tapping a stop must not alter diagram `scrollLeft`, `scrollTop`, or camera.
- The controls retain exact position and relationship wording at narrow widths;
  visual labels may truncate, but accessible names may not.
- An external keyboard on a touch-capable device retains the same focus/pause and
  activation semantics.

## Embed, print, and export contract

- Ordinary embed has no Guided View panel or beat controls. Existing
  `?embed=1&play=1` one-shot chapter behavior may continue to display Story Beats
  inside the SVG, but it adds no new control or continuous loop.
- Presentation mode may expose the same direct controls only when its Guided View
  panel is present; it gets no second implementation.
- Print shows the full undimmed canonical diagram and no Story controls, current
  beat ring, receipt, or pulse.
- Canonical SVG/raster export during pending, active, paused, pulsing, settled,
  hidden, and teardown states strips all Story runtime attributes and overlays.
- If a new pulse selector is needed, canonical cleanup and clean-state assertions
  must reject it explicitly. Prefer the existing `[data-story-overlay]` cleanup
  boundary when safe.
- Browser-native WebM export retains its existing canonical trace contract. A
  manually selected Story Beat is not baked into WebM, SVG, PNG, JPEG, or WebP.
- No schema, IR, renderer geometry, layout algorithm, dependency, or authored SVG
  changes are required.

## Suggested implementation shape

Keep the slice inside the existing shared template so architecture, workflow,
sequence, lifecycle, and dataflow inherit one behavior:

1. Add pure `storyStep(view, index)` that resolves stable node ID, exact adjacent
   edge keys, and `start / forward / reverse / group / multiple` relation.
2. Tighten `renderStoryTrail(view)` to assign beat steps only to exact adjacent
   edges and render native buttons with precomputed accessible labels.
3. Make `setStoryBeat(index, options)` the only state writer. It updates node,
   edge, stop, receipt, local Trail scroll, and read-only beat receipt.
4. Replace the independent beat interval and chapter timeout with one
   generation-owned scheduler that can resume from the current beat.
5. Add `selectStoryBeat(index)` for explicit activation: pause, arbitrate owners,
   set static truth, and optionally run one finite exact-path pulse.
6. Add one Trail focus handler that pauses without selection and one delegated
   click handler. Native buttons already provide Enter/Space.
7. Extend central cleanup, hidden/print/reduced-motion paths, export clone cleanup,
   and canonical-state assertions.
8. Keep the existing chapter rail, Chapter Delta Preview, Shared Anchor Handoff,
   Story Trail placement, Semantic Camera, and Motion Governor as the owners; do
   not create a new top-level subsystem.

## Acceptance checklist

- [ ] All five renderers inherit one template-level implementation.
- [ ] Current corpus proves 33 chapters, 150 stops, and 117 adjacent transitions
      split 84 forward / 1 reverse / 32 group before implementation.
- [ ] `agent-tool-call / happy-path` exposes eight native beat buttons and seven
      exact forward steps.
- [ ] `incident-response / escalate-and-communicate` beat 3 truthfully reports and
      signals the authored reverse direction.
- [ ] `agent-tool-call / evidence-loop` beat 2 reports grouped/no-direct-link and
      creates no path pulse.
- [ ] A synthetic multiple/bidirectional fixture highlights all exact paths
      statically and chooses none for motion.
- [ ] Nonconsecutive cross-links never acquire an adjacent Story beat number.
- [ ] Focus pauses playback without changing beat, chapter, focus, URL, camera,
      scroll, or SVG transform.
- [ ] Click, touch, Enter, and Space select the same exact beat on first
      activation.
- [ ] Exactly one stop has `aria-current="step"`; no stop uses a fake tab role or
      `aria-pressed`.
- [ ] Every beat target is at least 24×24 CSS pixels and has a visible focus ring.
- [ ] Manual activation during playback pauses once and leaves the chosen beat
      pinned.
- [ ] Resume continues from the pinned beat, completes remaining beats in order,
      and starts the next chapter only after Handoff settlement.
- [ ] Ten rapid select/pause/resume/replacement operations leave one current beat,
      one scheduler generation, and zero stale timers or overlays.
- [ ] Automatic beat updates never move focus or generate per-beat live-region
      chatter.
- [ ] A single exact edge receives at most one finite source→target pulse; repeat
      activation replaces it rather than stacking clones.
- [ ] Still, dynamic reduced motion, hidden page, and Motion Governor pause settle
      immediately to complete static beat meaning.
- [ ] Story activation cannot coexist with Route, Lens, Relationship, Intent,
      Legend, Chapter Preview, or Handoff residue.
- [ ] Selecting a beat leaves active chapter, chapter focus IDs, URL/hash,
      `aria-current` on chapter rail, camera, diagram scroll, and page scroll
      byte-for-byte unchanged.
- [ ] 320px and 390px touch layouts have one-tap selection, contained horizontal
      Trail scroll, readable current position, and no document overflow.
- [ ] Presentation uses the shared implementation; ordinary embed contains no new
      controls; one-shot embed retains one bounded share story.
- [ ] Print, SVG, PNG, JPEG, WebP, copy, and WebM remain canonical before, during,
      and after beat selection/pulse.
- [ ] Architecture, workflow, sequence, lifecycle, and dataflow generated outputs
      have no schema, IR, layout, dependency, or canonical SVG changes.
- [ ] Existing Guided Views, Story Trail/Beat, Named Chapter Rail, Chapter Delta
      Preview, Handoff, Motion Governor, Semantic Camera, focus, embed, export, and
      reduced-motion tests remain green.
- [ ] Built-in-browser verification covers dark/light, Signal Flow/Blueprint,
      mouse, keyboard, touch at 320/390px, reverse/group/multiple truth, resume
      timing, Still, dynamic reduced motion, Presentation, embed, print, and export
      during a live pulse.

## Risks and non-goals

The main correctness risk is calling Story order a graph path when an adjacent
pair has no direct authored edge. The exact adjacent-edge classifier and explicit
`group` / `multiple` fallbacks contain that risk. The main runtime risk is keeping
the current independent beat interval and chapter timeout while adding manual
seek; a single generation-owned scheduler is a requirement, not optional cleanup.
The main accessibility risk is putting timer-driven buttons inside the existing
polite live region; automatic state must remain silent.

Round 32 does not add new `meta.views` fields, durations per beat, a draggable
range input, thumbnails, speaker notes, parallel/nested story syntax, arbitrary
edge inference, camera movement, graph mutation, URL beat state, autoplay on
focus, hover preview, ambient loops, GIF generation, a new WebM mode, analytics,
dependencies, or renderer-specific implementations. If exact authored evidence
cannot identify one unambiguous path, the truthful experience is static.
