# Visual Evolution Round 42 — Story Shelf

Date: 2026-07-20
Status: implementation-ready research decision

## Executive decision

Build **Story Shelf**: when a generated artifact opens in its truthful
whole-diagram state, keep the existing chapter rail and **Play story** action
immediately available, but collapse the inactive Story Director controls until
a chapter or playback is actually activated.

This is a presentation change over existing truth, not another Story feature.
It adds no panel, preset, schema field, URL state, renderer branch, dependency,
or playback owner. The already-authored `data-active-view="all"` state is the
only cold/active boundary:

```text
whole-diagram opening
  -> compact shelf: Play story + every authored chapter
  -> reader selects a chapter or starts playback
  -> existing full director: Previous / caption / Next / Play / Copy moment /
     Show all / Story Trail / chapter rail
  -> Show all or Escape
  -> compact shelf again
```

The reason to do this now is measurable. Archify has accumulated a powerful
story system, but its inactive controls are occupying the space in which a new
reader should first see the diagram.

## Current-worktree evidence

### The cold state spends space on actions that cannot yet work

The generated viewer always renders the complete Story Director before the
diagram (`archify/assets/template.html`, current lines 3642–3679). Its first
row contains Previous, the generic `Explore this system` description, and Next;
its action row contains Play story, Copy moment, and Show all; the chapter rail
then occupies a final row.

The current `render()` function already exposes the exact state needed for a
bounded solution (`archify/assets/template.html`, current lines 7327–7342):

- `activeIndex === -1` writes `data-active-view="all"`;
- Previous is disabled;
- Copy moment is disabled until a beat exists;
- Show all is disabled; and
- the chapter buttons and Play story remain valid entrances.

The mobile stylesheet makes the cost larger rather than smaller. At widths up
to `720px`, the actions become a three-column second row and Previous/Next keep
`2.75rem` controls (`archify/assets/template.html`, current lines 2737–2755).

### Fresh browser readback

A fresh same-origin artifact was measured in its initial
`data-active-view="all"` state. This was a direct DOM bounding-box readback, not
an estimate from CSS:

| Viewport | Inactive panel | Diagram begins | Disabled but visible |
| --- | ---: | ---: | --- |
| `756 × 469` desktop headless viewport | `128px` | `y = 316` | Previous, Copy moment, Show all |
| `390 × 844` mobile emulation | `172px` | `y = 387` | Previous, Copy moment, Show all |

On mobile, inactive Story chrome alone consumes just over 20% of viewport
height. Together with the header, the first diagram pixel arrives after roughly
46% of the viewport. Next is enabled, but it duplicates the more legible first
chapter button already present in the rail. The cold panel therefore gives
five button-sized objects priority over the canvas while only Play and the
authored chapter choices are necessary to enter the story.

### Round 35–41 capabilities must not be rebuilt

The recent work already provides Named Chapter Rail, Chapter Delta Preview,
Shared Anchor Handoff, Story Beat Navigator, Story Follow Camera, Story
Director Strip, Story Horizon, Copy moment, Presentation Stage, explicit share
playback, and Settled Flow. Round 40 fixed proof visibility on the landing page;
Round 41 fixed ambient-motion semantics. Story Shelf applies the same
proof-first discipline **inside the artifact**. It does not replace or weaken
any of those shipped capabilities.

## Primary-source comparison

### Fireworks Tech Graph — the verified output is the lead, not the controls

The official Fireworks repository leads with a twelve-style animated showcase
and describes its offline viewer as a bounded delivery surface for pan/zoom,
themes, copy, and export. More importantly, its current composition contract
separates visual style from structural quality and requires the rendered scene
to earn delivery through measurable geometry and visual readback. The canvas is
the product-facing evidence; viewer chrome is supporting machinery.

Sources:

- [Fireworks Tech Graph README and showcase](https://github.com/yizhiyanhua-ai/fireworks-tech-graph#showcase)
- [Fireworks composition-quality contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md)

**Borrow:** let the artifact itself remain the first proof.
**Adapt:** compact Archify's inactive story surface while retaining its stronger
semantic chapter entrances.
**Skip:** copying twelve styles, a GIF pipeline, or Fireworks' complete geometry
contract as a substitute for this measured first-view problem.

### Structurizr — reveal controls belong to the active narrative

Structurizr animation is explicitly a sequence of reveal steps and offers
forward/back controls for that sequence. Its diagram viewer keeps animation
controls as floating actions, and presentation mode removes toolbars so that
the diagram canvas owns the screen while keyboard navigation remains
available. The useful lesson is contextual control density: narrative controls
support an active narrative; they do not need to dominate the untouched
overview.

Sources:

- [Structurizr animation](https://docs.structurizr.com/ui/diagrams/animation)
- [Structurizr diagram viewer controls](https://docs.structurizr.com/server/diagrams/viewer)
- [Structurizr presentation mode](https://docs.structurizr.com/ui/diagrams/presentation)

**Borrow:** make story progress controls contextual and keep the canvas primary.
**Adapt:** Archify should preserve Play and every named chapter before
activation, then reveal its richer director after activation.
**Skip:** hiding all navigation, requiring fullscreen, or reducing Archify to
only Previous/Next.

### LikeC4 — viewer capability is independently configurable

LikeC4's official React API exposes `showNavigationButtons`,
`enableDynamicViewWalkthrough`, `showDiagramTitle`, pan, zoom, and details as
independent viewer options. A host can present the diagram with only the
capabilities appropriate to that context instead of treating every available
control as mandatory chrome.

Source: [LikeC4 React components](https://likec4.dev/tooling/react/)

**Borrow:** capability and visibility are separate decisions.
**Adapt:** use Archify's existing semantic state, not a new host configuration,
to decide whether director-only controls are relevant.
**Skip:** a React integration layer, host API, or configurable control matrix.

### W3C — compacting cannot damage focus order or mobile access

WCAG 2.2 says keyboard focus order must preserve meaning and operability, and
its Reflow guidance explicitly encourages reducing scrolling even for
two-dimensional diagram content. Hidden inactive controls must leave the
sequential order as **Play -> chapter choices -> diagram**, while the active
director returns to its existing order.

Sources:

- [WCAG 2.2: Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)
- [WCAG 2.2: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)

## Candidate comparison

| Candidate | Visible value | Evidence | Risk | Round 42 decision |
| --- | --- | --- | --- | --- |
| **Story Shelf** | More diagram in the first artifact viewport; clearer story entrances | `128px`/`172px` inactive panel; three visible disabled actions | CSS/state regression if active controls fail to return | **Build now** |
| Clean Flow Gate | Reject edge/node and edge/edge collisions consistently across renderers | Current validators are uneven; Fireworks has a strong composition budget | Mostly prevents future defects; broad geometry semantics and legitimate junction exceptions need a separate contract | **Research next** |
| Automatic bridge jumps or edge casings | Can distinguish unavoidable crossings | Fireworks verifies bridge jumps but requires zero in showcase output | Duplicated visual paths, painter order, animation ghosts, hit targets, markers, and export fidelity | **Reject now**; validate and reroute first |
| Another Story panel/control | More narrative functions | No unsolved reader question found | More chrome is the measured defect | **Skip** |
| Another visual preset | More screenshot variety | Existing Classic, Signal Flow, and Blueprint already cover three distinct materials | Multiplies QA without fixing canvas visibility | **Skip** |

Story Shelf wins because it amplifies all existing story work while deleting
cold-state noise. Clean Flow Gate is a real later quality investment, but it
does not beat a reproduced issue every guided artifact shows immediately.

## Borrow / Adapt / Skip

| Decision | Round 42 contract |
| --- | --- |
| Borrow | Fireworks' output-first proof hierarchy. |
| Borrow | Structurizr's contextual narrative controls and canvas-first presentation. |
| Borrow | LikeC4's separation between available capability and visible capability. |
| Adapt | Use `data-active-view="all"` as the only Story Shelf state. |
| Adapt | Keep Play and all authored chapter choices visible and keyboard-reachable in the cold state. |
| Adapt | Restore the full existing director immediately after chapter selection, playback start, or deep-link restoration. |
| Skip | New disclosure button, menu, local-storage preference, query parameter, schema, or runtime owner. |
| Skip | Removing Story features, changing playback semantics, or changing canonical SVG/export. |
| Skip | Automatic bridge decoration before a shared crossing-quality contract exists. |

## Bounded recommended slice

### Product sentence

**Open on the diagram and its story choices; reveal editing-like story controls
only when there is an active story to direct.**

### Exact implementation contract

1. Keep the existing `.guided-views` element and DOM controls; do not create a
   second mobile component.
2. Use only `.guided-views[data-active-view="all"]` for the cold shelf. Do not
   add a second JavaScript state variable.
3. Ensure `data-active-view="all"` is present before the panel is unhidden so
   the full director cannot flash for one frame.
4. In the cold shelf, visually remove Previous, Next, Copy moment, and Show
   all; retain the compact `Guided views` / `Explore this system` identity but
   remove its generic instructional note.
5. In the cold shelf, keep Play story visible.
6. Keep every authored chapter button in the existing horizontally scrollable
   chapter rail; do not replace labels with dots or a count-only selector.
7. Preserve at least a `44 × 44` CSS-pixel target for Play and chapter buttons.
8. Keep DOM/focus order logical: Play, then chapter choices, then diagram.
   Hidden controls must use `display: none` or the native `hidden` contract, not
   opacity or offscreen positioning.
9. Selecting a chapter through pointer, keyboard, `[`/`]`, or a valid
   `#view=`/`#view=&beat=` restoration must reveal the complete existing
   director in the same render turn.
10. Starting Play from the shelf must activate the first authored chapter and
    reveal the complete director before the first beat advances.
11. Show all and the existing Escape unwind must return to the compact shelf.
12. `?play=1#view=...` and `?present=1&play=1#view=...` open directly in the
    active director state; they must never briefly collapse to the shelf.
13. Still/reduced-motion keeps the shelf and chapter buttons usable. The
    existing unavailable Play behavior may remain, but it must be clearly
    disabled and must not erase manual chapter entry.
14. Preserve Chapter Delta Preview on shelf chapter hover/focus; preview must
    not expand the director or change `data-active-view`.
15. Preserve the full director's current Previous/Next, Story Trail, Story
    Director, Story Horizon, Copy moment, Show all, progress, handoff, and
    playback behavior without forking their logic.
16. Keep embed, print, and canonical SVG/export behavior unchanged. The shelf
    is HTML viewer chrome only.
17. Keep all three presets recognizably themselves; only density/layout changes
    in the shelf state.
18. Add no persistence. Reloading a plain artifact truthfully opens the compact
    whole-diagram shelf; a semantic deep link truthfully opens active.

### Initial layout budget

The implementation should optimize for measured space, not a particular
mockup:

- desktop cold shelf height: **at most 80px**;
- `390 × 844` cold shelf height: **at most 112px**;
- mobile diagram top: improve from `y = 387` to **`y <= 330`** on the same
  artifact and viewport;
- zero page-level horizontal overflow; and
- no chapter label clipping that removes the only distinguishing text.

These targets leave room for the existing 44px controls and a real chapter
rail while reclaiming at least 48px desktop and 60px mobile.

## Failure modes to prevent

1. **The shelf becomes a new panel.** Reuse the existing element and controls.
2. **A full-director flash on load.** Apply `data-active-view="all"` before
   unhide or first paint.
3. **Deep links open collapsed.** Hash restoration must make active state
   visible synchronously with the existing activation receipt.
4. **Play begins while controls are still hidden.** Active state must render
   before the first scheduled beat.
5. **Preview accidentally expands.** Hover/focus Chapter Delta Preview remains
   temporary and does not alter `activeIndex`.
6. **Hidden buttons remain tabbable.** Remove them from layout and sequential
   focus in shelf state.
7. **CSS visual order contradicts DOM order.** Do not place chapter choices
   visually before Play if focus still lands on Play first without a clear
   reading rationale.
8. **Mobile targets shrink below 44px.** Recover vertical space through
   relevance, not tiny buttons.
9. **Still mode becomes a dead end.** Manual chapter selection remains fully
   available when Play is unavailable.
10. **Show all destroys discoverability.** Returning to overview must reveal
    the shelf, not hide guided views entirely.
11. **Preset-specific regressions.** Blueprint stays squared; Signal Flow keeps
    restrained luminous treatment; Classic remains neutral.
12. **Exports acquire viewer chrome.** No shelf/director element enters SVG,
    raster, WebM SVG clone, or print.

## Test contract

Add one focused Story Shelf contract test and extend existing guided-view tests
where ownership already exists:

1. Template contains one guided panel, one Play button, and one chapter list.
2. The shelf selector is keyed only by `data-active-view="all"`.
3. Cold state hides Previous, generic copy, Next, Copy moment, and Show all.
4. Cold state retains Play and the chapter index.
5. The default state is applied before `panel.hidden = false` or otherwise
   proven paint-safe.
6. `render()` continues to write `all` for `activeIndex === -1` and a real view
   ID otherwise.
7. Chapter activation and playback start expose the full director.
8. Show all and Escape restore shelf state.
9. Chapter preview never changes active state.
10. Valid view/moment deep links restore active state; invalid links fail closed
    to the shelf.
11. Still/reduced-motion leaves manual chapter buttons enabled.
12. Embed and print still omit the guided panel.
13. Canonical SVG serialization contains no Story Shelf/director HTML.
14. Three preset artifacts and all five renderer outputs retain the same
    authored SVG and story data.
15. Existing Story Trail, Director, Horizon, Follow, chapter handoff, share
    playback, motion governor, and export tests remain green.

## Built-in browser acceptance

Validate a freshly generated guided workflow artifact, not only the template.

### Desktop cold opening

1. Open at `1280 × 720` with no hash or query playback.
2. Confirm `data-active-view="all"` before the panel becomes visible.
3. Confirm only the compact shelf identity, Play, and chapter choices are
   visible in the guided surface.
4. Measure shelf height `<= 80px` and confirm materially more diagram is
   visible than baseline.
5. Tab through the shelf: Play, then logical chapter choices, then the diagram;
   no hidden inactive action receives focus.
6. Hover and keyboard-focus a chapter; Chapter Delta Preview works without
   expanding the director or changing the URL.
7. Select a chapter; the full director appears immediately with its current
   caption, trail, controls, and unchanged SVG state.
8. Activate Show all and press Escape from a chapter; each returns to the shelf.

### Mobile cold opening

1. Resize to `390 × 844`.
2. Confirm shelf height `<= 112px`, diagram top `<= 330px`, and no page-level
   horizontal overflow.
3. Confirm Play and every chapter remain reachable; horizontal scrolling stays
   contained within the chapter rail.
4. Confirm every visible Play/chapter target is at least `44 × 44px`.
5. Select a later chapter, inspect a beat, Copy moment, and return to Show all;
   no control or caption is clipped.

### State, accessibility, and delivery boundaries

1. Open `#view=<valid>` and `#view=<valid>&beat=<valid>`; the full director is
   visible on first settled frame with no shelf flash.
2. Open an invalid view/beat; it fails closed to the shelf without an exception.
3. Switch to Still and emulate reduced motion; manual chapters remain usable,
   motion stays absent, and Play reports its existing unavailable state.
4. Open `?embed=1`, print preview, and export SVG/PNG/WebM; established viewer
   and export boundaries are unchanged.
5. Exercise Story playback, Pause, Previous/Next, Story Horizon, Chapter
   Handoff, and Presentation Stage after expansion.
6. Check browser logs after desktop and mobile passes; application errors and
   unhandled rejections must be zero.

## Decision

Proceed with **Story Shelf** for Round 42.

Archify does not need another diagram feature to look richer. It needs its
existing richness to arrive in the right order. The compact cold shelf keeps
the two honest story entrances—Play and named chapters—while giving the
diagram back a meaningful part of the first viewport. Once the reader expresses
story intent, the complete director returns with no behavior loss.

Keep **Clean Flow Gate** as the next research candidate. Fireworks' current
composition contract exposes a real gap in Archify's uneven cross-renderer
geometry checks, but that deserves an explicit legitimate-junction and
diagnostic contract rather than being smuggled into a visual-density slice.
