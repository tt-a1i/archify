# Team contribution composition

This Draft candidate combines @outlier27-cell's #1222 (A1 threshold validation) and #1223 (A2 coverage disclosure) with #1244. Original source commits `6e123ea0a84df12ca539af862c72bd4f05913716` and `8de4ee3901f6d03f0c6782f772cf467a1518146f`, their original author metadata, and the later maintainer ZIP commits are retained as ancestors, not squashed or reauthored. The original PRs remain open. This is not approval, a merge into Labs, or a release.

## Scope and conflicts

The base is #1244 at `16c23ff47d8328a05cf480e639aa6afabc03938c`. The exact contributor heads are #1222 `f0b53b72031953ffd956409332f11fd9534326f4` and #1223 `2b43eb36a6dde564bba2b2818f08163c2e6556dd`. Source changes combined without conflicts. Each binary ZIP conflict was resolved by rebuilding from the combined tracked source with official Node 22.23.2 / bundled zlib `1.3.1-e00f703`. The final ZIP was built twice with byte-identical results.

No changes from #1224, #1203 or CI baseline repair #1242 are included. Source extraction, call resolution, paired-definition logic and the earlier seven-project evaluation files are unchanged. Earlier real-project results remain evidence at their original revisions; that matrix was not rerun here.

## Behavior and verification

The [receipt](receipt.json) pins the tested product commit and archive digest. A synthetic repository contained `good.py` with `answer()`, NUL-invalid `broken.py`, and `Note.java`. A warning complexity threshold was either `"oops"` or `0`. The public `archify code-analysis check` entrypoint ran with JSON and text output at the before revision, candidate source and extracted archive: 18 invocations in total. Candidate source/archive exit codes, stdout and stderr matched exactly for each of the six commands.

| Case | Before | Candidate source and ZIP |
| --- | --- | --- |
| Invalid threshold, `--fail-on never` | Exit 0 | Exit 2, `config/threshold-invalid` |
| Valid zero threshold, warning gate | Exit 1, no summary coverage | Exit 1; failed parse and one Java file disclosed |
| Valid zero threshold, never gate | Exit 0, no summary coverage | Exit 0; same coverage disclosed |

Focused complexity/coverage suites passed 18/18 from source and 18/18 from the extracted ZIP. One composition regression was added to #1223's existing fixture helper: configuration errors remain errors even with `--fail-on never`; zero remains a valid threshold; warning/never gates preserve exits 1/0 while both expose partial coverage. Existing clean/text coverage and valid-threshold tests were retained. No duplicate production logic was added.

The full module suite ran 343 tests: **342 passed, 1 failed, 0 skipped**. The failure is `installed configuration packages remain supported and changes invalidate analysis` at `ts-snapshot.test.mjs:89` (`Missing expected exception`). The focused snapshot file reproduces 10 passes/1 failure on both the unchanged #1244 checkout and the candidate with the same Node/environment. It is not introduced by this composition; its cause is not established here. This is not a fully green local suite. No tests were skipped or weakened to hide it.

Reproduce the committed regression and focused suites with Node 22 and Python available:

```sh
npm ci --ignore-scripts --prefix archify/modules/code-analysis
node --test archify/modules/code-analysis/test/complexity.test.mjs archify/modules/code-analysis/test/check-coverage.test.mjs
npm --prefix archify/modules/code-analysis test
```

Repeat the focused command against the equivalent files under an extracted `archify.zip`, after installing its module dependencies. `bash scripts/build-zip.sh /absolute/path/rebuilt.zip` with the canonical Node/zlib toolchain and `cmp archify.zip /absolute/path/rebuilt.zip` checks deterministic packaging. The first attempted build using the host Node 26 was rejected by the toolchain gate; all successful builds used the canonical toolchain.

## Accountability and limitations

The original implementation belongs to @outlier27-cell. Codex assisted @tt-a1i with composition, the additional regression, validation and documentation. Original contributor AI disclosure/personal confirmation requests remain pending; no agent has confirmed personal human review for either contributor. This candidate preserves that distinction and does not bypass final acceptance. The original #1244 README-receipt CI failure and the reproduced local snapshot failure remain explicit. npm dependency installation reported eight advisories; no dependency upgrade or audit remediation is included.
