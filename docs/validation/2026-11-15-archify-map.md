# Archify Map implementation and local validation

Base: `fb9ed13755444ff7188b4e65c39a7c96bc04a892` (`labs/code-analysis`).
Implementation branch: `feat/archify-map-canvas`.
This is local implementation evidence, not a release, remote CI result or human acceptance.

## Delivered behavior

- `archify map <root>` reuses the existing session/server; `--once` and `--no-serve` reuse preparation and exit with the report receipt. `start` and all existing Code Analysis subcommands remain supported.
- Standalone `archify map` adopts a full-bleed Canvas-First layout: opens directly in Graph with compact domain-cluster halos, collapsible `#bauify-reader` and `.atlas-side` drawers on demand, SVG swimlane `Layers` (up to 7 condensed bands), horizontal/vertical Sankey-ribbon `Butterfly`, and a floating pill HUD.
- Clean staging excludes the nested Code Analysis tests and fixtures, while keeping its runtime and lazy dependency bootstrap. No installation hooks, frontend dependencies or Skill metadata growth were introduced.
- Only architecture delivery explicitly bound through repository metadata and a local repository root receives a small static launch guide. It uses `archify map .` as a portable repository-root template. The service and prepared reports suppress that guide in favor of their existing controls. Other diagrams and unbound architecture remain clean.
- One projection of existing graph/facts/findings feeds Graph, Layers and Butterfly. Graph keeps module and file levels separate, supports dragging/zoom/hover and reciprocal/cyclic edges, and uses collision-aware screen-space labels. Layers use SCC-condensed dependency depth. Butterfly retains captured evidence and reference counts. Atlas and optional Classic participate in the same switcher and selection events.
- Multi-finding export uses the existing authenticated `/task` boundary and displayed claim digests. Offline export identifies captured evidence and supplies executable validation and re-analysis commands. Re-analysis writes a separate output directory, preserving the compared snapshot. HTTP rejections remain errors. Manual copy remains available if clipboard access fails.
- Architecture brief copying remains available in the overview. English/Chinese, dark/light, inline classic scripts and offline HTML are retained.

## Evidence

Local platform: macOS arm64, Node 22.23.3, desktop Chrome and headless Chrome.
Canonical ZIP build: official Node 22.23.3 with bundled zlib `1.3.1-e00f703`.

| Check | Result and scope |
| --- | --- |
| Code Analysis module suite (`npm --prefix archify/modules/code-analysis test`) | 627 passed, 16 skipped, zero failed. Skips require the optional real jscpd 5.4.3 executable; no duplicate detector claim is made. This preceded the final executable re-analysis command addition; the affected command and standalone tests were rerun afterward (6 passed). |
| Core product smoke (`npm test`) | 19 passed; covers ten diagram types, frozen compatibility inputs and delivery safety. |
| CLI/staging/Skill metadata focused selection | 39 passed. Module test fixtures are absent from staged output; runtime files remain present. |
| Generated checks (`npm run test:generated`) | Passed: Viewer, marks, validators, release identity and golden artifacts. No unrelated generated files changed. |
| Nine affected browser files | Initial run: 22 passed, one failed because Classic retained an empty view attribute. After restoring attribute removal, the affected Atlas/browser and Map selection passed (6 tests). The final expanded Map regression passed again after its last change. The other seven browser files retained their prior passing results. |
| Final Map regression | Online multi-selection sends displayed digests; copied checked tasks retain file/line evidence. Offline tasks label captured evidence; the test executes both copied validation and re-analysis commands. The unchanged fixture cycle still fails re-analysis as expected, while the original findings remain byte-identical. HTTP rejection and clipboard denial are exercised. Both locales/themes, desktop/narrow layouts, shared selection, file expansion/back navigation and missing-facts fallback pass without observed JavaScript errors. |
| Static entry browser | Bound/unbound cases, English/Chinese, light/dark, copying, Escape/focus restoration, and actual live startup with exactly one control before/after analysis pass. |
| Real repository use | `archify map archify/modules/code-analysis --once --language ts --locale zh-CN --out <outside-repo-dir>` succeeded. A desktop browser exercised native double-click drilldown, breadcrumb return, Layers, Butterfly and theme switching. Screenshots and the standalone HTML remain in the local session artifacts. |
| Size probe | Synthetic 400-module/4,000-file graph; server projection approximately 20 ms. Settled headless Chrome: Graph opening 63.5 ms; 60 zoom frames median approximately 16.7 ms, maximum 18.7 ms. Foreground desktop automation also had an approximately 957 ms startup outlier. These are local probes, not a general frame-rate guarantee. |
| ZIP | Two canonical builds were byte-identical. The 358-file archive excludes `modules/code-analysis/test/**` and contains the new view/static-guide assets. After the Canvas-First UI refactor and module doc alignment, `bash scripts/build-zip.sh` rebuilt the 358-file archive (`9e945d793...`) and `node --test test/release-package-gates.test.mjs` verifies clean staging and archive freshness on the final tree. |
| Canvas-First UI verification | Following the full-bleed canvas refactor and visual polish on `overlay/client/{map-views.js,map-views.css,overlay.js,atlas.js,atlas.css}`, `overlay/{standalone.mjs,i18n.mjs}`: `npm --prefix archify/modules/code-analysis test` (`627` passed, `16` skipped, `0` failed); Chrome real-browser run (`ARCHIFY_CHROME`) across the 6 Code Analysis browser suites (`18` passed, `0` failed, `0` skipped); `npm run test:generated` (`all checks passed`); and `node --test test/release-package-gates.test.mjs test/cli.test.mjs` (`187` passed, `2` skipped, `0` failed). Desktop (`1440x900` dark/light) and mobile (`390x844` dark) real-repo screenshots (`archify/modules/code-analysis --once --locale zh-CN`) were inspected in headless Chrome with `scrollWidth === innerWidth`. |

ZIP SHA-256: `9e945d793a7f8940160645c58813dc2a0adbf46dde94fcf4359b516ec33bf0b0`.
ZIP size: 7,634,415 bytes, compared with 7,941,831 bytes on the base.

## Review and limits

The scoped test-value/simplification checks retained one analysis pipeline, one
view projection and the existing evidence/task generator. Tests protect behavior,
source provenance, publication paths, compatibility, stack safety and bounded
work instead of matching implementation text or exact layout coordinates.

Independent agent review found the temporary-directory command bug; the fix now
uses the published directory and is protected by executing the copied command.
The analysis-toggle restoration and Classic visibility/state issues were also
corrected. A 12,000-module chain test verifies iterative SCC traversal.

Graph caps file drilldown at 180 displayed nodes, painted edges at 3,500 and
relationship details at 80, with displayed/total disclosure. Unresolved calls
and excluded source are not inferred. Layer depth is not a business-layer model;
static dependencies and disappearing findings do not prove runtime impact or a fix.

No live installation, remote publication, merge or release was performed. Windows
native execution, optional real jscpd checks and remote CI were not run locally.
Pre-existing unrelated untracked files in the worktree were preserved.
