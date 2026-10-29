# Keep source evidence inside short windows

Round 32, 2026-10-30. Disposition: verified local Reader repair. [Open the canonical page](candidate.html), [source](candidate.archify.md), [original behavior](attempts/source-card-base.html), [existing proposal replay](attempts/source-card-proposal.html).

When a source excerpt cannot fit below its citation, the Reader used to put the whole card above it, even when that placed its heading and first lines outside the viewport. The fix keeps the card between the window edges, limits its height and allows local scrolling. Opening it again starts at its heading. Existing Tab, Home and Escape behavior lets readers reach the original source, return to the first lines, and resume at the citation.

Base `c16a23e803b542703cb2c34946a71c7b635b25af`; product source commit `56c7fdb96f53e97e826dd2a913d7beb3aff24d25`. Latest fetched `dev` remains ancestor `5ecbd1bfdbf83ea747072112493c940e707569cb`.

## Existing work and reproduction

[PR #1015](https://github.com/tt-a1i/archify/pull/1015), inspected at `fe4f80d2195e0a7b49b7cfe6d3dba7ffd31a7ac8`, already proposes clamping the card's top to eight pixels. This round credits and replays that exact line, then checks the additional case where the card is taller than the window. Its CSS does not cap card height. The candidate uses a twelve-pixel inset on both sides, a height limit and scrolling. [Inspected source excerpts](evidence/owner-review.json) also record #1142 and #1144, which retain the original positioning. No owner PR or branch was modified and no duplicate implementation PR was opened.

The [plan](evidence/plan.md) began with actual menu/source keyboard checks. Style Tab/Shift+Tab, Export Tab, citation entry and source-card exit worked in [those observations](evidence/initial-interactions.json); no new focus model is introduced. Some initial programmatic focus captures left the card empty; later runs click a theme button before focusing, and these empty captures are not counted as Reader failures.

An initial render-only fixture adds real probe text to the prepared source, retaining its [input](attempts/fixture-prepared.json) and [measurements](evidence/fixture-base.json). The decisive comparison then uses public strict finalize and a valid Git source: the first fourteen lines of the already committed openrsync probe, pinned to `c16a23e80`. The reading prose is unchanged. This is a fixed-input reproduction, not an independent author generation or a new openrsync result.

## Visible and keyboard results

The [three-arm matrix](evidence/card-matrix.json) covers 390×480, 1440×480, 390×240 and 390×900 in light/dark, eight states per arm:

| Arm | Card within viewport | Remaining issue |
| --- | ---: | --- |
| Base | 2/8 | At 480 px tall, the card starts about 194 or 237 px above the viewport |
| #1015 line replay | 6/8 | At 240 px tall, the card extends to about 428 px |
| Candidate | 8/8 | Short windows need local scrolling to read the whole card |

[Base phone](screenshots/card-base-390x480-light.png), [candidate phone](screenshots/final-card-candidate-390x480-light.png), [short dark card](screenshots/final-card-candidate-390x240-dark.png). The long code lines retain their existing horizontal scrolling; this change addresses vertical visibility, not fitting every code line at once.

The first candidate preserved its outer scroll position when reopened. An added user-outcome assertion [failed at scrollTop 172](evidence/reopen-before-reset.log). Resetting the scroll position on show fixes that introduced behavior. The [final eight candidate states](evidence/final-card-matrix.json) retain the bounds and keyboard transitions and reopen at zero. Tab reaches the source link, Home returns to the excerpt's beginning, and Escape returns to the citation.

At 390×900 the original and candidate card geometry is unchanged. [Pixel comparison](evidence/normal-card-pixels.json) does not claim byte identity: initial captures differ by at most 2/4 channel levels; after waiting for animations, one-level differences remain inside the code excerpt. No geometry or text loss was observed there; their precise rasterization cause was not established.

## Verification and package

- [Regression on base](evidence/regression-final-base.log): 0 passed, 1 failed on viewport bounds. The final test adds a reopening assertion after that boundary; [initial candidate](evidence/regression-candidate-1.log) and the separate reopening failure remain.
- [Final real-Chrome browser file](evidence/browser-tests-final.log): 15 passed, no failures/skips. Existing native-node explanation, SourceCard navigation, Viewer, layout and export tests remain active.
- [Renderer/layout coverage](evidence/focused-tests.log): 19 passed; [core](evidence/core-tests.log): 19 passed; [generated checks](evidence/generated-tests.log) passed. These last three runs precede the scroll-reset line; their scope is reused, while the final browser run covers that line. The initial focused invocation misspelled the renderer test filename and executed no tests; its [error](evidence/invalid-focused-test-path.log) is retained.
- [Thirty-four fixed documents](evidence/replay.json) retain byte-identical output after removing the two changed embedded runtime assets. Authored text, diagrams, source inputs and the rest of each rendered page remain unchanged. This does not replay every interaction in all thirty-four pages.
- Two official Node 22.23.3 / zlib 1.3.1-e00f703 builds are byte-identical. ZIP SHA-256 `2cc32d7591b36df5d2f861045eec35e3b4297ba94f984e81a1c53fccd4dd95e7`, 6,996,620 bytes. [Package identity](evidence/package-identity.json); extracted Reader CSS, JS and renderer equal committed source. [Extracted browser regression](evidence/package-regression.log), [strict finalize](evidence/package-finalize.json) and [provenance check](evidence/package-check.json) pass. Harness dependencies are linked beside the extraction, not installed into a live Skill.

The canonical page has passing [strict finalize](evidence/candidate-finalize.json) and [current-path check](evidence/candidate-check.json), SHA-256 `fd24b3a61ad6f4c05ebe66ebed7f750800012624a030cfa4075e1057b234c6b5`. Its source pin remains `c16a23e80` after the runtime commit. [Canonical browser check](evidence/canonical-browser.json) shows the full card at 390×480. The [actual exported PNG](candidate-390-light.png), 780×4558 px, was inspected at [top](screenshots/export-top.png), [middle](screenshots/export-middle.png) and [bottom](screenshots/export-bottom.png); this export was made after closing the source card. It does not test exporting an open floating card.

The focused test-value review adds one observable viewport/navigation regression and retains existing focus tests. The change adds no new dependency, event listener, schema or authoring rule; no additional abstraction or deletion was justified. Historical receipts keep their original paths; the canonical pair above certifies the current path. Three TAP failure logs trim whitespace on blank diagnostic lines; [original/archive hashes](evidence/archive-normalization.json) record this formatting change. Archive hashes are in [manifest](manifest.json).

No fresh generation benchmark is claimed under the [project convention](../../../../benchmarks/real-repo-generation/README.md): this changes Reader interaction for fixed documents. No full browser acceptance runner, Safari/Windows/assistive-technology validation, final-head CI or human comprehension result is claimed. AI disclosure: Codex diagnosed, edited, tested and visually inspected these artifacts. Nothing was merged, released or live-installed. The overall goal continues.
