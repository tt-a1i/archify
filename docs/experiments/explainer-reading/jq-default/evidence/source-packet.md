# jq explainer source packet

Audience: Chinese-speaking developer who can read JSON and shell commands but may not know jq's result-stream rules. Question: why can an explicit false still produce a true default?

Local probe and verified source manifest are in /Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/jq-default/. Read README.md, probe.py, probe-output.json, sources.json. They are read-only. All24cases ran twice with identical output. The local binary reports jq-1.7.1-apple, distinct from upstream pinned71c2ab509a8628dbbad4bc7b3f98a64aa90d3297.

Public immutable probe URL: https://github.com/tt-a1i/archify/blob/8ccb79ff716b6b53afd8be76415c9c8c97d62a53/docs/experiments/explainer-reading/jq-default/probe-output.json
Public source manifest: https://github.com/tt-a1i/archify/blob/8ccb79ff716b6b53afd8be76415c9c8c97d62a53/docs/experiments/explainer-reading/jq-default/sources.json
Manual URLs and exact source line ranges are in sources.json. Prefer the definition/examples and verified probe; do not copy the manual's inconsistent per-value sentence noted in the audit.

Use exact commands/outcomes from the probe, or run an additional constructed case and retain its output. For ordinary object-field reading, the explicit false case, null-only policy and missing-only policy are particularly useful. empty means no output, not [] or null. The complete-stream and per-value forms differ; any broad statement about // must remain accurate. These are filters producing results, not input-file edits. POSIX shell quoting is sufficient; do not claim Windows command-line verification.

Use existing explainer components only. Choose a clear, compact narrative and responsive layout; diagrams are optional and must add explanatory value. No performance, production, human-comprehension or universal-version claims. No external messaging, source edits, installation or publication.
