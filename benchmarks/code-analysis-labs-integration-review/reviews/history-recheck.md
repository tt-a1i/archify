> Archived independent review narrative. Source anchors are pinned below; selected machine receipts are in [evidence](../evidence). Other original relative artifact links name retained local work records and may not be published. For current disposition read [the review summary](../README.md).

# Bounded Labs history/readiness re-review

**The omitted current A2 contribution is restored at `3f5b75f`; the formatter finding is resolved within its demonstrated scope. Whole-batch readiness remains pending human/integration requirements.** This is a technical re-review, not a human approval or authorization to merge, publish, release, or install.

Reviewed source: `3f5b75f3fff3870114bf5617cd2cba567c56dd37`. Initial evidence remains immutable at `996e073ded7b99cbe885fbc4afab5d125412f6c1`; Labs comparison base remains `bf0a29e7664f52973d06a8e6a608df2db1ecbd39`. Only the specified follow-up was investigated. Prior PR/stack/rules/history records are reused with their original snapshot identities; there was no fresh full metadata sweep or reinspection of the original 176 commits.

## Correction to the formatter claim

The initial report correctly demonstrated that the exported formatter at `996e073` and in its ZIP accepted an owned synthetic receipt and emitted raw newline/ESC characters. It also correctly identified that original A2 corrections `07134ec` and `17ed256` were absent. **Classify that finding as a formatter-contract and contribution-currency issue. An end-to-end CLI terminal-injection defect was not demonstrated.** This clarification supersedes the broader impact wording in the immutable initial report.

The supplied `root-checks/control-paths-only-before.json` records an ordinary Python `check` invocation exiting **2**, empty stdout, stderr `[extract/schema-invalid] Extractor output violates raw-facts.schema.json.`, and both injection flags false. The schema's `$defs.repoPath` excludes C0 U+0000–U+001F (including newline/ESC) and backslashes. Both file paths and parse-error paths reference that definition. These inputs therefore fail before the normal CLI formatter. This is reused coordinator evidence, not a new extraction run by this role. C1 characters are not excluded by that pattern; this re-review makes no end-to-end C1 or terminal-rendering claim and establishes no stronger real trigger.

At `3f5b75f`, the complete `formatTerminalText` helper and the parse-error formatting call are exactly source-identical to current original A2. A direct comparison of the exported formatters matches on **68 synthetic receipts**: the original three probes, all 32 C0 code points, and DEL plus all 32 C1 code points. Controls are escaped and literal backslashes remain distinct. This comparison concerns A2 parse-path behavior; it does not claim the entire formatter file is identical, because the integration has other language disclosure extensions. The tracked final ZIP contains the exact current formatter source. See `focused-observations.json` and `source-observations.json`.

## Current author head, exact preservation, and tests

A fresh read-only GitHub metadata request confirms [#1223](https://github.com/tt-a1i/archify/pull/1223) is open, unmerged, non-Draft, still targeting Labs, at **`e164cc32825267617db61d430b871a34fe0fe662`**. The response is saved in `pr-1223-refresh.json`. Its body explicitly retains A1-first/A2-separate staging, personal confirmation, and the historical final-head CI limitation. No PR was modified.

The merge commit's exact parents are:

- `d37596ea151eae4b252bbd46cc60ebaa0b56a4ba`, the root's shared source-line/BOM fixes on top of `996e073`;
- `e164cc32825267617db61d430b871a34fe0fe662`, current original A2.

Consequently all four newly imported original author commits are exact ancestors, with original author/committer identities: `07134ec0a7a9665e5bf106a39608da0e99d711cb`, `e7a753c91efd2cbb4939e03a0071bbe051948e78`, `17ed256b1a29da4e949732d6ffb2081aef900453`, and `e164cc32825267617db61d430b871a34fe0fe662`. Original A1 `6e123ea`/packaged `f0b53b7` and initial A2 `8de4ee3`/packaged `2b43eb3` also remain exact ancestors. This preserves actual contribution history rather than substituting attributed copies.

AST statement comparison confirms all **15 complexity tests and three coverage tests at `996e073`** remain byte-for-byte intact as test statements. The **four current original A2 tests** are intact, as are both tests originally added by A1. The merged coverage file has five tests: the current author's four plus the integration's existing threshold/gate test. This verifies preservation across the test-end conflict resolution.

Fresh focused execution on Node **22.23.3**: `node --test archify/modules/code-analysis/test/check-coverage.test.mjs archify/modules/code-analysis/test/complexity.test.mjs` — **20 passed, zero failures/skips**, exit 0. `focused-test-run.json` retains the command, revision, output, and result. Temporary fixtures were confined to this report directory and Python bytecode writing disabled. The public CLI coverage tests protect disclosure and unchanged gate behavior; formatter tests protect escaping and distinguishability without relying on platform-specific filenames. No extra tests or source changes were added. The coordinator's broader module/package runs are separate evidence and are not represented here as completed or independently reproduced.

## Complete current scope versus Labs

Recomputed from the full Labs-to-current tree diff, rather than #1279's intermediate base:

| Responsibility | Paths |
| --- | ---: |
| Analysis implementation/configuration/schema/manifests | 45 |
| Analysis authored documentation/contracts | 8 |
| Analysis tests/fixtures | 33 |
| Benchmark evidence/fixtures/replay/control programs | 543 |
| Generated Skill ZIP | 1 |
| Generated README proof GIF/receipt | 2 |
| DSH documentation-contract test | 1 |
| **Total** | **633** |

There are **577 added, 56 modified, zero deleted paths**. Labs is an ancestor; symmetric commit counts are **0 / 182**. The original 176 commits remain intact; the precise six-commit addition is `d37596e`, the four original A2 commits above, and merge `3f5b75f`. The current-versus-initial tree delta touches **13 paths**: seven analysis product files, five analysis test files, and the ZIP. Only `archify/modules/code-analysis/lib/evidence.mjs` is newly in the complete diff's path set; the other twelve paths already differed from Labs. Full current paths/statuses/categories are in `changed-paths.json`; the original benchmark classification (29 explanations, 113 authored replay/control programs, 401 recorded fixtures/results) is unchanged and not newly replayed.

The baseline caveat remains explicit: `docs/assets/archify-live-proof.gif`, its JSON receipt, and `integrations/deepseek-harness/test/docs-contract.test.mjs` are retained from #1242. The proof refresh updates the Classic source artifact digest and GIF identity. The DSH test adjusts documentation assertions to the current install prompt and explicit Skills CLI commands; it is **documentation-contract evidence, not a DSH host migration, package publication, live installation, or runtime acceptance**. These three paths remain part of the proposed cumulative scope. No renderer, Viewer, workflow, root dependency, or website implementation paths enter this diff.

`43561155ec1c087e3e122c36566f63923c7f6544` is **not an ancestor**. The Python adapter tree, `ARCHITECTURE.md`, and `docs/FUNCTION-ANALYSIS.md` are unchanged from `996e073`; the adapter still declares `python-lexical-v2`. The narrow Python change is BOM decoding in shared evidence, plus its regressions, not the excluded module-qualified v3 work. The excluded benchmark paths also do not enter the recomputed path set.

Final tracked ZIP identity: **7,597,489 bytes**, **405 entries**, SHA-256 `641e2c8cb495a4f7a9fb7c8098b12c9bb76e766eeeda95511bf255eebfc8c3ac`, no CRC failure. This role checked identity/CRC and formatter parity, not a fresh canonical rebuild or complete package acceptance.

## Remaining vehicle and human requirements

A dedicated **ordinary Draft PR directly to `labs/code-analysis`** remains the appropriate proposed cumulative vehicle: a branch at the reviewed combined head preserves history without retargeting or expanding any existing PR or native stack. This is a proposal only; none was created here. The prior no-exact-direct-vehicle determination is reused, not claimed as a newly swept inventory.

Actual personal confirmations from @outlier27-cell for **#1222 and #1223 exist**; #1223's refreshed body reconfirms its own scope. They must not be described as missing. They do not establish whole-batch personal confirmation. That accountable human confirmation remains pending for this 182-commit integration, including the shared fixes and baseline repairs.

The recorded [#1182 staging decision](https://github.com/tt-a1i/archify/issues/1182#issuecomment-6660571992) remains **A1 first, then A2 separately on Labs**. Combining them into a cumulative proposal does not silently supersede that decision: the maintainer must explicitly reconcile staged acceptance with cumulative integration and approve the actual scope, including baseline repairs. Previously agreed slices need no invented new proposal paperwork.

Reuse the initial applied-Labs-rule records: one approving review under the reviewed-PR rule (subject only to its recorded narrow pull-request-mode exception for user ID 291406663); resolved threads, stale-review dismissal and safeguards for unattributed changes still apply. The safeguards have no blanket bypass, and the narrow exception is not general merge authorization. The saved rules showed no required-status-check rule, but CONTRIBUTING independently requires refreshed base/head, applicable final-head CI, and honest reuse attribution. These are inherited rule snapshots, not freshly revalidated rules. Before integration the coordinator must check current applicable rules, obtain the authorized human decision and final revision evidence, and account for the actual merge set. Existing stacked PRs cannot be merged as a shortcut without scope authorization covering their lower layers.

The initial successful CI belongs to `996e073`, not `3f5b75f`; unchanged portions may be reused with that identity, while affected source/tests/archive require current evidence. No broad analyzer accuracy, human acceptance, final remote CI success, release, or installation claim follows from this bounded result.

Only this assigned `history/followup/` directory was written. Original reports, source, PRs and Wiki were preserved. No goals, reminders, extra agents, approvals, merges, publications, releases or live installs were created or performed. The commissioned follow-up is answered and stops here.
