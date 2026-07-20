# Visual Evolution Research — Round 49

Date: 2026-07-20
Scope: desktop-first, exact Story Beat semantics in full artifacts and explicitly
requested share playback.

## Decision: Semantic Story Carrier

Round 49 should connect the five **Semantic Flow Tokens** from Round 48 to the
existing Story Beat owner. When deliberate story playback advances across one
exact authored relationship, one matching call/data/event/security/state token
travels once along that exact relationship. The source route, marker, label,
nodes, camera target, beat caption, and Story Trail remain unchanged.

This is a stronger next slice than another viewer panel, minimap, style preset,
ambient loop, or motion owner. It makes the project's primary presentation and
README proof surface tell the same semantic story that direct relationship
inspection already tells, while closing a concrete identity bug first.

## Current evidence and gap

The shared viewer already has the right pieces, but they do not meet:

- [`relationshipTokenKind()` and `relationshipTokenGeometry()`](../archify/assets/template.html)
  classify one exact relationship as call, data, event, security, or state and
  move a compact token on its authored `path`, `line`, or `polyline` geometry;
- [`storyStep()` and `pulseStoryStep()`](../archify/assets/template.html) build
  ordered Story Beats and animate the generic Story Trail flow;
- [`storyMotionAllowed()`](../archify/assets/template.html) rejects every embed,
  even when the URL explicitly requested the existing `?embed=1&play=1` share
  contract;
- [`followStoryStep()`](../archify/assets/template.html), by contrast, correctly
  permits an embed only when `data-share-playback="true"`, so the camera and
  captions advance while the exact-edge carrier is absent.

There is also an exact-identity defect before motion is considered. `storyStep()`
iterates every DOM element with edge semantics and pushes each matching element.
Labeled relationships are emitted both as the drawable route and as a context
label group with the same `data-edge-key`. In the current Agent Tool Call Gallery
artifact, 5 of 11 relationship keys occur twice (`1`, `3`, `5`, `9`, `10`). The
`happy-path` story includes `chat → planner`, whose authored relationship is key
`1`; its route and label group are therefore counted as two “edges”, classified
as `multiple`, and excluded by the existing `step.edges.length === 1` pulse gate.
The source JSON proves that this is one relationship with ID `plan-request`, not
two parallel relationships.

Authoritative local evidence:

- [Agent Tool Call story source](gallery/sources/agent-tool-call.workflow.json)
- [compiled Agent Tool Call artifact](gallery/artifacts/agent-tool-call.workflow.html)
- [shared Story Beat implementation](../archify/assets/template.html)

The first implementation action must therefore be **deduplicate semantic edge
records by `data-edge-key` before deciding `forward`, `reverse`, or `multiple`**.
Do not paper over the bug with a looser `>= 1` motion condition.

## Primary-source comparison

### Fireworks Tech Graph: semantic carriers are route-owned and fail closed

Inspected revision:
[`50c819d68fd4fee330b3010988cd13e98b678d44`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44).

Fireworks' official motion contract keeps nodes, labels, containers, markers,
geometry, and camera fixed while connector motion follows semantic order
([rules 1–7](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L38-L53)).
Its scenes use recognizable route-owned carriers such as a Blueprint
registration bead and a Notion memory card, both derived from the source path
([Blueprint bead](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L178-L205),
[memory card](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L224-L249)).
Repeated semantic roles become independently addressable through an exact
`(role, stage, order)` identity, and stripping motion metadata restores the same
static geometry
([identity contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L251-L273)).

**Borrow:** one meaningful carrier on an exact, immutable source route; fail
closed when route identity is ambiguous.
**Adapt:** Archify already has stronger stable `data-edge-key` / optional
relationship IDs and five cross-renderer tokens, so reuse those instead of
adding Fireworks' scene metadata matrix.
**Skip:** 5.75-second infinitely looping GIF operation, per-style schedules,
new media formats, ambient carrier streams, and copied signature geometry.

### React Flow: the moving object and visible edge share one computed path

Inspected library revision:
[`dd308ab401d49518f73d1e91c43faf254ff5a4c9`](https://github.com/xyflow/xyflow/tree/dd308ab401d49518f73d1e91c43faf254ff5a4c9).
The first-party Animating Edges example renders the normal `BaseEdge` and passes
the same `edgePath` to an SVG `<animateMotion>` carrier
([official example](https://reactflow.dev/examples/edges/animating-edges#animating-svg-elements)).
The path remains the source of truth; motion is an adjacent visual layer rather
than a second route calculation.

**Borrow:** bind the carrier to the already compiled exact path.
**Adapt:** reuse the existing finite token vocabulary inside Story's established
780 ms exact-edge pulse rather than the example's indefinite generic circle.
**Skip:** React, editable-node state, duplicated path calculation, indefinite
repeat, and moving a whole node along an edge.

### AntV G6: a carrier can be an edge-owned subshape, but lifetime matters

Inspected revision:
[`7b7ff8e2b52609486840963dc1608d9f565e7f66`](https://github.com/antvis/G6/tree/7b7ff8e2b52609486840963dc1608d9f565e7f66).
G6's official fly-marker example creates a marker as a subshape of the exact edge
and uses that edge's key shape as `offsetPath`
([source lines 5–16](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/site/examples/animation/persistence/demo/fly-marker.js#L5-L16)).
Its separate path-in example shows a bounded path reveal with an explicit
500 ms duration and retained end state
([source lines 3–15](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/site/examples/animation/persistence/demo/path-in.js#L3-L15)).

**Borrow:** keep the moving mark owned by the exact relationship geometry, and
make lifetime explicit.
**Adapt:** one carrier per selected Story Beat, with Archify's existing cleanup
and motion governor.
**Skip:** the graph runtime, custom-edge registry, infinite iterations, and
persistent ant-line/fly-marker decoration.

## Borrow / Adapt / Skip

| Decision | Round 49 boundary |
|---|---|
| **Borrow** | A recognizable carrier follows one exact immutable route; carrier and visible relationship use the same path and authored direction. |
| **Adapt** | Reuse Round 48's five token kinds and geometry inside the current Story owner; allow it in ordinary artifacts and only in the already explicit `data-share-playback=true` embed contract. |
| **Adapt** | Normalize Story Beat edges to one semantic record per stable `data-edge-key` before classifying direction or multiplicity. |
| **Adapt** | Keep a generic static Story Trail and caption for grouped/no-edge and genuinely parallel-edge beats; motion must fail closed rather than choose arbitrarily. |
| **Skip** | New schema fields, scene roles, token chooser, toolbar control, dependency, layout pass, renderer-specific playback code, or separate timer/owner. |
| **Skip** | Motion in passive embeds, on page load without `play=1`, exact-moment links, Still/reduced-motion/hidden/print/export states, or mobile-specific behavior. |
| **Skip** | Infinite loops, simultaneous multi-edge carriers, random path choice, label-text inference, camera/background/node motion, or canonical SVG residue. |

## Proposed contract

1. Factor the existing token classification and geometry into one shared runtime
   helper. Relationship Preview and Story playback must call the same helper;
   do not copy the five token branches.
2. Build one semantic relationship record per `data-edge-key`, retaining the
   first real drawable route plus its authored direction, wrapper transform,
   optional relationship ID, label, and kind evidence. Context label groups are
   annotations of that record, not extra relationships.
3. A Story Beat is carrier-eligible only when the deduplicated result contains
   exactly one forward or one reverse authored relationship.
4. The token always travels in the relationship's authored source-to-target
   direction. A story sequence that visits the endpoints in reverse still uses
   the reverse-caption contract; it must not visually reverse authored traffic.
5. Starting an eligible beat adds at most one story-only carrier beneath nodes
   and labels. It uses Story's existing 780 ms finite pulse timing and current
   owner generation. No separate claim, interval, or infinite animation is
   created.
6. Ordinary full artifacts permit the carrier under Live. An embed permits it
   only when `data-embed=true` **and** `data-share-playback=true`, which is already
   the explicit `?embed=1&play=1` contract. Passive embeds and exact-moment links
   remain static.
7. Beat replacement, pause, Stop/Still, reduced motion, hidden document, manual
   navigation, print, export, chapter change, and playback completion remove the
   carrier synchronously. Stale `animationend` callbacks cannot clear or release
   a newer Story owner.
8. Static meaning never depends on the token. Story Trail, beat caption, active
   node, route direction copy, and settled edge emphasis remain complete when
   motion is unavailable.
9. No dedicated mobile product work is added. Narrow layouts inherit the same
   static fallback only; desktop presentation and documentation embeds are the
   target surface.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A label group is counted as a second relationship | Deduplicate by stable `data-edge-key`; test labeled and unlabeled edges across all five renderers. |
| Two real parallel edges share endpoints | Preserve distinct keys and classify the beat as `multiple`; show no arbitrary carrier. |
| Reverse story order lies about data direction | Animate only authored source-to-target geometry and retain explicit reverse copy. |
| A carrier outlives its beat or clears a newer beat | Tie overlay cleanup to the Story generation/owner token and reject stale callbacks. |
| README embed becomes ambient animation | Permit only the existing explicit `play=1` request; keep passive embed, moment links, Still, and reduced motion static. |
| Token and generic trail compete visually | One token only, 780 ms, beneath nodes/labels; no added dash stream or glow family. |
| Runtime decoration leaks into exports | Strip story-carrier overlay and runtime attributes in canonical SVG/raster serialization and synchronously before print. |

## Acceptance criteria

1. All five typed renderers inherit one Story Carrier implementation through the
   shared template; no renderer gains a private playback branch.
2. A fixture with one labeled relationship emits two semantic DOM fragments but
   resolves to one Story relationship key, one forward/reverse beat, and at most
   one token.
3. Two genuinely distinct parallel relationship keys remain `multiple` and
   produce no carrier.
4. Call, data, event, security, and state beats use the exact same deterministic
   classification precedence and SVG shapes as Relationship Preview.
5. `path`, `line`, and `polyline` routes, wrapper transforms, bent routes,
   vertical routes, and authored reverse direction are covered.
6. The token begins only when the beat deliberately advances or is activated as
   part of explicit playback; hover, focus, URL restoration, and a pinned moment
   do not restart it.
7. One token is finite (780 ms), remains below nodes/labels, and is absent
   after animation end, pause, replacement, chapter change, completion, hidden
   document, Still, reduced motion, print, and export.
8. `?embed=1&play=1` visibly advances the Story Carrier; `?embed=1` and
   `#view=...&beat=...` remain static. Turning Live to Still during share playback
   removes the token without changing the truthful active beat.
9. Canonical SVG and raster/export snapshots contain no carrier element,
   `animateMotion`, Story owner residue, runtime token kind, or runtime edge key.
10. Browser validation covers at least:
    - Workflow Signal Flow dark: labeled call and security beats;
    - Architecture or Data Flow: data/event carrier on a bent or vertical route;
    - Lifecycle: state carrier;
    - Blueprint light: crisp token without glow;
    - explicit README/Gallery share embed, passive embed, and Still transition;
    - zero console errors and zero runtime overlays after each finite pass.
11. Focused Story/relationship/motion/export tests, all 11 Gallery artifacts,
    composition checks, full `npm test`, and `git diff --check` remain green.

## Why this is not duplicate scope

- Round 13 added the **Story Trail**, which explains ordered topology with a
  generic route overlay; it does not classify the payload traveling on a beat.
- Rounds 16, 37, 38, 39, and 41 added beat order, camera follow, director copy,
  future context, and settled handoff; none reuse relationship-kind carriers.
- Round 48 added **Semantic Flow Tokens only to direct Relationship Preview**.
  Its own embed guard prevents them from appearing in the primary story/share
  proof path.
- Round 49 adds no new authored fact, reader mode, control, panel, camera rule,
  or motion owner. It repairs relationship identity and lets two already shipped
  systems share one exact semantic visual vocabulary.

## Recommendation

Proceed with **Semantic Story Carrier** as Round 49. First make Story Beat edge
identity truthful by deduplicating DOM fragments to stable relationship keys.
Then reuse—not clone—the Round 48 token builder inside the existing finite Story
owner. Permit the carrier in full desktop artifacts and the already explicit
`?embed=1&play=1` share contract only. This is a small implementation surface
with outsized product effect: the diagram's formal story, README proof, and
direct exploration finally speak the same visual language.
