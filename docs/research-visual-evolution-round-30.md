# Visual Evolution Round 30 — Shared Anchor Chapter Handoff

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build **Shared Anchor Chapter Handoff** as the next bounded viewer slice.
Archify already has the right substrate: one canonical SVG, stable semantic node
IDs, Named Chapter Rail, Story Beats, a bounded Semantic Camera, and the Round 29
Motion Governor. The missing quality is continuity between chapters. Today a
chapter activation replaces focus/trail state and asks the camera to fit the new
nodes, but the reader receives no truthful visual answer to “what persisted?”;
rapid retargeting can also remove the CSS transition before rebasing from the
currently rendered transform, producing a snap.

The handoff should preserve one real shared node on screen, briefly classify
shared/leaving/entering nodes, then settle the existing camera on the destination.
If no shared ID exists, it must use a restrained bounded retarget without inventing
continuity. This is a viewer enhancement only: no schema, layout, renderer,
canonical SVG, dependency, or export-model change.

## Evidence and scope

The current Guided Views activation writes destination focus, Story Trail,
camera, rail, and URL state in one synchronous path, while playback advances every
3.2 seconds ([template](../archify/assets/template.html#L5784-L5890)). Semantic
Camera uses one mutable transform and a 480ms CSS transition; stopping removes the
moving class, and a new fit immediately replaces target state
([camera](../archify/assets/template.html#L6083-L6252)). The Governor already has
replaceable token ownership and stale-release protection
([governor](../archify/assets/template.html#L4373-L4582)). SVG export clones the
canonical graph and strips viewer transforms and overlays
([serialization](../archify/assets/template.html#L3709-L3830)).

Primary comparisons are pinned to fixed source:

- Fireworks separates its staged semantic GIF from its static interactive HTML
  viewer and keeps motion bounded to routes while geometry remains fixed
  ([README@50c819d](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L140-L149),
  [capabilities](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/docs/CAPABILITIES.md#L30-L33)).
- LikeC4 reads the current viewport, finds a node corresponding across views,
  preserves its screen position, then settles the target; absent a match, it uses
  a bounded camera fallback
  ([navigation@f0ce898](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/diagram/src/likec4diagram/state/machine.state.navigating.ts#L72-L277)).
- reveal.js gives explicit IDs priority, permits an explicit restart when
  continuity is false, and distinguishes matched from unmatched elements
  ([official Auto-Animate](https://revealjs.com/auto-animate/)).
- Mapbox replaces an active camera ease before starting another and resolves to
  zero-duration/jump behavior under reduced motion
  ([camera@e3dec292](https://github.com/mapbox/mapbox-gl-js/blob/e3dec29241663b30725d13ae9a3b5c29e994db50/src/ui/camera.ts#L1324-L1459)).
- React Flow exposes duration/easing/interpolation and subset-node fitting as a
  camera contract ([FitViewOptions](https://reactflow.dev/api-reference/types/fit-view-options));
  D3 specifies that a new same-name transition interrupts the active one
  ([transition control](https://d3js.org/d3-transition/control-flow)).
- W3C requires non-essential interaction motion to be disableable and defines
  reduced motion as a request to minimize it
  ([WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html),
  [Media Queries 5](https://drafts.csswg.org/mediaqueries-5/#prefers-reduced-motion)).

## Borrow / adapt / skip

| Decision | Contract |
|---|---|
| Borrow | LikeC4's real corresponding-node anchor and bounded no-match fallback. |
| Borrow | reveal.js's stable-ID matching, explicit restart, and unmatched policy. |
| Borrow | Mapbox/D3 replacement semantics: latest intent wins; cancellation is normal. |
| Borrow | Fireworks' fixed geometry, small changing area, finite staged motion, and settled frame. |
| Adapt | Archify needs no cloned views or heuristic matching: both chapters reference the same persistent `data-node-id` elements. |
| Adapt | One camera transaction must commit semantic destination state immediately, animate only presentation, and expose `finished` settlement. |
| Skip | View Transitions API snapshots: the same SVG elements already persist; snapshots complicate hit testing, cleanup, support, and export. |
| Skip | Layout/edge morphing, springs, fly arcs, parallax, full-canvas blur/wipe, and infinite chapter loops. |
| Skip | React, XState, D3, Mapbox, reveal.js, or another runtime dependency. |

## Exact runtime contract

1. A handoff exists only for real chapter-to-chapter activation. Overview-to-
   chapter and chapter-to-overview use the existing bounded camera contract.
2. Compute `shared = previous.focus ∩ next.focus` using stable IDs only. Choose
   the current Story Beat if shared; otherwise choose the shared item nearest the
   end of the outgoing focus order; break ties by destination order, then ID.
3. Classify destination presentation as `stay`, `leave`, and `enter`. The anchor
   remains fully legible; leaving/entering states use opacity/emphasis only.
   Nodes, edges, labels, lanes, and containers never change authored geometry.
4. A single `aria-hidden="true"`, `pointer-events:none` anchor ring may be drawn
   from the node bounding box. It is runtime-only, never a cloned node.
5. Claim Governor owner `handoff` before visible mutation. One monotonic camera
   generation owns rAF, timer, overlay, completion, and cleanup. Releasing it
   returns ownership to the active chapter/story.
6. `Archify.view.reveal()` should return a transaction `{ id, state, finished,
   cancel(reason) }`. `finished` always settles once as `complete`, `replaced`,
   `manual`, `reduced-motion`, `hidden`, or `resize`.
7. Animate from the **currently rendered** `{x,y,scale}` to the new bounded fit
   over 420ms with the existing ease-out curve. Do not remove a CSS class in a way
   that snaps to an obsolete inline target; rAF interpolation is the safer fit.
8. A new chapter during motion samples the current transform, invalidates the old
   generation, removes its presentation state once, and retargets. Old callbacks
   cannot clear the new handoff. The rail, count, accessible label, hash, focus,
   and Story receipt always reflect the latest destination immediately.
9. Pointer pan, wheel/pinch, manual zoom/reset, or direct node exploration cancels
   at the sampled position with no jump, pauses Story, clears the ring/classes,
   and transfers camera ownership to the reader.
10. When there is no shared ID, publish `mode=no-anchor`, omit the ring, use one
    direct bounded camera retarget, and crossfade semantic emphasis only. Never
    infer an anchor from labels, proximity, kinds, or edge endpoints.
11. Story Beats and the 3.2s reading timer begin only after the winning handoff
    settles; replaced generations never start a beat or timer. This prevents two
    simultaneous explanations and preserves a full chapter dwell.
12. Still, dynamic reduced motion, hidden document, print, and ordinary embed
    synchronously commit the final destination with no transition or overlay.
    A preference change mid-flight snaps to the winning destination and pauses
    playback; returning to Live/visible never auto-replays it.
13. Wide mobile keeps scale 1 and interpolates contained `scrollLeft` only; touch
    input cancels it. No document-level horizontal overflow, page scroll capture,
    or hover requirement is introduced.
14. Default embed has no handoff. `?embed=1&play=1#view=...` has only one named
    chapter, so it settles that chapter without inter-chapter motion. Presentation
    Stage may use the handoff under the same Governor policy.
15. Export during any phase removes handoff root attributes, node presentation
    attributes, ring, transform, and timers from the clone. SVG/raster receipts
    remain canonical; print shows the full undimmed diagram; WebM behavior is
    unchanged.

## Acceptance checklist

- [ ] One shared ID produces exactly one anchored handoff; multiple IDs use the deterministic priority above.
- [ ] No shared ID produces `no-anchor` behavior and no fabricated visual connector.
- [ ] Final focus, Story Trail, rail, count, URL, camera, and accessible status equal direct destination activation.
- [ ] Anchor screen-position drift is at most 2 CSS px during the anchor phase at DPR 1 and 2.
- [ ] The final camera equals the existing bounded semantic fit and remains within scale/padding caps.
- [ ] Ten rapid rail clicks leave only the tenth chapter, one camera generation, zero stale timers, and zero overlays after settlement.
- [ ] Rapid Prev/Next, `[`, `]`, hash changes, playback advance, and Presentation navigation obey the same last-intent-wins rule.
- [ ] Pointer/touch interruption has no visible snap greater than 2 CSS px and never resumes Story automatically.
- [ ] Story Beat/progress does not start before handoff settlement and never starts for a replaced generation.
- [ ] Live-to-Still, media-query reduce, visibility hidden, and resize each leave a complete destination and no animation residue.
- [ ] Keyboard activation matches pointer behavior; focus never moves into the SVG ring; announcements do not repeat per frame.
- [ ] At 320px and 390px, chapter activation stays inside the diagram scroller and all controls remain usable.
- [ ] Normal embed, one-shot share embed, print, SVG, PNG/JPEG/WebP/copy, and WebM keep their existing boundaries.
- [ ] Canonical export during start/mid/cancel/end reports clean state and contains no handoff attributes or overlay.
- [ ] Existing Guided Views, Semantic Camera, Motion Governor, Story Trail/Beats, Radar, focus, direct-node release, and reduced-motion tests still pass.
- [ ] Browser verification covers Chromium desktop/mobile emulation: shared anchor, no-anchor, rapid retarget, manual interrupt, Still, dynamic reduce, hidden/visible, embed, print preview, and export-mid-flight.

## Risks and non-goals

The principal risks are transform snapping, stale completion callbacks, motion
competition with Story Beats, and misleading continuity. Generation ownership,
sampling the rendered transform, delayed beat start, and stable-ID-only matching
directly contain them. Performance risk stays bounded: one SVG, one ring, at most
three presentation classes per node, one rAF loop, and no layout recomputation per
frame.

Round 30 does not add authoring syntax, chapter transition configuration, viewport
history, a new panel, a second SVG, DOM snapshots, layout animation, edge-path
morphing, scroll-driven chapters, cross-document transitions, or multi-chapter
embed autoplay. If the implementation cannot preserve a truthful anchor, the
correct fallback is a clean cut to the existing bounded destination.
