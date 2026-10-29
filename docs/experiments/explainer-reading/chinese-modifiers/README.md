# Counted particles are not a Chinese syntax diagnosis

The former `writing-de-chain` rule counted “的” across a sentence. At three occurrences it asserted that modifiers were nested and the head noun arrived late. Three retained author drafts show why that inference is unreliable:

| Original case | What the occurrences actually describe | Historical result |
| --- | --- | --- |
| [Git baseline](../restore-pair/base/first-draft.archify.md) | A conflicted file, the table's copying model, and the relevant conflict options, across a colon | Warning; author revised the sentence |
| [Git candidate](../restore-pair/candidate/first-draft.archify.md) | Three separate definitions of HEAD, index and working-tree contents, separated by semicolons | Warning; author revised the sentence |
| [Thread cancellation](../thread-cancel/author/first-draft.archify.md) | The mechanism described above, a pinned source version, and the runtime-version qualification | Strict finalize failed; author revised the sentence |

The source/version sentence reads: “上面的机制来自固定版本的 CPython 3.13.9 源码；观察运行于本地 Python 3.15.0，并非 3.13.9 的实测。” Counting three particles does not establish the diagnostic's claim about its grammar. Splitting or editing these sentences can still be a valid editorial choice; the count alone should not require it.

## Change and tradeoff

Runtime change: `2d7633e68ec5064cf02e3729db050dfa615f3f78`, based on `c4b09e97bc7e2fabe92161ce8d018990570a9033`; fetched dev remains `5ecbd1bfdbf83ea747072112493c940e707569cb`.

The count-only diagnostic and numerical authoring quota are removed. The writing reference instead advises splitting genuinely stacked modifiers when they obscure the head noun. Sentence/paragraph length, scope, emphasis, numerical boundaries, phrase hints, evidence validation and strict/warn/off controls are unchanged. There is no new parser, punctuation heuristic, dependency or automatic rewrite.

The former positive assertion for a genuinely tangled modifier chain was retired with this automatic check. Such writing remains an editorial concern; the current linter no longer claims to identify it. The replacement regression protects the three actual independent-clause examples and a coordinated-noun example without punctuation. This avoids defining punctuation splitting as a substitute grammar test.

## Evidence

- The new regression fails on the unchanged base: **11 pass, 1 fail**, with the four false-positive diagnostics visible in [actual output](base-regression.log).
- Writing, validation, layout and CLI focused tests: **41 pass, 0 fail, 0 skipped** ([output](candidate-tests.log)). Existing tests still check retained hints, severity control, source positions, code/URL exclusion and public CLI behavior.
- Core product smoke: **19 pass, 0 fail, 0 skipped** ([output](core-tests.log)). Generated-output checks pass ([output](generated-tests.log)).
- Three complete, unchanged first drafts were replayed on the frozen base and candidate. **Base strict: all three fail only `writing-de-chain`; candidate strict: all three pass with zero diagnostics.** [Base runs](base-replay.json) and [candidate runs](candidate-replay.json) contain original-input hashes, actual exits, output identities and runtime versions. This new strict replay does not turn the two historical Git warnings into historical failures.
- The same-mode `warn` HTML files are **not byte-identical**: their embedded diagnostics and prepared-bundle digest change. All other fields in those two metadata blocks, and every byte outside them, match for each case ([comparison](render-comparison.json)). This isolates the change to the intended diagnostics; it is not a new screenshot or pixel-acceptance claim.
- Canonical `archify.zip` rebuilt with official Node **22.23.3** / bundled zlib **1.3.1-e00f703**. A second fresh build is byte-identical, and the extracted package outside the repository finalizes the original thread draft in strict mode ([package check](package-check.json), [actual smoke](package-smoke.json), [build log](zip-build.log)). No live installation changed.

The affected caller is explainer validation and its prepare/deliver/CLI paths. Architecture/workflow geometry and the reader are unchanged. Test-value review therefore uses the new low-cost wording regression, existing integration tests and the three natural-draft replays; no additional test framework or broad simplification was needed. The authoring-reference change stays beside the existing Chinese writing advice and removes the retired check from the diagnostic inventory.

## Benchmark and acceptance boundary

This round declared a fixed-input explainer diagnostic comparison before running. It is not the five-project architecture/workflow generation pilot, a fresh-author comparison, or a measured speed/comprehension gain. No general reduction in author repairs is claimed. The three selected cases establish the false-positive mechanism, not a prevalence estimate.

Full replay HTML and receipts are retained under `/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round13/`; lightweight command receipts and hashes are published here. For reproduction, materialize base commit `c4b09e97b` and candidate `2d7633e68`, then run `node <runtime>/bin/archify.mjs finalize explainer <original-first-draft> <new-output.html> --writing strict --json`. Repeat with `warn` only for the metadata comparison; warn-mode rendering is not strict acceptance of the base.

No new full browser gate, Windows run, full regression suite, fresh generation matrix, human acceptance or final-head remote CI is claimed. Existing earlier checks retain their recorded identities and limitations. No merge, release, version bump or live installation is part of this branch checkpoint.

Disposition: verified local diagnostic fix, packaged and retained on the experimental branch. Continue the overall readability goal.
