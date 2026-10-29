# Explainer reading laboratory

Experimental branch, authorized by the maintainer's 2026-10-29 request to explore clearer, more attractive explainers from latest `dev` and push the results to a remote branch. This is not a request for final review or merge.

Base: `5ecbd1bfdbf83ea747072112493c940e707569cb`.

## Questions and bounded plan

1. Can a Chinese SQLite WAL explanation distinguish concurrent reads/writes from checkpoint progress without hiding the exception?
2. Can an English Go singleflight explanation distinguish duplicate suppression, caching and forgetting an in-flight key?
3. Does the current writing rule reject useful local qualifications and encourage moving necessary context away from its claim?

Two independent discovery authors use gpt-6.1-terra, medium reasoning, with a 15-minute budget per case. They use the unchanged base runtime, preserve their first draft and actual failures, and cite primary sources. Parent review checks source claims and desktop/mobile screenshots before selecting changes. These are parallel discovery practices, not controlled base/candidate generation runs or speed measurements.

The writing-rule experiment uses the same authored input on base and candidate. Scope is removal of a demonstrated false-positive phrase rule; keep sentence/paragraph length, vague quantities, source resolution and all diagram contracts. No new scoring heuristic. The existing real-repository generation pilot concerns architecture/workflow authoring: this exploratory branch does not claim that benchmark or general generation gains. A broader benchmark and human acceptance remain unperformed.

Existing open work checked before implementation: #1015 (visual hierarchy, metrics, steps and source cards), #1076 (mobile menus), #1142 (claim attribution), #1144 (dependency preview), #1108 (placement indexing), #1152 (locale). This experiment does not implement those features or change their branches.

## Evidence

Case directories retain authored Markdown, delivered HTML, receipts and source/repair notes. Machine delivery does not establish factual correctness or visual acceptance. Screenshots and inspection results are recorded after the drafts exist. Unsupported claims are corrected in the candidate, never retroactively in its first draft.

## Results — 2026-10-29

| Practice | Inspectable result | What changed |
| --- | --- | --- |
| SQLite WAL, Chinese/editorial | [Page](sqlite/candidate.html), [draft](sqlite/candidate.archify.md), [source audit](sqlite/notes.md) | Shorter conclusion; only two complementary reasons; reading steps beside the architecture; checkpoint modes in a table. Removed redundant architecture edge labels after the browser measured them below 10 px; the adjacent steps preserve their meaning. |
| Go singleflight, English/clean | [Page](singleflight/candidate.html), [draft](singleflight/candidate.archify.md), [source audit](singleflight/notes.md) | Ordinary duplicate suppression comes first; `Forget` has its own table instead of being mixed into a six-participant sequence. The first draft's blocked-caller storytelling mistake is preserved and corrected. |
| Local qualifications | [Base strict failure](singleflight/base-strict.json), [candidate strict delivery](singleflight/candidate-strict.json) | The identical final singleflight draft is rejected by base for “illustrative” and “not measured”. Removing the blanket phrase rule permits this truthful local caption without switching writing checks off. |

Runtime fix: `553bf9411`. Canonical archive refresh: `713697902`. Neither renderer nor reader CSS/JavaScript changed. The authoring guide now distinguishes page-wide scope from local assumptions and uncertainty. No schema, theme, layout or source-attribution feature was added.

### Visual comparisons

These compare authored versions, not a renderer A/B test. Both versions use the same renderer; singleflight also changes its authored style from editorial to clean. Parent inspection found the candidate hierarchy clearer, but no human comprehension study was run.

| Case | Before parent review | Candidate |
| --- | --- | --- |
| SQLite, 1440 × 900, light | ![SQLite before](screenshots/sqlite-before-review-1440-light.png) | ![SQLite after](screenshots/sqlite-candidate-1440-light.png) |
| singleflight, 1440 × 900, light | ![singleflight before](screenshots/singleflight-before-review-1440-light.png) | ![singleflight after](screenshots/singleflight-candidate-1440-light.png) |

The final singleflight sequence panel is 637 px high versus 810 px before review at the recorded viewport; its local illustration caption adds height compared with the intermediate 596 px version. This describes the case, not a quality score. [Metrics](visual-metrics.json) also record 390 px light and 1440 px dark states. Themes were selected through the actual reader controls; a URL query alone did not change the theme and was not accepted as dark-mode evidence. Final captures replace those incorrect preliminary captures.

Bottom-of-page captures ([SQLite](screenshots/sqlite-candidate-1440-bottom.png), [singleflight](screenshots/singleflight-candidate-1440-bottom.png)) were inspected for the remaining tables and checklists at 1440 × 900. Both checklist inputs could be clicked and checked; [interaction results](interaction-results.json) do not establish keyboard traversal.

### Validation and limits

- The new regression expectations fail on base: **20 pass, 2 fail**, both failures caused by the qualification rule. [Actual output](base-regression.log).
- Writing, validation, layout and CLI focused suites: **40 pass, 0 fail, 0 skipped**. [Actual output](candidate-tests.log). Tests preserve other strict-mode diagnostics; they do not require a particular implementation of the phrase rules.
- Core public CLI suite: **19 pass, 0 fail, 0 skipped**. [Actual output](core-tests.log).
- Generated-output checks pass. [Actual output](generated-tests.log). No Viewer/schema/generated-example inputs changed; no unrelated gallery rebuild was needed.
- `archify.zip` rebuilt with official Node **22.23.3**, bundled zlib **1.3.1-e00f703**. The extracted archive, outside the repository, successfully finalized the qualification case in strict mode. [Package smoke](package-smoke.json). This is a macOS CLI check, not Windows or live-install acceptance. No live installation was modified.
- Both final candidates pass strict finalize's validate/deliver/check stages; browser acceptance is separate. Source claims were checked against the linked primary materials, with Go pinned to a commit and SQLite documentation live as noted in its audit.
- **Full browser gate is not green.** SQLite's first browser run reported 12 readability diagnostics and 28 keyboard-traversal diagnostics. After removing duplicate small edge labels, all readability diagnostics disappeared; 28 keyboard-traversal diagnostics remain across the checked states. [Before](sqlite/browser-before-label-repair.json), [after](sqlite/browser-check.json). The symptoms resemble existing #1124, but this experiment did not establish that PR fixes this case. The reports reference local screenshot sidecars retained under the tuning round; the selected screenshots committed here remain independently viewable.
- At 390 px, the English toolbar produces `scrollWidth=401` for `innerWidth=390`; SQLite's Chinese page stays at 390. Narrow toolbar work already exists in #1076. Singleflight's four-party preview is small on a phone; the interactive Viewer remains available. These remain known limitations, not successful mobile acceptance.
- No fresh five-project benchmark, human acceptance, Windows gate, full regression suite, or final-head remote CI acceptance is claimed. This branch is an experimental candidate, not integration-ready solely because local checks pass.

The test-value check retained existing protections and changed the former test that enforced the misleading qualification ban. No new dependency, state machine or abstraction was introduced, so no broader simplification was warranted. The guidance edit was checked against writing-for-agents: the local/page-wide distinction lives beside the evidence rule, and the removed rule is no longer advertised in delivery guidance.

### Reproduce and continue

From the repository root, run `node archify/bin/archify.mjs finalize explainer docs/experiments/explainer-reading/<case>/candidate.archify.md /tmp/<case>.html --writing strict --json` for `sqlite` or `singleflight`. The package smoke used the same singleflight input. Browser checks use the public `browser-check` command with a discovered Chrome binary; do not suppress its failures.

First drafts and all substantive failure receipts are preserved. Initial first-draft HTML files were not retained; their source can be replayed, but regenerated output must not be described as the original capture. The notes are author records, not complete exported agent transcripts.

Next worthwhile experiments: compare an equivalent phone-readable explanation using sequential steps versus a wide sequence; evaluate #1076 and #1124 against these exact drafts after their owners' changes are ready; test the local-qualification guidance with fresh independent authors before claiming a general reduction in repairs. Stop adding heuristics when source-backed case edits solve the reading problem.

AI disclosure: Codex performed research, source inspection, writing-rule implementation, tests, artifact authoring and visual inspection. The two independent discovery authors used gpt-6.1-terra with medium reasoning. No human review is claimed.

## Continued exploration — round 2

The user explicitly requested ongoing work on 2026-10-29; the first round is not the end of the goal. See [phone-preview round 2](phone-preview/README.md) for the mobile diagram experiment, export repair, source-backed Redis and TaskGroup pages, actual failures, and verification limits. Runtime change: `b670b5d4d`. No merge or live-install action is implied.

## Continued exploration — round 3

- [SQLite measured mechanism](sqlite-probe/candidate.html): an isolated temporary database demonstrates old-reader A/new-reader B and checkpoint progress, with a reproducible script, two actual runs and pinned raw output links. Frame counts are explicitly case-specific.
- [12px phone-label experiment](phone-labels/README.md): text grew, but the extra scrolling hid more of the exchange. Checks passed; visual comparison led us to reject this additional default and retain round 2's behavior. The patch and candidate remain inspectable.

These are ongoing exploration checkpoints. No overall-goal completion, human acceptance, merge or installation is claimed.

## Continued exploration — round 4

[Git restore paired experiment](restore-pair/README.md): a short-table-label instruction failed to improve the phone table. The preserved independent pair led to a separate two-column content repair, verified against the pinned Git manual and a disposable-repository probe. The candidate instruction remains unadopted; a remaining split command separator is the next bounded reader problem.

## Continued exploration — round 5

[Inline command wrapping](inline-code/README.md): the candidate preserved short flags and passed 33 focused tests, but left Chinese punctuation alone on a line. It was rejected after visual review; the experimental patch and actual results remain available, and the adopted runtime is unchanged.
