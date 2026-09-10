# Viewer source

Edit `reader-layout.js` for Adaptive Reader Layout, `viewer-chrome-layout.js`
for navigation clearance, `viewer-camera.js` for camera interactions and
transactions, `semantic-radar.js` for the overview map, `export-cleanup.js` for SVG export cleanup, and
`template.source.html` for the rest of the Viewer.
`archify/assets/template.html` is the committed
generated artifact, consumed unchanged by all five renderers and the installed
Skill. These maintainer sources live outside the packaged `archify/` directory.

From `archify/`, run `npm run generate:viewer` after editing any source.
`npm run check:viewer` verifies freshness without writing; `npm test` includes
that check. Assembly inserts each fragment verbatim at its fixed marker.
Reader, Chrome Layout, Camera and Radar extractions preserve delivered HTML bytes. Export cleanup adds a
private function and a call, changing script bytes but preserving cleanup order
and SVG output. All fragments retain classic-script scope and initialization order.
Generated output is not a second editing
surface; release identity changes also belong in `template.source.html`.

## Reader contract

- The IIFE initializes once, after the page DOM and shared
  `Archify.waitForStableLayout` exist, before `viewerChromeLayout` and `view`.
  It captures `.container`, `.diagram-container` and its direct child SVG,
  optional header/chapter/card elements, and the initial viewBox ratio.
- The public Interface remains `measure`, `schedule`, `whenStable`, `active`,
  and `receipt`. Viewer Chrome Layout calls `schedule` after changing the
  navigation reserve and `whenStable` while probing layout. The browser
  visual checker also uses `window.Archify.readerLayout.whenStable`.
- Reader owns the outer width (`html`'s `--archify-reader-width`) and temporary
  `data-reader-layout` / `data-reader-overflow` attributes. Ineligible measures
  clear them and reset the recorded width. CSS consumes the width on `.container`.
  Reader never writes canonical SVG geometry, viewBox or semantic IDs.
- Initial wide-diagram classification sets `data-wide-diagram` on the diagram
  container and `data-diagram-shape` on `html`. These survive eligibility changes;
  CSS and camera/radar behavior still depend on the wide-diagram flag on narrow
  screens. This is not live reclassification after replacing the diagram.
- Reader owns its measure/overflow animation-frame handles and the load/resize,
  font-ready, ResizeObserver and MutationObserver subscriptions. They last for
  the page lifetime. `schedule` coalesces requests; deferred overflow settling
  rechecks eligibility. Leaving adaptive layout clears its state without
  unmounting the module or clearing another module's state.
- Width eligibility, overflow fallback and optional-observer behavior are
  unchanged. Shared `waitForStableLayout` waits for fonts, pending work and
  consecutive stable dimensions; its default 240-frame sampling limit starts
  after font readiness. It is not a wall-clock timeout for stalled fonts or
  background pages. Keep this helper shared with Viewer Chrome Layout.

## Viewer Chrome Layout contract

The IIFE initializes once after the shared waiter and Reader Layout, before
Camera (`Archify.view`). Its interface remains `measure`, `schedule`, `reprobe`,
`whenStable`, `stageRect`, `active`, and `receipt`. `measure` may return null while
probing or arranging follow-up work; `receipt` may measure if no receipt exists.

- `schedule` coalesces a measurement into one animation frame. Camera calls it
  after applying transforms. It does not request a fresh zero-reserve baseline.
- `reprobe` temporarily removes the rail, waits for Reader's `whenStable` and
  schedules measurement again. Concurrent probes reuse the pending Promise.
  A non-baseline camera or an empty baseline only schedules and resolves false;
  a completed probe resolves true. Reader rejection is caught as before.
- Writing a changed reserve calls Reader's `schedule`. Chrome's `whenStable`
  uses the shared waiter, including font readiness and the pending frame/probe
  checks. It has the same sampling limits described in the Reader contract.

| Owned state | Meaning and lifetime |
| --- | --- |
| Container `--archify-nav-reserve`; container and html `data-nav-stage-rail` | Current visible rail. Clearing removes these inline values/attributes. |
| Reserve and rail latch | Keep the clearance decision stable while Reader incorporates the extra space. |
| Baseline gap/intersection and restorable reserve | Preserve the unzoomed layout reference. Temporary ineligibility while zoomed can retain the recovery baseline even though the visible rail is zero. |
| Probe fallback and pending Promise | If Camera changes during a probe, retain the prior reserve for recovery. They settle through the existing Reader Promise chain. |
| Measurement frame, follow-up frame, receipt, event/observer subscriptions | Page lifetime. There is no unmount/destroy; leaving eligibility is a layout state change, not module disposal. |

Eligibility requires the container, direct-child SVG, visible navigation, width
above 720px, no embed mode and no print media. This differs from Reader's 1024px
threshold. Presentation is eligible when its navigation is visible. A hidden or
absent legend does not disable protection of the SVG stage. `stageRect` removes
camera scale/translation from measured geometry; it never rewrites SVG geometry.

Resize, load, print, font readiness and the existing observers retain their
original roles. ResizeObserver watches navigation/SVG/legend size;
MutationObserver watches legend content and the root embed/presentation/preset/
theme attributes. Camera Reset preserves the established rail; viewport, mode
and content changes are responsible for baseline reprobes. Optional observer
fallbacks remain event-driven, without a new polling mechanism.

CSS stays in the shell: reserve affects container and floating-panel spacing,
while root rail state also changes header/chapter/card spacing. Reader reads the
resulting layout rather than importing Chrome's private state. Keeping this
contract beside the source localizes navigation-clearance maintenance; the
Reader/Chrome feedback and Camera/CSS dependencies still exist.

## Camera contract

`viewer-camera.js` initializes `Archify.view` once, after Reader and Chrome
Layout, before Radar. It captures the diagram container, its first SVG, required
zoom/reset controls and the initial viewBox. The existing `apply()`,
`pinControls()` and next-frame semantic sync stay in that order. Focus and Guided
Views already exist; checks for later modules and deferred callers remain needed.
The shared `viewerText` helper stays in classic-script scope.

The interface remains `zoomIn`, `zoomOut`, `reset`, `reveal`, `centerAt`,
`logicalViewport`, `sync`, and `state`. `state()` returns a copy of scale/x/y/mode;
the modes are overview, manual and semantic. Zoom and Reset return undefined;
`centerAt` returns a boolean, `logicalViewport` can return null, and `sync`
delegates to `reveal` or returns false. Manual Reset interrupts callers, whereas
`reset({ automatic: true })` stops camera motion without the manual takeover path.

`reveal` returns a transaction or false, with branch-specific side effects.
Desktop empty/unknown targets can return before changing the camera. At widths
up to 720px it first stops motion and applies a semantic scale-1 state; a wide
diagram can then return false for missing targets. A non-wide mobile diagram
returns an immediately completed transaction even without targets. Do not turn
these branches into a uniform Promise or assume false means no state change.

Transactions expose `id`, `state`, `target`, `settled`, `frame`, `timer`,
`finished`, `resolve` and `cancel(reason, commitTarget)`. `finished` resolves to
`{ id, state }` through the existing completion path. Replacement, manual
takeover, Reset and explicit cancellation preserve their distinct reasons;
repeated cancellation returns false. Committing a target during cancellation
differs from leaving the current state. Object/settled checks and cancellation
of frames/timers prevent superseded camera work from advancing; callers retain
their own stale-result checks. These fields are documented compatibility facts,
not an invitation for callers to manage the private scheduler.

Desktop transactions use animation frames. Wide mobile diagrams use contained
scrolling, the existing 460ms completion timer and automatic-scroll guard;
completion does not certify that native smooth scrolling has ended. The instant,
reduced-motion and call-time hidden-page branches keep their existing outcomes.
Camera does not subscribe to every later visibility/media change: Guided Views,
Motion Governor and other callers retain their own responsibilities.

| State / dependency | Ownership and coordination |
| --- | --- |
| Scale/x/y/mode, drag, transaction generation/object, camera frame/timer, clip/resize frames, automatic-scroll guard | Camera owns its page-lifetime state and pointer/scroll/resize/hashchange subscriptions. There is no destroy method. |
| SVG `transform`, `clip-path`, `data-view-scale` | Camera applies runtime transforms and clipping without rewriting authored geometry, viewBox or semantic IDs. Export cleanup removes these from its clone. |
| Container detail/camera attributes, `is-pannable`, camera movement/transaction flags, `data-just-panned`, `--archify-scroll-x` | Camera updates controls, drag suppression and mobile control positioning. `is-panning` is also used by Radar surface dragging; it is not exclusively owned by Camera. |
| Zoom/Reset labels, disabled state, detail attributes, title and ARIA text | Camera renders controls through shared translation helpers; associated CSS stays in the shell. |
| Reader width/wide-diagram classification; Chrome navigation reserve | Owned by the layout modules. Camera consumes geometry and classification; `apply()` schedules Chrome and synchronizes Radar. |
| Focus / Guided Views / Route | Finishing transactions repositions Focus. Manual takeover cancels guided handoffs and pauses Story and Route Journey, preserving Route elapsed time as before. Semantic sync prioritizes Guided Views over Focus. |

Focus, Guided Views/Story, Finder, Route and Radar reveal semantic targets;
Radar also consumes `logicalViewport` and calls `centerAt`. Presentation resets
and schedules semantic sync. Guide and keyboard shortcuts invoke navigation
commands. Camera samples rendered transforms when manual input takes over,
rather than treating the intended target as the current painted position.

Transaction completion, rendered transform/clip convergence and Reader/Chrome
layout stability are different observations. `finished` is not a page-wide
stability promise. CSS transitions and the clip sampler remain coordinated with
the existing layout feedback. Extraction localizes camera maintenance without
removing these runtime dependencies.

## Semantic Radar contract

`semantic-radar.js` initializes `Archify.radar` once after Camera and before
Presentation. It captures the diagram container and direct-child SVG, initial
viewBox, map panel/surface/controls, navigation and optional Passport. It creates
one runtime map SVG outside the canonical diagram and schedules the initial
node build. Reopening rebuilds node rectangles without appending another map SVG.
The shared `viewerText` helper and the existing HTML/CSS stay in the shell.

The interface remains `open`, `close`, `toggle`, `sync`, `focus`, `isOpen`, and
`count`. `isOpen()` reports requested intent, not panel visibility: unavailable
space can leave intent true while the panel is hidden and aria-expanded is false.
`open()` returns true even in that state; `close(options)` returns false and
optionally restores focus to the trigger. `toggle()` switches intent without
requesting surface focus. `sync()` immediately retries a requested hidden panel;
otherwise it coalesces work into one animation frame. It is not a stability Promise.

`focus(id)` returns whether the main node was found and actions were issued, not
whether navigation finished. It preserves Guided Views expansion, Focus selection,
Camera reveal, delayed page scrolling and main-node focus. `count()` reflects the
last build; it may be zero before the initial frame or with invalid geometry.
Failed getBBox calls and non-positive boxes are skipped. Required DOM and input
assumptions are unchanged.

| State / dependency | Ownership and coordination |
| --- | --- |
| Open intent, panel hidden, trigger ARIA/labels/title and space feedback | Radar owns them. A hidden requested panel can recover on retry or reflow. Close clears intent and retries. |
| Manual position and last placement; dock/side/compact/placement attributes; `--archify-radar-left/right/top` | Radar owns placement. Close clears current docking styles but retains position memory. Reopening or resizing can constrain it to current geometry. |
| Panel drag and viewport drag | Titlebar input moves the panel; surface input calls Camera. Pointer matching, capture/release and cancellation retain their separate rules. `is-panning` is shared with Camera. |
| Passport `data-radar-yielded` and saved `aria-hidden` | During compact expansion Radar can yield Passport space. Restoration reinstates the exact original attribute value, or removes it if originally absent. |
| Map nodes, viewport rectangle, activity markers and status | Derived from main-node bounds, Camera logicalViewport, Focus and Story state. Authored SVG geometry, viewBox and semantic IDs are not rewritten. |
| Sync frame, space retry and resize/scroll/ResizeObserver subscriptions | Page lifetime; no destroy method. Hidden-panel-only observer notifications are ignored to avoid a retry loop. |

Placement retains normal, compact and unavailable fallbacks. Navigation, Passport
and legend are hard blockers; active nodes are soft blockers. Manual position
priority, candidate scoring, clamping, gap and rounding remain private Radar
implementation. Cancelling titlebar drag restores the previous position intent
and recomputes placement in the current layout; it need not restore identical
pixels after geometry changes. Capture-phase Escape cancels titlebar dragging
before the global close shortcut. Surface pointercancel ends its drag without
restoring the previous camera state.

Compact expansion may hide Passport temporarily. Failed expansion, returning to
compact, unavailable space and closing restore it through their existing paths.
Space retry permits four 60ms attempts per round; success and external reflow
can reset the count. Close clears that timer and both drag records, hides the
panel and removes the shared panning class. It does not cancel the already queued
sync frame (which checks hidden), the untracked delayed node-scroll callback, or
universally remove every drag attribute. In particular, `data-dragging` is removed
by the surface drag-end handler, not by the close/reset-docking path.

Camera and Focus notify Radar to sync. Radar consumes Camera logicalViewport and
calls centerAt/reveal; opening clears Semantic Lens preview and closes that panel
as before. Route, Semantic Lens, Guide and global keyboard handlers keep their
existing mutual-exclusion and focus rules. Reader's wide-diagram classification
and Chrome's navigation reserve affect measured placement without transferring
ownership. Embed/print and narrow-screen presentation retain their existing CSS
and caller rules, rather than a new universal Radar eligibility gate. Export
continues cloning only the canonical diagram, excluding the runtime map SVG.

## Export cleanup contract

`cleanExportClone(clone)` lives inside the Export closure. Its sole caller is
`serializeSvg`: clone the live SVG, clean it, apply an explicitly requested
Route/Reach snapshot, then add dimensions, theme/font styles and serialize.
It mutates only the supplied SVG clone and returns the existing
`canonicalStateClean` boolean. It neither reads live selection nor calls a
Viewer capability or changes the live DOM. No new `Archify` interface is exposed.

| State owner | Clone treatment |
| --- | --- |
| Camera | Remove runtime transform, clipping and view scale. Preserve authored geometry and viewBox. |
| Focus, relationship preview, reachability, Intent Trace | Remove selection/preview markers and runtime overlays; reset node `aria-pressed` using the existing rule. |
| Guided Views and Story | Remove chapter/handoff/preview/beat markers, overlays and story step styles. |
| Route Probe | Remove picking, result and journey markers/overlays and route step styles. |
| Semantic Lens and legend preview | Remove filtering/preview decorations and runtime legend accessibility attributes. |
| Source Evidence | Remove beacons/counts; restore recorded original labels. Missing or empty original labels remove `aria-label`, as before. |
| Previous Route/Reach share decoration | Remove before applying the current export's explicit snapshot. |

Original content, node/edge identity, geometry and authored animation metadata
remain. Animation handling for share variants and recordings stays in Export.
Cleanup preserves the existing operation order, including overlay removal before
descendant cleanup. Missing optional decorations are harmless; repeated cleanup
is idempotent. The function assumes an SVG clone supplied by Export, not null or
the live SVG. Restore records are runtime metadata, not a general undo history.

The boolean checks the existing known transient-state contract; it cannot detect
arbitrary future decorations. Keep the cleanup and its check together. Adding a
new runtime decoration still requires checking this contract: extraction isolates
that knowledge from serialization, but does not eliminate producer/cleanup
coordination. Do not broaden rules or rejection behavior during a pure extraction.

Route/Reach validation, finite-dimension checks, receipts, errors, menu behavior,
rasterization, clipboard and recording remain owned by Export. Its existing
callers use the same paths and return fields. Tests exercise final browser exports;
isolated clone tests supplement them for restoration and idempotence.

For required browser, output and package evidence, follow
[Contributing](../CONTRIBUTING.md#local-setup-and-verification).
