> Archived independent review narrative. Source anchors are pinned below; selected machine receipts are in [evidence](../evidence). Other original relative artifact links name retained local work records and may not be published. For current disposition read [the review summary](../README.md).

# Labs integration history and readiness review

**Disposition: HOLD. One reproduced integration defect, plus human/integration requirements.** Technical inspection was expressly commissioned despite missing personal confirmations. This report supplies no human confirmation, approval, merge, release, installation, or publication.

Snapshot: 2026-11-08 UTC. Repository `tt-a1i/archify`. Labs is `bf0a29e7664f52973d06a8e6a608df2db1ecbd39`; candidate is `996e073ded7b99cbe885fbc4afab5d125412f6c1`. [PR #1279](https://github.com/tt-a1i/archify/pull/1279) remains **open, Draft, unmerged**, base `codex/java-declared-project-deps-20261108` at `196dd3569efba785d456a6dd0825ea6ebdf489bf`. A populated REST `merge_commit_sha` is a test merge, not evidence of integration; `merged=false` and `merged_at=null` are authoritative here. The newer local Python module-qualified work `43561155e` was excluded.

## Blocking reproduced defect: cumulative candidate omits the current A2 terminal-path fixes

**Trigger:** A parse-error path contains a newline or terminal escape character. Those filenames are possible on POSIX. The candidate contains #1223's original coverage summary, but not its subsequent fixes `07134ec0a7a9665e5bf106a39608da0e99d711cb` and `17ed256b1a29da4e949732d6ffb2081aef900453`.

**Expected, source-backed:** Current [#1223](https://github.com/tt-a1i/archify/pull/1223) at `e164cc32825267617db61d430b871a34fe0fe662` escapes terminal controls and first escapes literal backslashes, keeping different paths distinguishable. Its author explicitly describes both corrections in [the readiness reply](https://github.com/tt-a1i/archify/pull/1223#issuecomment-6716794608), captured in `comments-1223.json`. Exact implementation: [current original check.mjs, lines 156–159](https://github.com/tt-a1i/archify/blob/e164cc32825267617db61d430b871a34fe0fe662/archify/modules/code-analysis/bin/check.mjs#L156-L159). Both original review threads are resolved on that head.

**Observed:** [candidate check.mjs:151](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/bin/check.mjs#L151) joins raw paths. Calling its exported `formatText` with an owned synthetic coverage receipt containing `src/bad\nFORGED.py` and `src/\u001b[2Jbad.py` inserts a new output line and retains the ESC byte. The identical probe against the tracked ZIP behaves the same. Current original #1223 escapes both. Probe process exit is 0 because it records the comparison; the candidate's `conforms` result is **false**, and the original's is **true**.

Reproduce from this report directory:

```sh
python3 prepare_probe.py
```

This extracts just the exact formatter and its diagnostics import from Git objects and the pinned ZIP, then runs `probe.mjs` using retained Node 22.23.3. No analyzed project executes. See `format-probe-result.json`, `format-probe-commands.json`, and the copied exact files under `candidate/`, `candidate-zip/`, and `current-1223/`.

**Impact:** terminal coverage disclosure can be split or visually altered by the reported path. This is a demonstrated omission of an existing reviewed correction, not a hypothetical new security-hardening proposal. The probe establishes formatter behavior, not an end-to-end extraction run. Bring the two scoped corrections into the integration source with attribution, retain the literal-backslash distinction, and rebuild/revalidate the final ZIP. The coordinator owns any fix; no source was edited here.

## Complete scope and history accounting

Labs is an ancestor of the candidate: `git merge-base --is-ancestor BASE HEAD` exits 0; `git rev-list --left-right --count BASE...HEAD` returns **0 / 176**. The complete net difference is **632 paths: 577 added, 55 modified, zero deleted**, with 176 commits including 14 merges. This is the complete lower-history integration, not #1279's immediate-base diff of 58 files / 8 commits.

| Responsibility | Paths |
| --- | ---: |
| Analysis implementation, configuration, schema, manifests/locks | 44 |
| Analysis authored documentation/contracts | 8 |
| Analysis tests/fixtures | 33 |
| Benchmark evidence, fixtures, replay/control programs | 543 |
| Generated Skill ZIP | 1 |
| Generated README proof GIF/receipt | 2 |
| DSH documentation-contract test | 1 |
| **Total** | **632** |

The 543 benchmark paths comprise 29 explanations, 113 authored replay/control programs, and 401 recorded fixtures/results, classified by path/extension; this does not certify every recorded result as newly reproduced. No benchmark driver, analyzed upstream project, upstream build, macro or test suite was executed here.

Every path is enumerated with status, category and inspected PR overlap in `changed-paths.json` / `path-inventory.md`. Every commit has full SHA, all parents, author/committer identity, message, first-parent paths and categories in `commits.json` / `commit-inventory.md`. These are a complete range accounting, including merge ancestry. Category counts for individual commits overlap when a merge imports prior content; they must not be summed as unique files. `path-classification-summary.json` is the authoritative final classification; `accounting-summary.json` retains the initial broader classification used during capture.

The product scope includes load/cycle semantics, package and namespace resolution, source definitions/calls and current/paired questions across JS/TS, Python, Java, Go and Rust, shared evidence/schema/freshness handling, complexity-threshold validation, and partial-coverage disclosure. It adds Go and Rust extraction/toolchain paths. It is materially broader than only Rust lifetime navigation. No root renderer, Viewer, workflow, root dependency or website implementation path changes in this delta.

**Non-analysis material:** `docs/assets/archify-live-proof.gif`, its JSON receipt, and `integrations/deepseek-harness/test/docs-contract.test.mjs` come through [#1242](https://github.com/tt-a1i/archify/pull/1242), whose current head is an ancestor. They repair shared baseline checks and are described separately in that PR; they are not language-analysis features. Their inclusion needs to remain explicit in the integration scope. Unrelated Atlas #1203 and baseline write-route #1224 are not imported. #1224 remains Draft with three unresolved review threads and separate scope requirements; its findings must not be attributed to this candidate.

## Authors and source ownership

There are **173 commits authored by tt-a1i, two by 杨嘉伟 / @outlier27-cell, and one by BlueboxC**. Original contributor source commits `6e123ea0a84df12ca539af862c72bd4f05913716` (#1222) and `8de4ee3901f6d03f0c6782f772cf467a1518146f` (#1223) are exact ancestors, with their original author and committer metadata. #1222's current packaged head `f0b53b7` is retained; #1223's older packaged head `2b43eb3` is retained, **not its current head**. This is why claiming all current contributor revisions were incorporated would be incorrect. `original-contributor-commits.json` records every commit in those original PRs and ancestor membership.

BlueboxC's README repair is retained as attributed cherry-pick `816556b9667cd8eb2d762d8361edba340c462f83`, explicitly naming original `355ea380a2cdfddf12cd107d7d663ee7b2c4c5b7` from [#1174](https://github.com/tt-a1i/archify/pull/1174). Original author/date/message are preserved; tt-a1i is the cherry-pick committer. BlueboxC personally confirmed the original animation/explanation review in #1174; that confirmation does not cover the cumulative integration.

Original Java [#1239](https://github.com/tt-a1i/archify/pull/1239) head `110b8de` is not an ancestor. Its owner-authored integration is represented by `76596453bf13e9c27f8701df3cdc862846f6b770`, whose message records the original `d9ab198` and intermediate cherry-pick, and benchmark-only copy `62a7af34456d5e2b8c5775fa00d94fe49534e150`, explicitly attributing `110b8de`. This is attributed adapted history, not exact preservation of that branch. Do not claim every overlapping PR head is an ancestor. Current #1268 and #1277 independent branches are exact ancestors through their composition merges without reassignment.

The tracked CODEOWNERS file assigns governance/automation paths to @tt-a1i; it does not designate an analysis-module code owner. Ownership and contributor credit here come from original PR authors and Git history, not invented ownership assignments. Contributor copyright is retained under CONTRIBUTING's license terms.

## Current PR and native-stack overlap

`pr-overlap-map.json` records current head/base SHAs, authors, Draft/merge state, requested reviewers, review submissions, author replies and path overlap for 44 relevant PRs, with supporting `pr-*`, `comments-*`, and `reviews-*` snapshots. Supplementary original #1174/#1187 provenance and #998 metadata are also captured. Current related review threads are separately captured in `review-threads.json`.

| Native stack | Actual trunk | Ordered open members |
| --- | --- | --- |
| #1215 | `labs/code-analysis` | #1213 → #1214 |
| #1221 | `labs/code-analysis` | #1219 → #1220 → #1225 → #1226 → #1227 → #1229 → #1234 |
| #1237 | `labs/code-analysis` | #1235 → #1236 → #1243 |
| #1257 | `codex/python-explicit-import-calls-20261107` | #1255 → #1256 → #1258 |
| #1262 | `codex/python-explicit-import-calls-20261107` | #1260 → #1261 → #1263 → #1264 → #1265 → #1266 → #1267 → #1269 → #1270 → #1271 → #1272 → #1273 → #1279 |

All listed members are open Drafts. The stack numbers #1221/#1237/#1257/#1262 are stack objects, not missing PR layers. The exact server snapshots are `native-stacks.json` and `stack-*.json`; this is native membership, not an inference from chained bases. No stack command that changes tracking, branches or PRs was run. The installed official guide, skill, command reference, extension/version and current help were read before investigating the stack API.

Standalone dependencies/parallel work include #1212, #1216–#1218, #1231, #1239, #1242, #1244, #1250, #1252, #1259, #1268 and #1277. #1252 targets #1250's combined branch; it is the shared trunk of the two upper native stacks, not itself a native layer in them. #1222/#1223/#1224 remain independent contributor PRs. #1222 and #1223 currently have no requested reviewers or submitted human approvals, and GitHub reports `REVIEW_REQUIRED`; their bot comments do not satisfy an approval.

**No existing direct-to-Labs PR covers the exact candidate.** All 202 open PRs were paginated (100 + 100 + 2). The only PR at the exact candidate SHA is #1279, with the intermediate base above. The twelve current direct-to-Labs PRs are #1212, #1213, #1217, #1218, #1219, #1222, #1223, #1224, #1231, #1235, #1242, and unrelated #1203; `direct-labs-prs.json` supplies heads and stack membership.

A standalone branch rooted at the reviewed cumulative candidate can preserve every existing ancestor and target Labs **without changing any existing PR, branch, or stack**. Labs is already its ancestor, so no source-history rewrite is needed merely to propose that integration. This is a future coordinator action, not performed here. Reusing #1235 as the cumulative entry would change a bottom native-stack layer's scope and affect its children; retargeting #1279 changes stack #1262's relationships. Repurposing a narrow standalone PR such as #1242 is technically possible only as an explicitly agreed scope change, not an existing ready integration vehicle. Prefer a dedicated ordinary integration review rather than silently changing others' PRs. Repair the reproduced omission before selecting the final integration head.

## Required evidence or human decisions

1. **Cumulative contributor/maintainer confirmation remains missing.** #1279's personal-review checkbox is unchecked and it has no author reply or review submission. #1250/#1252/#1242 likewise do not supply personal confirmation for the whole candidate. The inspection commission is technical authorization, not that confirmation. Current #1222 and #1223, however, **do** disclose Codex/GPT-6.1 Sol and explicitly confirm personal review in body and author replies. Do not repeat the historical claim that these original contributors have not responded. #1250 and its benchmark README contain stale pending-confirmation statements; preserve their historical context and correct current readiness summaries.
2. **Record the cumulative integration decision and actual merge scope.** The [maintainer decision on #1182](https://github.com/tt-a1i/archify/issues/1182#issuecomment-6660571992) agrees A1 then A2 separately on Labs. Existing composition decisions and the commissioned review can be reused; green CI is not approval of the 176-commit batch or authorization to merge lower stacks. Name inclusion of the baseline repair and any staged-order reconciliation. No extra feature-proposal requirement should be invented for already agreed slices.
3. **Obey Labs' actual rules and final-head evidence requirements.** The applied-rule read returns two PR rulesets plus deletion/non-fast-forward protection. The safeguards require resolved threads, dismiss stale reviews, and extra approval for unattributed changes. The reviewed-PR rule requires **one approving review**, with an explicit pull-request-mode exception for user ID 291406663; the separate safeguards have no bypass actors. Do not generalize that narrow exception into blanket permission. There is no required status-check rule in the current applied Labs rules; classic protection returns 404 `Branch not protected`, while ruleset protection remains active. The Python trunk of #1262 currently has only deletion/non-fast-forward rules. Consequently #1279's `reviewDecision=null` or `mergeable=true` does not establish Labs readiness. Source: `labs-rules-cli.json`, `labs-protection-cli.json`, `ruleset-25339332.json`, `ruleset-25339433.json`, and `stack-trunk-rules.json` ([repository rules](https://github.com/tt-a1i/archify/rules)). CONTRIBUTING's final integration section independently requires final-head CI, refreshed base/head and attribution of reused evidence.
4. **After any fix, validate the actual final integration revision.** The defect probe changes the acceptance assessment, not the source. A future fix changes the head and archive; revalidate affected coverage/formatting and ZIP checks, refresh the target comparison and required remote CI. Reuse unaffected evidence under its original SHA and scope. Resolve applicable final review threads and obtain the authorized human decision before integration. No automatic approval, merge or live-installation step follows from this report.

## Local evidence, inherited CI, ZIP and merge state are separate

**Local:** Git graph/path/author inspection; current remote metadata; tracked ZIP identity/CRC; exact exported formatter comparison on a synthetic receipt. Commands capture scope, revision, expected behavior, output and exit in `commands.json`, `mapping-commands.json`, `final-accounting-commands.json`, `object-refresh.json`, `readiness-commands.json` and `format-probe-commands.json`. Object-only fetching of the two absent fork heads used `--no-write-fetch-head --no-tags`; no branch, checkout, worktree, stack or product source was changed. GitHub connector snapshots carry source URL and retrieval time. Encoded-slash branch endpoints were rejected by that connector, so read-only `gh api` supplied the branch/rules/stack fallback. Initial failed connector responses are retained, including the retried #1222 commit listing in `pr-commits-1222-cli.json`.

**Inherited CI:** [run 42442200073](https://github.com/tt-a1i/archify/actions/runs/42442200073), attempt 1, `pull_request`, exact head `996e073...`, completed success at 2026-11-08 03:25:44Z. All 19 non-skipped reported jobs succeeded: scope, published manifest check, full regression shards 1/2, Node 18/20/22/24, browser shards 1/2, WebM decode/aggregate, ZIP freshness, website, Windows Node 22/24, and package smoke on Ubuntu/macOS/Windows. Deployment jobs `deploy-cloudflare` and `deploy-pages` were **skipped**. This is remote evidence, not a locally rerun test matrix, publication, DSH plugin release, or acceptance of real-world diagram usefulness. See `final-ci.json`, `final-ci-jobs.json`, `candidate-checks.json`, `candidate-runs.json`. Successful jobs may contain intentionally skipped steps; the saved step records bound each job's claim. The PR body's 410-test and distribution recipe claims were not independently rerun by this history agent.

**ZIP:** `git show HEAD:archify.zip` yields 7,596,031 bytes, SHA256 **bb2f38587109acd1b73e97d58ce987b8db56af0c9ad58988665340e668286e4b**, 405 entries, no CRC failures. Formatter behavior was also checked from that exact ZIP. This independently verifies identity and the reported defect, not a clean rebuild or full distribution runtime parity. ZIP freshness is inherited from the successful exact-head CI; other review agents own broader archive checks.

**Actual integration:** Labs remained at `bf0a29e...`; #1279 and related PRs remained unmerged. No final direct-to-Labs candidate PR exists. Green candidate CI does not alter those facts.

## Nonblocking limitations and examined boundaries

This audit fully accounts for changed paths, commit ancestry and attribution, current native stacks, relevant PR metadata/discussions, branch rules, exact-head CI and archive identity. It does not establish broad analyzer accuracy, compiler/LSP completeness, visual acceptance, live installation behavior or upstream execution safety by rerunning the language matrices. Those are separate bounded technical reviews/evidence routes. The small formatter probe cannot substitute for those matrices. No unrelated redesign or test optimization was attempted. The inherited baseline repairs are an explicit scope decision, not a newly invented defect.
