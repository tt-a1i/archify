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
