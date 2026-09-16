# Visual Evolution Round 31 — Chapter Delta Preview

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build **Chapter Delta Preview** as the next bounded viewer slice, but define it
strictly as a preview of **chapter-focus membership**, not graph mutation and not
chapter activation.

When a reader hovers with a hover-capable pointer or keyboard-focuses an inactive
chapter, Archify should show which stable node IDs would **stay in focus**, **enter
focus**, and **leave focus**. The chapter rail should show the corresponding exact
counts. During preview, the active chapter, URL, focus selection, Story Beat,
camera transform, mobile scroller, and canonical SVG must remain unchanged. An
explicit activation clears the preview atomically and enters the existing Shared
Anchor Chapter Handoff path.

This is worthwhile because the substrate and the user need are both real:

- the Named Chapter Rail currently exposes only `N stops`, so it answers “how
  large is this chapter?” but not “what changes if I go there?”;
- across the 11 current Proof Lab artifacts, the 22 forward adjacent transitions
  contain **19 shared-ID transitions and 3 no-shared-ID transitions**;
- direct rail navigation also matters: the three chapters in each Proof produce
  66 directed non-self chapter pairs, of which **60 share at least one ID and 6
  share none**;
- a preview therefore explains the common continuity case and truthfully warns
  about the clean-cut case before the reader commits.

No inspected primary source ships this exact Archify interaction as a package.
The recommendation is a synthesis of their stronger primitives: stable identity,
separate hover/selection/viewport state, explicit matched/unmatched semantics,
cancelable transient work, and accessible hover/focus disclosure.

## Current Archify evidence

The present viewer already has the necessary facts and owners in
[`Archify.guidedViews`](../archify/assets/template.html#L5424-L6252):

- `views[]` contains stable `id`, authored `label`, `note`, and ordered `focus`;
- `activeIndex` is the sole selected-chapter owner;
- rail buttons are native buttons with roving focus, `aria-current="step"` only on
  the active chapter, and explicit activation through the existing `activate`;
- focus entering the chapter rail already pauses Story playback;
- `activate` writes focus, Story Trail, active state, handoff, render state, and URL;
- Shared Anchor Handoff already classifies stable-ID intersections and uses a
  truthful `no-anchor` fallback;
- canonical export already clones and strips viewer-only attributes and overlays.

The Proof Lab count above was derived from the current generated
`docs/gallery/artifacts/*.html` payloads, after resolving unique `focus` values
against actual `[data-node-id]` elements. The three forward adjacent no-shared
transitions are:

- `agent-tool-call` chapter 2 → 3;
- `incident-response` chapter 2 → 3;
- `product-analytics` chapter 2 → 3.

For a concrete test fixture, `agent-tool-call` chapter 1 → 2 is
`=2 stay, +2 enter, −6 leave`, while chapter 2 → 3 is
`=0 stay, +3 enter, −4 leave`.

## Primary-source findings

### LikeC4: transient hover state is not selection or navigation

At fixed commit
[`likec4/likec4@f0ce898`](https://github.com/likec4/likec4/tree/f0ce898be4868a4fc57f80630d6e8b09c0439eb2),
LikeC4 models `hovered` and `dimmed` as separate transient data rather than
selection or layout
([base state](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/base/Base.ts#L9-L64)).
Its relationship-details actor cancels stale delayed work, delays non-hovered
dimming by 100ms, and restores presentation after leave without navigating
([hover lifecycle](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/overlays/relationship-details/actor.ts#L275-L339)).
Another hover surface uses a small debounced visibility boundary and keeps the
surface visible while either the trigger or revealed toolbar is hovered
([persistent hover surface](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/base-primitives/element/ElementTags.tsx#L96-L115)).
Its node update path explicitly preserves hovered/dimmed presentation when model
data changes unless the new update overrides it
([update separation](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/base/updateNodes.ts#L20-L40)).

**Borrow:** transient state separate from selection, bounded intent delay,
cancel-by-ID/latest-intent semantics, and persistence while the revealed content
is inspected. **Adapt:** Archify needs one preview generation over stable SVG IDs,
not LikeC4's XState/XYFlow model. **Skip:** importing its actor stack, mutating
layout data, or making hover a navigation event.

### reveal.js: stable matching and unmatched content are explicit

reveal.js Auto-Animate gives explicit `data-id` values priority over heuristic
matching, treats unmatched elements separately, and permits an explicit restart
when continuity is not truthful
([official Auto-Animate contract](https://revealjs.com/auto-animate/)). Its Speaker
View demonstrates the alternative of rendering a complete upcoming-slide preview
([official Speaker View](https://revealjs.com/speaker-view/)).

**Borrow:** exact stable-ID matching and an explicit unmatched/no-continuity case.
**Adapt:** compute three focus sets on one persistent SVG; do not match by label,
DOM order, proximity, kind, or geometry. **Skip:** a full next-chapter thumbnail,
DOM snapshots, cloned SVG, implicit matching, or preview animation. A thumbnail
would duplicate rendering and hide the precise semantic delta Archify can provide.

### D2 and TALA: board semantics and layout are separate concerns

D2 defines `steps` as boards inherited from the previous step, while layers and
scenarios use different inheritance rules
([composition](https://d2lang.com/tour/composition/),
[steps](https://d2lang.com/tour/steps/)). Its export guidance warns that a single
animated composition is best for only a small number of boards, because readers
can become confused or wait through the loop
([composition formats](https://d2lang.com/tour/composition-formats/)). At fixed
commit
[`terrastruct/d2@2446e24`](https://github.com/terrastruct/d2/tree/2446e247b6d7d5b9395a1ae8ad1e9c2641231035),
the animated SVG wrapper places every complete board in its own group and cycles
their opacity forever rather than exposing an element-level delta
([animation wrapper](https://github.com/terrastruct/d2/blob/2446e247b6d7d5b9395a1ae8ad1e9c2641231035/d2renderers/d2animate/d2animate.go#L14-L125)).
D2 nevertheless exports each authored object with its absolute ID
([stable shape ID](https://github.com/terrastruct/d2/blob/2446e247b6d7d5b9395a1ae8ad1e9c2641231035/d2exporter/export.go#L205-L216)).

TALA's first-party scope is architecture-aware placement, orthogonal routing,
containers, clusters, and label collision avoidance
([official TALA description](https://terrastruct.com/tala/)). It is a layout
engine, not a chapter-state or hover-preview model.

**Borrow:** the idea that current→next semantics are explicit and stable identity
matters. **Adapt:** derive membership from independent Archify `focus` arrays; do
not invent D2 step inheritance. **Skip:** full-board opacity loops, relayout,
TALA integration, a new board schema, or calling any layout engine during preview.

### React Flow: hover, selection, mutation, and viewport are distinct APIs

React Flow exposes separate node mouse-enter/leave, node click, selection, and
viewport callbacks. A controlled viewport is a separate `viewport` /
`onViewportChange` contract
([official component API](https://reactflow.dev/api-reference/react-flow)). Its
`NodeChange` union distinguishes actual `add`, `remove`, `replace`, and `select`
changes
([official NodeChange API](https://reactflow.dev/api-reference/types/node-change)).

**Borrow:** keep preview input, selected chapter, graph mutation, and camera state
as separate channels. **Adapt:** `enter` and `leave` must mean entering or leaving
the **chapter focus set**, never adding or removing architecture nodes. **Skip:**
React, XYFlow, controlled-node state, viewport writes, and a dependency change.

### W3C: focus cannot activate, and hover/focus content has a lifecycle

WCAG 3.2.1 requires focus not to cause an unexpected context change
([On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus)). WCAG 1.4.13
requires additional content triggered by hover/focus to be dismissible without
moving focus/pointer, hoverable when pointer-triggered, and persistent until its
trigger ends, it is dismissed, or it becomes invalid
([Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html),
[SCR39 technique](https://www.w3.org/WAI/WCAG22/Techniques/client-side-script/SCR39)).
Color cannot be the only carrier of role meaning
([Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
Media Queries Level 4 says `hover: none` covers touch and inconvenient long-press
hover, and explicitly warns that layouts must not depend on hover
([interaction media features](https://www.w3.org/TR/mediaqueries-4/#interaction)).

**Borrow:** focus previews without activation, Escape dismissal, trigger/content
hover persistence, keyboard parity, and non-color role encoding. **Adapt:** keep
counts visible without hover and make the first touch activation remain a normal
button click. **Skip:** a custom tooltip role, focus movement into SVG overlays,
long-press preview, or tap-once-preview/tap-twice-activate.

## Candidate comparison

| Candidate | Benefit | Failure | Decision |
|---|---|---|---|
| Delta counts only | Very cheap and mobile-safe | Answers how much, not which stable IDs | Keep as always-visible fallback, not the whole feature |
| Temporarily call `focus.setMany(target)` | Reuses current emphasis | Mutates selected focus, conflicts with Story state, looks activated | Skip |
| Full target thumbnail / cloned SVG | Familiar slide preview | Duplicates rendering, hides exact delta, adds viewport/export complexity | Skip |
| Always-open comparison matrix | Complete across every chapter | Becomes a dashboard and overwhelms the reading surface | Skip |
| Static three-way delta preview | Exact, truthful, one-SVG, no camera movement | Needs careful cancellation and accessible persistence | **Build** |

## Borrow / adapt / skip summary

| Decision | Archify contract |
|---|---|
| Borrow | LikeC4's separate transient hover state and cancelable delayed work. |
| Borrow | reveal.js's explicit stable matching and truthful unmatched boundary. |
| Borrow | React Flow's separation of hover, selection, graph mutation, and viewport. |
| Borrow | W3C's focus-without-context-change and dismissible/hoverable/persistent lifecycle. |
| Adapt | Compute an ordered three-way focus-set delta once and reuse it for rail counts, preview, and handoff classification. |
| Adapt | Keep count truth available on touch; make richer visual preview progressive enhancement. |
| Skip | New schema/IR, layout, full snapshots, morphing, edge inference, ambient motion, dependencies, and graph add/remove language. |

## Exact semantic contract

For current active view `A` and inactive target view `T`, first normalize each
`focus` list exactly as the existing focus system does: retain the first occurrence
of each ID only when it resolves to a real `[data-node-id]` in the current SVG.

Then compute:

```text
stay  = T in target order where id ∈ A
enter = T in target order where id ∉ A
leave = A in current order where id ∉ T
```

The invariants are:

```text
|stay| + |enter| = |T|
|stay| + |leave| = |A|
stay, enter, leave are pairwise disjoint
```

The UI may use compact glyphs `=`, `+`, and `−`, but visible and accessible copy
must say **stays in focus**, **enters focus**, and **leaves focus**. It must never
say added, created, removed, deleted, deployed, or destroyed. The graph objects
continue to exist in the same canonical SVG.

Only node IDs participate. Do not infer membership from labels, aliases, kinds,
containers, geometry, edges, or adjacent endpoints. Preserve display labels for
readability but retain semantic IDs in DOM data and accessible text so duplicate
labels remain unambiguous.

## Exact runtime contract

1. Preview exists only when `activeIndex >= 0`, the target index is valid and not
   active, ordinary viewer mode is present, and no handoff is active. At Show all,
   buttons retain their existing absolute `N stops` copy and no delta is claimed.
2. `chapterDelta(A, T)` is one shared pure helper used by rail counts, preview
   presentation, and handoff classification. Parallel implementations are not
   acceptable because their truth can drift.
3. With an active chapter, every inactive button shows compact truth such as
   `=2 +2 −6`; the active button keeps `N stops`. The accessible button name also
   includes target stop count and expanded focus-delta wording.
4. Preview owns one generation object, for example `{id, fromIndex, toIndex,
   source, delta}`. A newer request cancels the pending timer and invalidates all
   callbacks from older generations. Repeating the same request is idempotent.
5. Fine-pointer hover waits 120ms before presentation, following the bounded
   intent threshold demonstrated by LikeC4. Keyboard focus presents synchronously.
   Pending hover that leaves before 120ms produces no DOM mutation.
6. Pointer preview is enabled only when `matchMedia('(hover: hover) and (pointer:
   fine)')` matches. Touch/pen compatibility events and long press never start it.
7. Track hover target and focus target separately. While a chapter button is
   directly hovered, pointer intent wins; otherwise an undismissed focused target
   wins. Leaving one source may fall back to the other without stale cleanup.
8. The pointer may move from the button into the revealed delta strip or diagram
   and continue reading the same preview. Use a small bridge grace only to cross
   the physical gap; once visible, there is no auto-dismiss timer.
9. `Escape` clears the preview while leaving focus on its chapter button and marks
   that target dismissed until its hover/focus trigger genuinely ends. Preview
   Escape takes precedence over the existing Escape-to-Show-all behavior.
10. Focus, hover, and Escape do not write `activeIndex`, `aria-current`,
    `aria-pressed`, URL/hash/history, `Archify.focus`, Story Trail data,
    `storyBeatIndex`, camera state, SVG transform, or scroller offsets.
11. Starting preview pauses active Story playback once, using the existing pause
    path, because two simultaneous explanations are misleading. Leaving preview
    never auto-resumes playback.
12. Preview is a static semantic presentation, not a Motion Governor owner. It
    must not claim `handoff`, `chapter`, `story`, `trace`, or a new motion token.
13. Render a restrained, explicitly labeled `Focus delta` strip with the exact
    display labels grouped by `= stay`, `+ enter`, and `− leave`. Keep it on the
    existing Guided Views surface, horizontally scrollable, not as a new panel.
14. On the SVG, set a preview root attribute and one
    `data-chapter-preview-role="stay|enter|leave"` per participating real node.
    Viewer-only, pointer-free overlays may add a stable outline and `=`, `+`, or
    `−` badge. Geometry, paths, labels, lanes, and containers never move.
15. Non-participants may be subdued, but all three roles remain legible. Role
    glyph, line pattern/weight, text, and luminance must supplement hue. The active
    chapter button remains visually current and the target is visibly labeled
    Preview so the diagram change cannot be mistaken for activation.
16. Pointer-triggered preview must not generate an aria-live announcement.
    Keyboard users receive the exact counts and role names through the focused
    button's accessible name/description once, not once per node or frame. SVG
    overlays remain `aria-hidden="true"` and unfocusable.
17. Explicit click, Enter, Space, Previous/Next, bracket shortcut, hash change,
    playback advance, Show all, or direct-node release first invalidates preview
    presentation atomically, then continues through its existing owner.
18. Activating the previewed target passes the same computed delta to the existing
    Shared Anchor Handoff. A nonempty `stay` set enables the current stable-anchor
    policy; `stay=[]` remains an honest `no-anchor` handoff. Preview never invents
    or reserves an anchor.
19. A preview request during active handoff is ignored. Handoff settlement does
    not replay an old hover/focus request; a fresh input event is required.
20. Document hidden, `beforeprint`, ordinary embed, canonical serialization, and
    renderer teardown synchronously clear pending/visible preview state. Becoming
    visible again never restores it automatically.
21. Still and `prefers-reduced-motion: reduce` retain the useful static preview
    but remove opacity, outline, badge, and strip transitions. A preference change
    while visible settles the same roles immediately; it does not dismiss them.
22. Default embed and `?embed=1&play=1` have no rail, counts, preview attributes,
    delta strip, or listener-visible side effects. Presentation mode may use the
    ordinary contract only when its rail is actually present.
23. On touch-first mobile, the first tap activates the native chapter button.
    Suppress focus preview caused by that touch pointer sequence; never require a
    second tap. An external keyboard may still trigger focus preview.
24. At 320px and 390px, count glyphs remain visible, rail and delta strip scroll
    inside their own surface, and neither creates document-level horizontal
    overflow or captures diagram/page scrolling.
25. Canonical SVG/raster export during pending, visible, dismissed, activation,
    and cleanup phases strips root preview attributes, node roles, overlays,
    labels, and timers from the clone. Print always shows the full undimmed graph.

## Suggested implementation shape

Keep this inside the existing template-level `Archify.guidedViews` module so all
renderers inherit one implementation:

- add pure `normalizeViewFocus(view)` and `chapterDelta(from, to)` helpers;
- replace handoff's duplicate membership classification with the shared result;
- add `currentPreview`, `previewGeneration`, one pending hover timer, explicit
  `hoverTarget`, `focusTarget`, and dismissed-trigger bookkeeping;
- render compact counts in `syncChapterIndex()` from current `activeIndex`;
- add one viewer-owned, non-live, horizontally scrollable delta strip adjacent to
  the chapter rail;
- add and centrally clear `[data-chapter-preview-active]`,
  `[data-chapter-preview-role]`, and `[data-chapter-preview-overlay]` state;
- expose a read-only `guidedViews.preview()` receipt for deterministic tests, but
  do not add authoring syntax or a URL parameter;
- extend canonical cleanup and clean-state assertions with every new preview
  attribute and overlay selector.

## Acceptance checklist

- [ ] Current generated artifacts prove 19/3 shared/no-shared forward adjacent pairs and 60/6 across all directed non-self pairs.
- [ ] `agent-tool-call` 1→2 renders exactly `=2 +2 −6`; 2→3 renders `=0 +3 −4`.
- [ ] Every button count satisfies both set-size invariants for all 66 directed pairs.
- [ ] Duplicate and unresolved focus IDs are normalized exactly like `focus.setMany` and never inflate counts.
- [ ] Human copy consistently says focus membership, never architecture add/remove semantics.
- [ ] From Show all, all buttons retain absolute stop counts and no preview state is created.
- [ ] Active-chapter hover/focus creates no preview; inactive target focus creates one synchronously.
- [ ] Fine-pointer hover shorter than 120ms creates no presentation; a sustained hover creates exactly one generation.
- [ ] Ten rapid target changes leave only the latest target, no pending stale timer, and no stale overlay after cleanup.
- [ ] Pointer can move from the target to the delta strip and into the diagram without losing visible content.
- [ ] Escape dismisses preview without moving focus, changing chapter, or triggering Show all; a second Escape may use the normal contract.
- [ ] Moving focus/hover away after dismissal allows a later fresh preview of that target.
- [ ] Preview leaves `activeIndex`, `aria-current`, `aria-pressed`, URL/hash, selected focus IDs, Story Beat, and authored trail data byte-for-byte unchanged.
- [ ] Preview start/end leaves camera `{x,y,scale,mode}`, inline SVG transform, `scrollLeft`, and `scrollTop` exactly unchanged and calls no reveal/fit/reset API.
- [ ] Preview does not change Motion Governor owner or create automatic/ambient motion.
- [ ] Stay, enter, and leave roles are distinguishable in monochrome through glyph/text/pattern, not color alone.
- [ ] Pointer hover produces no screen-reader live chatter; keyboard focus announces one bounded exact summary.
- [ ] Story playback pauses on preview intent and never resumes when preview clears.
- [ ] Click/Enter/Space on a previewed shared target produces the same final handoff, anchor, focus, URL, and camera as activation without preview.
- [ ] Activating `=0` produces the existing `no-anchor` handoff with no fabricated continuity.
- [ ] Preview cannot coexist with handoff attributes or overlay; handoff-time requests do not replay after settlement.
- [ ] Still and dynamic reduced motion retain static delta truth with zero transition or animation.
- [ ] Hidden/visible, print, hash change, Show all, and direct-node release leave zero preview residue and do not auto-restore it.
- [ ] Touch at 320px and 390px activates on first tap, never produces sticky hover, and never requires long press.
- [ ] External-keyboard focus remains usable on a touch-capable device.
- [ ] Rail and delta strip remain internally scrollable with no page-level horizontal overflow at 320px and 390px.
- [ ] Ordinary embed and one-shot share embed contain zero preview controls, attributes, overlays, or automatic work.
- [ ] SVG, PNG, JPEG, WebP, copy, and print remain canonical when captured before, during, and after preview.
- [ ] Canonical clean-state assertions reject every preview root/node/overlay attribute if cleanup regresses.
- [ ] Architecture, workflow, sequence, lifecycle, and dataflow outputs inherit the same behavior without renderer-specific code.
- [ ] Existing Named Chapter Rail, Guided Views, Story Trail/Beats, Shared Anchor Handoff, Semantic Camera, Motion Governor, focus, embed, reduced-motion, and export tests still pass.
- [ ] Built-in-browser verification covers dark/light, Signal Flow/Blueprint/Classic, mouse, keyboard, 320/390px touch emulation, Still, print, embed, shared activation, and no-anchor activation.

## Risks and non-goals

The principal product risk is semantic misreading: `leave` can sound like a node
was deleted. Repeating “focus delta” in the strip and accessible copy, keeping the
active rail state unchanged, and forbidding graph-mutation vocabulary contain
that risk. The main runtime risks are stale hover timers, focus/pointer ownership
collisions, an Escape handler falling through to Show all, and preview attributes
leaking into export. One generation owner, explicit input-source bookkeeping,
priority cancellation, and canonical clean-state assertions contain those risks.

Round 31 does not add chapter authoring fields, a comparison dashboard, a second
selection, URL-encoded preview, edge deltas, graph diffs, layout changes, cloned
SVGs, snapshots, minimaps, hover on touch, long press, tap-twice activation,
ambient loops, new dependencies, analytics, or export of preview state. If the
viewer cannot prove a role from exact stable focus IDs, the truthful behavior is
to omit that role rather than guess.
