# Why did Make skip the check recipe?

Round 29, 2026-10-30. Disposition: source-backed reading candidate. [Open the page](candidate.html), [authored source](candidate.archify.md), [independent author's original](author/answer.html).

The ordinary `check` rule in this example has no prerequisites. A same-name file makes Make consider the target current, so its recipe is skipped. That file decision does not prove any check ran. The candidate says “这个文件无需更新” instead of the original “已更新,” then shows how `.PHONY: check` changes the decision while leaving real prerequisite files under their normal update rules.

Runtime/source: `f70db859fa51e663d67041927652bc07f038abc7`; latest fetched `dev` `5ecbd1bfdbf83ea747072112493c940e707569cb` is an ancestor. No runtime, parser, writing guidance, package or dependency changes occur in this round.

## Source and execution evidence

GNU Make 3.81 is pinned to [`776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962`](https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L2591-L2650). [Source audit](source/audit.md) records ordinary target freshness, the same-name collision and non-inheritance of phoniness. The local executable reports GNU Make 3.81; it is the macOS supplied binary, not a byte-verified upstream build. [Source identity](source/identity.json) also records the 4.4.1 manual inspected before selecting the matching version; full source snapshots remain outside the repository.

The [probe](source/probe.py) constructs five cases in disposable directories, with two calls per case. [First run](source/probe-1.json) and [repeat](source/probe-2.json) are byte-identical:

| Rule and file state | Two calls |
| --- | --- |
| Ordinary check, no same-name file | Marker printed both times |
| Ordinary check, same-name file exists | Up-to-date notice both times; recipe skipped |
| Phony check, file absent or present | Marker printed both times; existing file preserved |
| Phony check depends on real report.txt | Build + check first; check only second |

The recipe prints a marker; it does not run a real test suite. These are ordinary explicit calls without execution-changing modes, with unchanged input in the real-file case. No parallel, recursive, failure-propagation or performance claim follows.

## Authoring and visual decisions

A separate gpt-6.1-terra / medium author used the frozen runtime and supplied evidence. The [assignment](evidence/author-prompt.txt), [first draft](author/first-draft.archify.md) and [trace](author/author-trace.json) remain. Both strict finalize attempts passed; the second delivered the same authored bytes to the final author path. Work start was 21:17:26Z, draft recorded at 21:17:46Z, handoff at 21:17:55Z. Prompt-read completion is unknown. Parent review and repair are additional work; this is not a speed comparison.

Parent changes are case-specific: clarify `up to date`, remove visible backticks from the plain page title, shorten table labels, preserve the real-file boundary, and add the exact commands needed to run the complete example in a new directory. The redundant closing checklist is replaced by that executable comparison.

- [Attempt 1](attempts/candidate-1.html) adds the commands but produces a long final card and a large empty desktop column. Phone/desktop heights: 2,449/1,418 px.
- [Attempt 2](attempts/candidate-2.html) uses explicit six-column widths. The desktop blank area remains; height stays 1,418 px. This arrangement was rejected as the final composition.
- [Attempt 3](attempts/candidate-3.html), the selected content, separates the Makefile and its execution/observation into sequential adjacent panels. Phone/desktop heights: 2,504/1,265 px, versus the original 2,551/1,221 px. It adds usable setup while costing 44 px on desktop. A shorter page is not the acceptance criterion.

[Original phone](screenshots/author-390-light-top.png), [original desktop](screenshots/author-1440-light-top.png), [rejected empty column](screenshots/candidate-2-1440-light-bottom.png), [candidate desktop](screenshots/candidate-3-1440-light-top.png), [candidate phone](screenshots/candidate-3-390-light-top.png). Parent inspection covered top and bottom at 390/1440 px in light/dark. The [original measurements](evidence/author-browser.json) and candidate measurements in [attempts](attempts/candidate-3-browser.json) found no overflowing code/table regions or document width in those states. No automatic layout rule was changed to accommodate this example.

## Final delivery checks

The canonical page passes [strict finalize](evidence/candidate-finalize.json) and [current-path provenance checking](evidence/candidate-check.json); SHA-256 `a33baca508dfceda6f0165c088b031a88007acc582a9a575599d3cfc30c6e79d`.

Four actual Copy controls produced the expected [payloads](evidence/copies.json), including 1, 1 and 3 literal recipe tabs in the three Makefiles. [Execution of those copied bytes](evidence/copy-run.json) reproduces all four collision combinations and the complete report example. The latter outputs `built`, `checked`, `checked`, and creates the expected report. Clipboard writes were intercepted at the API boundary; OS clipboard permission is untested.

The [actual reader PNG](candidate-390-light.png) was inspected as image pixels at [top](screenshots/export-top.png), [middle](screenshots/export-middle.png) and [bottom](screenshots/export-bottom.png). [Export and index evidence](evidence/export-index-check.json) records its dimensions and switching both variants at both preview widths. The review index now holds fourteen questions across twelve projects and thirty-two variants.

Only content and experimental evidence changed, so runtime suites and ZIP rebuilding were not repeated. Package/runtime evidence remains at round 28's source `62eb5ee983d08682c23fcff4114d60fe484977d4`. No full browser acceptance runner, Windows, fresh generation comparison, final-head CI or human comprehension study is claimed. Archived browser scripts trim extra trailing blank lines. Original failure-free author receipts and intermediate artifacts retain historical paths; only the canonical finalize/check above certifies the new repository path.

Under the [project benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is one new-project discovery and parent reading revision, not a general generation result. AI disclosure: Codex authored, researched, edited, ran probes and visually inspected the page; no human acceptance is implied. Nothing was merged, released or installed. The ongoing goal remains active.
