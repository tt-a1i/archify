# An empty endpoint diff can hide staged changes

Round 27 explores a Git reading question: why can `git diff HEAD` show nothing while the index still contains a change? The independent [author page](author/answer.html) explains the example correctly. Two parent variants test simpler content and layout; neither is adopted as the final reading page. The second exposes a concrete desktop layout-contract defect for a separate repair.

## Source and observations

The upstream [git-diff manual](https://github.com/git/git/blob/d82adb61ba2fd11d8f2587fca1b6bd7925ce4044/Documentation/git-diff.adoc#L26-L71) and [status short format](https://github.com/git/git/blob/d82adb61ba2fd11d8f2587fca1b6bd7925ce4044/Documentation/git-status.adoc#L169-L224) are pinned to Git v2.50.1 commit `d82adb61ba2fd11d8f2587fca1b6bd7925ce4044`. The local executable is `/usr/bin/git`, **2.50.1 (Apple Git-155)**; that distribution is not claimed to be the exact upstream binary. [Identity](evidence/identity.json).

The [probe](evidence/probe.py) constructs a disposable repository with an existing commit and one tracked file. It records HEAD, index and worktree contents, three diff outputs and short status. It verifies that comparisons do not modify those contents or HEAD. [Run 1](evidence/probe-1.json) and [run 2](evidence/probe-2.json) are byte-identical.

| Case | HEAD / index / worktree | Nonempty comparisons |
| --- | --- | --- |
| Clean | 1 / 1 / 1 | None |
| Staged only | 1 / 2 / 2 | `--cached`, `HEAD` |
| Unstaged only | 1 / 1 / 3 | Plain diff, `HEAD` |
| Both distinct | 1 / 2 / 3 | All three |
| Same endpoints | 1 / 2 / 1 | Plain diff, `--cached`; **`HEAD` is empty** |

Values stand for the file lines `value=1`, `value=2`, `value=3`. In the last case, cached diff shows 1 → 2, plain diff shows 2 → 1, and status is `MM value.txt`. `git diff HEAD` compares the two equal endpoints, not the intermediate index. This constructed example does not cover conflicts, sparse checkout, submodules or all diff options. Ordinary tracked-file comparisons do not establish the absence of untracked files. No command ran against the user's working files.

## Author and content experiments

A separate gpt-6.1-terra / medium author used the [saved task](evidence/author-prompt.txt), pinned source/probe and frozen Archify runtime at `4bc35604ec8809d832cdff98cadfe3167763938d`. Its [first draft](author/first-draft.archify.md) passed strict delivery immediately. A supplied status-document citation led to a second successful finalize, with no failed attempt. [Trace](author/author-trace.json) and [report](author/report.md). Prompt-read time was not recorded precisely, and this is not a speed comparison.

The author's three-column tables fit at 390 px, but commands split into separate lines. At 1440 px, the conclusion stretches into a large mostly empty column: [phone](screenshots/author-390-light-middle.png), [desktop](screenshots/author-1440-light-top.png).

1. [Parent attempt 1](attempts/candidate-1.html) uses two-column tables and a copyable block containing the three read-only comparisons. It still splits command tokens, even on desktop, and makes both viewport heights larger. Rejected: [phone](screenshots/candidate-1-390-light-middle.png), [desktop](screenshots/candidate-1-1440-light-top.png).
2. [Parent attempt 2](attempts/candidate-2.html) removes the redundant command table. Short row labels show the three stored contents, and comparison directions sit directly beside the actual diff output. Phone height falls slightly, but the desktop answer column grows to 792 px and retains substantial empty space. This is a content candidate awaiting a layout repair: [phone](screenshots/candidate-2-390-light-middle.png), [desktop](screenshots/candidate-2-1440-light-top.png).

| Matched viewport | Author | Attempt 1 | Attempt 2 |
| --- | ---: | ---: | ---: |
| 390 × 900 | 2269 px | 2367 px | 2233 px |
| 1440 × 900 | 1252 px | 1305 px | 1452 px |

These are document heights, not comprehension scores. Tables and the candidate command block fit their containers; that does not imply words remain pleasantly arranged. Light/dark measurements agree: [author](evidence/visual-metrics.json), [attempt 1](evidence/candidate-1-metrics.json), [attempt 2](evidence/candidate-2-metrics.json). The initial author metrics used a selector that collected no panel heights; document/table measurements and screenshots remain valid. Later scripts collect `.panel` explicitly. Parent inspected the shown light states and dark desktop ending. The title's literal backticks were removed in the parent drafts.

## Confirmed layout problem

The authoring guide says explicit spans fix a panel's width. Attempt 2 gives both content panels `span=6`. The static HTML correctly emits `data-span-fixed="6"`, but the live reader places each at **8 columns**, while the answer occupies 4. [DOM and geometry observation](evidence/fixed-span-observation.json). The reader uses fixed spans as a minimum rather than an exact width. The trial `span=12` on attempt 1's document heading did not configure the answer panel; that unsupported assumption is removed in attempt 2.

This is sufficient evidence to investigate the explicit-width contract separately. It does not by itself justify changing automatic layouts or claiming that exact spans will solve all whitespace. The next round will audit callers, related work, preserved automatic behavior and real browser coverage before choosing a fix.

Both parent drafts pass strict finalize; original receipts and scripts retain their historical tuning paths. They do not certify provenance at these copied archive paths. No runtime or package changes, full browser suite, copy-button execution, image-export acceptance, fresh generation improvement or human reading acceptance are claimed. The main review index remains twelve questions across eleven projects and 28 variants while this new case is experimental. Nothing was merged, released or installed.

AI disclosure: the independent author wrote the original page; Codex ran the probe, made the two variants, inspected artifacts and documented the defect. Runtime source remains `4d182b54f5778ef707228922c5d04b3b981f26b3`; ZIP identity remains the round 26 build.
