---
name: archify
description: Create polished architecture, workflow, sequence, data-flow, and lifecycle diagrams as validated standalone HTML with inline SVG, themes, motion, and image/video export. Accept plain-language or Mermaid input and inspect repository evidence for real code. Use when the user asks to visualize system architecture, infrastructure, workflows, API sequences, request lifecycles, data pipelines, state machines, or to beautify Mermaid.
license: MIT
metadata:
  version: "2.17"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify

Create an interactive HTML diagram from typed JSON. Static output is the default; enable motion only when requested.

## Existing candidate handoff

When the user supplies a frozen candidate, run `finalize` first as one CLI invocation. Named gates describe outcomes, not four commands unless explicitly requested. A passing receipt completes the ordinary handoff without screenshots or an image-capable model. If repair is needed, validate once after the edit, then rerun `finalize`.

The update check is outside the delivery critical path. A harness may start it concurrently with `finalize`; if it cannot, omit it for this task. Never add a foreground tool turn or delay a required gate for update information.

## Fast authoring path

Use this bounded path for ordinary generation. Do not read the optional Viewer Runtime reference unless the user asks about those features.

1. Choose `architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle` from the question.
   For a repository, run `node bin/archify.mjs inspect-repo <repo-root> --json`; read `level1.boundaries`, then follow `coverage.nextArguments` and `references/authoring-defaults.md`.
2. Use the exact paths in the Type router; do not list `schemas/` or `examples/` first. For Architecture, read `references/authoring-defaults.md` and the matching showcase example in one parallel batch; it includes boundaries, guided views, and conclusion cards. For Workflow, read defaults and its starter together. Read the Architecture or Workflow schema plus `schemas/common.schema.json` only for a field absent from that example or after a schema diagnostic. For Sequence, Dataflow, and Lifecycle, read defaults, schema, common schema, and example together. Fresh authorship means new IDs, domain wording, and layout; examples provide shape, not facts. Do not run help, doctor, validate a starter, create a temporary diagram, pre-create/list output paths, or query brands. Only for explicitly requested branded marks may you query `node bin/archify.mjs brands "<name>" --json`; read `references/brand-marks.md` only for an unknown brand with a user-provided URL.
3. Artifact first: the next tool action must write the candidate; do not plan coordinates in prose. Let the real system determine the number of nodes and relationships: keep separate nodes when merging would hide a responsibility, boundary, trust boundary, protocol, lifecycle, ownership, or persistence seam; group only unified concerns. Never use node, relationship, source-reference, view, card, or boundary counts as an authoring target, ceiling, or performance lever. Audit responsibility ownership rather than counts: keep an evidence-backed controller, broker, runtime, or supervisor separate when it manages multiple participants and merging would hide control-plane ownership or lifecycle. Keep an external caller or client separate from the gateway, relay, or service when source distinguishes runtimes or trust; a transport is not its user. Never use shared source citations as a substitute for an omitted role; omit only roles absent in code. For a repository showcase, add curated `meta.views` for distinct reader questions and evidence-backed conclusion cards for material takeaways; every aid must improve comprehension, with no quota. Set `meta.quality_profile` to `"showcase"` unless the user requests dense `standard`. Keep forward flow monotonic where practical, branches beside their owner, shared stores outside the main lane, and feedback paths on the perimeter; wrap broad systems into meaningful rows. Leave clear gaps for actual relationship labels and add whitespace rather than route controls. On the first draft, let the renderer route every connection: omit `via`, `route`, `fromSide`, `toSide`, `channelX`, `channelY`, `labelAt`, `labelDx`, `labelDy`, and `labelSegment` unless the user supplied that exact route intent. Add the smallest control only after a measured diagnostic.
4. Once the complete first candidate is written, run `finalize` directly. Its first gate is showcase validation; successful first drafts need no separate pre-validation. Keep the candidate unchanged while the command runs:

   ```bash
   node bin/archify.mjs finalize <type> <candidate.json> <output.html> --quality showcase --json
   ```

   For a repository-backed candidate, include evidence on the first draft and use the complete first command: `node bin/archify.mjs finalize <type> <candidate.json> <output.html> --repo-root <repo-root> --quality showcase --json`.

   A passing receipt proves that the included `validate`, `deliver`, strict `check`, and deterministic real-browser `browser-check` gates passed. Do not read its full sidecar or rerun individual commands afterward; use a standalone command only for an explicitly separate execution or focused failure diagnosis.

5. A non-zero exit is never success. Use its compact stdout or `evidence.summaryReceipt`; read the full receipt only if the summary is truncated and lacks enough evidence for a coherent repair. After a validation failure, the next action is the smallest coherent local edit named by that evidence, not prose coordinate exploration or whole-candidate replacement. Do not run validate, layout, render, or finalize first; edit the existing JSON in place. Geometry never authorizes deleting or merging a source-backed component, relationship, reference, view, card, boundary, or semantic label; reroute, reposition, or add readable canvas space instead. Then run exactly one `validate <type> <candidate.json> --quality showcase --json`; every repository-backed validation must also include `--repo-root <repo-root>`. Do not first run validation without the repository root. Use `--layout-json` before the edit only when compact evidence lacks needed geometry. A receipt with only 4 artifact checks is basic validation: require all 9 checks with 0 composition errors and 0 warnings. Fix `meta.quality_profile` before geometry. For workflow v2, use the stable compiler receipt; solver internals are not authoring controls. A passing validation returns `candidateFrozen: true`; do not edit, revalidate, or reread it. Run its `nextAction.arguments`, replacing only `<output.html>`. Repair a later gate without changing the frozen candidate, then rerun `finalize`. If one issue survives two focused repairs, inspect measured geometry or the relevant contract; after one evidence-based retry, stop truthfully. A lower error count never justifies changing meaning.

## Update awareness

After the first candidate exists, a harness with true parallel tool calls may run the packaged checker `scripts/check-update.mjs` once alongside validation or `finalize`. Otherwise skip it; do not serialize it into the user's delivery path. If the checker cannot run, continue without mentioning it.

- For `silent`, continue without mentioning the update check.
- For `update_available`, read `references/update-awareness.md`, follow it, then continue the requested task.

Do not read `bin/` implementation, renderer or validator source, tests, or benchmarks before the first candidate; the commands above are sufficient. Inspect implementation only for a diagnostic without actionable evidence or after two focused repairs fail.

## Type router

| Type | Use for | Schema | Example |
|---|---|---|---|
| `architecture` | Components, services, cloud/security boundaries, infrastructure | `schemas/architecture.schema.json` | `examples/web-app.architecture.json` |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD | `schemas/workflow.schema.json` | `examples/starter.workflow.json` |
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

Run the complete acceptance path directly on a first candidate, or after standalone validation completes a repair loop:

```bash
node bin/archify.mjs finalize <type> <candidate.json> <output.html> --quality showcase --json
```

`finalize` stops at the first non-passing gate. Its compact stdout and `<output-stem>.finalize-summary.json` are the normal evidence; `<output-stem>.finalize.json` is full audit detail, not ordinary repair context. A passing handoff reports `visualReview: "not-requested"` and creates no screenshots.

Escalate to perceptual review only when the user requests an aesthetic review, a template/renderer/viewer change needs visual regression evidence, a novel layout or browser diagnostic leaves low confidence, or the run is a sampled audit. Run `visual-check` on the finalized artifact, inspect its `.visual-check.contact.png` once with a capable image reader or human, and record that judgment separately. Open an individual viewport PNG only when the contact sheet shows a possible defect. Model image capability is optional because this path is not part of ordinary acceptance.

For recovery, the required order stays `deliver` → strict provenance `check` → `browser-check`. Run optional `visual-check` only against a strict-provenance artifact. Read `references/delivery-contract.md` for standalone syntax, any failed gate, stale provenance, recovery metadata, repeated delivery to one path, export evidence, or post-delivery opening.

For workflow viewport overflow, read [Workflow viewport repair](references/authoring-contract.md#workflow-viewport-repair) before the next layout edit.

`browser-check` collects machine-readable browser evidence from the exact delivered HTML without modifying, rerendering, or capturing it. `visual-check` is the capture-producing command for an escalated perceptual review.

Keep the claims separate: `deliver` proves deterministic artifact checks, `browser-check` proves bounded behavior in a real browser, `visual-check` adds artifact-bound captures, and perceptual review requires an actual human or image-capable reviewer. Report optional perceptual review only when it was requested or triggered by the escalation rules above.

Add `--open` only when the user wants an immediate local preview. For an active desktop authoring loop, the optional command is:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Never start preview by default.

## Optional viewer capabilities

Generated HTML already contains theme switching, pan/zoom, search, focus, relationship tracing, semantic views, presentation, and truthful exports. These are reader capabilities, not extra authoring work. `meta.animation: "trace"` is opt-in; `meta.views` is optional, and its chapters should follow the distinct reader questions that materially benefit from guided focus rather than a numeric target.

Read `references/viewer-runtime.md` only when the user explicitly asks for Share Cards, Route/Reach cards, motion, guided stories, deep links, presentation, search/focus, or another Viewer Runtime feature.

## Setup and fallback

No install is required inside the skill package. Verify with:

```bash
node bin/archify.mjs doctor
node bin/archify.mjs demo <output-directory>
```

When shell access is unavailable, hand-place architecture SVG into `assets/template.html`, use CSS semantic classes rather than inline colors, and follow the visual review contract in `references/delivery-contract.md`.

## Output

Return the checked HTML path, diagram type, validation summary, specification/artifact receipt, browser-evidence status, and truthful visual-review status. Do not claim success for a non-zero command or claim visual inspection you did not perform.
