---
name: archify
description: Create polished, validated architecture, workflow, sequence, data-flow, and lifecycle/state diagrams as explorable standalone HTML with inline SVG, dark/light themes, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export. Accept plain-language requirements or pasted Mermaid flowchart, sequenceDiagram, and stateDiagram input; inspect repository evidence when the diagram must reflect real code. Use when the user asks to visualize system architecture, infrastructure, cloud/security/network topology, technical workflows, API call sequences, request lifecycles, data pipelines, ETL/ELT, data lineage, state machines, or to convert/beautify Mermaid.
license: MIT
metadata:
  version: "2.17"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify

Create an interactive HTML diagram from typed JSON. Static output is the default; enable motion only when requested.

Run commands from your working directory, keeping candidate JSON and output artifacts there. Replace `bin/archify.mjs` in the commands below with the installed package's absolute path, or its path relative to your working directory; input and output paths resolve from that working directory.

For a real codebase, read [Repository authoring](references/repository-authoring.md) while tracing the requested behavior. A system description uses the steps below; an existing JSON uses the handoff path.

## Existing candidate handoff

When the user supplies a frozen candidate, run `finalize` first as one CLI invocation. Its passing receipt completes the automated gates; follow any visual review recommendation under Delivery before claiming visual quality. For repair, follow step 5.

The optional update check never delays `finalize`; see Update awareness.

## Fast authoring path

Use this path for ordinary generation. Read branch references only when their stated trigger applies.

1. Choose `architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle` from the question.
2. Use the exact schema and example paths in the Type router without listing their directories. Read [Authoring defaults](references/authoring-defaults.md) and the mode's example in a bounded batch separate from project documents and complete schemas so neither is truncated; recover any missing section before writing. For Architecture, use the matching showcase example. For Sequence, Dataflow, and Lifecycle, also read the mode and common schemas. Read the relevant schema definition before choosing any new field, enum, or constrained text, especially boundary kinds and guided-view notes. Examples teach shape, not facts. Use fresh IDs, wording, and layout. Go directly to the candidate without preliminary help, doctor, starter validation, temporary diagrams, or output-path listing. Query brands only for an explicitly requested mark; read [Brand marks](references/brand-marks.md) for an unknown mark with a user-provided URL.
3. Once the requested scope and, for a real codebase, [source evidence](references/repository-authoring.md) are covered, write the complete candidate directly without planning coordinates in prose. Choose Architecture abstraction and connected placement using Authoring defaults before coordinates: show the main user journey and necessary branches, preserve control roles and behavior-changing conditions, and leave enough room for actual relationship labels. No node, relationship, source, view, card, or boundary count is a target or ceiling. Use automatic routes first; add explicit routing only for necessary branch, return, supplied geometry, or measured repair. Set `meta.quality_profile` to `"showcase"` unless the user requests dense `standard`.
4. Once the complete first candidate is written, run `finalize` directly. Its first gate is showcase validation; successful first drafts need no separate pre-validation. Keep the candidate unchanged while the command runs:

   ```bash
   node bin/archify.mjs finalize <type> <candidate.json> <output.html> --quality showcase --json
   ```

   For a repository-backed candidate, include evidence on the first draft and use the complete first command: `node bin/archify.mjs finalize <type> <candidate.json> <output.html> --repo-root <repo-root> --quality showcase --json`.

   A passing receipt proves the included `validate`, `deliver`, strict `check`, and real-browser `browser-check` gates passed. Use its compact summary; run standalone commands only for a separate request or focused failure diagnosis.

5. A non-zero exit is never success. Read compact stdout or `evidence.summaryReceipt`, then [repair the failed gate](references/delivery-contract.md#failed-finalize-and-candidate-repair), including its repair limit. Preserve requested meaning and source evidence. For several tangled Architecture routes, read [Architecture layout repair](references/architecture-layout-repair.md); for measured field or geometry failures, read [Authoring contract](references/authoring-contract.md). Edit the connected neighborhood and rerun the complete `finalize` command from step 4. If an earlier candidate at the same HTML path was delivered successfully, choose one fresh `--out-dir` for the revised `finalize` and any following `visual-check`; old browser evidence is tied to the previous artifact.

## Update awareness

After the first candidate exists, a harness with true parallel tool calls may run `scripts/check-update.mjs` once alongside `finalize`. Otherwise skip it without delaying delivery.

- For `silent`, continue without mentioning the update check.
- For `update_available`, read `references/update-awareness.md`, follow it, then continue the requested task.

Before the first candidate, use the authoring references and relevant repository source, not Archify implementation or tests. Inspect Archify implementation if diagnostics remain unactionable after focused repairs.

## Type router

| Type | Use for | Schema | Example |
|---|---|---|---|
| `architecture` | Components, services, cloud/security boundaries, infrastructure | `schemas/architecture.schema.json` | System descriptions, services, libraries, and CLI repos: `examples/web-app.architecture.json`; deployment repos: `examples/production-deployment.architecture.json` |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD | `schemas/workflow.schema.json` | `examples/agent-tool-call.workflow.json` |
| `sequence` | API call chains, request lifecycles, async traces, returns | `schemas/sequence.schema.json` | `examples/cache-miss-request.sequence.json` |
| `dataflow` | Pipelines, ETL/ELT, lineage, governance, consumers | `schemas/dataflow.schema.json` | `examples/product-analytics.dataflow.json` |
| `lifecycle` | State/status transitions, retries, waiting and terminal states | `schemas/lifecycle.schema.json` | `examples/deployment-release.lifecycle.json` |

When ambiguous, run `node bin/archify.mjs guide "<scenario>" --json`. Scenario proof examples are structural references, not facts to copy.

## Mermaid input

Read Mermaid for topology and meaning, then author fresh Archify JSON; do not mechanically render Mermaid styling.

- `flowchart` / `graph` → `workflow`, or `architecture` for a component map.
- `sequenceDiagram` → `sequence`; participants become semantic participants and arrows become messages.
- `stateDiagram` → `lifecycle`; states and transitions retain meaning, not Mermaid style.

## Delivery

Use the `finalize` command above for the first candidate and after a repair.

`finalize` stops at the first non-passing gate. Its compact stdout and `<output-stem>.finalize-summary.json` are ordinary evidence. A passing run creates no screenshots and reports `visualReview: "not-requested"`.

Perceptual review is optional for ordinary generation, including a newly positioned Architecture. Use [Optional capture evidence](references/delivery-contract.md#optional-capture-evidence) when the user requests visual review, during development audits, or for a concrete route/browser concern. `visualReviewRecommendation` does not change the machine exit code. For a showcase Architecture, a reported crossing between ordinary relationships is an unresolved composition defect: trace the named edges and reflow their connected scene before declaring the drawing finished. Do not accept a crossing solely because its labels remain legible. Follow the bounded repair path in [Architecture layout repair](references/architecture-layout-repair.md); if it remains after that path, report the visible limitation instead of claiming visual quality. Captures are useful evidence but are not required to identify the reported crossing. Inspect captures before claiming visual quality; otherwise report automated checks only.

Read [Delivery contract](references/delivery-contract.md) for failed gates, standalone commands, provenance/recovery, repeated delivery, exports, or opening. Recovery follows `deliver` → strict provenance `check` → `browser-check`; captures require strict provenance.

For workflow viewport overflow, read [Workflow viewport repair](references/authoring-contract.md#workflow-viewport-repair) before the next layout edit.

Report artifact checks, browser evidence, captures, and actual perceptual review as distinct results. For an explicitly requested immediate preview or active desktop loop, see [Optional opening](references/delivery-contract.md#optional-opening).

## Optional viewer capabilities

`meta.animation: "trace"` is opt-in. Use optional `meta.views` for distinct reader questions, with no numeric target.

Read `references/viewer-runtime.md` only when the user explicitly asks for Share Cards, Route/Reach cards, motion, guided stories, deep links, presentation, search/focus, or another Viewer Runtime feature.

## Setup and fallback

No install is required inside the skill package. For setup diagnosis, verify with:

```bash
node bin/archify.mjs doctor
node bin/archify.mjs demo <output-directory>
```

When shell access is unavailable, hand-place architecture SVG into `assets/template.html`, use CSS semantic classes rather than inline colors, and follow the visual review contract in `references/delivery-contract.md`.

## Output

Return the checked HTML path, diagram type, validation summary, specification/artifact receipt, browser-evidence status, and truthful visual-review status. Do not claim success for a non-zero command or claim visual inspection you did not perform.
