# Export the explanation without floating source cards

Round 33, 2026-10-30. Disposition: verified local image-export repair. [Canonical page](candidate.html), [source](candidate.archify.md), [phone export](exports/canonical-api-390-open.png), [desktop export](exports/candidate-api-1440-open.png).

The public `ArchifyExplainer.pageImage()` path could paint an open source card over the explanation. Its long excerpt also entered the page's code-overflow measurements and unnecessarily released the measured panel layout. The repair measures code only inside the page shell and removes source cards from the exported clone. It leaves the live card, its text, focus and panel geometry alone.

Base `0b91a0cf1ffca41ba2b386473d3da910dab8d4e0`; source commit `7a8625b10379992da6a89872430f16e20b80ee89`. Refreshed `dev` remains ancestor `5ecbd1bfdbf83ea747072112493c940e707569cb`. This reuses round 32's source-pinned openrsync page; it is not a new author generation or source-project result.

## Observed paths

The [ordinary UI experiment](evidence/ui-observations.json) opened the card, then used the Export menu at 1440/390 px. The card was already hidden at each export click, roughly 0.9–1.0 seconds after the initial observation. Those images do not demonstrate an open-card UI failure. No frequency or human timing claim is made.

The direct public export API, already exercised by the repository's browser tests, keeps the card open. A [complete base replay](evidence/base-repeat-api-observations.json) records visible, horizontally overflowing source excerpts at export time. The resulting [desktop](screenshots/view-api-1440-open.png) and [phone](screenshots/view-base-repeat-api-390-open-top.png) PNGs show the card covering the explanation. Export dimensions also change:

| Viewport width | Base, card closed | Base, card open | Candidate, either state |
| --- | --- | --- | --- |
| 1440 px | 2880 × 2562 | 2880 × 2558 | 2880 × 2562 |
| 390 px | 780 × 4558 | 780 × 4434 | 780 × 4558 |

[Candidate observations](evidence/candidate-api-observations.json) confirm the card is open in the intended arms. The open/closed PNG pair is **byte-identical at both widths**, with zero differing pixels ([comparison](evidence/candidate-pixel-comparison.json)). Parent inspection covered [desktop](screenshots/view-candidate-api-1440-open-top.png), [phone middle](screenshots/view-candidate-api-390-open-middle.png) and [phone bottom](screenshots/view-candidate-api-390-open-bottom.png). This establishes the saved images for these inputs, not general visual preference or human comprehension.

## Failure preservation and scope

The [bounded plan](evidence/plan.md) and [harness record](evidence/harness-record.json) retain two incomplete test-download attempts. The first API loop saved two desktop images, then timed out waiting for a phone download; an image-inspection script had mistakenly used the same browser Page while that loop was still running. Its cause is not assigned to the product. A later synthetic-link download did not finish saving and its client was terminated. That harness immediately revoked the blob URL, unlike the product's delayed revocation, but this was not proved to be the cause.

The canonical follow-up saves the actual public API Blob bytes directly, avoiding that synthetic download path. It confirms the card remains open before/after and the saved image is byte-identical to the reviewed phone export ([binding](evidence/canonical-export-binding.json)). Actual UI downloads and public Blob export are separate evidence. A slow full-string comparison helper was also stopped; structured comparison found only relocated prepared `sourcePath`, `baseDir` and their digest ([artifact binding](evidence/canonical-binding.json)). These are tool-workflow outcomes, not application failures or successful validations.

The inspected heads of [#1015](https://github.com/tt-a1i/archify/pull/1015), [#1142](https://github.com/tt-a1i/archify/pull/1142) and [#1144](https://github.com/tt-a1i/archify/pull/1144) also omit source cards from their export removal lists; their [exact revisions and excerpts](evidence/owner-review.json) are retained. This does not qualify those whole PRs. No owner PR was modified or duplicate PR opened.

## Verification and package

- [Base regression](evidence/regression-base.log) fails with 240,950 marked popup pixels in the PNG; [candidate](evidence/regression-candidate.log) passes at desktop and phone widths. It checks absence of the floating overlay, unchanged output dimensions, and preservation of the live card/text/focus/layout.
- [Complete Explainer browser file](evidence/browser-tests.log): 16 passed, zero failures/skips. Existing complete table, long snippet, diff, footer and bounded-bitmap export checks stay active.
- [Renderer/layout tests](evidence/focused-tests.log): 19 passed; [core](evidence/core-tests.log): 19 passed; [generated checks](evidence/generated-tests.log) passed.
- [Thirty-four fixed documents](evidence/replay.json) retain the same authored/rendered content after removing embedded runtime assets. Only Reader JS changed; CSS, schema and authoring guidance did not. This is a frozen-input replay, not 34 new generations or 34 complete interaction audits.
- Two official Node 22.23.3 / zlib 1.3.1-e00f703 builds are identical: ZIP SHA-256 `2bd6598f0c7071dd4795f11780294815d3035eea923b4eb80d4881b41faf1141`, 6,996,632 bytes. [Package identity](evidence/package-identity.json), [extracted real-browser regression](evidence/package-regression.log), [strict finalize](evidence/package-finalize.json), [provenance check](evidence/package-check.json). Extracted Reader assets match the committed source. Harness dependencies are outside the extracted Skill; no live installation occurred.

The canonical page passes [strict finalize](evidence/candidate-finalize.json) and [current-path provenance checking](evidence/candidate-check.json); SHA-256 `c78db401bd1b818dc7090873d9f6d7d05cca2af272eae6820b50c395d19754ab`. Its source pin remains `c16a23e80`. Historical receipts certify their original paths. Archived TAP diagnostic whitespace is trimmed; [original/archive hashes](evidence/archive-normalization.json) record the formatting change. Archive hashes appear in [manifest](manifest.json).

The scoped test-value review protects the actual bitmap and live state with one regression and reuses the existing content-completeness tests. The implementation changes three existing lines and introduces no new state, timer, listener or dependency; no additional abstraction was justified. Under the [benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is a fixed-input Reader export repair. No full browser acceptance runner, Safari/Windows/assistive-technology validation, final-head CI, generation-quality or human reading result is claimed. AI disclosure: Codex diagnosed, edited, tested and inspected these artifacts. Nothing was merged, released or live-installed. The ongoing goal stays active.
