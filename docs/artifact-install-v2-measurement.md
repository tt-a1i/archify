# Artifact → Install v2 measurement contract

Artifact → Install v2 is a bounded change to the existing journey. Proof Lab cards link to `start.html?type=<type>&source=gallery`, and the Start page selects the matching typed recipe and can copy the selected agent's installation request plus the bounded first-use prompt in one action. Generated artifacts no longer emit the former footer link; `source=artifact` remains accepted only for compatibility with already-shared artifact URLs.

The page records only coarse interaction steps:

- `start_view`
- `starter_copy`
- `global_install_copy`
- `project_install_copy`
- `agent_install_prompt_copy`
- `prompt_copy`
- `proof_open`

Each event contains `schemaVersion`, `step`, the allow-listed source, diagram type, agent, and language. It never contains a repository path, diagram title, prompt text, node, relationship, source JSON, or user identifier. Unknown source values are normalized to `direct`.

## Privacy boundary

Events are capped at the latest 24 entries in `sessionStorage` under `archify.start.events.v1`. The page also dispatches the same detail as the `archify:start-funnel` browser event and exposes a read-only snapshot through `window.ArchifyStartMetrics.snapshot()`.

**No network request is made by Archify.** The page contains no `fetch`, `sendBeacon`, or XHR path. Closing the browser session discards the local receipt. A hosting operator must not attach an external event sink without a separate privacy decision, public disclosure, retention policy, and test update.

## Observable metrics

Within a controlled browser test or an explicitly instrumented host, compute:

- Legacy artifact arrival share: `source=artifact` `start_view` / all `start_view`
- Gallery arrival share: `source=gallery` `start_view` / all `start_view`
- Combined starter copy rate: `starter_copy / start_view`
- Agent installation prompt copy rate: `agent_install_prompt_copy / start_view` (scope is not selected yet)
- Any install copy rate: sessions with at least one of `starter_copy`, `agent_install_prompt_copy`, `global_install_copy`, or `project_install_copy` / sessions with `start_view`
- Prompt-only copy rate: `prompt_copy / start_view`
- Proof reassurance rate: `proof_open / start_view`

The two terminal events describe only their respective global/project commands. Agent prompt copies do not imply either installation scope.

Count at most one occurrence of each step per browser session when reporting conversion, even though the local diagnostic receipt retains repeated clicks. Segment only by the allow-listed source, type, agent, and language.

## What this does not prove

**First-diagram success is not observable from this static page.** A successful copy is an intent signal, not proof that installation completed, the agent generated a candidate, validation passed, or the user retained Archify. Do not label these ratios “activation,” “success,” or “retention.”

The Ordinary-Model Floor benchmark measures candidate quality independently. A future end-to-end activation metric would require an explicit, privacy-reviewed receipt boundary at the installed CLI or a voluntary user submission; it must not be inferred from Start-page clicks.

## Evaluation window

Before publishing a conversion claim:

1. Pin the repository commit and the exact v2 UI.
2. Validate the event contract in a real browser for artifact, gallery, direct, and rejected unknown-source URLs.
3. If an approved aggregate sink is later added, run a predeclared observation window and publish both session counts and rates; do not compare against a historical period that lacked equivalent instrumentation.
4. Keep deterministic page tests, package tests, and visual review as release gates regardless of copy rate.

Until an approved aggregate sink exists, the event receipt is for local QA and experiment readiness only.
