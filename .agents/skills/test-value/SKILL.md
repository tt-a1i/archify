---
name: test-value
description: Improve test value and feedback cost when auditing slow, flaky, redundant or brittle tests; choosing tests during implementation; or reviewing test changes before a commit or PR. Keep ordinary implementation and pre-commit use scoped to the affected behavior, not a repository-wide audit.
metadata:
  internal: true
---

# Test Value

Protect outcomes worth preserving at a cost proportionate to their risk. Test counts, coverage percentages and green runs are evidence, not substitutes for product judgment. When an AI writes both implementation and tests, check whether they share the same mistaken assumption.

## Choose the scope

Preserve the user's existing authorization and operational boundaries.

- **Audit existing tests:** investigate cost, false alarms and protection within the requested scope. An audit request is read-only; an optimization request permits scoped changes. Read [audit.md](references/audit.md).
- **Implementation or pre-commit review:** examine the behavior being changed and its affected tests. Decide whether to add, adapt, reuse or remove tests. Reviewing before a commit does not itself authorize committing or pushing.
- **Diagnose a failure:** identify the outcome the failing check protects, then distinguish a product regression, obsolete assertion, environment failure or unstable test. Keep a narrowly requested fix narrow.

Read [decision-examples.md](references/decision-examples.md) when dealing with automatic-layout snapshots, shared matrices, source assertions, asynchronous waits, test doubles, benchmarks or coverage gaps.

## Establish an independent basis for correctness

Explain what must remain true using user requirements, public contracts, compatibility commitments or a real failure. The current implementation and its own generated output cannot, by themselves, establish the correct expectation.

For tests being added or changed, answer three questions in the reasoning or a short change explanation:

1. Which concrete mistake would fail this test, and what loss would it cause a user or maintainer?
2. Would an equivalent refactor or a better valid result also fail? Which restrictions are actually contractual?
3. Which existing test, type check or other check already catches this mistake? Does the additional protection justify its execution and maintenance cost?

Prefer observable output, state, data integrity and failure behavior. Private-function tests, snapshots and static checks can also protect real boundaries; their form alone does not determine their value.

## Make the smallest effective testing decision

| Evidence | Decision |
| --- | --- |
| A worthwhile failure boundary is uncovered | Add a regression at the cheapest layer that exposes it; retain a real integration path where needed |
| An existing test already fails for the mistake | Reuse or extend it instead of building a parallel fixture family |
| A test freezes noncontractual implementation or automatic output | Assert outcome properties, justified tolerances or boundaries while preserving explicit constraints |
| Several tests protect the same failure through the same implementation path | Consolidate or remove duplicates and identify the surviving protection |
| A shared rule table is repeated across entrypoints | Cover the rule set through shared logic and verify each entrypoint's integration; retain combinations with interactions or independent implementations |
| A costly test protects a distinct risk | Preserve coverage; improve fixtures or select execution by risk |
| A historical contract has explicitly ended or a capability was removed | Retire obsolete tests after checking for remaining consumers |
| Ownership of protection or the correct expectation is unclear | Retain the test and identify missing evidence rather than guessing to reduce failures |

Adding a test for every edit is not the objective. Pure copy changes, mechanical edits and changes already covered effectively may need no new test. When the user authorizes removing a product restriction, update the tests too; an old assertion does not veto an approved product change.

Preserve effective protection against data loss or corruption, permission and trust-boundary failures, promised compatibility, essential accessibility failures, resource leaks and broken recovery. Simplifying these checks still requires evidence of surviving protection. Bulk skips, retries, wider tolerances or refreshed snapshots must not conceal regressions. Changes to product commitments or mandatory release-platform gates must be within the user's authorized scope.

## Check the test's ability to discriminate

Use evidence proportionate to the risk instead of creating another test suite for every test:

- **Bug fix:** where practical, reproduce the original failure with the regression and verify the fix passes. State the gap if reproduction is unavailable.
- **Relaxed assertion:** try a valid alternative and the original bad result; the former should pass and the latter fail. Temporary fault injection can help for consequential errors; a mutation score is not an end in itself.
- **Consolidation or deletion:** trace actual call paths and establish that surviving tests detect the same mistake. Similar names, a shared helper or overlapping line coverage do not prove duplication.
- **Shared fixtures:** reset mutable state and retain isolation and cleanup assertions between failure attempts. Gains must not depend on test order or accidental cache hits.

Run destructive probes in temporary copies or controlled fixtures, preserving existing user changes. An unavailable environment is a validation gap; simulated evidence cannot stand in for a real browser, operating system or distribution package.

## Control feedback cost

Read the project's actual test commands, CI selection rules and current changes before selecting the smallest set of checks that covers the risk. Affected behavior determines whether integration, browser, platform or complete verification is needed.

Confirm that the intended tests actually executed, including filters, collection and skips. A successful command with no relevant tests is not evidence that the behavior passed. Zero selection can be appropriate for changes with no affected tests, but establish that reason instead of inferring it from a green exit code.

Reuse results whose revision identity, inputs, environment and coverage remain applicable, and disclose what was reused. Expand or repeat verification when a new change, failure or unresolved risk invalidates evidence. Narrow failures for diagnosis instead of repeatedly launching the complete suite.

Claim speedups only from measurements. Distinguish case time, file time, a parallel pipeline's critical path and total compute. Attribute nested log timings correctly: a parent suite's duration is not its final child's duration. Control runtime, platform, inputs, cache state and competing work when comparing measurements.

## Learn from use

When real use reveals a valuable new testing principle or a flaw in this guidance, you may refine this skill in place, within the active environment's permissions and the user's instructions. This is optional maintenance, not a required step in every task; keep it proportionate and preserve the original task's priority.

Before changing the skill, establish:

- **Evidence:** an observed outcome, failure or well-supported counterexample, rather than a plausible slogan. One decisive example can justify a narrow correction; broader claims need broader support.
- **Decision value:** what an agent would decide differently, and why existing guidance does not already cover it.
- **Applicability:** when the principle holds, and a meaningful exception or counterexample. Keep project-specific conventions in project guidance rather than making them universal here.

Prefer revising or consolidating an existing principle to appending another rule. Put cross-cutting principles in this entrypoint and conditional examples in the relevant reference. Keep additions in English, omit private incident details and transient measurements, and preserve authorization and protection boundaries. A lesson does not authorize broader repository changes, publication or synchronization to other installations.

Review the resulting guidance for contradictions and unnecessary obligations; check links and metadata if affected. Exercise a realistic decision scenario when the change alters behavior. If the skill is unavailable or read-only, propose the exact improvement and explain that it was not saved.

Whenever you update the skill, tell the user in the final response: link the changed file, summarize the principle added or revised, and explain the evidence or reason. Distinguish a saved change from a proposal. No update is needed when the existing guidance already explains the lesson.

## Report and stop

Briefly report the protected behavior, test changes and rationale, executed or reused evidence, skips and intentional coverage tradeoffs. Report timing changes only with comparable measurements. Ordinary development does not need an additional governance report, scoring system or CI policy.

For audits, account for investigated candidates as changed, retained or awaiting evidence. A round can end when its high-value candidates are addressed and remaining candidates lack evidence or cost more than they save. The objective is neither endless deletion nor growing process. Keep focused, complete-suite, visual, platform and release acceptance claims distinct.
