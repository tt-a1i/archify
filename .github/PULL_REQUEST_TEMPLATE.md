<!-- Authors: follow CONTRIBUTING.md. Reviewers and Agents: follow REVIEWING.md. -->

## Problem and value

- Related issue / agreed discussion, or why this is a purely mechanical documentation correction:
- Actual problem on the current base, intended outcome, and why it is worth maintaining:
- Before/after evidence entry point: <!-- Link the relevant evidence below or an existing report; explain when not applicable. -->

## AI assistance and accountability

<!-- Required for every PR. See CONTRIBUTING.md#ai-assistance-and-contributor-responsibility. A short answer is enough; reuse the evidence sections below. -->

- AI use: none / writing or translation only / implementation, investigation, tests, or review assistance
- Tools and model (if known), and assisted areas:
- Accountable contributor: @handle
- Problem origin: observed usage / code inspection / synthetic probe / proposed improvement; describe briefly
- [ ] I reviewed the submitted changes and explanation, understand their impact, and can answer questions about them. Validation results and gaps are recorded below.

<!-- Personal confirmation: an Agent must leave this unchecked unless the accountable person explicitly confirms it. -->

## Stability impact

<!-- Summarize applicable PR improvement findings or why no improvement was needed; CONTRIBUTING.md#pr-improvement-check defines scope. -->

- Impact class and changed behavior/shared callers: <!-- CONTRIBUTING.md#choose-evidence-by-impact -->
- Existing behavior preserved / intended compatibility changes / failure behavior:

## Tests run

<!-- For behavior changes, apply project test-value to the affected tests and explain meaningful protection/cost tradeoffs here. -->

Comparison base and candidate head; applicable commands/results or evidence links. Identify reused evidence by its original revision and explain material coverage gaps. Follow CONTRIBUTING.md#choose-evidence-by-impact; required remote CI still applies.

<!-- Generation-chain pilot PRs: link the real-repository comparison report (benchmarks/real-repo-generation/README.md), or explain the agreed narrower scope/exemption. Include original session records and both versions' artifacts; identify synthetic checks separately. -->

## Visual evidence

Omit this section for non-visual changes.

- Evidence provided: <!-- screenshots, recordings, or reproducible steps; intended and unexpected differences -->
- Comparison conditions: <!-- same input, viewport, theme, preset, mode, zoom, page state -->
- Automated or browser checks:
- Perceptual visual review: passed / failed / skipped / Not applicable

Report automated or browser evidence separately from perceptual review.

## Generated artifacts

Omit this section if generated outputs are unaffected. Otherwise list regenerated files or linked build evidence, and explain freshness of affected outputs left unchanged.


## Release follow-up

Omit for changes without release scope. For a release, link the completed or explicitly deferred stages and evidence in the [central release checklist](https://github.com/tt-a1i/archify/blob/main/CONTRIBUTING.md#release-checklist), including the DSH decision. Do not equate PR completion with publication or deployment.
