# Reviewing Archify changes

Use this guide for initial and revised PR reviews. Judge the user value, implementation and ongoing maintenance cost, and impact on existing behavior. [Contributing](CONTRIBUTING.md#choose-evidence-by-impact) describes contribution and evidence requirements.

## Check readiness before detailed review

Complete this gate before detailed code review, test reconstruction, or delegating those tasks. A limited diff/metadata inspection to classify impact is appropriate:

1. Classify the change as a fix, new capability, or maintenance work, and establish its actual generation impact from changed paths and callers.
2. Apply [Choose the right path](CONTRIBUTING.md#choose-the-right-path). For a new capability or changed default, present the user-visible behavior and tradeoffs to the maintainer before adoption; reuse existing scope agreement. When required agreement is missing, thank the contributor, point to the relevant issue or proposal form, and close or defer within the authorized scope. Purely mechanical documentation corrections may proceed directly.
3. Check the [AI disclosure and accountability requirements](CONTRIBUTING.md#ai-assistance-and-contributor-responsibility), including the contributor's personal review confirmation. Check both the PR body and author replies: an explicit confirmation can supply the substance of an unchecked box. An AI-generated report or green CI alone cannot supply it.
4. Identify the applicable evidence route below and check that required evidence or an agreed scope/exemption is available. Do not reconstruct a missing generation comparison on the author's behalf.

Disclosure is context for review, not a quality score. Ask about specific unexplained decisions or unsupported claims; never infer a violation solely from writing style.

If required scope, personal confirmation, or evidence is missing, describe the material gaps together in one actionable response and stop detailed review, testing, and review delegation. Resume when the contributor supplies the missing items; reuse valid existing evidence. Maintainers review and sample submitted evidence rather than routinely reconstructing every contribution's test run. An issue link alone does not establish scope agreement or review readiness.

For existing PRs, reuse earlier maintainer decisions and evidence; request discussion only for unresolved direction, rather than requiring a new issue as paperwork.

## Understand the problem and approach

Record the current target base and candidate head. Read the linked issue or agreed scope and check the current-base behavior where feasible. Separate the reported problem from the proposed implementation.

For a visual fix, identify the observable defect in the original before implementing an alternative. Keep the unchanged original as the control, using the same input, viewport, zoom, and theme. Compare the proposal and, when it differs, the smallest correction to that defect. Record what improves and what becomes worse, including legibility and preserved content. Geometry assertions establish alignment or containment, not visual acceptance; screenshots and pixel differences do not establish preference by themselves.

Identify who benefits and whether the approach is worth maintaining. Consider whether existing capabilities or a smaller change would solve the problem. For a new default, schema field, or acceptance policy, clarify the value and compatibility tradeoff early. Reuse decisions already made in the issue or authorized task.

If required scope agreement is missing, use the readiness procedure above before investing in implementation review. Reuse existing agreements rather than creating another planning exercise.

## Match investigation to impact

Check the author's [impact classification](CONTRIBUTING.md#choose-evidence-by-impact) against the changed paths and callers. Shared helpers, templates, and authoring instructions may affect more modes than the title suggests.

Choose checks that resolve the important uncertainties, including relevant historical failures and authored constraints. Broaden the investigation when findings or coverage gaps warrant it. Repository-only policy changes need consistency checks, not layout screenshots.

Use existing tests, receipts, and browser tools. For behavior comparisons, use fixed inputs on the recorded base and candidate:

- Account for changed and preserved topology, meaningful labels, explicit geometry, and relevant failure behavior.
- For affected visible behavior, inspect the intended differences and unexplained changes under comparable browser conditions. A pixel difference identifies a change; it does not judge its quality.
- When a fix also changes a validator or golden baseline, evaluate that acceptance change explicitly. Fresh generated output proves consistency with the candidate, not compatibility with the base.
- Separate locally reproduced results, author/CI evidence, reused evidence, and unknowns. Keep browser checks and perceptual review distinct.

Evidence should be sufficient for the affected contract. Avoid rebuilding an unchanged artifact or replaying unaffected checks merely to restate existing results.

For generation-comparison pilot PRs, use the [real repository benchmark review procedure](benchmarks/real-repo-generation/README.md#6-submit-and-review-one-report): inspect the paired outcomes and sample the source/session evidence before requesting reruns. A missing real-world benefit is an unverified claim; synthetic repair success does not establish it.

Record the evidence route in the review or linked report: fresh real-repository generation, fixed-JSON replay, Viewer presentation/export replay, or a justified narrower scope/exemption. Include base/candidate identities, evidence links, reuse applicability, and remaining gaps. Fixed-JSON replay can establish renderer behavior on those inputs; it does not establish Agent authoring speed or first-draft quality. The benchmark's three-PR pilot and agreed scope rules remain authoritative; this classification adds no universal full-matrix requirement.

## Give actionable feedback

Lead with whether the approach is worthwhile, then explain findings and a clear disposition:

- **Blocking defect:** trigger, impact, supporting evidence, and the behavior that must be corrected.
- **Required evidence or scope decision:** the unresolved claim, why it matters to acceptance, and the smallest check or decision that would settle it. An unverified risk is not a reproduced defect.
- **Suggestion:** a worthwhile improvement outside the acceptance conditions; personal preference alone does not block.
- **Ready:** the agreed behavior is delivered, relevant evidence is sufficient, and no acceptance blocker remains.

Consolidate scope and compatibility concerns in the first substantive review where possible. Explain any later blocker with newly found evidence, an overlooked acceptance requirement, or a new diff. Record unrelated issues separately instead of growing the PR's scope.

Assess bot findings against the current diff and existing evidence before forwarding them. Explain duplicate or inapplicable findings; use the same standard of evidence as for your own feedback.

## Re-review and finish

Compare against the last reviewed head, resolve outstanding findings, and inspect added changes. Check intervening base changes for effects on the earlier assessment. Expand review when those changes invalidate scope or evidence; do not treat an old pass as proof of new behavior.

Finish when the agreed outcome is delivered, relevant evidence is sufficient, and no acceptance blockers remain. Report non-blocking limitations. A review conclusion does not itself authorize a GitHub approval or merge; follow the authorized action and [final integration requirements](CONTRIBUTING.md#final-integration-and-follow-up).

## Integrating a sole generated ZIP conflict

When integration is authorized and the reviewed source is ready, the optional helper can handle a conflict limited to `archify.zip`. Fetch the target branch, check out the candidate in a clean linked worktree on a branch, and record both full commit SHAs. With the canonical build runtime on `PATH`, first inspect:

```sh
node scripts/integrate-pr-zip.mjs --base origin/dev --expect-head FULL_PR_HEAD --expect-base FETCHED_DEV_SHA
```

The default leaves the index and working tree unchanged. Add `--apply` to merge and run the existing canonical ZIP builder. Source conflicts, dirty state, ongoing Git operations, or changed pins stop the operation. The helper verifies non-ZIP source against Git's combined tree and leaves an **uncommitted merge** for inspection, preserving both contributions. It does not fetch, commit, push, approve, or merge a GitHub PR.

Inspect the source delta and staged archive, then perform only the authorized commit/push steps. If building fails, inspect the retained merge state and follow the reported recovery instructions; builder edits may remain after aborting. Final-head CI, including the existing ZIP freshness check, is still required. Reuse unaffected source and generation evidence with its original identities and explain why it applies; an archive-only refresh or unrelated base movement does not by itself require repeating the generation matrix.
