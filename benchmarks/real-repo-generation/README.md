# Real repository generation benchmark v1

**Status: pilot protocol and task corpus; no generation runs or quality results yet.** Use this for agreed pilot PRs first. Evaluate the first three submissions before making it the default for all generation-chain PRs. Existing CI and merge authority remain unchanged. This directory supplies instructions and evidence templates; it does not launch Agents, capture sessions, or automatically score diagrams.

The question is: **does the change help a real Agent deliver a factually correct, readable diagram with less rework?** Contributors provide comparable evidence; maintainers inspect changes and sample the underlying record. Quality comes before speed.

## 1. Declare scope before running

Use the five public, pinned projects in [projects.json](projects.json). Their tasks cover OpenPI delegation, Hive workers, MCO provider orchestration, Squad task coordination, and SkillRoster filesystem changes. These are five specific developer-tool projects, not a representative sample of every software domain. Read project sources in place and link to them; the corpus does not redistribute them or change their licenses.

| Change | Default evidence |
| --- | --- |
| One diagram's layout, routes, typography, schema, or generation instructions | That diagram type on all five projects, once on base and once on candidate: 10 independent generation sessions. Add same-JSON replay when rendering or validation changes. |
| Shared authoring, repair, delivery, or layout behavior | Architecture and workflow on all five projects: 20 sessions. Add representative saved real inputs for other affected types. Expand live generation only where the changed path is not exercised by that coverage. |
| Shared Viewer presentation/export only | Replay saved real artifacts under the affected interaction, viewport and export conditions. Fresh source-to-diagram sessions are needed only if generation or repair behavior also changes. |
| Repository prose, metadata or unrelated CI changes | Explain why generation evidence is not applicable; use the existing focused checks. |

Run the agreed matrix once the approach is settled and the PR is ready for final review, not on every push. Classify by actual callers, not PR title or file extension. A narrower run is acceptable when the author explains the unaffected paths and equivalent existing evidence; agree on the scope in the PR before spending on runs. A later expansion needs a concrete uncovered risk. No new per-PR approval form is required.

Architecture and workflow have ready prompt variants in [prompts.md](prompts.md). For another type, agree on a natural source-backed task using the same projects before running. If a project has no meaningful instance (for example, no relational model for an ER diagram), record it as not applicable and select an appropriate public replacement task in advance. Keep five applicable projects where practical; explicitly report a smaller agreed matrix. Never invent a database, timing measurement or relationship to fill a slot. A new diagram type unsupported by base has candidate-only evidence, clearly labeled; it is not a before/after improvement.

## 2. Freeze the comparison

Copy [report-template.md](report-template.md) and record the run plan before generating:

- The suite revision, selected cases/types, full source-project commits, exact prompt text and prompt hash. Keep these identical across arms. Update the corpus through a separate reviewed revision; do not silently track project HEAD. Create clean source checkouts from those project commits, with identical tracked source and project instructions in both arms. Record checkout status once per project; keep pre-existing untracked/ignored files and generated diagrams outside the Agent-visible source tree. Record any necessary extra project instructions and supply them identically to both arms.
- The current PR target commit as **base**, and exact PR head as **candidate**. Materialize each tracked Archify revision in a separate clean local package/checkout and record its source SHA and package/tree hash. A release number alone is insufficient. Use the same preparation method for both; keep setup logs. Do not install or replace live Skills for this benchmark.
- The Agent/client version, model ID, reasoning setting, available tools, browser/runtime/OS, resource limits and concurrency. Use a contributor-accessible capable coding model; keep the configuration identical within each comparison. Results across different configurations must not be pooled as version effects.
- A common time budget, declared before launch (pilot default: 20 minutes per session). Crossing it records a timeout, not a quality score. If the budget proves unsuitable, preserve the failed run and rerun both arms under the revised limit. Use the same token/cost cap when the client offers one.

Use one active generation session at a time by default and alternate base/candidate order between projects. Parallel runs are allowed with the same concurrency policy and environment on both sides; record queueing and contention and avoid speed claims when they are uncontrolled. Download/setup happens before the generation clock and is recorded separately.

## 3. Run fresh natural-language tasks

Use a new session or a fresh subagent with only the selected project checkout, that arm's Archify entry point, the composed prompt and ordinary project instructions. A subagent must not inherit this maintenance conversation, a prior answer, or another run's context. Disable cross-run memory where possible and disclose any unavoidable shared context. Keep benchmark reports, reference diagrams and the other arm outside the generation workspace. Isolate browser/local-storage state and output directories as well as chat history.

The Agent reads source and follows that revision's Archify Skill to produce a diagram. It can validate, inspect the result, and repair naturally. Do not give it predetermined coordinates, a reference JSON, or hints about which PR behavior should improve. Preserve the requested business scope and permit layout choices. Run the project checkout read-only except for the isolated diagram output; the task does not require installing the project into a user's environment or invoking live services.

Capture the earliest complete diagram JSON **before its first validation/render attempt**, every later candidate submitted to the CLI, command arguments/results, receipts and final artifacts. Use client tool logging/file snapshots or an external recorder, not a retrospective reconstruction of the first draft. Record the capture method. If the client cannot preserve a first draft or a file revision, mark that metric unavailable and disclose the gap; never substitute the final candidate. That run can still support a final-artifact claim, but not a first-draft or complete-repair-history claim.

Retain all scheduled runs and their sessions, including failed commands, timeouts and repeats. Extra attempts receive new run IDs; a successful retry does not replace an earlier failure. If a claimed diagnostic fix never occurs naturally, report that the mechanism was not exercised. Add an original failure captured from real use when available; artificially corrupted inputs do not demonstrate Agent benefit.

## 4. Retain inspectable evidence

Each run includes:

- Original composed prompt; run metadata from [run-template.json](run-template.json).
- Exported session record with ordered messages, tool calls/results, timestamps and nested-session links/exports where used. Preserve commands, errors, edits and restarts, not just the final answer. Native exports are preferred; an event export is acceptable when its origin and completeness are stated. The session is the source record for failures and retries; no separate failure log is required. The comparison report summarizes counts and links to relevant events. Supplement only tool output or external logs that the session export omits. Private model reasoning is not required.
- First JSON, ordered attempted JSON versions, final JSON and HTML/SVG. Link CLI receipts where produced; output already preserved in the session need not be copied into a separate log. Missing output is an explicit result.
- Browser screenshots of the final artifact: light/Classic/Still, browser zoom 100%, 1440 × 900 CSS pixels, device scale 1 where supported. Retain both the initial viewport and a full-page image when needed; label any different conditions. Inspect dark mode or exports when affected. If defaults change, additionally show each version's actual default instead of hiding it behind forced settings.
- A small semantic checklist with links into the pinned source for the key nodes, directions, conditions, ownership boundaries and failure paths. Have the reviewer verify this independently of the generated JSON; do not score agreement with a reference layout.

Publish a redacted evidence bundle or durable artifact link with a digest and a retention/location note. Keep it accessible through review and the resulting release cycle. Remove tokens, credentials, private source, unrelated history and personal data; retain meaningful failures and annotate redactions. Session share links alone are insufficient when they omit tools or expire. Only publish material the contributor may disclose; a sanitization gap is reported, not filled with invented logs. A transcript aids audit but does not cryptographically prove that a run was authentic. Evidence marked complete must include reconstructible candidate revisions; if those are missing, limit the claim and list the missing evidence explicitly.

Large traces and images belong in PR artifacts or an evidence archive, not the source tree. Do not fabricate an empty JSON or screenshot for an absent result.

## 5. Compare output and authoring effort separately

For layout, renderer or validator changes, also replay the same frozen real JSON on base and candidate. Use the **final JSON from both arms** when their content differs, plus the original real failure for a bug fix. This cross-replay adds no model invocation and helps distinguish authoring choices from renderer changes. Preserve the input bytes; report unsupported new fields or a base validation failure honestly. Retain failed outputs and diagnostics; a relaxed profile may be used for an explicitly labeled diagnostic view, not a passing result.

Report these observations for each run, without collapsing them into a total score:

| Observation | Definition |
| --- | --- |
| Semantics | Reviewer outcome: correct / incorrect / unverified, with concrete source-backed findings. |
| Readability | Reviewer outcome: readable / issues / unreviewed; note clipping, route ambiguity, needless detours, unreadable text or wasted space. Automated checks are reported separately. |
| Delivery | Delivered / failed / timeout / provider error / unsupported. CLI success alone does not establish semantic or visual acceptance. |
| First draft | First captured JSON's check outcome, plus semantic/visual outcome only if inspected; unknown when not observed. A whole session with repairs is not a first draft. |
| Repair rounds | Number of revised candidates after the first check/inspection cycle, grouped with their feedback and next validation. Multiple commands on unchanged JSON do not create another repair round. Record voluntary visual revisions as well as validation-driven ones. |
| Tool work | Generation/validation tool calls, failures and repeated work, with the counting method. |
| Time | Dispatch-to-final-response wall time, time to first JSON, CLI time and queue/wait time when observable. Use null with a reason when unavailable. Overlapping child/tool durations are work totals, not additive end-to-end latency. |

The initial 10-session matrix is a diagnostic comparison, not a stable speed benchmark. Repeat the affected base/candidate pairs for a disputed regression or a speed claim; retain every repetition and report spread and completion failures alongside timing. Never advertise a percentage speedup from one pair or faster failed deliveries.

## 6. Submit and review one report

Fill [report-template.md](report-template.md). Present each project side by side with before/after screenshots and links to originals, JSON, replay and sessions. A Markdown report or static HTML page is sufficient; reviewers should not have to reconstruct the comparison from terminal logs. Put changed outcomes, regressions and coverage gaps first. Label author inspection, independent review, CI results and reused evidence separately.

Maintainers first check revision/scope/evidence completeness, inspect the comparison images and source-backed findings, then sample one session and investigate every material regression. Re-run only disputed, unavailable or invalidated evidence. When base/head changes, explain which tested paths changed; reuse unaffected results under their original SHA instead of rerunning the matrix for unrelated prose or packaging updates.

Unsupported facts, lost relationships, unreadable output or a new delivery failure need correction or an explicit maintainer decision. Intentional layout changes, pixel differences and minor timing noise are not automatic blockers. A validator disagreement can justify revisiting the validator, but retain the original failure and distinguish visual acceptance from the automated result. No aggregate score or screenshot similarity threshold authorizes a merge.

For each of the first three pilot PRs, record execution cost when available, time spent assembling evidence, maintainer review time and useful defects found. Adjust the required scope or tooling if the process costs more than it saves. Until those runs exist, this is a protocol, not an established quality baseline or a new mandatory CI gate. A contributor without suitable model access may supply an original real case and request a maintainer-assisted run; mark the evidence pending rather than inventing it.

## Existing suites

- [repair-rounds](../repair-rounds/README.md) remains synthetic diagnostic regression coverage. It cannot demonstrate real Agent mistakes, rework savings or end-to-end generation improvement.
- [ordinary-model-floor](../ordinary-model-floor/README.md) provides earlier bounded Agent-task evidence. Its historical `firstPassUsable` is task-level usability after one invocation, which can contain repairs; it must not be relabeled first-draft success.

Reuse applicable existing CLI, semantic and browser checks with their actual coverage. This protocol adds real task evidence; it does not duplicate a provider SDK, model leaderboard or a second product validator.
