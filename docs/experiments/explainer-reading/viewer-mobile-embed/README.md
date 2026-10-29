# Native Viewer controls inside a phone explainer

Round 35, 2026-10-30. Disposition: **existing PR replay, retained as an experimental comparison**. No product code or package change is adopted in this round.

- NetworkX: [current runtime](base-networkx.html), [#1027 candidate](pr1027-networkx.html), [source and executable case](../networkx-path/README.md).
- singleflight: [current runtime](base-sequence.html), [#1027 candidate](pr1027-sequence.html), [source case](../singleflight/notes.md), [earlier phone-preview work](../phone-preview/README.md).

Open “打开交互图” / “Explore diagram” to compare the native Viewer controls. The reading-page content is unchanged. The preview index includes both candidates as a third, explicitly experimental option; it now has sixteen questions across fourteen projects and thirty-eight variants.

## Diagnosis and ownership

Base local/remote `9f74529f3bc43795c283ad48daf58aab06114e65`; refreshed `dev` remains ancestor `5ecbd1bfdbf83ea747072112493c940e707569cb`. [Bounded plan](evidence/plan.md).

At an outer 390 px width, the modal provides a 342 px native viewport. The wide graph uses a 720 px reading canvas inside a 308 px scrolling area. D initially extends beyond the right edge, but is not lost: a controlled 80 px horizontal scroll brings it into view. The ordinary 75% zoom action also shows all three nodes, while Reading Depth hides relationship labels at that scale. Forcing overview would trade away the weights this explanation needs. This investigation therefore does **not** change initial fit or authored geometry.

The concrete control problem is a single-row dock whose rightmost buttons extend beyond its container. In this NetworkX case, Reset and Zoom in initially cannot be pointer-hit at their centers; the English sequence also clips Zoom out. “Not initially visible” is not proof that no keyboard path can ever reach a button. A first Ego horizontal-wheel attempt did not visibly move the scene; the cause is unproven. Controlled DOM scrolling and actual zoom controls establish narrower, explicit reachability facts. [Initial geometry](evidence/geometry.json), [summary](evidence/summary.json), [actual 75% view](screenshots/after-zoom.png).

The existing [#1027 mobile Viewer proposal](https://github.com/tt-a1i/archify/pull/1027), by `jahfaliabdulrahman-dev`, already owns dock wrapping and measured clearance. Its exact head is `c393fc7fbc321d5b6c4685ca35cd612b75d64083`. The three-file [source delta](evidence/pr1027-source.patch), from merge base `10b4dd5c5f2264baa315ee65a9b4cc23c13ea5f0`, applies cleanly to a frozen copy of this branch; only its generated Viewer template is rebuilt. [Patch check](evidence/patch-check.json), [source identities](evidence/runtime-identities.json).

[#1001](https://github.com/tt-a1i/archify/pull/1001), exact head `4ca84e4af9ef16810b0823fe6e3320b58cb733a5`, concerns the camera viewport above 100%; it was inspected for overlap but not applied. [Observed PR identities](evidence/related-prs.json). No contributor branch was changed, no PR was opened or reviewed, and neither proposal was merged. The candidate is current base plus the scoped #1027 source delta, not the PR's entire historical tree.

## Fixed-input browser comparison

The same NetworkX workflow and singleflight sequence sources are finalized by base and candidate. The document, native spec, semantic graph and SVG are exactly equal between arms: [semantic comparison](evidence/semantic-comparison.json). This is a runtime replay, not fresh authorship or a generation-speed comparison.

Each arm has twelve states: two cases × three outer viewport sizes (390 × 900, 320 × 480, 1440 × 900) × light/dark. The [initial matrix](evidence/matrix.json) exposed the short-frame vertical distinction. The [follow-up matrix](evidence/followup-matrix.json) explicitly selects the actual theme controls, verifies the native theme, and then scrolls the native page to the dock. [Harness](evidence/matrix-followup.mjs), [output](evidence/followup-matrix.log).

| State criterion | Current runtime | #1027 replay |
| --- | ---: | ---: |
| Every currently visible dock button initially inside the container and viewport, and hit-testable | 4 / 12 | 8 / 12 |
| Same criterion after the native page is vertically scrolled to the dock | 4 / 12 | 12 / 12 |
| Closing with the close control returns focus to the explainer opener | 12 / 12 | 12 / 12 |

The candidate's four initial failures are the short frames requiring vertical scrolling. It does not promise a whole diagram and toolbar within every first screen. The initial hidden radar button is excluded from the visible-control denominator; after zooming to 125%, the newly visible radar and other dock buttons also remain in bounds in the checked NetworkX phone case.

Inspected pixels include [NetworkX before](screenshots/base-networkx-390-900-light.png), [after](screenshots/pr1027-networkx-390-900-light.png), [sequence before](screenshots/base-sequence-390-900-dark.png), [after](screenshots/pr1027-sequence-390-900-dark.png), and short frames after vertical scrolling: [workflow](screenshots/followup-pr1027-networkx-320-480-light.png), [sequence](screenshots/followup-pr1027-sequence-320-480-dark.png). The dock wraps, preserving all actions; it is taller. This is a usability tradeoff, not proof of universally better aesthetics.

Actual Ego pointer clicks on candidate Zoom in, Reset and Zoom out reach 125%, 100%, and 75%; [125% pixels](screenshots/pr1027-actual-zoom-in.png), [75% pixels](screenshots/pr1027-actual-zoom-out.png), [script](evidence/browser-04.mjs). Escape closes the native modal and returns focus. Headless measurements and controlled scrolling are distinguished from these actual UI actions.

## Export, delivery and limits

The public page-image API produces byte-identical NetworkX PNGs between arms at 390 and 1440 px. [Hashes](evidence/export-comparison.json), [export harness](evidence/export-comparison.mjs), [phone PNG](networkx-export-390.png), [desktop PNG](networkx-export-1440.png). This checks page-image output, not native Viewer SVG/video export or every #1027 responsibility.

All four canonical artifacts pass strict finalize and current-path provenance checks; the receipts are in `evidence/`. [Canonical identities](evidence/canonical-identities.json) show only expected source/dependency path rebasing and prepared digests differ from the inspected outside-repository copies. The rest of their HTML is byte-identical. The first overstrict byte-identity assertion failed on this expected rebasing; [record](evidence/canonical-rebase-note.txt).

Two earlier harness/setup failures are retained: [opaque-frame lookup](evidence/browser-01-failure.txt) used a main-target frame tree that did not expose the out-of-process iframe, so the repository's native-target inspection seam was used; [missing source receipt](evidence/missing-sequence-source-failure.json) pointed at a nonexistent phone-preview Markdown file, then [corrected both arms](evidence/source-path-correction.txt) to the existing singleflight input. Neither failure was a renderer defect.

This does not verify all #1027 overlays, print, presentation, short Passport prose, every browser/device, or final PR CI. The PR's own test claims were read as context and are not relabelled as this round's execution. No full browser acceptance runner, ZIP rebuild, integration approval or human reading result is claimed. The branch's runtime and ZIP remain at round 33's verified source/package evidence; the source delta exists only in these experimental artifacts.

Under the [project benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is a fixed-input interaction comparison. AI disclosure: Codex selected the cases, replayed the attributed proposal, checked source identities, ran browser actions and inspected pixels. The continuous goal remains active; nothing was installed, released or merged.

[Final index and canonical browser checks](evidence/index-canonical-check.json) cover three versions at two preview widths for both cases, then open/close both canonical candidate Viewers. [Canonical workflow](screenshots/canonical-networkx.png), [canonical sequence](screenshots/canonical-sequence.png). Archive file hashes are in [manifest](manifest.json). Generated HTML and the attributed patch preserve their original trailing whitespace; [check record](evidence/whitespace-record.json) distinguishes this from the passing authored-text/index checks.
