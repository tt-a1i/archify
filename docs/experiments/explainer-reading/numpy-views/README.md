# Change the selection: which NumPy array changes?

Round 36, 2026-10-30. [Retained candidate](candidate.html), [authored source](candidate.archify.md), [independent first version](author/answer.html), [unselected overview-table attempt](attempts/candidate-2.html).

The candidate starts with a concrete effect: after `b = a[1:3]`, writing `b[0] = 99` also changes `a[1]`. Adding `.copy()` gives independent data. Complete programs and actual output make that difference inspectable. The integer-index table distinguishes taking a copy from assigning directly into the original array.

Base/runtime `ba5f5f84c16c24146e4b2c89ec70b34681095e46`; refreshed `dev` remains ancestor `5ecbd1bfdbf83ea747072112493c940e707569cb`. The #1027 replay from round 35 remains an experimental artifact and is not part of this runtime. No runtime, schema, guide, dependency or ZIP change is made here.

## Source and actual mutation

NumPy **2.5.4**, tag commit `a3d0ef1df045b858e68115001fdabc930bb3b68c`, on isolated Python **3.12.13**. The installed wheel reports the same Git revision; this is an identity match, not a reproducible source-to-binary build verification. [Identity](source/identity.json), [environment](evidence/environment.log), [brief](source/brief.md).

The pinned [copy/view explanation](https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.copies.rst#L23-L98) establishes shared view data, explicit copies and advanced-index reads; the [assignment explanation](https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.indexing.rst#L781-L812) distinguishes writing through an index. The scope is ordinary one-dimensional `int64` arrays with fixed, in-bounds, unique indices. Object dtype, reshape, repeated-index arithmetic, memory consumption and performance are not evaluated.

The [probe](source/probe.py) creates a fresh `[10, 20, 30, 40]` NumPy array for each case. [Run 1](source/probe-1.json) and [run 2](source/probe-2.json) are byte-identical:

| Operation | Original array after the write | Shared data with retained `b` |
| --- | --- | --- |
| Basic slice, then `b[0] = 99` | `[10, 99, 30, 40]` | Yes; a different array object |
| Slice `.copy()`, then `b[0] = 99` | `[10, 20, 30, 40]` | No |
| Integer-index read, then `b[0] = 99` | `[10, 20, 30, 40]` | No |
| Direct `a[[1, 2]] = [99, 88]` | `[10, 99, 88, 40]` | No retained `b`; not measured |
| Chained `a[[1, 2]][0] = 99` | `[10, 20, 30, 40]` | Temporary result not retained |
| Alias `b = a`, then `b[0] = 99` | `[99, 20, 30, 40]` | Yes; the same array object |

The sixth alias case remains probe context, not an extra concept forced into the page. `np.shares_memory` observations apply to these small arrays. The venv and raw third-party documentation remain outside the repository; no project or live Archify installation was modified.

## Independent draft and two revisions

[Plan](evidence/plan.md), [assignment](evidence/author-prompt.txt), [first draft](author/first-draft.archify.md), [trace](author/trace.txt). The Terra/medium author records start at 22:40:16Z and handoff at 22:40:29Z. It passed its first strict finalize, did not use the browser, and relied on the supplied probe rather than rerunning Python. The trace records ordering but no exact first-draft/attempt timestamps; do not infer them or treat this interval as an authoring-speed benchmark. Original attempt artifacts and receipts remain unchanged.

The first table has four columns; on the phone its last result is clipped inside a horizontal scroller. Its lambda-based program and output also overflow. The prose's `a = [10, 20, 30, 40]` shorthand could be mistaken for a Python-list initializer, whose slice behavior differs. The parent uses explicit `np.array(...)` construction, straight-line programs, clearly labelled outputs, a concrete title, and a two-column assignment table. Version/build qualification moves from the reading flow into this report; the page still names its actual runtime versions and data scope.

| Version, editorial style held constant | 390 px height | 1440 px height | Outcome |
| --- | ---: | ---: | --- |
| [Author](author/answer.html) | 2,396 px | 1,511 px | Four-column table, program and stdout require horizontal scrolling |
| [Revision 1 / retained](candidate.html) | 2,478 px | 1,503 px | All table/code content fits; independent complete programs; desktop examples remain staggered |
| [Revision 2 / unselected](attempts/candidate-2.html) | 2,713 px | 1,807 px | Overview repeats results and leaves a larger lower-right blank area |

[Original metrics](evidence/author-browser.json), [revision 1](attempts/candidate-1-browser.json), [revision 2](attempts/candidate-2-browser.json), [canonical metrics](evidence/canonical-browser.json), [decision record](evidence/parent-revisions.md). Both revisions pass strict delivery and have no horizontal document/table/code overflow in checked 390/1440 px light/dark states. The later version is not automatically selected: its added table costs 235 px on the phone and 304 px on desktop versus revision 1. Those dimensions describe the tradeoff, not a comprehension score.

Inspected pixels include [original phone table](screenshots/author-390-light-middle.png), [retained desktop](screenshots/candidate-1-1440-light-top.png), [phone programs](screenshots/candidate-1-390-light-middle.png), [phone assignment distinction](screenshots/candidate-1-390-dark-bottom.png) and [unselected desktop continuation](screenshots/candidate-2-1440-light-bottom.png). The retained desktop view and copy panels start at different heights because the automatic answer placement occupies the first column. This remains a concrete layout limitation; the page does not claim aligned side-by-side comparison. Two planned content revisions were used, with no third edit.

## Delivery evidence and limits

Canonical [strict finalize](evidence/canonical-finalize.json) and [current-path provenance check](evidence/canonical-check.json) pass. Artifact SHA-256: `6ca3ecb1c3bee984a31579e1f1444a11f2807a2b55c34b7391d6b30a11ef7e0a`. Historical receipts retain their original paths; the author's `answer.html` is an unchanged copy of its attempt artifact, not a new current-path certification.

Four actual Copy controls produce the exact visible bytes: two complete Python programs and their two outputs. [Captured content](evidence/copies.json), [execution harness](evidence/copy-run.py), [results](evidence/copy-run.json). Each copied program runs in a fresh temporary directory and matches its copied output plus the final newline. The three table operations are separately extracted from the actual rendered inline code, executed against fresh arrays, and compared with each row's displayed expected array. These are DOM-derived operations, not Copy controls. Clipboard API interception does not validate OS clipboard permissions.

Actual UI image export is 780 × 5,052 px. Inspected [top](screenshots/export-top.png), [middle](screenshots/export-middle.png) and [bottom](screenshots/export-bottom.png) show the complete programs, outputs and assignment table without horizontal clipping. [Export and index checks](evidence/export-index-check.json) confirm 17 questions, 15 projects and 41 variants; all three NumPy variants point to their expected artifacts at 390/1440 px. Archive hashes are recorded in [manifest](manifest.json). Runtime suites and ZIP rebuilds were not repeated for this content-only case. Round 33 source/package evidence remains at `7a8625b10379992da6a89872430f16e20b80ee89` / `85ebcb876f82b3dab08d7f43d8c55974e0c86911`. No full browser acceptance runner, final-head CI, Windows/Safari, general generation gain or human comprehension result is claimed.

Under the [project benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is one new-project discovery with parent content revisions. AI disclosure: Codex researched, authored, edited, ran the probes and inspected the artifacts. Nothing was merged, released or installed; the continuous goal remains active.
