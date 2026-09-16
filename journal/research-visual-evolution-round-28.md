# Visual Evolution Round 28 — Named Chapter Rail

Research date: 2026-07-20 (Asia/Shanghai)

## Product question

Archify already compiles authored `guidedViews`, renders the active chapter's
label and note, supports Previous / Next / Play / Show all, exposes `[` and `]`
shortcuts, focuses the chapter's `focus` array, and draws a node-by-node story
trail for the active chapter.

The remaining discoverability gap appears before a chapter is selected. At
`0 / N`, the reader can see that guided views exist, but cannot scan their
authored names or compare their sizes without walking through them one at a
time. The product question for this round is therefore deliberately bounded:

> Can all authored chapter names become visible, counted, and directly
> selectable from the existing Guided Views surface without creating a
> dashboard, a second story state machine, or new ambient motion?

**Recommendation: yes.** Add a compact, viewer-owned **Named Chapter Rail** to
the existing Guided Views panel. Render it immediately at `0 / N`; show every
authored label and a step count derived from that view's existing `focus`
array; and delegate activation to the current `activate(index)` path.

This is a discoverability and navigation improvement. It is not a new guided
view model, a restore system, a carousel autoplay mode, or an export feature.

## Current Archify evidence

### The authored model already contains everything the rail needs

[`Archify.guidedViews`](../archify/assets/template.html) parses the existing
`archify-guided-views-data` payload into an ordered `views` array. Every entry
already has:

- a stable `id` used by `#view=` deep links;
- an authored `label` and optional `note`;
- an ordered `focus` array that defines both the highlighted nodes and the
  active chapter's story-trail sequence.

The rail must read these fields directly. It must not add a schema property for
display order, count, active state, status, icon, duration, or viewport.

### `activeIndex` is already the sole chapter owner

The current module initializes `activeIndex = -1` for Show all, changes it only
through `activate`, `activateById`, `showAll`, or hash restoration, and derives
the visible count, label, note, focus, URL, viewport reveal, playback and share
cue from that value.

The rail must render from `activeIndex` and call the existing owner. It must not
introduce `selectedChapter`, `railIndex`, a DOM-owned selection, or a second URL
parser. Roving keyboard focus is transient focus, not chapter selection.

### The active node trail and the proposed chapter rail are different levels

The existing `guided-view-trail` is created only for the selected view and
shows the ordered nodes in `view.focus`. The new rail sits one level above it:

- **chapter rail:** which authored view to inspect;
- **story trail:** which focused nodes make up the active view.

Both should remain visible when a chapter is active. Replacing the node trail
with chapter buttons would discard useful relationship evidence; nesting all
node steps under every chapter would create a dashboard. The bounded design is
one shallow chapter row plus the existing active chapter trail.

## Primary-source findings

### 1. Fireworks Tech Graph: keep the viewer bounded and export clean

The comparison is pinned to
[`yizhiyanhua-ai/fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44).
Its interactive viewer exposes one title, a focused set of native controls, a
focusable stage and an `aria-live` zoom status rather than a dashboard of
secondary panels
([viewer shell](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L223-L265)).

The viewer owns a single mutable pan/zoom object and reset path. Export
serializes the SVG rather than the surrounding viewport transform, so browsing
state does not become diagram content
([view and export implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L276-L328)).
It also removes CSS transitions when reduced motion is requested
([preference guard](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L238-L246)).

**Borrow:** one viewer owner, native controls, a clean artifact boundary and a
small surface. **Do not borrow:** the absence of authored chapter discovery, or
direct live-SVG serialization as Archify's export implementation. Archify's
canonical-clone cleanup is already stronger and must remain unchanged.

### 2. D2: named views need explicit semantics and a density guard

D2 gives authored boards three distinct meanings: `layers` are independent,
`scenarios` inherit from a base view, and `steps` inherit from the previous
step
([composition contract](https://d2lang.com/tour/composition/),
[scenario inheritance](https://d2lang.com/tour/scenarios/),
[step inheritance](https://d2lang.com/tour/steps/)). Its internal links and
clickable ancestor navigation make named boards directly reachable rather than
forcing a linear walk
([board links and backlinks](https://d2lang.com/tour/linking/)).

D2's export guidance also states that animated SVG is suitable for only a
small number of Steps or Scenarios; with too many boards a viewer can become
confused or wait for an entire loop. Larger compositions use multiple SVGs,
PDF pages, or PowerPoint slides instead
([composition export guidance](https://d2lang.com/tour/composition-formats/)).

**Borrow:** make authored names directly scannable, keep their existing order,
and preserve an obvious route back to the root/Show all state. **Do not
borrow:** nested boards, inheritance syntax, relayout per chapter, or an
animated loop. The rail should remain one line of navigation over the existing
compiled graph. On narrow screens it should scroll rather than wrap into a
multi-row control wall.

### 3. Flourish Stories: saved views become understandable through names,
progress and direct controls

Flourish saves interactions such as a map position or menu selection into each
story slide while updates to the underlying visualization data and settings
continue to flow into all derived slides. Its player supplies forward/back
navigation, authored captions, transitions, web embedding, and responsive
desktop/tablet/mobile output
([story and saved-view behavior](https://helpcenter.flourish.studio/hc/en-us/articles/8761559998351-Creating-a-story)).

The default story navigation contains native Previous and Next buttons, a
current/total count, a caption, and a progress bar. Boundary buttons are
disabled when they are not meaningful
([story player markup](https://helpcenter.flourish.studio/hc/en-us/articles/8761537615119-Customizing-the-story-player)).
Flourish recommends testing typical tablet and phone widths, and its responsive
embed redraws against the available space
([mobile guidance](https://helpcenter.flourish.studio/hc/en-us/articles/8761567966351-How-to-create-mobile-friendly-visualizations)).

Flourish also offers autoplay and looping as optional story settings
([autoplay behavior](https://helpcenter.flourish.studio/hc/en-us/articles/8761537726479-How-to-set-a-story-to-autoplay)).
Those are not required for discovery.

**Borrow:** authored names, direct selection, explicit current/total progress,
native buttons and responsive treatment. **Do not borrow:** generic anonymous
dots, a new autoplay loop, or animation attached to ordinary chapter
selection. Archify already has deliberate Play/Pause ownership and should not
expand it.

### 4. Mapbox Storytelling: one chapter should own one coherent state

The comparison is pinned to
[`mapbox/storytelling@04e6e37`](https://github.com/mapbox/storytelling/tree/04e6e372cd6a9bc2a776589121a2398cd09bbc93).
Each chapter record owns a stable ID, visible title, description, location and
enter/exit effects
([fixed chapter configuration](https://github.com/mapbox/storytelling/blob/04e6e372cd6a9bc2a776589121a2398cd09bbc93/config.js#L22-L114)).
The renderer exposes the chapter title as an actual heading rather than hiding
its name behind a numeric marker
([chapter markup](https://github.com/mapbox/storytelling/blob/04e6e372cd6a9bc2a776589121a2398cd09bbc93/index.html#L212-L247)).

When a chapter becomes active, one handler resolves its array index, marks the
chapter active, and applies its map and layer state; the exit handler removes
that active ownership
([active-state transition](https://github.com/mapbox/storytelling/blob/04e6e372cd6a9bc2a776589121a2398cd09bbc93/index.html#L318-L364)).
Its mobile rules widen story cards and explicitly repair touch scrolling
([mobile boundary](https://github.com/mapbox/storytelling/blob/04e6e372cd6a9bc2a776589121a2398cd09bbc93/index.html#L124-L135)).

The template's README warns that its full-page, scroll-driven interface does
not work as expected in an iframe
([embed limitation](https://github.com/mapbox/storytelling/blob/04e6e372cd6a9bc2a776589121a2398cd09bbc93/README.md#L19-L26)).

**Borrow:** stable authored names and one index-owned active chapter. **Do not
borrow:** scroll-position activation, hidden trigger chapters, auto advance,
ambient rotation, or full-page layout. The Archify rail must work by explicit
button activation and must not change the existing embed boundary.

### 5. Cytoscape.js: graph, viewport and export are separate contracts

Cytoscape.js exposes viewport state explicitly through `cy.viewport()` and can
save or restore graph state declaratively through `cy.json()`
([viewport API](https://js.cytoscape.org/#cy.viewport),
[state API](https://js.cytoscape.org/#cy.json)). Its input event model includes
mouse, touch and pinch gestures
([user-input events](https://js.cytoscape.org/#events/user-input-device-events)).
Image export also distinguishes the current viewport from the full graph with
an explicit `full` option
([PNG export contract](https://js.cytoscape.org/#cy.png)).

**Borrow:** keep graph selection, viewport reveal and artifact export as
distinct responsibilities. **Do not borrow:** a general graph-state snapshot
or a current-viewport export option in this slice. The current Archify
`activate(index)`, Show all, canonical export and embed behavior are already
the product contract.

### 6. WAI-ARIA and WCAG: native activation, bounded focus and no surprise
motion

The WAI-ARIA Authoring Practices carousel pattern requires explicit Previous
and Next controls and, if automatic rotation exists, a visible stop/start
control. Automatic rotation must stop when focus enters or the pointer hovers
and must not restart without an explicit request
([carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)).

For a one-at-a-time set, the manual Tabs pattern uses one Tab stop, Left/Right
to rove, optional Home/End for the boundaries, and native Enter/Space to
activate the focused item
([manual tabs keyboard contract](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)).
A toolbar follows the same one-stop and arrow-key principle for grouped
controls
([toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)).

The visual rail is navigation over a diagram, not necessarily a set of DOM tab
panels. Use a labeled navigation/toolbar group of real `<button>` elements and
`aria-current="step"` for the selected chapter rather than applying `tablist`
semantics without a real `tabpanel` relationship.

WCAG says non-essential motion triggered by interaction must be disableable,
and automatic moving content that lasts more than five seconds requires a
pause/stop/hide mechanism
([Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions),
[Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)).
The `prefers-reduced-motion` media feature communicates a request to remove or
replace non-essential motion
([Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)).

**Borrow:** real buttons, one roving Tab stop, visible selection and explicit
playback. **Do not borrow:** automatic activation merely because keyboard focus
moves. Manual activation lets a reader scan long authored names without
changing the diagram underneath them.

## Recommended product contract

### Structure

Keep the existing outer controls and insert one shallow chapter rail between
the current chapter copy and the active node trail:

```text
←  0 / 4  Explore this system                         →
   [01 Overview · 4 steps] [02 Trust boundary · 3] [03 Request path · 5] [04 Recovery · 3]
   Play story                                      Show all
```

When a chapter is active, its existing label, note, story trail, Play/Pause,
Previous, Next, `[` / `]`, and Show all behavior remain in place. The rail is
an additional direct route to the same `activate(index)` function.

### Visibility and counts

1. Render the rail as soon as valid `views` exist, including at `activeIndex =
   -1` and visible `0 / N` state.
2. Preserve the source array order; do not sort alphabetically or by count.
3. Show every authored `view.label` as visible text. Do not replace names with
   dots, tooltips, or chapter numbers alone.
4. Derive each visible step count from `view.focus.length`. Do not query the
   rendered story-trail DOM, count edges, or duplicate a `steps` field.
5. A zero-step view remains named and disabled/non-activatable only if the
   current data contract permits it; the rail must not silently invent focus
   targets.

### Selection and ownership

1. Each chapter item is a native button with its array index as its stable
   runtime mapping.
2. Click, tap, native Enter and native Space call the existing
   `activate(index)` path.
3. `activeIndex` remains the sole selected-chapter state. Selected styling,
   `aria-current`, count, label, note, hash, focus and story trail all derive
   from it.
4. Show all continues to call the existing `showAll()` path and returns the
   rail to `0 / N`; it does not destroy the rail.
5. Previous, Next, `[` / `]`, hash restoration and deliberate playback update
   the same rail through the normal render path. No rail-specific selection
   event writes graph state.
6. Do not add a restore stack. Existing Guided Views arbitration and Show all
   semantics remain authoritative.

### Keyboard and assistive technology

1. The rail is a visibly labeled navigation or toolbar group.
2. Exactly one eligible chapter button has `tabindex="0"`; the rest use
   `tabindex="-1"`.
3. Left/Right move focus to the previous/next eligible chapter, with bounded
   behavior at the ends. They do not select a chapter.
4. Home/End move focus to the first/last eligible chapter. They do not select a
   chapter.
5. Enter/Space use native `<button>` activation; do not add a second synthetic
   key-to-click handler that could double activate.
6. When selection changes by Previous, Next, direct activation, `[` / `]`, hash
   restoration or playback, the active rail item receives `aria-current="step"`.
   Do not steal focus unless the reader acted inside the rail.
7. The visible name and count form an understandable accessible name, for
   example `Trust boundary, chapter 2 of 4, 3 steps, current`.

### Visual language and density

1. Give active, past and future chapters cues that remain distinct without
   color:
   - active: heavier outline plus `CURRENT`/current marker;
   - past: check or completed marker plus quieter text;
   - future: numbered marker plus normal outline.
2. Focus-visible must remain different from active. A reader may keyboard-focus
   a future chapter while the current chapter remains selected.
3. Use compact pills/cards consistent with the existing viewer tokens. Do not
   add statistics, thumbnails, icons by kind, edge counts, completion
   percentages, or a second side panel.
4. Keep one row. Desktop may show the whole set or horizontal overflow; narrow
   screens must scroll instead of wrapping into multiple rows.

### Mobile and touch

1. At the existing narrow breakpoint, the rail is horizontally scrollable with
   touch pan and scroll snapping.
2. Every chapter button has at least a 44 by 44 CSS-pixel hit target.
3. Direct tap activates once; there is no hover-only preview or first-tap hover
   trap.
4. After an actual chapter selection, center the active item in the rail using
   non-animated/instant scrolling. Do not center merely because roving focus
   moved.
5. The rail must not overlap the existing bottom controls, create page-level
   horizontal overflow, or block SVG pan/zoom gestures.

### Motion

1. Do not animate chapter-button entry, selection, completion, focus, rail
   scrolling, or Show all.
2. Preserve only the existing deliberate Play/Pause progress animation and
   existing story-beat playback owned by `playing`.
3. Manual click/tap/keyboard selection remains still.
4. Existing reduced-motion behavior remains authoritative: no new timer,
   transition, or autoplay branch is added.

### Artifact boundaries

1. No schema or renderer change is needed; the rail is derived from the
   existing guided-view JSON in the shared viewer.
2. Do not add or change canonical SVG attributes for the rail.
3. Do not change `Archify.exporter`, export cleanup, canonicality receipts,
   print output, or image dimensions.
4. Do not change embed suppression or `?play=1` share-playback semantics.
5. The rail remains runtime HTML with the existing `.guided-views` / `no-print`
   boundary; it never enters cloned SVG output.

## Explicit borrow / skip matrix

| Source | Borrow | Skip |
| --- | --- | --- |
| Fireworks Tech Graph | bounded viewer controls; one owner; clean artifact boundary | anonymous viewport state as a story; live-SVG export changes |
| D2 | authored names; direct reachability; obvious root; density restraint | nested boards; new inheritance/schema; animated board loop |
| Flourish Stories | native Prev/Next; visible count/caption/progress; responsive navigation | anonymous dots; new autoplay/loop; selection animation |
| Mapbox Storytelling | stable chapter IDs/names; one index-owned active state | scroll-driven activation; hidden triggers; ambient rotation |
| Cytoscape.js | separation of graph, viewport and output responsibilities | general snapshot/restore stack; new current-view export |
| WAI/WCAG | native activation; roving focus; no-color state; explicit playback | focus-follows-selection; surprise or persistent motion |

## Acceptance criteria

1. A document with valid guided views renders one chapter-rail item per view.
2. The rail is visible before selection while the existing counter reads
   `0 / N`.
3. Every item visibly exposes the authored `view.label`.
4. Every item exposes a step count equal to `view.focus.length`.
5. Rail order exactly matches the compiled `views` array.
6. Clicking any item activates exactly that array index through the existing
   `activate(index)` owner.
7. Tapping any item on a coarse pointer activates exactly once.
8. Native Enter and Space on a focused item activate exactly once.
9. Exactly one eligible item participates in the page Tab sequence.
10. Left/Right rove focus without changing `activeIndex`.
11. Home/End rove to the first/last eligible item without changing
    `activeIndex`.
12. Direct rail activation updates the existing counter, label, note, focused
    graph, story trail and `#view=` hash together.
13. `activeIndex` is the only selected-chapter variable; no duplicate rail
    selection state exists.
14. Previous and Next update the rail's active state through the existing
    render path.
15. Existing `[` and `]` shortcuts update the same active state.
16. Existing hash restoration marks the matching rail item current.
17. Show all keeps the rail visible, clears current state, and restores
    `0 / N` through the existing `showAll()` behavior.
18. The active item has `aria-current="step"`; inactive items do not.
19. Active, past, future and keyboard-focus states are distinguishable without
    relying on color alone.
20. Manual chapter selection adds no animation or timer.
21. The only moving rail-adjacent progress remains the existing deliberate
    playback progress owned by Play/Pause.
22. Under `prefers-reduced-motion: reduce`, the rail adds no motion and existing
    playback fallback remains intact.
23. At a 390 CSS-pixel viewport, the rail stays in one horizontally scrollable,
    scroll-snapped row with at least 44 by 44 pixel item targets.
24. Selecting a chapter on mobile centers the active rail item without page
    horizontal overflow or overlap with bottom controls.
25. The rail does not depend on hover and does not block graph touch gestures.
26. Documents without guided views render no empty rail.
27. No renderer, schema, validator, fixture model, or guided-view JSON shape
    changes are introduced.
28. Canonical SVG content is byte/structure-equivalent apart from unrelated
    existing generation changes; no rail marker enters SVG source.
29. SVG/image export and print contain no chapter-rail HTML or runtime state.
30. Existing embed suppression and share-playback behavior are unchanged.
31. Existing Prev, Next, Play/Pause, Show all, story trail, node release,
    presentation and URL tests remain green.
32. New contract tests cover `0 / N`, names/counts, activation delegation,
    roving focus, no-color states, mobile geometry, reduced motion, and artifact
    boundaries.

## Decision

Implement the **Named Chapter Rail** as a shallow extension of
`Archify.guidedViews`.

The desirable richness is not more ambient animation. It is making the
author's existing narrative structure legible before commitment: readers can
see what stories exist, how long each is, jump directly to one, understand
where they are, and return to the whole graph. Reusing `views`, `focus`,
`activeIndex`, `activate`, `showAll`, deliberate playback and existing export
boundaries keeps the result attractive, stable and recognizably Archify.
