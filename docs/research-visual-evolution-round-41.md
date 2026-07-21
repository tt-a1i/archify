# Visual Evolution Round 41 — Settled Flow

Date: 2026-07-20
Status: implementation-ready research decision

## Executive decision

Build **Settled Flow**: an ordinary trace-enabled Archify artifact should run
one short ambient flow pass, then return permanently to the exact authored
relationship styles and a quiet, fully readable topology.

Do not add a motion mode, button, schema field, preset, dependency, or second
animation system.

This is not merely a calmer aesthetic. Current runtime inspection found a
semantic defect:

- ordinary trace edges and nodes use infinite CSS animations;
- every animated edge receives `stroke-dasharray: 10 8`;
- authored `a-security` relationships should settle as `5 5`;
- authored `a-dashed` relationships should settle as `4 4`; and
- switching to `Still` stops the animation but leaves the incorrect `10 8`
  line style in place.

The current effect therefore replaces meaning rather than temporarily
illustrating it. Settled Flow fixes both the endless ambient motion and that
truth regression.

The target experience is:

```text
open trace artifact
  -> one staggered edge/node operating pass
  -> authored solid/security/async line language returns
  -> graph remains quiet
  -> reader-triggered Story/Route/Lens/Relationship motion still works
```

## Candidate decision

### Candidate A — Settled Flow (**build now**)

Settled Flow improves every trace-enabled renderer and corrects a measured
semantic problem. It reuses the existing `data-animate`, Motion Governor, and
WebM pipeline. It can remain entirely viewer/CSS-owned.

### Candidate B — another Story or visual-preset feature (**skip**)

Archify already has Story Trail, Story Beats, Story Follow Camera, Story
Director, Story Horizon, three visual presets, Route Journey, Semantic Flow,
Relationship Pulse, and reader-controlled Live/Still. Another panel or preset
would increase surface area without addressing the current infinite loop or
the incorrect settled relationship style.

### Why A wins

| Axis | Settled Flow | Another feature/preset |
| --- | --- | --- |
| Proven defect | Infinite loops and overwritten author dashes | None identified |
| Reach | All five trace renderers and WebM | One new surface |
| Reader value | Motion explains once, topology then reads cleanly | More discovery cost |
| Truth boundary | Restores existing authored classes | Risks new parallel semantics |
| Dependency/schema cost | None | Likely larger |
| Round 41 decision | **Build** | Skip |

## Current-worktree evidence

### Infinite ambient ownership

`archify/assets/template.html` currently gives trace edges and nodes:

```css
animation: archify-edge-flow 2.4s linear infinite;
animation: archify-node-pulse 3.6s ease-in-out infinite;
```

Signal Flow and Blueprint adjust duration and treatment, but not the infinite
iteration contract. Signal Flow also owns an infinite six-second scan.

### Author line semantics are overwritten

The same template defines:

```css
.a-security { stroke-dasharray: 5,5; }
.a-dashed   { stroke-dasharray: 4,4; }
```

The later trace selector has greater specificity and sets every animated edge
to `10 8`. Browser readback on the checked-in workflow proof confirmed:

| State | Security computed dash | Async computed dash |
| --- | --- | --- |
| Live | `10px, 8px` | `10px, 8px` |
| Still | `10px, 8px` | `10px, 8px` |
| Authored contract | `5px, 5px` | `4px, 4px` |

Still currently stops time without restoring the authored visual language.

### Strong motion already has correct finite owners

Motion Governor already yields ambient motion to Story, Chapter, Route,
Semantic Lens, Relationship Preview, Intent Trace, Focus, and Legend. Those
signals are finite and reader-owned. Settled Flow must not replace or replay
them; it only changes the ownerless ambient opening.

### Export already has the right boundary

Static SVG/raster export uses `serializeSvg()`. WebM creates a fresh serialized
SVG image and records six seconds through `MediaRecorder`. A finite motion
selector can therefore be explicitly enabled only on the WebM clone, giving
the recording one repeatable construction-to-settled timeline while ordinary
static exports retain canonical state.

## Primary-source comparison

### Fireworks Tech Graph — construct, hold, preserve the source

The official motion contract keeps nodes, labels, containers, marker geometry,
and camera fixed. Routes draw in semantic order, then the completed topology
gets a substantial operating hold. Its quality gate preserves immutable source
paths and inserts transient motion decorations rather than rewriting source
truth. The current default is a fixed 5.75-second package with a construction
phase and readable settled interval.

Sources:

- [official repository](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)
- [official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/motion-effects.md)

**Borrow:** finite semantic order, a readable settled result, and immutable
source topology.
**Adapt:** Archify can reuse its existing CSS markers and six-second WebM
surface; it does not need Fireworks' GIF renderer or scene metadata.
**Skip:** twelve scene contracts, Puppeteer/FFmpeg, motion-role schema, GIF-only
distribution, copied signature effects, and continuously moving settled rails.

### Structurizr — motion is a story with controls

Structurizr defines animation as ordered steps that reveal elements or
relationships and provides forward/backward controls and keyboard navigation.
Its image export treats animation steps as an explicit option, not as an
ambient property of every static diagram.

Sources:

- [official animation documentation](https://docs.structurizr.com/ui/diagrams/animation)
- [official PNG/SVG export documentation](https://docs.structurizr.com/export/png-and-svg)

**Borrow:** motion has a bounded explanatory job; static export remains an
explicit stable artifact.
**Adapt:** Archify's Story features already own deliberate step navigation, so
ambient trace should simply introduce and settle.
**Skip:** a new step UI or export mode.

### LikeC4 — scenario motion stays separate from durable model truth

LikeC4 dynamic views describe a particular use case with ordered interactions,
parallel steps, notes, and navigation without polluting the durable model.

Source:

- [official dynamic-view documentation](https://likec4.dev/dsl/views/dynamic/)

**Borrow:** transient explanation must not mutate the durable relationship
model.
**Adapt:** treat Archify animation state as viewer-only; authored classes and
canonical SVG remain authoritative.
**Skip:** a new dynamic-view DSL, notes schema, or parallel-story authoring.

### D2 — loops have a comprehension cost

D2 documents animated SVG/GIF as useful for small compositions and warns that
too many boards can confuse the reader or force them to wait through a loop.

Source:

- [official composition export formats](https://d2lang.com/tour/composition-formats/)

**Borrow:** keep automatic motion short enough to understand in one pass.
**Adapt:** one topology, one finite operating pass, then rest.
**Skip:** board composition and repeated carousel-like animation.

### W3C — automatic motion must be suppressible

WCAG Pause, Stop, Hide guidance requires a way to pause or stop qualifying
automatic moving content, while the WAI carousel pattern similarly treats
automatic rotation as controlled reader state.

Sources:

- [WCAG Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- [WAI carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)

**Borrow:** Still and reduced motion remain authoritative.
**Adapt:** ending ambient motion automatically is stronger than merely adding a
pause button.
**Skip:** autoplay replay, hover restart, or a second motion preference.

## Borrow / Adapt / Skip summary

| Decision | Round 41 contract |
| --- | --- |
| Borrow | One construction/operating pass followed by a readable hold. |
| Borrow | Preserve authored paths, markers, line variants, nodes, labels, and camera. |
| Borrow | Keep deliberate story motion reader-controlled and finite. |
| Adapt | Use existing `data-animate` hooks and Motion Governor ownership. |
| Adapt | Make the six-second WebM clone opt into the same finite timeline. |
| Adapt | Cap only animation delay, never authored graph order or identity. |
| Skip | New controls, presets, dependencies, schemas, GIF renderer, or scene DSL. |
| Skip | Infinite ownerless edge, node, or background scan loops. |
| Skip | Rewriting security/async dash semantics after the pass. |

## Exact implementation contract

1. Ordinary trace-enabled pages receive `running -> settled` ambient state on
   the HTML viewer only.
2. Every edge and node ambient animation uses exactly one iteration.
3. The Signal Flow background scan also runs once and fades to no residue.
4. Trace selectors must not permanently set `stroke-dasharray` or
   `stroke-dashoffset` on the authored edge.
5. When the pass settles, `a-default` and `a-emphasis` return to solid,
   `a-security` returns to `5 5`, and `a-dashed` returns to `4 4`.
6. Animation keyframes may temporarily visualize flow but end on the underlying
   authored computed style.
7. The shared renderer animation delay is capped so every supported proof can
   settle within the existing six-second WebM window.
8. The cap changes only `--step`; graph/source order, Story order, IDs, and
   relationship semantics remain untouched.
9. Motion Governor starts the ambient pass at most once per page lifecycle.
10. Still, reduced motion, hidden documents, embeds, share playback, or a
    stronger semantic owner settle/suppress ambient motion without later replay.
11. Returning from Still to Live does not replay the ambient opening.
12. Clearing Focus/Route/Lens/Story ownership does not replay it.
13. Story, Route, Lens, Relationship, Intent, Chapter, and camera behavior keep
    their existing finite contracts.
14. The Live/Still control remains the only motion control; no new row, badge,
    toggle, or storage key is introduced.
15. Ordinary embeds remain calm unless their existing explicit bounded story
    is requested.
16. Static SVG, PNG, JPEG, WebP, print, and clipboard outputs remain canonical.
17. WebM serialization explicitly opts its clone into one finite ambient pass
    and captures a settled hold before the existing six-second stop.
18. WebM export does not depend on the viewer's already-settled runtime phase.
19. Static artifacts without `meta.animation: trace` gain no motion state or
    visible control.
20. No schema, renderer geometry, layout, marker, relationship ID, dependency,
    or JSON authoring surface changes.

## Failure modes

1. Changing `infinite` to `1` while leaving base `10 8` declarations in place.
2. Security and async edges look correct only in Still, not after natural settle.
3. Finished animations jump back to the starting dash offset.
4. Focus or Story cleanup restarts the ambient pass.
5. Switching Still -> Live restarts the pass.
6. A hidden tab finishes then unexpectedly replays on visibility return.
7. Embeds begin ownerless motion again.
8. Reduced-motion readers receive even one automatic pass.
9. The last delayed node exceeds the six-second WebM duration.
10. WebM records a permanently settled clone and loses motion.
11. Static SVG/raster exports acquire viewer phase attributes.
12. The implementation clones or mutates authored paths in the live DOM.
13. Signal Flow scan continues after graph motion settles.
14. Blueprint loses its square/no-glow identity.
15. A new control or schema field is added to solve runtime choreography.

## Test contract

1. All five renderers emit trace hooks and inherit the same finite CSS/runtime.
2. No ambient edge/node/scan selector contains `infinite`.
3. Runtime exposes one `running` and terminal `settled` phase.
4. Phase start is generation-owned and cannot restart after settle.
5. Owner, Still, reduced motion, hidden state, embed, and share paths settle.
6. Authored class definitions remain `5 5` and `4 4`; trace base rules do not
   override them after animation.
7. `--step` is deterministically capped without affecting small examples.
8. WebM clone alone receives its motion-export opt-in attribute.
9. Static canonical serialization removes that attribute.
10. Golden renderer output, Gallery receipts, Guide, README proof, ZIP doctor,
    ZIP validation, and the complete test suite remain green.

## Built-in browser acceptance

### Ordinary desktop trace artifact

1. At load, root phase is `running` and computed iteration count is `1`.
2. Edge/node motion is visibly staggered without moving nodes, labels, camera,
   markers, or layout.
3. Within six seconds, root phase becomes `settled`.
4. Settled edges have no active ambient animation.
5. Security computes to `5px, 5px`; async computes to `4px, 4px`.
6. Still -> Live leaves the phase settled and does not replay.
7. Focus or a deliberate Story/Route action still gets its bounded signal.

### Mobile and embed

8. At 390px, the existing Live/Still control stays at least 44px and the page
   has no horizontal overflow.
9. Mobile ambient motion settles exactly once.
10. Ordinary embed starts static/settled; explicit `?play=1` Story still plays
    once and settles.

### Export and accessibility

11. Reduced-motion CSS/runtime keeps the authored static topology.
12. Download SVG remains canonical and contains no viewer phase state.
13. A short browser WebM smoke returns a non-empty blob when supported.
14. The WebM timeline begins moving even if the live viewer had already settled.
15. Print and raster export remain complete and still.
16. No application-origin console warning or error is introduced.

## Decision

Implement Settled Flow now.

The transferable lesson from Fireworks is not the number of styles or the GIF
pipeline. It is the discipline of a finite semantic construction followed by a
legible settled topology, with source geometry and meaning preserved. Archify
can absorb that lesson more cleanly: one dependency-free viewer contract across
five renderers, existing reader-controlled interactions, existing WebM export,
and exact restoration of the author's relationship language.
