# Visual Evolution Round 25 — Directional Flow Pulse

Research date: 2026-07-19 (Asia/Shanghai)

## Product question

Archify already has optional trace animation, one-hop Intent Trace, directed
Route Probe, Story Trail, and exact Relationship Preview. The next motion change
should therefore not ask “how can more things move?” It should ask:

> Can a reader see the direction of one real relationship immediately, without
> turning the whole technical diagram into an ambient screensaver?

The strongest next step is a short, interaction-bound **Directional Flow Pulse**
on the exact edge already selected by Relationship Preview. This makes the
diagram feel alive at the moment motion carries meaning, while retaining one
canonical topology and one stable geometry.

## Current Archify evidence

- Every typed renderer already exposes relationship identity and direction as
  `data-edge-key`, `data-edge-from`, and `data-edge-to`. No motion-specific schema
  or IR field is needed.
- [`template.html`](../archify/assets/template.html) already clones authored edge
  geometry for Intent Trace, Route Probe, and Story Trail. These overlays are
  viewer-only, pointer-transparent, removed on state exit, and stripped from
  canonical SVG export.
- Relationship Preview already resolves one exact relationship row to its source,
  target, edge key, and endpoint nodes, but currently communicates direction only
  through row text, endpoint color, arrow markers, and a static glow.
- The optional `meta.animation: "trace"` remains an author-requested presentation
  mode. It should not become the prerequisite for this reader interaction, and
  Round 25 should not broaden its ambient loops.
- Reduced-motion CSS already makes Intent Trace, Route Probe, Story Trail, and
  authored trace output static. Round 25 should strengthen that boundary rather
  than create a parallel preference system.

## Primary-source findings

### fireworks-tech-graph: the life comes from fixed geometry plus semantic traffic

The inspected repository is
[`yizhiyanhua-ai/fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44),
at source snapshot `50c819d`. Its motion surface is not a general graph particle
engine: a generated semantic SVG is accepted only by a validated, scene-specific
SVG-to-GIF pipeline. The default result is 960px wide, 5.75 seconds, 20fps, 115
frames, and infinitely looping; its offline interactive HTML viewer is a separate
static surface
([motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L1-L36),
[interactive viewer source](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L250-L328)).

Its effective visual grammar has two phases. Routes first draw in by cloning the
source edge and changing `stroke-dashoffset`; after arrival, a marker-free body
and brighter head advance toward the target. The original node, label, container,
marker, and camera geometry remains fixed
([documented rules](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md#L38-L52),
[draw-on implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L822-L970),
[stream/head implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L987-L1117)).
My product inference is that this is why the samples read as systems operating
rather than cards wobbling: motion follows the authored source-to-target route
while the reader's mental map does not move.

Later styles replace generic dots with small scene-specific carriers—task
capsules, policy seals, token trains, review cursors, event cars, and telemetry
heads—while still advancing them along the authored path. Their implementation
uses path length and tangent direction to translate and rotate the carrier, with
endpoint clearance and fixed source geometry
([scene contracts](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L287-L429),
[path-following implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L1709-L1795)).
The useful first-step lesson is semantic direction, not the number of bespoke
carrier designs.

The implementation is disciplined about overlay ownership. Motion clones are
`aria-hidden`, pointer-transparent, stripped of identity, and normally stripped
of markers and filters; a runtime sentinel asserts that the static DOM did not
change at every sampled frame
([clone preparation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L896-L919),
[static-DOM guard](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L2338-L2402)).
Archify can borrow this invariant directly with far less machinery.

The repository also demonstrates where not to copy the delivery model. Its motion
export requires Chromium and FFmpeg, and the renderer enforces explicit limits of
25fps, 4096px per side, 500 frames, 16 megapixels per frame, and 600 million total
rendered pixels
([render budget source](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/svg2gif.js#L2735-L2782)).
Its own website handles reduced motion by replacing animated GIF sources with
static PNGs, because a standalone GIF cannot respond to a live CSS preference
([showcase markup](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/index.html#L223-L246),
[preference switch](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/index.html#L313-L316)).
Archify's self-contained HTML viewer can apply the preference directly and should
keep its zero-runtime-dependency advantage.

### G6: useful motion is attached to a graph event or lifecycle stage

G6's official edge-animation example computes the edge length and runs a 500ms
`lineDash` path-in animation only when the edge is created. The demo creates that
edge from an explicit Connect action rather than running a permanent global loop
([official example source](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/site/examples/animation/basic/demo/enter-edge-path-in.js#L3-L11),
[interaction source](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/site/examples/animation/basic/demo/enter-edge-path-in.js#L36-L57)).
G6 separately exposes animation as a configurable part of click-selection state,
including the selected element and a bounded neighbor degree
([ClickSelect source](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/behaviors/click-select.ts#L19-L41),
[event binding and state update](https://github.com/antvis/G6/blob/7b7ff8e2b52609486840963dc1608d9f565e7f66/packages/g6/src/behaviors/click-select.ts#L129-L168)).

The transferable idea is stage ownership: creation, selection, preview, and
removal decide when motion exists. Archify does not need G6's renderer, extension
registry, state engine, or dependency graph to follow the same rule.

### Sigma.js: schedule only necessary work and cancel owned frames

Sigma's renderer coalesces repeated render requests into one
`requestAnimationFrame`, and its teardown cancels outstanding frames before
discarding state
([scheduler source](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/sigma/src/sigma.ts#L2128-L2155),
[cleanup source](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/sigma/src/sigma.ts#L2368-L2389)).
For Archify's smaller fixed SVGs, the simpler equivalent is stronger: create at
most one exact-edge overlay on preview entry, let a finite CSS animation run, and
remove the overlay on preview exit. There is no reason to add a perpetual JavaScript
frame loop or reprocess the graph.

### W3C: hover is not permission for endless motion

WCAG 2.2 distinguishes automatic/general-interaction motion from intentional
activation. Motion that starts automatically—or merely because of hover or focus—
and continues beyond five seconds alongside other content needs a pause, stop, or
hide mechanism. The guidance explicitly says hover/focus is not the same as
activating a button
([WCAG 2.2 SC 2.2.2 explanation](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)).
WCAG 2.2 SC 2.3.3 additionally requires non-essential motion triggered by
interaction to be disableable, and identifies `prefers-reduced-motion` as a
sufficient route
([Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions),
[C39 technique](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)).

This rules out an infinite Relationship Preview or Intent Trace loop on hover.
The safer Archify grammar is a short one-shot directional pulse, with the static
edge, arrow, endpoint emphasis, and text retaining all meaning when motion is
reduced or already finished.

## Candidate decision

| Candidate | Reader value | Boundary cost | Decision |
|---|---:|---:|---|
| One-shot pulse on the exact Relationship Preview edge | High | Low | **Build next** |
| Make passive Intent Trace motion finite as part of the same motion audit | High | Low | **Build with it** |
| Add a global FLOW mode over every edge | Uneven | Medium | Postpone; it has no honest semantic schedule on arbitrary diagrams |
| Add style-specific trains, cards, gems, halos, and particles | Demo-heavy | High | Skip; visual grammar would outrun the IR semantics |
| Add Chromium/FFmpeg GIF generation to the default runtime | Medium | Very high | Skip; violates zero-runtime-dependency delivery |
| Move nodes, labels, containers, or the camera | Low | High | Skip; destroys reading stability |

## Recommended interaction contract

1. Upgrade the existing Relationship Preview row instead of adding another nav
   button, panel, authoring field, or durable URL mode.
2. On fine-pointer entry or keyboard focus of a relationship row, reuse its exact
   stable edge key and authored `from → to` direction. Incoming relationships still
   travel in their authored direction; they do not reverse merely because the
   currently focused node is the target.
3. Insert one `aria-hidden`, `pointer-events="none"` overlay group beside the
   authored edge layer. Clone only the matching `path`, `line`, or `polyline`
   geometry, preserve any owner transform, strip IDs, markers, filters, roles, and
   semantic data attributes, and set `pathLength="1"`.
4. Keep the authored edge as the quiet rail. The clone is one short, rounded,
   high-contrast packet head that moves source-to-target by normalized
   `stroke-dasharray` / `stroke-dashoffset`; do not add random particles.
5. Run one bounded pass of roughly 1.0–1.4 seconds. It may restart only after a
   new preview entry or an intentional replay action. It never repeats forever
   merely because a pointer or keyboard focus remains parked on the row.
6. Keep endpoint colors, arrow marker, direction copy, and exact relationship label
   fully informative before, during, and after the pulse. Motion enhances meaning;
   it is not the sole carrier of meaning.
7. Remove the overlay immediately on row exit, focus transfer, Focus clear, Escape,
   Lens/Route/Story takeover, page hiding, embed state, print, or canonical export.
   At most one relationship pulse owns the diagram at a time.
8. Under `prefers-reduced-motion: reduce`, create no moving pulse (or render it as
   a static emphasis with no dash displacement). The same relationship remains
   completely understandable.
9. In the same round, replace passive Intent Trace's current infinite hover loop
   with a finite duration below five seconds. Route Probe and Story Trail are
   explicit, clearable reader operations and keep their separate playback contract.
10. Do not change the compiler, schema, IR, node coordinates, edge routing,
    viewBox, camera, authored SVG, or standalone export semantics.

## Borrow / skip boundary

### Borrow now

- Fixed canonical geometry with a transient marker-free motion layer.
- One bright directional head over the real authored path.
- Exact source-to-target semantics rather than visually convenient direction.
- Event-owned lifetime, finite duration, immediate cleanup, and one active owner.
- Small dynamic surface area; nodes, text, boundaries, labels, and camera stay still.
- Reduced-motion parity and static meaning before motion.
- Deterministic tests for direction, ownership, canonical cleanliness, and teardown.

### Deliberately skip

- No G6, Sigma, Canvas, WebGL, Graphology, Chromium, Puppeteer, FFmpeg, or GIF
  dependency in the viewer or compiler.
- No motion metadata field, style-specific scene contract, renderer layout rule,
  particle system, physics, or general animation timeline.
- No ambient whole-graph infinite loop, synchronized edge flashing, autoplay on
  hover/focus for more than five seconds, or motion without a static equivalent.
- No moving nodes, labels, cards, groups, boundaries, camera, zoom, or topology.
- No glow/filter stack on every edge and no more than one transient relationship
  owner at a time.
- No motion state in printed output, canonical SVG, PNG/JPEG/WebP export, or embed
  editing chrome.

## Concrete acceptance criteria

1. All five typed renderers inherit the pulse through existing stable edge hooks;
   there is no renderer-specific relationship list or new schema/IR field.
2. Pointer preview and keyboard focus resolve the exact deduplicated edge key, and
   only that relationship plus its real endpoints remain strong.
3. The packet always advances from compiled `data-edge-from` to `data-edge-to`,
   including incoming rows, reverse-layout routes, polyline bends, and self loops.
4. Overlay clones preserve geometry and owner transforms but contain no original
   ID, semantic edge attributes, markers, filters, accessible name, or pointer hit
   target. The original edge DOM and coordinates remain byte/attribute stable.
5. There is at most one pulse overlay group. A new preview atomically replaces the
   old one; clearing preview, changing durable mode, hiding the page, and destroying
   the state leaves zero overlays and zero running frame callbacks.
6. General hover/focus motion completes in under five seconds and has no `infinite`
   iteration. Re-entry can replay it; parked focus cannot create an ambient loop.
7. `prefers-reduced-motion: reduce` produces the complete static Relationship
   Preview with no moving packet, and changing the media preference while the page
   is open cannot leave a stuck animation.
8. The implementation uses normalized SVG dash motion and CSS only—no per-frame
   `getPointAtLength()`, graph traversal, layout pass, canvas, worker, network fetch,
   timer farm, or runtime dependency.
9. Focus, Intent Trace, Route Probe, Story Trail, Semantic Lens, Reading Depth,
   Relationship Preview, Finder, Radar, and Guide arbitration cannot leave mixed
   emphasis or duplicate overlays. Passive Intent Trace is finite after this round.
10. Mobile retains the existing relationship-row layout and touch behavior; motion
    never becomes a hover-only requirement. Desktop pointer, keyboard, 390px
    viewport, and reduced-motion browser checks finish with zero console errors.
11. Print, embed, and every canonical export contain the full static authored graph
    with no pulse class, overlay, transient relationship attribute, dimming, or
    viewer-only motion state.
12. Focused contract tests cover exact-edge ownership, direction, finite timing,
    reduced motion, cleanup, canonical export, and all five renderers; the complete
    Archify suite and Proof Lab remain green.

## Recommendation

Build **Directional Flow Pulse** next, specifically as the motion grammar of the
existing exact-edge Relationship Preview. fireworks-tech-graph proves that a
diagram feels operational when small signals move along semantically correct
routes while everything important stays fixed. G6 reinforces event-owned motion,
Sigma reinforces bounded scheduling and cleanup, and W3C sets the line against
passive infinite loops.

The result should be one precise packet, one real relationship, one short pass,
and zero new runtime architecture. That is enough movement to make Archify feel
alive without sacrificing its strongest differentiators: stable geometry,
self-contained artifacts, accessibility, canonical export, and zero dependencies.

## Implementation decision after prototyping

The first Round 25 implementation applies the same event-owned, finite-motion
grammar to **Semantic Lens** before Relationship Preview. Lens has a stronger
activation boundary than passive hover, already answers an explicit direction
question, and can expose a small authored relationship set without adding another
control. The implementation therefore runs one staggered pass over exact matched
geometry, caps the active set at 24 relationships, leaves the selected Lens state
static after the pulse, and also changes passive Intent Trace from infinite to
one-shot playback. Relationship Preview remains the preferred next home for a
single-edge replay gesture rather than becoming a second ambient loop.

In-app browser inspection then exposed a separate usability defect: a fixed-right
Lens panel could cover the selected database node. The viewer now scores the real
selected-node rectangles against left and right panel candidates, docks to the
lower-overlap side on desktop, and preserves the existing full-width mobile
containment. This is a viewer-only placement decision; it does not move diagram
geometry or affect canonical export.
