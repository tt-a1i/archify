# jq defaults: preserve the difference between false, null and a missing key

[Candidate page](candidate.html) · [Candidate draft](candidate.archify.md) · [Author page](author/answer.html) · [Probe](probe.py) · [Actual probe output](probe-output.json) · [Pinned sources](sources.json)

Round 20 adds a Chinese/editorial explainer around a concrete result: `.enabled // true` produces `true` when the object explicitly contains `false`. The candidate keeps the three default policies visible on a phone and provides copyable commands that reproduce their displayed outputs. This is an authored reading experiment on the frozen runtime at `8ccb79ff716b6b53afd8be76415c9c8c97d62a53`, based on dev `5ecbd1bfdbf83ea747072112493c940e707569cb`. No product runtime, authoring rule or package changed.

## Sources and actual behavior

The installed `/usr/bin/jq` reports `jq-1.7.1-apple`. Upstream reference is jq 1.7.1 at `71c2ab509a8628dbbad4bc7b3f98a64aa90d3297`. The Apple version label does not establish binary identity with that upstream commit. The source describes intended upstream behavior; the probe independently records this executable's results.

The 24-case probe records exact argv, stdout, stderr and exit status. It reads no user files, changes no configuration and makes no network requests. Exact serialized assertions distinguish `false` from numeric zero. Two runs produced byte-identical JSON. The packet was pushed at `8ccb79ff7` before independent authoring, and its immutable remote contents were verified.

- Individual `false`, `null` and an empty left-hand result stream trigger the fallback. Zero, an empty string, an empty array and an empty object remain values. `empty` produces zero output values; `null` and `[]` each produce one.
- For the constructed objects, `.enabled // true` replaces explicit `false`, explicit `null` and a missing key. Reading a missing object key yields `null`.
- `.enabled | if . == null then true else . end` retains `false` and defaults null/missing values. `if has("enabled") then .enabled else true end` defaults only a missing key, retaining explicit `null` too. These filters return values, without editing an input file.
- `(false, null, 0) // "fallback"` produces only `0`. Piping the three values through `. // "fallback"` produces two fallback strings followed by zero. The operator handles its complete left-hand stream, which can contain multiple results.

The [pinned manual](https://github.com/jqlang/jq/blob/71c2ab509a8628dbbad4bc7b3f98a64aa90d3297/docs/content/manual/v1.7/manual.yml#L2405-L2460), grammar, `gen_definedor` compiler and false/null runtime branch support these claims. The [source packet](evidence/source-packet.md) records an inconsistent sentence in that manual; the formal definition, examples, source and local stream pair agree on the behavior above. No upstream edit or message was sent.

## Authorship and retained attempts

The tuning Skill's independent-author workflow used a separate gpt-6.1-terra/medium agent with the fixed source packet and runtime. Its first draft and first HTML are byte-preserved under [author/](author/). The first finalize receipt passes validate, deliver and check, with no diagnostics; its wrapping zsh command then failed because `status` is a read-only variable. The author made no repair and performed no browser review. [Author notes](author/author-notes.md) distinguish the receipt from that shell failure.

Parent source and browser review found a 492.75 px table in a 358 px phone container, with the missing-key policy offscreen. Three commands also needed horizontal scrolling. The opening describes a single `false` case more directly in the candidate; the full stream rule remains beside the examples.

The [first parent candidate](first-candidate/candidate.archify.md) shortened four headers and removed repeated “retained” badges. It still measured 432 px in the same 358 px container. [Screenshot](screenshots/candidate-390-light-policy.png). This intermediate is rejected. The two-column candidate states all nine input/policy outcomes in three rows. Its missing-only example uses explicit `null`, making that policy's distinction visible in the command output.

The parent's first finalize invocation used nonexistent `--strict-sources` and failed at argument parsing. [Failure](evidence/candidate-finalize-1.log). The corrected invocation uses documented `--writing strict`. No authoring failure is hidden by the successful later result.

## Observed layout and execution

Matching views use editorial style, 390/1440 × 900 viewports and both light/dark themes. The six author screenshots, ten final screenshots and the rejected intermediate screenshot are retained in [screenshots/](screenshots/). Parent inspected each of those selected captures. The final stream captures also show the scope note and source list. Metrics: [author](evidence/browser-01.json), [rejected](evidence/browser-02.json), [candidate](evidence/browser-03.json).

| Observation | Author | Candidate |
| --- | --- | --- |
| Phone table / container width | 492.75 / 358 px | 358 / 358 px |
| Phone code requiring horizontal scroll | 3 of 5 | 0 of 5 |
| Phone conclusion height | 483.48 px | 449.48 px |
| Phone policy panel height | 583.04 px | 790.24 px |
| Desktop policy panel height | 558 px | 679 px |

The candidate costs more vertical space. The two-column prose is also less compact than a full matrix on desktop. The retained choice prioritizes complete phone comparison and copyable examples for this page; it does not establish a universal table rule or measured comprehension improvement.

All five actual copy buttons were clicked at 390 px. The Clipboard API payloads exactly match rendered code. Each reviewed jq-only payload was run with `/bin/zsh -f` in a fresh temporary directory: outputs were `true`, `false`, `null`, `0`, and the three values `"fallback"`, `"fallback"`, `0`. Every command exited 0 with empty stderr. [Captured text](evidence/copied-commands.json) · [Execution results](evidence/copied-command-results.json) · [Runner](evidence/run-copied-commands.py). The browser intercepted `navigator.clipboard.writeText`; this verifies the handler's payload, not the macOS clipboard service.

The canonical candidate at this repository path passes [strict finalize](candidate.finalize-summary.json) and a separate [required-provenance check](evidence/candidate-check.json). Archived author and first-candidate receipts retain their original paths and bytes. They are historical generation evidence, not new provenance acceptance at the copied archive paths. The final candidate was generated directly at its current path.

The review index switches between the author and candidate and between 390/1440 px widths. [Interaction record](evidence/index-interaction.json). All 44 distinct local targets referenced by its static markup and case data exist, and the case README links resolve. [Verification summary](evidence/verification.json). Dev was fetched again before this batch; it remains the base above and an ancestor of the feature branch.

## Reproduction and limits

Run `python3 docs/experiments/explainer-reading/jq-default/probe.py` from the repository root. The command runner can be rerun as `python3 docs/experiments/explainer-reading/jq-default/evidence/run-copied-commands.py`; it checks the saved copied text before executing the five jq-only commands. A different jq build reports its own version. To regenerate the page, use `node archify/bin/archify.mjs finalize explainer docs/experiments/explainer-reading/jq-default/candidate.archify.md /tmp/jq-default.html --writing strict --json`.

The real-repository five-project generation pilot covers architecture/workflow generation. This round is a new explainer author task followed by parent edits on one frozen renderer; it is not a paired generation benchmark or a speed measurement. It has no human-reading acceptance, full browser-gate result, Windows shell check, print/export run, performance result or final-head remote CI acceptance. It covers JSON objects and constructed values, not invalid input types or a production configuration workload. Relevant checks are source/command agreement, strict artifact delivery, copy behavior and visual inspection; no unrelated renderer suite or archive rebuild is needed for this content-only round.
