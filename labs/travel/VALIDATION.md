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
