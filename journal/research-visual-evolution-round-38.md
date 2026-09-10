# Visual Evolution Round 38 — Story Director Strip

Status: implementation-ready research recommendation
Research snapshot: 2026-07-20
Competitive source snapshot: `fireworks-tech-graph` commit [`50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44)

## Executive decision

The highest-leverage next slice is **Story Director Strip**: one compact,
viewer-only caption for the active Story Beat that explains what the camera is
showing without asking the reader to decode glow, direction, or graph geometry.

The current Story Follow Camera makes the active neighborhood readable. The
missing layer is semantic narration. A moving camera can answer “where should I
look?” but not always “what happened here?” Archify already owns the facts needed
to answer that second question:

- stable current and previous node IDs and labels;
- exact `forward`, `reverse`, `multiple`, `group`, and `start` beat classes;
- exact authored edge labels;
- renderer-owned node kind, sublabel, context, and tag metadata;
- current beat position, playback state, chapter identity, and Live/Still state.

Round 38 should compose those existing facts into a cinematic but restrained
caption. It should add no schema field, panel, graph engine, layout algorithm,
dependency, storage, inferred prose, or canonical SVG content.

**Product sentence:** while Story Follow frames the active neighborhood, the
Director Strip names the exact authored transition and the current component's
role, so a reader can watch and understand without guessing.

## Why this is the next gap

Archify has already solved the surrounding navigation layers:

- Semantic Camera and Story Follow Camera handle local framing.
- Story Beat Navigator exposes every authored stop.
- Route Journey handles a computed shortest directed path.
- Named Chapters, Chapter Delta Preview, and Shared Anchor Handoff handle
  chapter structure and continuity.
- Semantic Passport and Relationship Lens provide deliberate inspection.
- Live/Still and reduced-motion handling provide one motion owner and an
  explicit static equivalent.
- Presentation Stage, Semantic Radar, Finder, and three reading depths cover
  immersion, overview, search, and density.

The current beat copy is technically truthful, but it is a small text line among
navigation controls. It names endpoints and relation class, yet it does not
surface the authored edge label or the current node's existing responsibility.
The Share Chapter Cue is richer, but intentionally appears only for shared
embed playback or a pinned embed moment. Adding more motion now would increase
spectacle faster than comprehension; adding more chrome would make the already
capable viewer feel denser.

The best leverage is therefore to promote existing truth into a stronger visual
hierarchy, not to invent a new interaction mode.

## Primary-source findings

### 1. fireworks-tech-graph: richness comes from semantic identity and timing, not arbitrary effects

The current official repository advertises twelve visual styles and a focused,
validated SVG-to-GIF path. Its showcase uses a 5.75-second timeline: routes draw
first, then the complete topology holds a live operating state for two seconds
([official README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44#showcase)).

The deeper motion contract is deliberately strict. Nodes, labels, containers,
markers, and the camera remain fixed; motion is keyed by explicit semantic role,
stage, and order; missing metadata fails closed; and each style has a reviewed
signature rather than a generic effect sprayed over arbitrary topology
([official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md)).

**Borrow:** semantic specificity, a settled reading interval, immutable source
geometry, and fail-closed behavior.

**Adapt:** Archify should express semantic specificity as exact, readable beat
copy beside its already bounded motion. The strip can use real edge labels and
node responsibilities without creating twelve scene-specific runtimes.

**Skip:** copying twelve styles, packet trains, ECG heads, halos, per-scene
metadata, or GIF-only timelines. Those are validated fixture contracts in that
project, not general facts Archify can safely infer from its five typed IRs.

### 2. Structurizr: a story is stepped, reader-controlled, and quieter in presentation

Structurizr animations reveal elements for static views and relationships for
dynamic views. Readers can move backward and forward with buttons or keyboard
shortcuts
([official animation documentation](https://docs.structurizr.com/ui/diagrams/animation)).
Its presentation mode removes toolbars to leave the diagram canvas, while
keyboard shortcuts retain animation and navigation access
([official presentation documentation](https://docs.structurizr.com/ui/diagrams/presentation)).
The full viewer also treats descriptions and metadata as separately toggleable
information layers
([official viewer documentation](https://docs.structurizr.com/server/diagrams/viewer)).

**Borrow:** keep semantic explanation distinct from the geometry; retain manual
step controls; keep presentation visually quiet.

**Adapt:** use one non-interactive caption in the existing Story surface. Do not
add a second toolbar or open an inspection panel on every automatic beat.

**Skip:** hiding all not-yet-revealed topology and copying Structurizr's complete
workspace navigation model. Archify's full static truth and local framing are
already stronger safeguards against lost context.

### 3. LikeC4: a dynamic step can carry explanatory notes

LikeC4 defines a dynamic view as a use case with specific interactions, supports
forward and backward steps plus flow-control blocks, and lets each step carry
Markdown `notes`
([official dynamic-view documentation](https://likec4.dev/dsl/views/dynamic/)).
This is direct evidence that a mature technical story needs an explanation
layer in addition to ordered endpoints.

**Borrow:** the concept that a step may explain its technical meaning.

**Adapt now:** derive a concise explanation only from Archify's existing edge
label and node metadata.

**Skip now:** a new author-controlled beat-note schema and Markdown renderer.
Schema expansion is justified only after derived captions are browser-tested and
a real corpus gap proves that existing metadata cannot explain important beats.

### 4. React Flow: fixed information belongs above the viewport transform

React Flow's official `Panel` component positions content above the viewport and
is also used by its minimap and controls
([official Panel reference](https://reactflow.dev/api-reference/components/panel)).
This supports keeping story copy in the HTML viewer layer rather than inside the
transformed SVG.

**Borrow:** a stable screen-space information layer.

**Adapt:** reuse the existing guided-view note region as the semantic owner. In
normal mode it remains part of the current Story panel; in Presentation Stage it
may become a compact lower-third. Do not render a duplicate caption on top of
the same text.

**Skip:** React state, draggable nodes, viewport portals, and another generic
panel system.

### 5. D2: automatic sequences must stay short enough to understand

D2's composition export guide says animated SVG is useful for a small number of
steps, warns that too many boards can confuse readers or make them wait for the
loop, and documents `1200ms` as an animation interval example
([official composition formats](https://d2lang.com/tour/composition-formats/)).

**Borrow:** one settled caption per bounded beat, with enough dwell to read it.

**Adapt:** keep Round 37's minimum 1100ms dwell. The strip must be concise enough
to read within that budget; it must not lengthen every story to accommodate
paragraphs.

**Skip:** multiple board documents, looping autoplay, and animated SVG as the
interactive viewer's truth.

### 6. W3C: captions should remain readable, and announcements must follow playback state

The WAI carousel pattern requires a start/stop control for automatic rotation,
stops rotation on keyboard focus, and recommends `aria-live="off"` while content
is automatically rotating and `polite` while it is not
([APG carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)).
Its reference example says controls and captions outside a moving image are
easier to perceive and read; it also pauses by default for reduced-motion users
([APG previous/next example](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/examples/carousel-1-prev-next/)).
WCAG guidance requires non-essential interaction-triggered motion to be
disableable and identifies `prefers-reduced-motion` as a sufficient technique
([Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)).

**Borrow:** do not repeatedly announce automatic beat changes; manual changes
may be announced politely; captions need a stable, high-contrast reading surface.

**Adapt:** retain Archify's current pause-on-focus behavior and Live/Still owner.
The strip may use a 120–160ms opacity-only entrance in Live; Still and
`prefers-reduced-motion` switch content immediately.

**Skip:** text that moves with the camera, a typewriter effect, scrolling copy,
or speech-like announcements on every autoplay beat.

## Candidate decision

| Candidate | User value | Density cost | Truth/risk | Decision |
|---|---|---:|---|---|
| Fourth or fifth visual preset | More screenshots | High CSS and renderer QA surface | Mostly cosmetic; duplicates competitor breadth | **Skip now** |
| Per-diagram packet/train/ECG motion signatures | High spectacle | Low chrome, very high runtime surface | Needs explicit semantics Archify does not currently own | **Adapt later** |
| Auto-hiding Presentation HUD | More canvas | Low | Helpful polish, but does not explain a beat | **Later** |
| Runtime collapse/expand | Less visible topology | Medium | Changes perceived graph truth and camera assumptions | **Skip** |
| Active-subgraph foreground cloning | Cleaner crossings | Low chrome, high DOM complexity | Marker, z-order, hit-target, and export risks | **Only after measured occlusion** |
| Author-written Markdown beat notes | Excellent explanation | Low viewer density | New schema/editor/sanitization burden before demand is proven | **Later** |
| **Story Director Strip** | Explains every current frame using facts already present | No new control; one bounded text surface | Fail-closed and export-isolated | **Borrow + adapt now** |

## The one recommended Round 38 slice

### Visual anatomy

Use one structured caption with at most two readable lines:

1. **Eyebrow:** `BEAT 02 / 08 · FORWARD` plus `PLAYING`, `PAUSED`, or `STILL`
   only when that state is useful.
2. **Director line:** the truthful transition, followed by the strongest existing
   semantic detail.

Examples:

```text
BEAT 02 / 08 · FORWARD
Chat → Planner · creates plan · Plans tool-safe execution
```

```text
BEAT 04 / 06 · REVERSE
Worker → Queue · reverse authored link · Retries remain durable
```

```text
BEAT 03 / 05 · GROUPED
API · Auth · grouped transition, no direct authored link
```

The strip is not a button, tooltip, modal, or third inspector. Reuse the existing
guided-view note as the semantic owner. When a beat is active, render structured
children instead of also showing the old one-line beat copy. In Presentation
Stage, CSS may position that same owner as a restrained lower-third outside the
camera transform. Ordinary mode keeps it inside the established Story surface.

### Truth algorithm

Derive copy deterministically from the existing `storyStep`:

- `start`: current node label + `Starting point` + current node detail.
- one `forward` edge: previous → current + exact `data-edge-label` when present.
- one `reverse` edge: display the authored direction current → previous and say
  `reverse authored link`; never draw a misleading previous → current arrow.
- `multiple`: previous ⇄ current + exact authored edge count; do not choose one
  relationship or concatenate an unreadable label list.
- `group`: previous · current + `Grouped transition · no direct authored link`.
- current-node detail priority: `data-node-sublabel`, then
  `data-node-context`, then `data-node-kind`; omit an empty duplicate.

Every fragment must come from existing DOM metadata or a fixed relation-state
vocabulary. Do not ask an LLM at runtime, infer verbs from node names, summarize
multiple edges, or turn geometry into meaning.

### State and motion

- Show the strip only when a valid named view and valid active beat exist.
- Keep one DOM node and update text atomically.
- Automatic playback: `aria-live="off"`.
- Manual beat, paused beat, or exact moment restoration: `aria-live="polite"` and
  `aria-atomic="true"`.
- Live may use one 120–160ms opacity-only change. No translation, scaling,
  typewriter effect, shimmer, infinite pulse, or per-character animation.
- Still, hidden page, print, and reduced-motion update instantly.
- Focusing Story controls keeps the existing pause behavior. Copying a moment
  preserves the visible strip and the current beat.

### Density and responsive rules

- No new always-visible control and no extra page Tab stop.
- Desktop width should be bounded (approximately 38–52rem), not span the entire
  diagram card.
- Normal mode must replace the old active-beat sentence, not duplicate it.
- Presentation Stage may use the same DOM as a lower-third, with an opaque or
  strongly blurred background and safe contrast; it must not sit behind moving
  text or consume the camera's focus bounds.
- At 390px, keep the eyebrow and one clamped director line, allow two lines of
  wrapping, and never create page overflow. Do not marquee or horizontally
  scroll the caption.
- Long labels truncate visually only after the accessible full text is retained.

### Embed, print, and export boundary

- Ordinary embeds: no Director Strip.
- Explicit shared playback or pinned moment embeds: reuse the existing Share
  Chapter Cue and feed it the same director copy; do not render two captions.
- Print: hidden.
- Canonical SVG, PNG/JPEG/WebP source serialization, and standalone SVG: no
  Director Strip DOM, attributes, text, style, or state.
- WebM may capture the visible HTML presentation layer only if the current export
  contract already captures it; Round 38 must not silently change that boundary.
- No schema, IR, renderer geometry, authored SVG, dependency, storage, or URL
  grammar change.

## Acceptance criteria

### Contract evidence

1. All five typed renderers produce the same Director Strip behavior through the
   shared viewer.
2. `start`, `forward`, `reverse`, `multiple`, and `group` each have deterministic
   copy tests.
3. A single exact edge label is displayed verbatim; missing labels omit the
   clause without placeholder noise.
4. Node detail uses the declared sublabel/context/kind priority and never invents
   prose.
5. Reverse copy exposes authored direction; grouped copy explicitly says there
   is no direct relationship; multiple copy exposes the exact count.
6. The old active-beat sentence is not simultaneously visible.
7. The strip has no interactive role, no Tab stop, and no pointer owner.
8. Automatic playback sets live announcements off; manual selection, pause, and
   exact-link restoration use polite atomic announcements.
9. Still and reduced motion contain no strip transform/position animation.
10. Ordinary embed, print, and canonical SVG serialization contain zero Director
    Strip residue.

### Browser evidence

Validate with generated Proof Lab artifacts, not only the template:

1. Tall workflow in Presentation Stage: first, middle, and final beats remain
   readable while Story Follow settles before the next dwell.
2. One sequence or lifecycle example proves a reverse authored edge.
3. A fixture proves grouped transition and a fixture proves multiple edges; copy
   must remain truthful even if the visual result is less glamorous.
4. Pause freezes beat, camera, and caption; resume continues the same remaining
   dwell.
5. Manual beat selection and `#view=&beat=` restoration show the same caption
   immediately without autoplay or focus theft.
6. Switching Live → Still leaves the same semantic caption and removes only
   non-essential motion.
7. At 390×844, the caption wraps to at most two useful lines, controls remain
   targetable, and `scrollWidth <= clientWidth` for the page.
8. Shared embed shows one enriched Share Chapter Cue; ordinary embed shows none.
9. Export SVG reports canonical clean and contains none of the strip's runtime
   selectors, state, or copy.
10. Final desktop and mobile screenshots show the caption helping the eye rather
    than covering the current node or competing with Story controls.

## Failure modes and stop conditions

### Duplicate narration

If the existing note, Share Cue, and new strip all show similar beat text at the
same time, Round 38 has increased clutter and failed. One semantic owner must
render differently by surface.

### Invented causality

If `A · B` becomes “A calls B” without one exact forward edge and label, the
feature has violated Archify's trust boundary. Fail closed to relation class,
endpoints, and existing metadata.

### Caption becomes a second Passport

If it lists ID, tags, kind, context, all edge labels, and actions, it duplicates
Semantic Passport and Relationship Lens. Keep one strongest detail and no action.

### Caption obscures the graph

If the lower-third overlays the current/next frame or causes the camera to fit a
smaller viewport unpredictably, keep it in the reserved HTML Story region rather
than floating over the canvas.

### Reading time exceeds dwell

If common captions cannot be read inside the 1100ms minimum dwell, shorten the
copy; do not silently slow every story. Long authored labels should clamp
visually while full text remains accessible after pause/manual selection.

### Announcement flood

If screen readers announce every autoplay beat, `aria-live` ownership is wrong.
Playback stays off; only reader-driven or paused changes are polite.

### Feature envy

If implementation begins adding per-style packet trains, Markdown beat schemas,
new panels, or a fourth theme, stop. Those are separate hypotheses and are not
required to prove the Director Strip.

## Final Borrow / Adapt / Skip

**Borrow** the competitor lesson that polished motion needs semantic identity,
stable geometry, and time to read; the model-viewer lesson that dynamic steps
benefit from explanatory notes; the viewport lesson that fixed information stays
outside the transform; and W3C's playback-aware live-region contract.

**Adapt** those lessons into one existing-owner Story Director Strip derived from
stable nodes, exact relationships, edge labels, and renderer metadata. Make it a
quiet two-line caption, visually stronger in Presentation Stage, static in Still,
and shared through the existing embed cue.

**Skip** more presets, generic spectacle, inferred prose, Markdown schema,
another panel, autoplay on load, moving captions, topology hiding, runtime graph
mutation, and canonical/export changes.

## Source register

- [fireworks-tech-graph repository snapshot](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44)
- [fireworks-tech-graph focused motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md)
- [Structurizr animation](https://docs.structurizr.com/ui/diagrams/animation)
- [Structurizr presentation mode](https://docs.structurizr.com/ui/diagrams/presentation)
- [Structurizr diagram viewer](https://docs.structurizr.com/server/diagrams/viewer)
- [LikeC4 dynamic views and step notes](https://likec4.dev/dsl/views/dynamic/)
- [React Flow Panel](https://reactflow.dev/api-reference/components/panel)
- [D2 composition export formats](https://d2lang.com/tour/composition-formats/)
- [WAI-ARIA carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)
- [WAI carousel previous/next example](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/examples/carousel-1-prev-next/)
- [WCAG 2.2 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
