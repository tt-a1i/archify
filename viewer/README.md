# Viewer source

Edit `reader-layout.js` for Adaptive Reader Layout, `viewer-chrome-layout.js`
for navigation clearance, `export-cleanup.js` for SVG export cleanup, and
`template.source.html` for the rest of the Viewer.
`archify/assets/template.html` is the committed
generated artifact, consumed unchanged by all five renderers and the installed
Skill. These maintainer sources live outside the packaged `archify/` directory.

From `archify/`, run `npm run generate:viewer` after editing any source.
`npm run check:viewer` verifies freshness without writing; `npm test` includes
that check. Assembly inserts each fragment verbatim at its fixed marker.
Reader and Chrome Layout extractions preserve delivered HTML bytes. Export cleanup adds a
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
