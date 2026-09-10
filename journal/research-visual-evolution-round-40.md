# Visual Evolution Round 40 — First-fold Proof Aperture

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build **First-fold Proof Aperture**: make a meaningful slice of Archify's
existing live, checked artifact visible in the initial viewport, then start its
one-shot story only when the artifact itself becomes visible.

Do **not** add another viewer feature in Round 40.

Archify already has the richer product: three live proof choices, five typed
renderers, three visual presets, progressive reading depth, Semantic Camera,
Semantic Radar, Finder, Relationship Lens, direct relationship inspection,
Route Probe, Route Journey, chapter stories, Story Follow, Story Director,
Story Horizon, Presentation Stage, motion governance, exact links, and clean
multi-format export. The landing page also already places a real interactive
proof inside the hero. But current browser readback contradicts the intended
"proof-first" promise:

- at `1280 x 720`, `#hero-proof-stage` begins at approximately `y = 689`, so
  only `31px` of its outer shell is visible;
- at `390 x 844`, it begins at approximately `y = 803`, so only `41px` is
  visible; and
- in both cases, the actual `.proof-viewport` is entirely below the fold.

The embedded URL currently includes `play=1` immediately. Therefore the
finite story can begin—and substantially or completely finish—before a reader
sees a single diagram node. Structurally the proof "leads" the page; visually
it does not.

Round 40 should close that gap without changing the proof artifact, SVG,
schema, layout, viewer controls, or export pipeline. Compact the hero's
vertical rhythm until part of the **actual diagram viewport** is visible on
desktop and mobile. Load the same artifact in a settled static state first,
then arm `play=1` once, using viewport intersection rather than a timer or
scroll polling. The existing full proof remains below as the natural next
scroll destination.

## Decision question: Proof Aperture or another viewer feature?

### Candidate A — First-fold Proof Aperture (**choose now**)

This candidate fixes a measured acquisition and trust failure. The user can
judge the output before being asked to read feature claims or scroll. It
amplifies every viewer improvement already shipped because the product itself
becomes visible during the first impression.

It is also unusually bounded:

- landing CSS and a small visibility handshake are enough;
- it reuses three existing, checked, keyboard-selectable proof artifacts;
- it adds no product surface, dependency, renderer branch, or diagram state;
- it can be verified with direct bounding-box and URL/readback assertions; and
- failure cannot corrupt authored diagram truth.

### Candidate B — Settled Flow choreography (**defer**)

The current optional trace mode is a legitimate later improvement target.
`[data-animate="edge"]` applies an infinite `10 8` dash cycle to the authored
edge itself, while `[data-animate="node"]` pulses node borders forever. A more
disciplined construction-then-operating-flow sequence would better resemble
Fireworks' settled motion contract and would avoid overriding the visual dash
language of authored security/async edges.

It is not the highest-leverage Round 40 slice. Implementing it truthfully
touches the shared viewer motion layer, original-edge semantics, Motion
Governor ownership, reduced motion, embeds, Story playback, WebM capture,
standalone SVG serialization, print, and all five renderer outputs. More
importantly, richer motion still has no first-impression value while the live
canvas is entirely below the fold.

Retain Settled Flow as a later research candidate after the proof is visibly
earning attention.

### Why A wins

| Axis | Proof Aperture | Settled Flow / another viewer feature |
| --- | --- | --- |
| Measured current gap | Actual proof canvas is invisible in both tested first folds | Viewer already has motion and many semantic interactions |
| User value moment | Before the first scroll | After the reader discovers and opens the artifact |
| Product leverage | Exposes all existing work | Improves one existing mode |
| Truth risk | Landing-only; no diagram mutation | Cross-cuts motion, dash semantics, serialization, and capture |
| Platform growth | None | Easy to expand into another motion subsystem |
| Best Round 40 choice | **Yes** | No; explicitly defer |

This is also the feature-envy guard. Fireworks' animated grid is effective
because it is visible proof, not because Archify must copy twelve styles or a
GIF renderer. Adding another interaction to an already dense viewer would be
imitating surface breadth. Making Archify's own stronger artifact visible is
the adapted product lesson.

## Current-worktree evidence

### The hero already owns the correct artifact

[`docs/index.html`](index.html) contains:

- `#hero-proof-stage` inside the hero;
- three native tab buttons for Signal Flow, Blueprint, and Classic;
- one same-origin iframe backed by a checked Gallery artifact;
- validation receipt copy;
- a link to the full Presentation artifact; and
- bilingual labels plus arrow-key, Home, and End tab navigation.

[`archify/test/landing.test.mjs`](../archify/test/landing.test.mjs) verifies that
the three choices resolve to real Gallery manifest entries, retain their
expected presets, node/edge counts, named views, green checks, files, and
keyboard contract. The proof itself is not speculative marketing content.

### The vertical budget hides it

The current landing CSS spends substantial height before the proof:

- `.hero { padding-top: 11rem; padding-bottom: 6rem; }`;
- `.hero-badge { margin-bottom: 2.25rem; }`;
- `.hero h1 { margin-bottom: 1.5rem; }`;
- `.hero-sub { margin-bottom: 2.75rem; }`; and
- `.hero-actions { margin-bottom: 4.5rem; }`.

Mobile reduces only the top padding to `8rem`; it preserves the other vertical
gaps and stacks two full-width actions. The result is an attractive but
overlong preamble. The browser measurements above prove that neither viewport
shows the proof chrome completely, much less the iframe.

### Playback is scheduled before visibility

The initial iframe `src` is currently:

```text
...?embed=1&play=1&theme=dark#view=happy-path
```

`renderProof()` also writes `play=1` whenever a proof is selected. The selected
artifact's story is finite by design. Starting it during page load while the
canvas is below the fold spends the best motion before it can explain anything.

### The README proof is already strong

All README languages already lead with the generated
`docs/assets/archify-live-proof.gif`, backed by a receipt and focused tests.
Round 40 does not need another GIF, poster, or style grid. The remaining gap is
specific to the web landing viewport.

## Primary-source comparison

### Fireworks Tech Graph — proof is the product-facing lead

The official README places its animated twelve-style showcase near the top and
describes the scene, dimensions, cadence, and regression provenance before the
long capability catalogue. Its motion contract keeps nodes, labels, containers,
marker geometry, and camera fixed while semantic routes construct and then
settle into an operating hold
([official README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/README.md),
[official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/motion-effects.md)).

**Borrow:** output must be judgeable before the long explanation; motion must
arrive while the output is visible.
**Adapt:** expose Archify's existing real HTML proof rather than copying a
twelve-style GIF wall.
**Skip:** additional styles, a scene-specific GIF renderer, persistent ambient
motion, and broad UML claims.

### D2 — show the rendered result with the input

D2's official home page leads with the value proposition and an immediately
inspectable diagram example with copy and Playground actions. Its examples page
explicitly treats production-looking output as the evidence for the language
([official home](https://d2lang.com/),
[official examples](https://d2lang.com/examples/overview/)).

**Borrow:** put working output adjacent to the promise.
**Adapt:** Archify already has a richer interactive artifact, so reveal it
instead of adding another static example.
**Skip:** another playground, editor, language surface, or layout engine.

### LikeC4 — a concrete demo closes the claim-to-output loop

LikeC4's official site explains Write / See / Ship, then provides a "See it in
action" source-to-preview demo and a direct Playground path. Its embedded React
viewer exposes navigation and detail capabilities as one configurable viewer
instead of separate products
([official site](https://likec4.dev/),
[official React components](https://likec4.dev/tooling/react/)).

**Borrow:** the fastest route to trust is promise → visible model → real
preview.
**Adapt:** keep Archify's current three proof tabs and full artifact link.
**Skip:** React, Mantine, XYFlow, an editor runtime, and a new model DSL.

### React Flow — interactive examples demonstrate the actual primitive

React Flow's official feature overview embeds a working flow rather than
describing node, edge, controls, and minimap behavior only in prose. Its
examples index makes visible examples the navigation surface for capabilities
([official feature overview](https://reactflow.dev/examples/overview),
[official examples](https://reactflow.dev/examples)).

**Borrow:** demonstrate the real interaction surface.
**Adapt:** retain Archify's read-only, generated artifact and keyboard proof
tabs.
**Skip:** draggable/editable nodes, connection handles, component APIs, and a
showcase directory expansion.

### Structurizr — when presenting, leave the diagram canvas primary

Structurizr Presentation mode enters full screen and removes toolbars so only
the diagram canvas remains, while keyboard navigation still reaches the next
or previous diagram and animation steps
([official presentation documentation](https://docs.structurizr.com/ui/diagrams/presentation)).

**Borrow:** the diagram must become the visual owner.
**Adapt:** compact the landing preamble; do not remove the two useful calls to
action or the proof switcher.
**Skip:** full-screen takeover on page load and a separate slide surface.

### W3C — visibility is an observable state; use it instead of polling

The Intersection Observer specification defines asynchronous visibility and
position observation relative to the viewport and explicitly identifies
deferred loading as a use case. It avoids continuous scroll polling and forced
layout readback
([W3C Intersection Observer](https://www.w3.org/TR/intersection-observer/)).

The WAI carousel pattern and WCAG Pause, Stop, Hide guidance reinforce that
automatic moving content needs reader control and should not become an
unbounded distraction
([WAI carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/),
[WCAG 2.2.2 understanding document](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide)).

**Borrow:** visibility-gate one finite playback; keep user control.
**Adapt:** show the settled artifact immediately, then arm the existing story
once when enough of its canvas is actually visible. The artifact's own Motion
Governor and reduced-motion handling remain authoritative.
**Skip:** scroll listeners, repeated autoplay, an auto-rotating proof carousel,
or motion used as a prerequisite for comprehension.

## Borrow / Adapt / Skip summary

| Decision | Round 40 contract |
| --- | --- |
| Borrow | Let readers judge real output during the first impression. |
| Borrow | Start finite proof motion only when the proof can be seen. |
| Borrow | Keep the diagram canvas, not surrounding chrome, as the visual owner. |
| Adapt | Reuse the three checked Archify artifacts and existing tab semantics. |
| Adapt | Create first-fold room by tightening vertical rhythm, not by shrinking or faking the diagram. |
| Adapt | Use one-shot Intersection Observer activation with a safe fallback. |
| Skip | Another Viewer panel, button, mode, minimap, inspector, or playback system. |
| Skip | Twelve-style breadth, another GIF, a new static mockup, or a playground/editor. |
| Skip | Schema, renderer, canonical SVG, layout, export, embed, or artifact mutations. |

## Unique recommendation: First-fold Proof Aperture

### Exact implementation contract

1. **Scope stays on the landing page.** The implementation may change
   `docs/index.html` and focused landing tests. It must not change renderer
   schemas, typed JSON, compiled SVG geometry, shared Viewer state, exports, or
   Gallery artifact meaning.
2. **Expose actual canvas pixels.** Compact desktop and mobile hero spacing
   until at least `88px` of `.proof-viewport` itself—not only `.hero-proof` or
   `.proof-chrome`—is visible at the tested initial viewport sizes.
3. **Preserve the hero hierarchy.** Keep the badge, two-line product promise,
   concise explanation, both calls to action, proof receipt, tabs, and full
   artifact link. Tighten spacing and line measure before deleting meaning.
4. **Do not crop or miniaturize the proof.** Keep the existing proof viewport
   height, iframe scale, and full-width artifact. The aperture is created by
   reducing pre-proof vertical cost, not by turning the diagram into an
   unreadable thumbnail.
5. **Render a settled first frame.** The initial iframe source loads the same
   artifact and named view with `embed=1` and theme, but without `play=1`.
   There must be no blank poster, fake screenshot, or delayed semantic content.
6. **Play once on visibility.** Observe `.proof-viewport` with
   `IntersectionObserver`. When a meaningful portion of its real canvas is in
   the viewport, upgrade the current proof URL to include `play=1` exactly once
   and disconnect the observer. A ratio around `0.15–0.20` is a starting point;
   browser acceptance is authoritative.
7. **Respect reader motion preference.** If the parent page reports
   `prefers-reduced-motion: reduce`, do not request automatic playback. The
   static artifact remains fully visible and the reader may use its controls.
8. **Provide a no-Observer fallback.** Browsers without Intersection Observer
   keep the settled artifact and may activate one pass after initial load; they
   must not poll scroll position or throw.
9. **A deliberate tab choice may play.** Clicking or keyboard-activating a
   different proof is explicit reader intent, so the selected artifact may load
   with `play=1`. It must still play only one finite chapter, as today.
10. **No replay from incidental state.** Scrolling away/back, resizing,
    switching language, window focus, iframe `load`, or an observer callback
    race must not restart the initial proof.
11. **No layout shift.** The proof viewport keeps an explicit height before the
    iframe loads. The compact hero must not jump when fonts or the artifact
    finish loading.
12. **Preserve access.** Tablist roles, roving `tabindex`, arrow/Home/End keys,
    iframe title, focus visibility, two mobile CTAs, and current bilingual copy
    remain operable.
13. **Mobile remains honest.** At `390px`, keep zero horizontal overflow,
    readable heading/copy, stacked full-width CTAs, and existing touch targets.
14. **Canonical boundaries remain untouched.** The same generated Gallery HTML
    is embedded. No runtime landing attribute enters canonical SVG, downloaded
    SVG/PNG/JPEG/WebP/WebM, print, or ZIP sources.

### Suggested vertical budget, not a new design system

Tune against browser readback rather than treating these as immutable values:

- desktop hero top padding: roughly `6–7rem`, not `11rem`;
- badge margin: roughly `1–1.25rem`, not `2.25rem`;
- title and subtitle gaps: roughly `0.875–1.75rem`;
- action-to-proof gap: roughly `2–2.5rem`, not `4.5rem`;
- allow a wider desktop subtitle measure if it removes an unnecessary line;
- mobile hero top padding: roughly `5.5–6rem`, with compact gaps while
  retaining the stacked actions.

The browser-visible canvas requirement decides the final values. Do not add a
negative margin, absolute-position the proof, overlap controls, or hide copy to
hit the target.

## Failure modes to prevent

1. **The shell peeks but the canvas does not.** Counting border/chrome pixels
   reproduces the current bug; acceptance measures `.proof-viewport`.
2. **The diagram becomes a thumbnail.** Reducing iframe height or applying CSS
   scale makes proof visible but unreadable.
3. **Motion still runs unseen.** Keeping `play=1` in the initial source spends
   the finite story before intersection.
4. **The proof starts blank.** Deferring all iframe content until intersection
   weakens first impression and creates avoidable layout/loading uncertainty.
5. **Observer replay loop.** Multiple callbacks, iframe `load`, language
   rerender, or scroll re-entry must not append/reload `play=1` repeatedly.
6. **Reduced-motion override.** The landing must not force playback when the
   reader requests less motion.
7. **Mobile conversion regression.** Hiding one CTA, making buttons too small,
   clipping proof tabs, or causing horizontal scroll is not acceptable.
8. **Hero becomes cramped.** Compression must preserve a deliberate rhythm and
   clear hierarchy; no negative overlaps or density tricks.
9. **Fake proof substitution.** A screenshot, poster, or new GIF loses the
   existing interactive and validation-backed advantage.
10. **Artifact drift.** Forking special hero-only diagram markup would bypass
    Gallery receipts and freshness checks.
11. **Feature-envy escape hatch.** Do not combine this with new styles, a
    viewer panel, tooltip system, or Settled Flow in the same slice.
12. **Canonical leakage.** Landing activation state must never be serialized
    into SVG, exports, examples, or the ZIP.

## Browser acceptance criteria

### First-fold geometry

1. At `1280 x 720`, after fonts and entrance transitions settle, the visible
   intersection height of `.proof-viewport` with the viewport is at least
   `88px`; the current baseline is `0px`.
2. At `390 x 844`, the visible intersection height of `.proof-viewport` is at
   least `88px`; the current baseline is `0px`.
3. Both sizes remain at `scrollY = 0`; no automatic scrolling is used.
4. `document.documentElement.scrollWidth === innerWidth` at `390px`.
5. The nav, badge, full heading, explanation, both CTAs, proof status, and the
   beginning of real diagram content remain visually legible without overlap.

### Playback visibility handshake

6. Before the threshold is met, the iframe shows the correct settled named
   view and its URL does not contain `play=1`.
7. Crossing the threshold adds `play=1` once, starts one finite story, and
   disconnects or otherwise permanently settles the initial activation.
8. Scrolling out and back in does not reload or replay it.
9. Selecting Signal Flow, Blueprint, and Classic by click and by keyboard loads
   the correct artifact, updates receipt/title/link, and performs at most one
   deliberate pass per selection.
10. With `prefers-reduced-motion: reduce`, no automatic playback request is
    made; the settled artifact and tabs remain usable.

### Responsive and accessibility regression

11. At `390px`, both CTA buttons and proof tabs retain their existing usable
    touch geometry; no label is clipped beyond recognition.
12. `Tab`, Left/Right, Home, and End preserve the existing tablist behavior and
    visible focus.
13. English and Chinese keep the same first-fold aperture without overflow or
    a hidden call to action.
14. Reload, direct `#proof` navigation if present, browser back/forward, and
    language switching produce no duplicate playback or stale tab/iframe URL.

### Artifact and quality regression

15. The embedded files remain the same three generated Gallery artifacts with
    the same green receipts, named views, presets, node/edge counts, and source
    digests.
16. Opening the full artifact still supports Story Horizon, Story Director,
    Still/Live, Presentation, theme switching, relationship/route exploration,
    and export exactly as before.
17. Landing, iframe, and opened artifact consoles contain zero warnings or
    errors.
18. Existing landing, Gallery, README showcase, full test, ZIP doctor, and ZIP
    artifact validation gates remain green.

## Decision

Implement **First-fold Proof Aperture** now.

Archify does not need another capability to become more convincing in this
round. It needs the capability already built to appear at the moment a new
reader decides whether to care. This directly adapts the strongest lesson from
Fireworks, D2, LikeC4, React Flow, and Structurizr—show the real diagram early
and let the canvas own attention—while preserving Archify's narrower, stronger
boundary: one checked, self-contained, interactive artifact rather than a
style catalogue or editor platform.

Settled Flow remains a worthwhile later motion-quality candidate. It should be
researched and implemented only after the current live proof is visibly earning
its first impression.
