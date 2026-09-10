# Viewer source

Edit `reader-layout.js` for Adaptive Reader Layout, `viewer-chrome-layout.js`
for navigation clearance, `viewer-camera.js` for camera interactions and
transactions, `semantic-radar.js` for the overview map, `motion-governor.js` for
motion mode and ownership, `node-finder.js` for node search and endpoint picking,
`intent-trace.js` for hover/focus previews, `semantic-lens.js` for type selection
and legend previews, `export-cleanup.js` for SVG export cleanup, and
`template.source.html` for the rest of the Viewer.
`archify/assets/template.html` is the committed
generated artifact, consumed unchanged by all five renderers and the installed
Skill. These maintainer sources live outside the packaged `archify/` directory.

From `archify/`, run `npm run generate:viewer` after editing any source.
`npm run check:viewer` verifies freshness without writing; `npm test` includes
that check. Assembly inserts each fragment verbatim at its fixed marker.
Reader, Chrome Layout, Camera, Radar, Motion Governor, Finder, Intent Trace and Semantic Lens
extractions preserve delivered HTML bytes. Export cleanup adds a
private function and a call, changing script bytes but preserving cleanup order
and SVG output. All fragments retain classic-script scope and initialization order.
Generated output is not a second editing
surface; release identity changes also belong in `template.source.html`.

## Semantic Lens contract

The complete IIFE initializes once after Route Probe and before Guide, in the
existing classic-script scope. Legend decoration, listeners, `renderKinds()` and
`syncFromHash()` retain their order. The ten methods remain `open`, `close`,
`toggle`, `clear`, `clearPreview`, `select`, `copyLink`, `isOpen`, `active`, and
`kinds`. Required inputs are the document root, diagram container/direct SVG,
Lens controls and shared translation helpers; Legend Bridge is optional.

- Selection, legend preview and panel visibility are separate states. Lens owns
  selected kinds, legend entry/input references, active preview, opener, runtime
  decoration, flow overlay and page-lifetime listeners/callbacks. `active()`
  returns a copied array or null; `isOpen()` reads panel visibility; `kinds()`
  dynamically collects counts. There is no mount/unmount API or persistent index.
- Collection requires node ID and kind, keeps the first element per nonempty ID,
  and treats empty kind as neutral. Sort is count descending then translated
  label. Relationships group by edge key, otherwise from/to/label. Single-kind
  selection marks touching relationships and peers; two kinds include only
  direct cross-kind relationships, with direction relative to selection order.
- `select` clears legend preview before validation. Unknown or third kinds return
  false; existing kinds toggle off. Removing the last kind returns false without
  the Camera reset performed by explicit `clear`. Adding the first kind clears
  Focus, Route, Guided Views and Intent in that order, with existing options.
  These real callers can affect Camera; the second kind does not repeat prepare.
- `close` returns false and hides only the panel, retaining selection, hash and
  flow. It normally restores the current opener's focus. `clear` returns false,
  clears selection/Lens SVG state and docking, updates URL unless disabled,
  resets Camera unless `preserveView:true`, and closes only for `closePanel:true`.
  It does not itself clear legend preview. `clearPreview` returns undefined,
  clears preview attributes but retains hovered/focused references, selection,
  URL and panel state. A false return is not a guarantee of no side effects.
- `open` rejects embed early, records the opener, closes Export/Finder/Radar/Guide
  as currently implemented, renders and opens the panel, then docks/focuses in
  rAF. It does not introduce a universal preview cleanup. Repeated/rapid calls
  retain pending-frame ordering. Guide is initialized later and stays a runtime
  lookup. Other module callers and the global L/Escape shortcuts stay in the shell.
- Legend decoration is initialization-only. Zero-count entries get hit/badge
  decoration but no button role; positive entries use roving tabindex and count
  ARIA. One or two available entries use group, three or more use toolbar.
  No bridge or embed skips decoration. Fonts-ready and resize remeasure authored
  children, excluding runtime decoration, with the existing getBBox fallback.
- Fine-pointer non-touch hover and native focus drive preview; focused entries
  win during sync and relatedTarget guards internal transitions. Media query is
  captured at initialization. Selection, open panel, Presentation, Focus, Intent,
  Route, Story and relationship preview gate new previews. The same active entry
  can return early before checking blockers; no new observer guarantees instant
  cleanup when another attribute changes. Preview writes node/edge match, selected
  and peer attributes without committing selection, URL or flow overlay.
- Legend arrows wrap; Home/End and Enter/Space preserve keyboard behavior and
  opener restoration. Activation still opens after a rejected third selection.
  Panel buttons rerender during click, so outside-click detection must retain
  composedPath as well as contains and launcher exemptions. The dialog remains
  non-modal; no focus trap or panel coordinator is introduced.
- Flow count measures relationship groups. Zero/embed produces no overlay;
  more than 24 sets quiet density without dropping matches/counts. Returning to
  24 restores flow. Only each group's first member supplies transform/shapes;
  unlike Intent, later members are not cloned. Shallow path/line/polyline clones
  preserve authored geometry, the removal list, pathLength=1, direction and
  step-times-0.08s delay. No shapes can mean an active selection without overlay.
- URL updates replace the hash, preserving pathname/query. Hash restoration
  filters unknown/duplicate kinds and keeps the first two, without opening or
  normalizing the URL. Missing/empty lens clears an existing selection while
  preserving view and URL; a nonempty all-invalid value retains selection.
  Copy prefers clipboard then textarea/execCommand fallback, cleans the field
  and restores feedback after 1600ms. It has no cancellation/debounce contract.
- Docking removes the side attribute first. Hidden, width <=720 and zero-size
  panels return right without writing it. Desktop compares selected-node overlap
  plus legend/nav overlap weighted 1000, with 16px margins and ties going right.
  Open/select and selected-open resize retain their triggers; no Camera observer
  or guarantee of collision-free layout at every size is added.
- Lens writes `data-lens-*`, `data-legend-preview-*`, legend decoration and panel
  DOM/ARIA. Existing CSS owns themes, opacity, flow directions, reduced/Still,
  print/embed and responsive rendering. Motion Governor observes semantic state
  to derive owner; Lens does not claim/release it. Export Cleanup strips clone
  state and decoration; it remains in its own module. Export serialization and
  subsequent download/global-click effects are distinct observations.

`semantic-lens-browser.test.mjs` covers five-mode initialization, trusted input,
real capability handoffs, cleanup, URL/copy, themes, motion and SVG export.
Explicit DOM/media/geometry/clipboard fixtures isolate boundary inputs; they do
not certify touch hardware, OS clipboard permission, screen readers or arbitrary
layout collision freedom. Static Lens/legend/flow checks remain useful alongside
browser checks. This split narrows maintenance scope while preserving runtime
collaboration and single-file delivery.

## Intent Trace contract

The complete IIFE initializes once after Focus and before Guided Views, with
the existing classic-script scope and listener order. Its interface remains
`show(id, options)`, `clear(options)` and `active()`. It requires the diagram's
direct SVG child, `#intent-trace-status`, document root and shared `viewerText`.
Focus/Route active queries are runtime lookups; Route initializes later.

- Intent owns active ID, hovered/focused node references, the entry timer,
  preview overlay, Intent node/edge attributes and status text. Its listeners
  last for the page lifetime; there is no mount/unmount API or persistent index.
- `show` first rejects empty IDs or blocked requests, silently clearing the old
  preview and returning false. An already-active ID returns true without
  rebuilding, announcing or cancelling a pending entry timer. Other IDs clear
  the old preview before lookup, including unknown IDs, which return false.
  Isolated nodes can be active without an inserted overlay.
- `clear` returns undefined, cancels the entry timer, clears active ID, removes
  overlay/Intent attributes, and normally clears status. `announce:false`
  retains status. It does not erase hovered/focused references, so later input
  can reuse them. Only `show` with `announce === true` writes status; repeated,
  rejected or silent requests can retain previous text.
- Fine-pointer non-touch pointerover schedules entry after 90ms, or an
  asynchronous 0ms under system reduced motion. Internal pointer transitions
  are ignored through relatedTarget. `matchMedia` absence retains the current
  fine-pointer fallback. User Still mode does not change this delay rule.
- The entry callback checks the hovered reference before showing. Native
  focusin records focus and shows immediately; pointerout/focusout update their
  reference and run sync, which prefers focused over hovered. This local
  preference does not extend to every scheduled callback. The existing
  duplicate-show and retained-reference behavior is not a global priority or
  suppression mechanism.
- Non-node container pointerdown and window blur silently clear. Global Escape
  remains in the template with its existing capability priority. Blocking is
  evaluated by show: embed, Guide, panning, Lens, Story, relationship preview,
  and active Focus/Route. Changing a blocking attribute alone does not install
  a new observer or promise immediate cleanup; callers retain their effects.
- Every actual build reads semantic nodes and directed relationships from the
  SVG. Counts deduplicate by edge key, or from/to/label fallback; DOM edge
  members are still all marked/cloned. Self-loops are counted once as loops.
  Only path/line/polyline shapes are shallow-cloned, using the existing attribute
  removal list, wrapper transform and insertion position. Author geometry is
  preserved; `pathLength=1` normalizes animation, not coordinates.
- Incoming/outgoing labels describe direction relative to the previewed node.
  Both animate along authored source-to-target geometry; incoming is not
  reversed. The single 1.15s CSS animation does not clear the preview on end.
  Reduced motion/Still retain the existing static preview styles.
- Intent writes `data-intent-trace-active`, node/edge match and node-selected
  attributes and the aria-hidden overlay. Existing CSS owns opacity, direction,
  theme/preset and motion rendering; the overlay remains pointer-transparent.
  Motion Governor observes the active attribute to derive ownership; Intent
  never claims or releases an owner. Export Cleanup strips cloned Intent state,
  while Intent clears the live diagram. Neither dependency moves into this file.

`intent-trace.test.mjs` retains generated-output checks. The browser test covers
five-mode initialization, real pointer/native focus handoffs, bounded timer
cleanup, isolated timer and SVG fixtures, blockers and actual callers, real CSS
completion, Motion ownership, reduced motion, themes and SVG export. Fixtures
do not claim touchscreen hardware, background throttling or screen-reader
verification. The extraction narrows maintenance scope without redesigning the
existing runtime collaboration.

## Node Finder contract

The complete IIFE initializes once after Presentation and before Route Probe.
It uses the existing classic-script scope and renders the initial list at that
position. Its interface is `open`, `close`, `toggle`, `select`, `isOpen`,
`context`, and the numeric `count` property. There is no mount/unmount API.

- Finder owns its initial semantic-node index, visible result list, context,
  panel rendering and page-lifetime listeners. `count` is the initial index
  size, not the current result count. Changing the SVG later does not reindex.
- Initialization requires the diagram SVG, Finder controls, Source Evidence
  and the shared `viewerText`, `viewerCount`, and `viewerKindLabel` functions.
  Source Evidence supplies search metadata; Finder does not verify repositories.
  Route Probe and Semantic Lens initialize later, so their references remain
  runtime `Archify.*` lookups with the existing availability checks.
- Search preserves authored DOM order and the existing ID, label, type, text,
  metadata, brand and source-reference matching. Queries are trimmed and
  lowercased for substring matching. Connections are counted by distinct
  directed from/to pairs, not edge keys or distinct neighbors.
- Context comes from explicit `options.context`, otherwise the current Route
  Probe picker, otherwise focus defaults. Requested fields shallowly override
  defaults. `allowedIds: null` leaves all items available; `[]` leaves none.
  This filters results only: public `select(id)` still searches the whole index.
- Opening rejects embed before other work, clears Lens preview, closes Export
  and Lens as currently implemented, resolves context, updates controls and
  clears the query, then schedules input focus with rAF. Reopening repeats this
  work. It does not establish a global exclusive-panel coordinator.
- Closing hides the panel, clears the input and updates `aria-expanded`, but
  retains context and rendered results until the next open/render. Ordinary
  close returns focus to the trigger unless `restoreFocus:false`; route close
  delegates focus and docking to Route Probe. Repeated close and pending input
  focus retain their current ordering; there is no rAF cancellation mechanism.
- Ordinary selection runs Guided Views `showAll({clearFocus:false,
  updateUrl:false})`, Camera `reset({automatic:true})`, Focus
  `set(id,{toggle:false})`, then Camera `reveal([id],{includeNeighbors:true,
  reason:'finder'})`, preserving optional checks and order. It closes without
  restoring trigger focus and focuses the node with the existing preventScroll
  fallback. An unknown ID returns false before these actions.
- Route-source/target selection delegates to Route Probe `choose`. Missing or
  rejected choices return false without the success path. A resulting target
  state requests Camera reveal with `reason:'route-pick'`; then Finder closes
  and focuses the node. This branch does not directly call ordinary Focus or
  Guided View selection; global event handlers retain their own effects.
- Finder writes panel `hidden`/`data-context`, trigger `aria-expanded`, title,
  input placeholder, list ARIA, result children, empty-state visibility and
  status text. Route Probe owns its `data-finder-open` attribute through
  `finderOpening`/`finderClosed`. Existing HTML/CSS remain in the template.
- Input ArrowDown enters results and Enter selects the first visible result;
  result arrows wrap and Home/End move to the endpoints. Escape prevents default
  and stops propagation before closing. Outside clicks close without restoring
  focus, except the existing `[data-node-finder-trigger]` exemption. Global `/`
  handling, Guide and Route callers remain outside Finder. The dialog stays
  non-modal; no focus trap or keyboard adapter is introduced.

`finder.test.mjs` retains generated-output checks; `finder-browser.test.mjs`
exercises five-mode initialization, trusted keyboard/mouse input, real Route
source/target collaboration, retained context, panel cleanup, themes, constrained
layout, reduced motion and SVG export. Its metadata fixture isolates search
inputs; it does not claim repository verification or brand-rendering coverage.
The source split narrows maintenance scope while preserving runtime dependencies.

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

## Motion Governor contract

`motion-governor.js` initializes `Archify.motionGovernor` once after Export,
before Source Evidence and Focus. It captures the initial trace capability,
main SVG, controls and reduced-motion query. Guided Views and Route initialize
later; their existence checks remain necessary. The final `syncVisibility()`,
`publishOwner()`, `render()` calls keep their original order. CSS, controls,
translation helpers and authored animation metadata stay in their existing sources.

The interface is `capable` plus `pause`, `resume`, `toggle`, `setMode`, `mode`,
`claim`, `release`, `suspend`, `isPaused`, and `owner`. Capability is fixed from
the initial SVG `data-animation="trace"`. Non-trace pages hide the control, clear
the existing root motion attributes, and return inert methods: false for pause/
resume/toggle/release, zero for claim, still for modes, true for isPaused, an
empty owner, and a suspension function returning false. That branch does not
install the trace listeners or run its visibility initialization.

For trace pages, pause/resume/toggle return the reader's pause intent, while
mode/isPaused report effective pause: reader intent OR reduced motion OR a
nonempty suspension table. Thus resume can return false while mode remains still.
setMode treats only `still` as a pause request, returns effective mode and honors
`persist:false`. The storage key remains `archify-motion`; user pause writes
`still`, resume removes it, and storage errors are ignored. System suspension
does not become a persisted user preference. Becoming live does not restart
Story/Route playback or replay an already settled ambient pass.

Explicit claims override derived owners. Without a claim, SVG attributes select
Story playing/follow, chapter, route, lens, relationship, intent, focus, legend,
then empty, in that order. A semantic owner can coexist with live mode. Claiming
even the same name clears the previous claim and invokes its cleanup before
publishing a new token/owner. Cleanup errors are caught; synchronous reentry keeps
the existing call order without a new guard or queue. Releasing the current token
does not run cleanup, advances the token and falls back to current SVG state.
Stale/repeated releases return false. Claims are not a stack of resumable owners.

| State / dependency | Ownership and coordination |
| --- | --- |
| Reader pause, suspension table, previous effective-pause value | Governor owns these. Ordinary suspend keys count references; each returned release function succeeds once. Visibility directly sets/deletes the same table's `visibility` key, so a caller using that key does not have independent counting guarantees. |
| Explicit/derived owner, token and cleanup callback | Governor owns arbitration. Guided handoff, chapter preview, Story and Route provide cleanup; their decorations and transaction state remain caller-owned. |
| Root motion/owner/capable/document-hidden attributes and button hidden/disabled/ARIA/text/title | Governor writes them; CSS consumes them. System preference, suspension, reader pause and owner retain their existing label precedence. Only the system preference disables the button. |
| Ambient started flag and pending element set | Governor starts at most one ambient pass and finishes it on the existing animation boundary or suppression paths. |
| Button/media/visibility/mutation/animation subscriptions | Page lifetime, no destroy method. Owner observation is installed only when initially non-embed and supported; it watches the explicit SVG attribute list. |

Entering effective pause pauses Story, settles handoff, and pauses Route Journey
with elapsed time preserved, using the existing reason priority and call order.
Route syncMotion retains its render-time notification. The previous-pause guard
does not imply a universal once-only guarantee under synchronous caller reentry.

Ambient starts from the initial edge/node animation targets. Animationend and
animationcancel remove event targets from the pending set; unrelated targets
are ignored, and an empty set settles and detaches those listeners. There is no
animation-name filter, timeout or polling loop. Empty targets settle as empty;
pause, owner, embed, share playback or document-hidden suppress the pass through
the existing render paths. Settle reason can be overwritten by a later render;
it is not immutable history. Runtime root-mode changes do not install additional
listeners or guarantee immediate reevaluation without an existing render trigger.

The Governor manages these Viewer signals, not every animation on the page.
Camera retains its transactions and CSS transitions; Export retains its separate
WebM canvas timeline. Authored geometry/IDs and canonical export cleanup remain
unchanged by this source extraction.

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
