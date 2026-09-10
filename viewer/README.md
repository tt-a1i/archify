# Viewer source

Edit `reader-layout.js` for Adaptive Reader Layout, `viewer-chrome-layout.js`
for navigation clearance, `viewer-camera.js` for camera interactions and
transactions, `semantic-radar.js` for the overview map, `motion-governor.js` for
motion mode and ownership, `node-finder.js` for node search and endpoint picking,
`intent-trace.js` for hover/focus previews, `semantic-lens.js` for type selection
and legend previews, `route-probe.js` for directed paths and Route Journey,
`guided-views.js` for authored chapters and Story playback,
`focus.js` for semantic selection, relationships, reachability and shared flow tokens,
`export.js` for export menus, serialization, images, cards, clipboard and WebM,
`export-cleanup.js` for its private SVG clone cleanup, and
`template.source.html` for the rest of the Viewer.
`archify/assets/template.html` is the committed
generated artifact, consumed unchanged by all five renderers and the installed
Skill. These maintainer sources live outside the packaged `archify/` directory.

From `archify/`, run `npm run generate:viewer` after editing any source.
`npm run check:viewer` verifies freshness without writing; `npm test` includes
that check. Assembly inserts each fragment verbatim at its fixed marker.
Reader, Chrome Layout, Camera, Radar, Motion Governor, Finder, Intent Trace, Semantic Lens, Route Probe, Guided Views, Focus and Export
extractions preserve delivered HTML bytes. Export cleanup adds a
private function and a call, changing script bytes but preserving cleanup order
and SVG output. All fragments retain classic-script scope and initialization order.
Generated output is not a second editing
surface; release identity changes also belong in `template.source.html`.

## Export contract

`export.js` contains the complete Export heading and IIFE. It initializes once
at its original position after Theme/Preset and before Motion Governor and
Source Evidence. `export-cleanup.js` stays private to that closure. Assembly has
one explicit child relationship: Export must contain exactly one EXPORT_CLEANUP
marker and no other known marker. The shell owns EXPORT; all other fragments
reject nested markers. Export is expanded before Cleanup in the fixed list,
without changing the generated script's execution order. This is not a recursive
loader or a second runtime initialization step.

### Interface and dependencies

The interface includes all ten `Archify.exportMenu` methods: open, close, isOpen,
run, shareCard, downloadRouteShareCard, downloadReachShareCard, syncRouteShare,
syncReachShare and copyShareCard. The same closure installs
`Archify.motion.canRecord` and `recordWebm`; this recording capability is distinct
from Motion Governor. Return values and synchronous/asynchronous failure modes
are part of the interface, not normalized by the extraction.

- Initialization requires the export menu, trigger and Route/Reach menu items;
  it probes format/clipboard/recording support, registers listeners and creates
  one toast live region. Later calls require the main diagram SVG and use the
  existing header, document title, font style and computed theme/preset styles.
- Shared viewerText, viewerCount and hasDrawableGeometry remain in classic-script
  scope. The last helper verifies drawable semantic edges in export snapshots.
- Menu open looks up Preset and Semantic Lens at call time, preserving optional
  checks, close arguments and preview clearing. Route Probe and Focus provide
  exportSnapshot/reachabilitySnapshot at sync/export time; their later script
  positions do not justify early capture or new initialization dependencies.
- Preset, Lens, Finder and Presentation close Export through its existing
  interface. Guide/Presentation open it; Route Probe and Focus synchronize their
  share items. The DOM menu routes clicks to the private ordinary PNG copy path.
  External consumers of Archify.motion retain both recording methods.

### DOM, styles and output state

- Menu state is its open class plus the trigger's aria-expanded. Navigation skips
  hidden/disabled items; ArrowUp/Down wrap, Home/End select endpoints, Escape
  restores trigger focus, Tab/outside clicks close without forced restoration.
  Ordinary export/copy uses close(true); Route/Reach downloads use close(false).
- The query openExport=1 waits for fonts and two animation frames; without the
  Font Loading API it retains the 200ms fallback. No new readiness coordinator
  is introduced. Toast reuses role=status, a frame callback and a 1500ms timer.
- shareCard returns a PNG Blob and does not download or write a receipt. Semantic
  variants re-read their current provider, reject unavailable/invalid snapshots,
  and retain the existing clone geometry/identity checks. Menu visibility does
  not grant a stale snapshot permission to export after Route/Reach is cleared.
- Downloaded SVG embeds both themes. Raster/card/recording serialization locks
  current theme variables after host CSS. CSS rule filtering, stylesheet order,
  cross-origin cssRules catches, embedded fonts and temporary theme probes stay
  unchanged. Moving CSS can change export output even when the live page looks
  similar; styles remain in the main template.
- Cleanup affects the clone. Canonical output excludes transient camera/focus/
  preview/route/story state; semantic cards intentionally apply their own share
  markers and styles afterwards. This does not promise that menu-driven focus
  changes leave all live preview state untouched.
- Raster scale chooses the largest fitting member of 4/3/2/1, falling back to 1
  even when that size exceeds the advisory pixel cap. Cards remain 1200x630.
  File names, MIME probes, quality and background choices remain unchanged.
- run clears old export receipts before starting. Success writes format/bytes/
  canonical and optional dimensions/variant/clean flags. Route/Reach downloads
  return their Blob and mark canonical=false. Their failures report share-card
  errors and alert. Regular run resolves through its existing handlers; failures
  record an error and alert, except WebM disables its item and shows a toast.
- Ordinary PNG copy only toasts on success; card copy also writes a card receipt.
  Their failure receipt behavior differs. Unsupported copy can return undefined.
  ClipboardItem construction with a Promise stays inside the user gesture;
  synchronous rejection falls back to a Blob, asynchronous write rejection does
  not take that fallback. SVG serialization can throw before run constructs its
  Promise chain. No common wrapper changes these distinctions.

### Resources and verification

| Owner/path | Lifetime |
| --- | --- |
| Auto-theme probes | Detached after computed-style sampling, including finally on failure |
| Download URL/anchor | Anchor appended/clicked/removed synchronously; URL revoked after 1000ms |
| Raster/card SVG URL | Lives until Image load/draw or error; revoked before toBlob completion, with existing catch cleanup |
| Recording background URL | Survives background loading and recording; released on image error, recorder-constructor failure or recorder cleanup |
| Recording tracks/rAF | Constructor failure stops created tracks; recorder error/stop uses existing guarded cleanup to stop tracks and cancel the frame callback |
| Recording/toast timers | Preserve existing bounded callbacks and state checks; extraction adds no cancellation protocol or shared busy flag |

recordWebm retains duration/fps options, defaults, minimums, MIME selection,
geometry-driven scene and encoder flush timing. This table describes existing
paths; it does not add universal recovery from arbitrary browser API exceptions.

`export-browser.test.mjs` exercises native menu input, unavailable formats,
auto-open/themes, real semantic cards, clipboard call order/fallback, raster
failures/retry, synchronous serialization failure, real WebM decode and recorder
failure cleanup. It intercepts download and clipboard boundaries without changing
production serialization. `export-cleanup-browser.test.mjs` supplies five-mode
canonical SVG and real raster/theme coverage. Existing share-card and WebM smoke
checks retain their broader artifact contracts. Set ARCHIFY_CHROME for browser
checks; ARCHIFY_EXPORT_RUNTIME_EVIDENCE optionally saves runtime observations,
menu screenshots and a real recording. CI runs the browser suite without relying
on optional evidence capture. Compare the same final tests on a fixed baseline
and candidate; encoding bytes/timing are not a deterministic oracle for video.

## Focus / Semantic Explorer contract

The complete IIFE initializes once after Source Evidence and installBeacons(),
before Intent Trace and Guided Views. Reader/Chrome Layout, Camera, Finder, Route
and Lens keep their later positions. Required diagram SVG, Passport controls and
relationship list remain required DOM. Shared viewerText/viewerCount/viewerKindLabel
and hasDrawableGeometry stay in the template's classic-script scope.

The interface is thirteen Focus methods: set, setMany, clear, copyLink, reach,
clearReach, reachabilitySnapshot, inspectRelationship, inspectRelationshipById,
reposition, relationship, reachability and active. The same closure also installs
Archify.flowTokens.create/kind/path before Story can consume them. This shared
provider is part of Focus ownership, not a second initialization step.

- set writes neighborhood mode into its supplied options object and delegates to
  setMany. setMany clears Lens preview/selection and, unless preserveRoute is true,
  Route before filtering IDs. An empty/unknown selection can therefore return false
  after those side effects. Valid IDs are deduplicated in supplied order. Repeating
  the same ordered selection toggles through ordinary clear unless toggle is false.
- A single neighborhood matches incident edges and neighboring nodes. Multi-node
  or explicit selection mode matches only edges whose endpoints are both selected.
  Focus counts duplicate edge keys once while marking every matching fragment.
  hideChip, label, mode, updateUrl, urlKey and urlValue keep their existing defaults.
- clear removes Reach, Intent, relationship preview/pin and Focus markers;
  it hides Passport and resets its existing fields.
  It resets Camera unless preserveView, updates the URL unless updateUrl is false,
  and restores a previously single selected node only when restoreFocus is true.
  clearReach and clearRelationshipPreview have narrower effects. Repeated clear
  does not gain a no-op return or stronger cancellation guarantee.
- active returns null, a single ID or a copied array. relationship returns a fresh
  record or null; reachability returns copied node/edge arrays. Snapshot results
  are constructed from current authored nodes, edges and validated Reach state.
- Passport uses existing label/kind/detail/context/tag/brand/source metadata. The
  Source Evidence provider owns repository/node lookup and beacon installation;
  Focus owns displaying or hiding evidence and building the existing safe links.
  Relationship rows are grouped out/in/loop, retaining authored order within each
  group and deduplicating keys. Up/Down/Home/End clamp within the resulting rows.
- Relationship intent priority is pin, then focus, then hover. Clearing one intent
  may restore another. Pointer transitions within the same row/hit target do not
  reset intent; touch and non-fine-pointer hover retain their filters. Direct hover
  waits 90ms (0 with reduced motion), rechecking pointer, pin and owner state when
  the timer fires. Clearing preview cancels that timer; it does not always unpin.
- Direct hit targets are created once from drawable path/line/polyline fragments.
  Same-key compatible fragments share one record; conflicting identity or duplicate
  authored relationship IDs make records ineligible. Hit geometry is cloned, with
  original path/points and existing transform handling retained. Focus does not
  repair malformed geometry or derive connectivity from labels.
- Direct pointer exploration is blocked by embed, Guide, panning, ordinary active
  Focus, Story, Route picking/result, Lens and chapter preview under the original
  predicates. Pointer and keyboard paths retain their different guards. Direct
  target arrows wrap, Home/End choose endpoints, Enter/Space inspect or toggle, and
  pinned Escape clears with updateUrl:false. Global Escape/shortcuts stay outside.
- Pinning first clears the curated view with the existing options, focuses the
  relation source, previews the matching Passport row and marks its hit target.
  Camera reveal remains a call-time lookup with the original one-rAF retry if
  Camera is not initialized yet. No polling service or dependency capture is added.
- Reach traverses authored direction breadth-first, deduplicates edge keys and
  preserves the original traversal/edge order for cycles, parallel edges and loops.
  It requires one selected origin and at least one other reachable node; repeated
  direction toggles unless toggle:false. It clears curated view/relationship state,
  updates Export controls and optionally URL/Camera according to existing options.
- reachabilitySnapshot fails closed when selection, Reach mode/attributes, depths,
  live node multiplicity or edge identity disagree. Each edge key requires exactly
  one drawable fragment, though compatible shapeless fragments are allowed. Extra
  marked nodes/edges, multiple drawable fragments and inconsistent endpoints/IDs
  yield null. It does not sanitize or silently rederive an invalid live snapshot.
- flowTokens consumes existing shape geometry, edge classes and node kinds. Kind
  priority remains security, event, data, state, call. create produces a detached
  token with the existing path, duration/class options and null behavior. Story's
  carrier lifecycle and Motion ownership remain in their existing modules.
- Relationship pulse removes any previous pulse, clones existing shape geometry
  and installs at most one flow token, retaining overlay placement and animation
  end/cancel removal. Embed, hidden, paused Motion and reduced motion prevent new
  pulses. Visibility/reduced-motion callbacks remove pulse without universally
  clearing static selection, preview or pin. Motion observes shared attributes;
  Focus does not gain a new owner token or controller.
- Hash restoration prioritizes relation, then focus/reach; a view hash avoids the
  ordinary no-focus clear branch. Invalid relation and embed relation restore use
  existing clear behavior. Focus does not become the parser for Route/Lens/Story.
  No new handling of arbitrary malformed IDs or selector escaping is introduced.
- copyLink requires exactly one selected node, prefers an authored pinned relation
  URL, otherwise copies focus plus optional reach. It preserves the non-hash URL,
  clipboard/fallback results and 1600ms feedback. Older feedback callbacks still
  render the then-current copy action; no generation or cancellation policy is
  added. Fallback textarea cleanup and promise return values are unchanged.

| State or surface | Owner and dependencies |
| --- | --- |
| Selected IDs, hover/focus/pin/preview references, reachability, hit targets, direct timer, lens rAF | Focus closure; page lifetime, no destroy interface |
| data-focus-active/match/selected, node aria-pressed, Passport content/hidden/expanded/top | Focus writes/clears; Camera reveals/resets and Radar syncs through call-time lookups |
| data-reach-active/match/origin/depth and Passport Reach controls | Focus; Export consumes syncReachShare and reachabilitySnapshot |
| data-relationship-preview/direct/pin-active, preview source/target and row/hit ARIA | Focus; Lens/Route/Story/Intent/Guide state controls existing eligibility rules |
| Relationship hit/pulse overlays and flowTokens construction | Focus creates; canonical export removes transient clones through Export Cleanup |
| Source Evidence payload/repository links, camera transactions, other feature state | Their existing modules; Focus remains a caller, with original options and order |
| SVG/document capture, node/row/hit keyboard and pointer subscriptions, passive scroll, resize, visibility, media listeners | Original execution positions and capture/passive/once semantics retained |

Export triggers may move focus or cause normal input-state handoff before the clone
is made. Verify live state and clone state separately; do not assert that every
export leaves every focus-backed preview unchanged. Author geometry, stable IDs,
viewBox and static SVG output remain unchanged by this source extraction.

Browser checks exercise actual node/relationship inputs, pointer delay, pin priority,
Passport grouping, cyclic Reach and strict rejection, cold/hash URLs, copy feedback,
real pulse end/cancel, media preference transitions, actual SVG export, three widths
and dark/light screenshots. Explicit DOM/clipboard/visibility/pointerType fixtures
cover controlled edge cases and are not claims about OS permissions or devices.

## Guided Views / Story contract

Chapter and Trail scrolling use their own viewports. Trail centering measures DOM
rectangles rather than an ancestor-relative offset. A page-lifetime ResizeObserver
watches both scroll containers and recenters the active item only when its viewport
width changes; scrolling alone does not recenter it. Without ResizeObserver, direct
selection still centers the item. This is a follow-up behavior fix, not part of the
original byte-preserving extraction.

The complete IIFE initializes once after Focus/flowTokens and Intent Trace, before
Reader/Chrome Layout/Camera. Camera and Lens remain call-time lookups; the delayed
initial Story follow must still work before Camera exists. Payload parsing, initial
focus filtering, cold panel state, chapter index, listeners, synchronous hash
restoration and pending share playback's double rAF retain their original order.
Required panel, Trail, payload and direct diagram SVG nodes remain required.

With authored chapters the interface is `count` plus seventeen methods: `activate`,
`showAll`, `play`, `playCurrent`, `pause`, `beatLink`, `copyBeatLink`, `cancelHandoff`,
`settleHandoff`, `clearPreview`, `isPlaying`, `handoff`, `active`, `preview`, `delta`,
`beat` and `focus`. Empty chapters, including the JSON parse-error fallback, return
only `count: 0` and `active`. The fragment does not add missing methods or normalize
arbitrary invalid JSON types. Initial focus filtering removes unknown/repeated IDs
in authored order; it is not a new dynamic graph index or kind filter.

- Guided Views owns chapter/beat selection, Story steps, playing/scope/completion,
  elapsed/dwell/timer and separate generations, handoff objects and promises,
  pointer/focus preview intents, Motion tokens, autoplay pending and copy feedback.
  Returned focus/delta/beat arrays are copies. Focus owns selected graph semantics
  and the shared flowTokens implementation; Camera owns reveal transactions.
- Activation preserves Focus's setMany options and the existing order of pause,
  preview cleanup, old handoff cancellation, Trail rendering, new handoff, controls
  and URL updates. `showAll`, `pause`, `clearPreview`, `cancelHandoff` and
  `settleHandoff` have different effects. Existing options and return values remain;
  no common reset or stronger panel exclusion rule is added.
- The chapter rail uses roving tabindex, clamped Left/Right, Home/End and native
  button activation. Focus can preview without activating. Trail beat buttons use
  click/Enter/Space and focusin pauses playback; they do not gain Route Journey's
  arrow navigation. SVG capture listeners release a curated chapter before normal
  exploration continues. The captured P/bracket/Escape keys retain editor/Guide
  guards and propagation differences; the template's global shortcuts stay put.
- Delta uses authored stable-ID intersections and order. Handoff anchors prefer
  the outgoing beat when shared, then search the old chapter backwards. No labels
  or geometry infer relationships. Pointer/focus previews are independent intents;
  the newest valid intent wins and clearing one may reveal the other. Hover/touch
  and relatedTarget filters remain. Setting intent can pause playback before
  checking preview eligibility. Presentation cleanup is distinct from intent reset.
- Preview blocking still depends on hidden/playing/handoff/embed/print and the
  existing Route/Lens/Intent/relationship/Focus attributes. MutationObserver and
  Motion preemption keep their original callbacks; release is not a universal
  promise that no other owner or remaining intent exists.
- Handoff retains first/same chapter and static fallbacks, a 110ms anchor hold,
  420ms Camera transaction, holding/no-anchor/settling state, receipt, role/anchor
  overlays and temporarily disabled beat/copy controls. Settle commits the target;
  cancel does not force target commit. Old hold/Camera/afterHandoff callbacks retain
  their different identity/playing/generation checks, not a common cancellation API.
- Story follow frames previous/current/next nodes with padding 64, maxScale 1.65
  and duration 320. Initial deferred rAF, reason/manual/linked/instant options and
  settled/interrupted receipts remain. Camera manual takeover and Motion/Guide
  callers keep their existing pause/settle responsibilities.
- Story steps follow authored chapter order, classifying adjacent-node relations
  as start/forward/reverse/multiple/group from direct edges. A group is not a
  computed path. Edge-key/fallback-key deduplication keeps DOM order and replaces
  an initially shapeless fragment with a later shape-bearing one. Shape presence
  is not Route's exportSnapshot drawable-validity check.
- Overlay shallow clones preserve path/line/polyline geometry and transform, the
  exact attribute removal list, insertion point, and node/edge step assignments.
  No shapes means no Story overlay. Beat states are past/active/next/pending, with
  original caption, note, ARIA, progress and next-node updates. Shared geometry is
  not recomputed or reversed for the story's reading order.
- A pulse requires one forward/reverse relationship and the existing motion
  conditions. Carrier creation uses flowTokens with 0.78s and the original placement.
  Pulse cleanup uses animationend plus its generation; there is no Route-style
  fallback timer. Claim/release/preempt and release:false stay intact. Governor
  also derives chapter/story ownership from SVG state, independently of tokens.
- Each beat dwells for max(1100, 3200 / max(1, total)) milliseconds. Pause normally
  retains elapsed time; resume uses the remainder, fresh beats reset it. Date.now,
  timer clearing and generation checks remain. Whole-story play can cross chapters
  after handoff; playCurrent has chapter scope and does not advance to another
  chapter. Repeated starts and replay retain their own existing effects.
- Automatic playback, pulse motion and handoff eligibility are different checks.
  Non-trace does not prohibit all Story playback. `play=1` marks pending single
  chapter playback, attempted after initial double rAF or visibility restoration.
  Consumed playback does not restart merely on visible, but pending playback can
  start there. Linked static moments and reduced-motion share outcomes keep their
  original beat/overview decisions and pending/playing/complete/interrupted/pinned
  presentation. Embed is not a blanket public-method guard.
- Chapter updates replace hash with view while preserving pathname/query. Moment
  links encode view/beat, remove play from the returned URL and leave the page URL
  alone. Initial/hashchange restoration, handoff deferral and latest-intent checks
  remain; unknown view/beat, empty hash and Focus/Relation/Route hashes retain their
  different existing effects. Manual beat selection does not write every step URL.
- Copy pauses as before, returns false without a moment, and uses clipboard with
  textarea/execCommand fallback. The 1600ms feedback timer is reset by existing
  cleanup, but a still-pending copy promise can complete after the chapter clears.
  No promise cancellation or shared Route copy helper is introduced.
- Guided Views produces data-story-*/data-chapter-* SVG/node/edge state, panel
  data-active-view/data-playing/data-autoplay, chapter-button state, Trail/caption/
  progress styles and Share Cue HTML/ARIA. CSS owns Shelf/Director layout, themes,
  responsive scrolling, Still/reduced-motion, print and embed rendering. Export
  owns cleanup of Story/carrier/handoff/preview/follow clones. Export first focuses
  its trigger, clearing focus-backed chapter preview; pointer-backed intent can
  remain. This input handoff precedes clone cleanup. Serialization is
  distinct from later download clicks and their global input effects.

`guided-views-browser.test.mjs` supplements the Story/Chapter source and SVG checks
with real navigation, timing, handoff, preview, links and exports. Graph, clock,
Camera receipt, visibility and clipboard fixtures expose specific edge cases;
real Camera, input, animation and complete playback are also exercised. Fixtures
are not evidence for OS clipboard permission, background throttling or arbitrary
screen/content collision freedom.

## Route Probe contract

The complete IIFE initializes once after Finder and before Semantic Lens, in the
existing classic-script scope. It registers listeners then synchronously restores
the initial hash. Later hashchange restoration runs in rAF. Required inputs are
the document root, diagram container/direct SVG, Route/Journey controls, shared
`viewerText`, `viewerCount` and `hasDrawableGeometry`. The latter stays shared
with Focus and Export; Lens remains a runtime lookup because it initializes later.

The nineteen methods remain `begin`, `choose`, `clear`, `toggle`, `escape`,
`copyLink`, `playJourney`, `pauseJourney`, `showOverview`, `selectJourneyIndex`,
`syncMotion`, `isJourneyPlaying`, `finderContext`, `finderOpening`, `finderClosed`,
`openFinder`, `exportSnapshot`, `active` and `result`. There is no mount/unmount API.

- Route owns mode, endpoint IDs, path node arrays and exact edge DOM references,
  Journey index/playing/complete, timer/generation/elapsed time, Motion token,
  overlays and its panel/listener state. Mode is idle/source/target/result;
  panel error is presentation state and can coexist with target mode. `active`
  returns mode or null. `result` returns copied nodes and scalar state only in
  result mode; it does not certify an exportable snapshot.
- Nodes and edges are read dynamically. The node map keeps the last element per
  ID; it does not use Lens's kind filter or first-ID rule. Outgoing relationships
  require existing endpoints and ignore self-loops. BFS follows directed DOM edge
  order, keeping the first reached path and exact edge references. There is no
  grouping by edge key, weighted search, new sort order or persistent graph index.
- Source selection marks reachable targets, including the existing no-outgoing
  outcome. In target mode, same-node/unreachable choices return false and render
  error while retaining target mode. Unknown IDs and choices outside picker mode
  retain their existing early returns. Finder's allowed list does not constrain
  every public choose call. Results retain full path/hops and begin in overview.
- `begin` rejects embed, clears Lens preview/active selection, captures an explicit
  source or single Focus node, clears old Route, then clears Intent/Guided/Focus
  and closes Finder/Radar in the existing order. Optional checks and options stay
  unchanged. Multi-Focus and invalid sources are not normalized into new behavior.
- `clear` returns undefined, closes only the applicable route Finder context,
  invalidates Journey work and removes Route state, overlays and docking, then
  updates controls/Export. Camera resets only when previously active and without
  `preserveView:true`; `updateUrl:false` retains URL. Only `restoreFocus:true`
  requests trigger focus. Repeated clear can still update controls and URL.
- Pause retains path and position; overview retains path but clears Journey
  position; clear removes the path. Escape returns paused, overview, then cleared
  across those states. Focus requests retain their original targets even if a
  browser refuses focus on a disabled control. Finder owns its search panel;
  Route supplies allowed IDs/badges, finder-open state and close/docking callbacks.
- Journey marks past/current/future nodes and the exact incoming edge. Position
  zero has no incoming pulse. Manual stepping stops playback and resets completion;
  arrows clamp at endpoints. Native chip focus pauses, while Enter/Space chooses
  the position. Camera reveal keeps the existing neighbor slice and parameters.
- Playback requires result, multiple nodes, non-embed, visible document and a
  capable, unpaused Motion Governor. Dwell is 1100ms per position. Pause normally
  retains elapsed time; resume uses the remainder, new positions use a fresh dwell.
  Date.now, generation invalidation, timer order and synchronous handoff resets
  stay intact. Final dwell completes without looping; replay restarts at zero.
  Returning to visible/Live does not automatically restart playback.
- Journey pulses actively claim/release a Motion token, alongside Governor's
  attribute-derived ownership. A released token does not imply an empty global
  owner. Owner callbacks, animationend and the 860ms fallback retain their order
  and isConnected guards. Clear invalidates playback but does not introduce a
  universal cancellation mechanism for every delayed callback.
- Overlay clones preserve path/line/polyline geometry, transform, removal lists,
  pathLength=1 and insertion position. Overview can insert an empty overlay when
  selected edges have no cloneable shapes; Journey rejects that empty pulse.
  No common overlay factory or geometry recomputation is introduced.
- `exportSnapshot` is stricter than interaction: it requires a consistent result,
  unique extant path nodes, attached edges, nonempty distinct keys and consistent
  from/to/edge-id across each key's fragments. Exactly one fragment must be
  drawable according to the shared geometry check, and it must be the selected
  edge. Returned data contain no DOM references. Export consumes the snapshot;
  it owns Share Card rendering, rejection receipts and clone cleanup.
- URL updates replace the hash with encoded source~target and preserve query.
  Journey progress is never serialized. Missing/empty route clears active state;
  malformed pairs/unknown endpoints return early. Valid but same/unreachable
  endpoints retain begin/choose error state and the original hash. Existing
  encoding, asynchronous hashchange order and embed guards are unchanged.
- Copy returns a Promise, preferring clipboard and falling back to temporary
  textarea/execCommand. Non-result resolves false. Text/ARIA feedback resets after
  1600ms even when subsequent cleanup has occurred; no debounce/cancellation is
  added. SVG capture listeners intercept picker click/Enter/Space with
  stopImmediatePropagation. With data-just-panned they let events through; later
  Focus handlers can still consume a key and clear Route. Global R/Slash/Escape
  and other modules' callers stay outside this source.
- Docking compares top/bottom overlap with route nodes or the start node, nav
  weight 4 and an out-of-bounds penalty; ties choose top. Hidden panels remove
  dock, zero-size panels return without replacing it. Scroll measures directly;
  requests retain rAF plus 120/560ms rechecks, without coalescing or cancellation.
  This is not Lens's left/right or 720px eligibility algorithm.
- Route produces node/edge data-route-* attributes, step styles and panel/control
  DOM/ARIA. Existing CSS owns themes, flow, Still/reduced motion, print/embed and
  responsive rendering. Focus/Lens clear Route; Camera/Motion/Guide can pause it.
  These dependencies remain explicit runtime collaboration after the source split.

`route-probe-browser.test.mjs` complements static Route/Journey/Share Card tests
with actual input, playback, handoffs, snapshots, themes and SVG export. Graph,
clock, hidden-page, geometry and clipboard fixtures isolate specific boundaries;
they do not certify hardware input, OS clipboard permission or all-screen collision
freedom. Serialization is distinguished from later download/global-click effects.

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
