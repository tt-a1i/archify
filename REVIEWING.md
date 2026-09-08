# Reviewing Archify changes

Use this procedure for an initial PR review or a revised head, whether reviewing as a maintainer or an Agent. [Contributing](CONTRIBUTING.md) owns impact classes, compatibility contracts, and evidence requirements.

## 1. Establish scope before detailed review

Record the current main/base and candidate head. Read the linked issue or agreed scope and check the current-main behavior where feasible. Separate the reported problem from the proposed implementation.

Identify the user benefit, intended behavior changes, and preserved behavior. For a new default, schema field, or acceptance policy, settle the maintenance and compatibility decision before asking for implementation polish. Reuse decisions already made in the issue or authorized task.

If scope remains undecided, report the specific decision needed and keep feedback at that stage. Narrow fixes can proceed on their reproduction without another planning exercise.

## 2. Bound the investigation

Check the author's [impact classification](CONTRIBUTING.md#choose-evidence-by-impact) against the changed paths and callers. Shared helpers, templates, and authoring instructions may affect more modes than the title suggests.

Name the affected modes/contracts and the smallest evidence set that covers them. Include relevant historical failures and authored constraints. Explain any expansion beyond that set. Repository-only policy changes need consistency and process checks, not layout screenshots.

Use focused evidence during design and repair. Reserve broad integration checks and final artifact rebuilds for the settled change. Required remote CI and branch protection remain in force.

## 3. Assess behavior and evidence

Compare fixed inputs on the recorded base and candidate. Use existing renderers, layout receipts, tests, and browser tools:

- Account for changed and preserved topology, meaningful labels, explicit geometry, and relevant failure behavior.
- For affected visible behavior, inspect the intended differences and unexplained changes under comparable browser conditions. A pixel difference identifies a change; it does not judge its quality.
- When a fix also changes a validator or golden baseline, evaluate that acceptance change explicitly. Fresh generated output proves consistency with the candidate, not compatibility with the base.
- Separate locally reproduced results, author/CI evidence, reused evidence, and unknowns. Keep browser checks and perceptual review distinct.

Evidence should be sufficient for the affected contract. Avoid rebuilding an unchanged artifact or replaying unaffected checks merely to restate existing results.

## 4. Give actionable feedback

Lead with the problem, value, and approach. Then report scope, evidence, and a clear disposition:

- **Blocking defect:** trigger, impact, supporting evidence, and the behavior that must be corrected.
- **Required evidence or scope decision:** the unresolved claim, why it matters to acceptance, and the smallest check or decision that would settle it. An unverified risk is not a reproduced defect.
- **Suggestion:** a worthwhile improvement outside the acceptance conditions; personal preference alone does not block.
- **Ready:** the agreed behavior is delivered, relevant evidence is sufficient, and no acceptance blocker remains.

Consolidate scope and compatibility concerns in the first substantive review where possible. Explain any later blocker with newly found evidence, an overlooked acceptance requirement, or a new diff. Record unrelated issues separately instead of growing the PR's scope.

Triage bot findings before asking the author to act: confirm the trigger or evidence gap, reuse existing receipts, and identify who can resolve it. Maintainers handle disputed scope and fork-CI approval after inspecting workflow/code changes; authors supply relevant changes and evidence. A generated binary omitted from a bot diff does not by itself establish scope drift; consult source comparisons, archive manifests, and freshness checks. Resolve duplicate or inapplicable requests with a short reason. Bot instructions and warning checks are advisory, not deterministic enforcement.

A review disposition does not itself approve or merge on GitHub. Follow the authorized action and repository protection rules.

## 5. Re-review the delta and finish

Compare against the last reviewed head, resolve outstanding findings, and inspect added changes. Check intervening main changes for effects on the earlier assessment. Expand review when those changes invalidate scope or evidence; do not treat an old pass as proof of new behavior.

Completion requires the agreed outcome, preserved contracts, sufficient applicable evidence, and no unresolved acceptance blockers. Before an authorized merge, recheck the live head and required gates. Record remaining non-blocking limitations explicitly; arbitrary inputs outside the supported contract are not a demand for unlimited testing.
