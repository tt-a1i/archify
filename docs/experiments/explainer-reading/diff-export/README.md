# Complete diff lines and reflowed code panels in exported images

Round23 fixes two confirmed losses in static image exports: long diff lines were clipped horizontally, and wrapped desktop code could extend below its panel's old measured height. Product commit: `60f5c8f28f5f4112d00400963057bb40241119b2`. Base: `9183ff68dff83c47139fa181eb3e069bd547cbb4`. Refreshed `origin/dev` remains `5ecbd1bfdbf83ea747072112493c940e707569cb`, an ancestor of this branch.

The export clone wraps overflowing diff code, preserving each old/new source line as one table row. For wrapped snippets or diffs, it releases measured grid-row heights while retaining column assignments and source order. The live reader is unchanged. Short fitting diffs keep identical PNG bytes.

This is a fixed-input rendering/export experiment under the [benchmark convention](../../../../benchmarks/real-repo-generation/README.md), not an independent author or full-generation comparison. The explanatory wrapper is parent-authored. It does not establish that reading a complete patch is easy, or that readers understand the change better.

## Before and after

| Case | Before | Retained output |
| --- | --- | --- |
| Real Archify patch, 390 px | [PNG](exports/base-real-390.png), [live reading viewport](screenshots/base-real-390.png): 2249 px of diff inside 356 px | [PNG](exports/product-candidate-real-390.png), [reader](candidate/real.html): all 61 rows and final return statement remain visible |
| Long literal strings, 390 px | [PNG](exports/base-tokens-390.png): neither `OLD-END` nor `NEW-END` is visible | [PNG](exports/product-candidate-tokens-390.png), [reader](candidate/tokens.html): both strings remain complete, with one source line number per wrapped row |
| Desktop snippet, 1440 px | [PNG](exports/final-base-desktop-code-1440.png): text extends below its panel by about 50 px | [PNG](exports/product-candidate-desktop-code-1440.png), [reader](candidate/desktop-code.html): the complete command precedes the following paragraph |
| Short fitting diff | [Base reader](base/short.html) | [Candidate reader](candidate/short.html): PNGs are byte-identical at both 390 and 1440 px |

The repository whitespace check excludes only `base/real.archify.md`, `candidate/real.archify.md`, and `source.patch`: their nine flagged lines are single-space unified-diff context markers. Those characters are retained, and the two complete authored inputs remain byte-identical. [Exact exception record](evidence/whitespace-exception.json). All other staged files pass the normal check.

The real input contains the full `charts.mjs` diff from [commit e5e03d1](https://github.com/tt-a1i/archify/commit/e5e03d185ce0617aa4fc7645bac0317e4079f421), which previously repaired configured pie legends. The [raw patch](source.patch) comes from local Git at that exact commit, with [source identity](evidence/source-identity.json). No external source or uncommitted code was substituted. The other inputs are explicitly synthetic layout controls.

The real phone PNG grows from 780 × 5164 to 780 × 9282 px. Keeping the code is a correctness improvement with a real reading cost: more scrolling, and wrapped expressions that take effort to follow. At 1440 px the corrected image is 2880 × 4500. A concise explanation should still select and explain the relevant code instead of expecting a reader to parse this entire patch. No live wrap toggle or default was added in this round.

## Failed first attempt

The [first patch](prototypes/prototype-wrap.patch) only wrapped diff code and measured the clone again. Table-width and footer checks passed, yet the [actual desktop image](prototypes/first-candidate-real-1440.png) cuts off the final patch rows. The live board writes measured pixel row spans to each panel. Those stale spans kept the panel height unchanged after wrapping; its clipped overflow hid content inside an otherwise complete page. The [first observations](evidence/prototype1-comparison.json) retain this misleading geometry result.

The [second patch](prototypes/prototype-reflow.patch) releases those row heights for export-only code/diff reflow, preserving existing column assignments. Generated empty grid spacers are removed. The real patch's final code now ends at 1830.62 CSS px, inside its panel ending at 1854.02 px. An additional desktop snippet reproduces the same owner on the base: code ends at 519.73 px while its panel ends at 469.5 px. Candidate ends at 518.82 px inside a panel ending at 553.57 px. [Measured comparison](evidence/prototype2-comparison.json).

The current source differs from that successful prototype only in explanatory comments. Six actual downloads from the canonical final pages are byte-identical to the corresponding prototype PNGs: [pixel comparison](evidence/pixel-comparison.json). Current-path artifact/provenance checks are separate below.

## What was checked

- The existing long-snippet bitmap test now runs at 390 and 1440 px. A new diff bitmap test checks the ends of the removed and added code, footer, live scroll/state preservation, exact literal text including repeated spaces, and original source line numbers. Both [fail on the frozen base](evidence/base-regression.log). The [complete explainer browser test file](evidence/product-browser.log) passes all 13 tests, zero skipped, on candidate.
- [Diff parser and renderer suites](evidence/diff-renderer.log): 25 passed. [Core smoke](evidence/core.log): 19 passed. [Generated checks](evidence/generated.log) pass. These results do not claim a complete repository suite or full browser runner.
- The source rows, text, prefixes and old/new line numbers match base in all seven checked prototype diff states: [row integrity](evidence/row-integrity.json). Six canonical product exports retain their last content and footer and leave live measurements unchanged: [product observations](evidence/product-comparison.json). Short phone/desktop controls are byte-identical to base.
- Parent inspected the baseline phone diff, baseline literal-string export, the failed desktop prototype, corrected desktop real patch and command, and corrected phone literal strings. The full real phone export was additionally opened as an image at 390 CSS px and scrolled to inspect its ending in [light](screenshots/final-candidate-real-390-actual-image-bottom.png) and [dark](screenshots/final-candidate-real-390-dark-actual-image-bottom.png). These screenshots show actual exported pixels, not a re-rendered DOM. [Full dark PNG](exports/final-candidate-real-390-dark.png).
- Four strict finalizations and current-path provenance checks pass at the checked-in [candidate paths](candidate/): [results](evidence/product-finalize-results.json). Base receipts are archived copies with original tuning paths; they do not certify new provenance at the archive paths. Browser scripts and logs retain their original paths; only terminal blank lines were trimmed from copied logs.
- Two official Node 22.23.3 / zlib 1.3.1-e00f703 ZIP builds are byte-identical: 6,996,136 bytes, SHA-256 `460c8fbe8c4939e3c50c91da63d09a45e0fd5d5e3970a781fa3248597b3c778e`. An extraction outside the repository matches reader source and passes [strict CLI finalization](evidence/package-cli.log) plus [five browser regressions](evidence/package-browser.log). [Package identity](evidence/package-result.json). This is execution of the package, not a live installation.

Scoped PR improvement check: extend the existing snippet regression for the newly observed desktop failure; reuse the bitmap helper for diff endpoints rather than add another screenshot harness. Preserve parser/renderer tests for literal content and line-number semantics. Focused simplification review retains the existing export measurement paths; the observed stale row spans justify a local reset, not another layout planner. Export width planning, schema, source parsing and live layout behavior are unchanged.

A [bounded open-PR title search](evidence/ownership.json) for `diff` returned no hits. This is not an exhaustive ownership audit or a claim that no overlapping PR exists. Prior #1015/#998 observations retain the scope recorded in rounds21–22. No external message or patch reuse occurred.

Remaining limits: visual comparisons use editorial style; automated new regressions also exercise the default clean style in dark mode. No Swiss/product visual matrix, JPG/WebP recheck, Safari, Windows, screen-reader, full browser runner, final-head CI, or human reading acceptance is claimed. Earlier round22's other-format checks belong to that source revision. Large patches remain long even when complete; the next content experiment will select and explain the critical changes while retaining access to the full source.
