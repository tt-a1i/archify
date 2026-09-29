# Local validation, 2026-09-29

Scope authorized in the task: merge `labs/infinite-canvas` into `labs/travel`,
add travel exploration with real geography and artistic landmarks, then add
freely rotatable 3D. No production schema changes or live installation.

The travel checks run the generated offline HTML in Chrome. Both suites pass:
reproducible build and provenance, 2D navigation/search/filter/save/deep links,
responsive layout, 3D geometry, mouse orbit/tilt/wheel/pan, reset/top view,
auto-rotation, scene/filter/detail synchronization, PNG generation, 2D toggle,
and a forced WebGL-unavailable fallback. 3D uses software WebGL in headless
Chrome. Touch gestures and physical mobile GPUs have not been device-tested.
Evidence: `out/travel-3d-tests.log`, `out/travel-3d-evidence/` (local, untracked).

Earlier merge validation: 51 focused renderer tests, 278 viewer compilation
checks, 68 browser/interaction checks, 28 locale checks and 47 artifact checks
passed. Golden verification passed using the repository's existing canonical
Node 22.23.2 runtime and Git tools on PATH.

The broad suite at the intermediate merge had 2,262 passes, 33 failures and 128
skips. Twelve failures were subsequently fixed or resolved by the required
toolchain and their focused checks passed. The remaining 21 failures were
reproduced on untouched dev `e023ea45`: nine architecture recovery checks,
one Windows short-path extension check, eight evidence-replacement checks
using an invalid Windows null Git configuration path, one delivery timing
check and two update-notifier checks. This is not a claim that the full suite
is green. Baseline logs are retained under `out/travel-base-*.log`; the latest
notifier rerun is `out/travel-notifier-recheck.log`.

The 3D addition is confined to this lab; it does not change the shared viewer
or release package, so its final validation uses the affected travel suites.

## Three-day itinerary integration

The follow-up adds the curated France/Paris three-day sentence entry point,
six stops, optional date warnings, day-specific camera framing and selection,
three OSM walking previews with 3D directional arrows, a street/building
backdrop, itinerary JSON and combined map/timetable PNG export. General LLM
generation, live bookings and production navigation are not implemented.

Four affected tests pass (no skips): reproducible artifact/provenance, 2D
browser regression, 3D/browser itinerary interactions, and route continuity.
Browser coverage includes the requested Chinese prompt, unsupported-request
feedback, day 3 filtering, schedule selection, Monday closure warning, camera
controls, PNG output, narrow viewport and forced WebGL fallback. Data checks
cover all six sourced stops, matching route order, road-segment continuity,
distance totals, endpoint gaps and building-height provenance.

Evidence: `out/travel-trip-tests.log` and `out/travel-trip-evidence/`.
`france-three-days.png` is generated through the page's export button; its
layout and the desktop page were visually inspected. OSM routes remain
planning previews: the offline graph does not model barriers at nodes,
accessibility or live closures, and attraction coordinates are not entrances.

## Historical global data explorer (removed)

The package catalog separates bundled global boundaries, streamed geography,
streamed buildings, streamed terrain, the existing Paris landmark set and
unavailable global textured landmarks. The separate MapLibre view loads no
external data until the user applies a detailed selection; its engine assets
and simplified country data are local. It is not an offline regional package
manager and has not yet been connected to the generated itinerary overlay.

Five tests passed with no skips in `out/travel-world-final-tests.log`: the four
travel checks plus a live-network Chrome check. The latter verified zero remote
requests in the initial light mode, real rendered Paris building features,
positive Alps DEM elevation after tiles finished loading, terrain/building
removal, retaining the light map when a style request fails, and narrow layout.
The live screenshots in `out/travel-world-evidence/` were visually inspected.
Sources were tested in these sample regions; worldwide completeness, precise
building heights and offline persistence are not claimed.

## Illustrated Shanghai and three presentation levels

The conventional street-map renderer, online layer UI and MapLibre dependency
were removed. The replacement destination picker leads to the same offline
illustrated atlas in 2D, flat 3D or height 3D. Shanghai is a bounded Lujiazui
sample, not full-city coverage. Four focused tests passed with no skips,
including Shanghai scene navigation, three landmark models, all three display
levels, Paris itinerary compatibility, export, mobile layout and WebGL fallback.
Screenshots: `out/travel-shanghai-evidence/shanghai-3d.png` and
`shanghai-flat.png`; both visually inspected. This does not validate surveyed
building accuracy or real terrain elevations.

## Shanghai three-day plan

Focused browser coverage now includes the Shanghai prompt, six scheduled stops,
three day views, cross-view schedule selection, day select navigation, PNG
export and Paris compatibility. Evidence: `out/travel-shanghai-trip-evidence/`,
including visually inspected `shanghai-three-days.png` and `disney-day2.png`.
The Disney castle is a symbolic model at the sourced park coordinate; the
background is a location window, not mapped park geography.

## Versioned packages and deterministic style

The HTTP suite checks destination isolation, deferred height downloads, local
cache reuse, service-worker offline reload, cross-city navigation and identical
canvas output after reload and curated itinerary regeneration. Cache unit tests
cover LRU order, active/pinned protection, quota failure and corrupt-byte rejection.
The manifest checks each content hash and the explicit visual baseline lock.
The portable offline atlas retains the existing interaction/export/browser tests.
No claim is made about all browsers, production CDN deployment or global coverage.
Evidence: `out/travel-packages-evidence/` and tool-reported focused test results.

## Disney map completion

Added sourced park boundary, roads, water and building footprints plus a visible
map-heading entry and clickable day legend. Browser regression follows the
entry to Disney, verifies park data and returns to the city. Evidence:
`out/disney-map-evidence/disney-map.png`; visual style remains the same.
# Host journeys and daily blocks — 2026-09-29

Ran all five travel test files with Chrome: **10 tests passed, 0 skipped**.
The earlier HTTP coverage was retained and adapted to day packages. New checks
exercise five-day input, seven stops in one day, repeated place visits, invalid
coordinates/models/source URLs, antimeridian projection, geometry cropping,
four-day portable CLI output, keyboard node navigation, day-only downloads,
cached days offline, and repeated scene switches without GPU geometry growth.
Legacy offline navigation, rotation, export and WebGL fallback remain covered.

Visually inspected Shanghai's full overview in the app, Disney's detailed day
block and Paris's full overview. Evidence from the automated browser run is in
`out/journey-evidence/` (local, not a shipped input). The user-authorized layout
change is pinned as `illustrated-diorama-v2`; the `air-arc-v1` arrow contract and
pastel materials are unchanged. Host generation is repo-local via SKILL.md and
render-journey.mjs, not a live installation or new model backend. Coordinate
provenance URLs are structurally validated; truth/availability still requires
host research. This work did not run or claim the full core renderer suite.
