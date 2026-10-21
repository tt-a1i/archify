---
name: archify
description: "Create validated architecture, workflow, sequence, data-flow, lifecycle/state, ERD, class, tree, timeline, and waterfall diagrams as explorable standalone HTML with dark/light themes, motion and image/SVG/WebM export. Accept requirements or Mermaid; inspect repository evidence for code-backed diagrams. Use when visualizing systems, API calls, pipelines, schemas, histories, timings, or everyday steps, parts, relationships and states. Also turn an answer into a one-page explainer, with the conclusion first, structured panels, native diagrams and charts, when the user asks for a page, an explainer or an answer to share (做成一页, 用页面讲), or proactively when the user's rules opt in with an [archify explainer: ...] line. Optionally add a guided story and video export to an existing native diagram. Not for dashboards."
license: MIT
metadata:
  version: "3.2"
  author: tt-a1i
---

# Archify

Create checked standalone HTML as a native diagram or a one-page explainer that answers a question.

Run commands from your working directory. Unless the user names another location, give each new artifact request its own folder `.archify/<type>-<slug>-<YYYYMMDD-HHMMSS>/` there (local time, chosen once): keep the candidate and `<slug>.html` in it and reuse it for repairs. Native diagrams use `candidate.json` with `meta.output` relative to the working directory; explainers may use `candidate.archify.md` and a portable output filename. A later request gets a new folder. Replace `bin/archify.mjs` in every command with the installed package's absolute path, or its path relative to your working directory; CLI input and output paths resolve from that directory.

For a native diagram of a real codebase, read [Repository authoring](references/repository-authoring.md) while tracing the requested behavior. A system description uses the native steps below; a frozen candidate uses the handoff path.

## Choose the artifact

- When the user asks to draw or visualize a system, flow, schema or history, use a native diagram and the Type router.
- For a guided walkthrough or explanation video of a native HTML diagram, read [Story authoring](references/story-authoring.md). Use `story draft` and `story attach` to add playback and video export to its existing Viewer.
- Use `explainer` when the user asks for the answer as a page: a page, one page, an explainer, something to share (“做成一页”, “用页面讲”, “answer with a page”). Without such a request, answer in text or draw the requested diagram. A page made on request ends its reply with the one-line mode offer under Output.
- A rules line in context changes this. `[archify explainer: proactive]`: also make a page, unasked, for an explanation, comparison, trade-off, decision, diagnosis, review or plan that needs a table, steps or several sections. `[archify explainer: always-on]`: every reply that reaches a conclusion also gets a compact page of at most four panels, delivered without opening it, its link closing the reply. `[archify explainer: on-demand]`: only when asked, and never offer a mode.
- In every mode a page needs a conclusion with some structure behind it: chat, one-line answers, raw command output and text-only requests get none.
- For `explainer`, read [Explainer authoring](references/explainer-authoring.md) for its conclusion, reasons, scope, board layout and optional native diagrams. Write the complete draft, then run `finalize explainer` for validation, atomic delivery and artifact checks. Use panel patch for local content revisions.

## Existing candidate handoff

When the user supplies a frozen candidate, run `finalize` first as one CLI invocation. Its passing receipt completes the automated gates; follow any visual review recommendation under Delivery before claiming visual quality. For repair, follow step 5.

`finalize` includes a bounded update check in its delivery receipt; see Update awareness.

## Native diagram authoring

Use this path for ordinary generation. Read branch references only when their stated trigger applies.

1. Choose `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`, `erd`, `class`, `tree`, `timeline`, or `waterfall` from the question.
2. Use the exact schema and example paths in the Type router without listing their directories. Read [Authoring defaults](references/authoring-defaults.md) and the mode's example in a bounded batch separate from project documents and complete schemas so neither is truncated; recover any missing section before writing. For Architecture, use the matching showcase example. For every mode except Architecture, also read the mode and common schemas. Read the relevant schema definition before choosing any new field, enum, or constrained text, especially boundary kinds. Examples teach shape, not facts. Use fresh IDs, wording, and layout. Go directly to the candidate without preliminary help, doctor, starter validation, temporary diagrams, or output-path listing. Query brands only for an explicitly requested mark; read [Brand marks](references/brand-marks.md) for an unknown mark with a user-provided URL.
3. Once the requested scope and, for a real codebase, [source evidence](references/repository-authoring.md) are covered, write the complete candidate directly without planning coordinates in prose. Choose Architecture abstraction and connected placement using Authoring defaults before coordinates: show the main user journey and necessary branches, preserve control roles and behavior-changing conditions, and leave enough room for actual relationship labels. No node, relationship, source, view, card, or boundary count is a target or ceiling. Use automatic routes first; add explicit routing only for necessary branch, return, supplied geometry, or measured repair. Set `meta.quality_profile` to `"showcase"` unless the user requests dense `standard`. For ERD, use a table-first layout: show every physical column in `entities[].attributes`, keep its SQL type and source comment, state every key role a column carries (`key` takes a role or a list, so a junction column is `["pk", "fk"]`, and every `fk` column also needs `references` like `"orders.id"`), and never move columns into cards as a substitute for the table. Classify tables into functional domains before placement, give each domain a concise `tag`, and place its members in one solid rectangle of grid cells — a single row, a single column, or a filled rectangular block, not an L or diagonal. A tagged table always needs `row`/`col`, because absolute coordinates have no grid cells and a domain whose tables do not fill one rectangle cannot be drawn as a band: the renderer reports `erd/domain-not-drawn` instead of publishing a diagram that cannot name the domain. A multi-domain schema reads best as one domain per column — each `tag` a vertical run — because the reader scales a wide canvas up to the reader width and shrinks a tall one until the page fits, so the wide arrangement is the one that stays complete and legible inside a laptop viewport. A schema-first ERD over roughly 8 tables or 50 fields is itself a dense map: author its first complete-field pass at `standard` and upgrade only once the layout still reads.
4. Once the complete first candidate is written, run `finalize` directly. Its first gate is showcase validation; successful first drafts need no separate pre-validation. Keep the candidate unchanged while the command runs:

   ```bash
   node bin/archify.mjs finalize <type> <candidate.json> <output.html> --quality showcase --json
   ```

   For a repository-backed candidate, include evidence on the first draft and use the complete first command: `node bin/archify.mjs finalize <type> <candidate.json> <output.html> --repo-root <repo-root> --quality showcase --json`. Pass the `--quality` that matches `meta.quality_profile`, such as `standard` for a dense first ERD pass.

   A passing receipt proves the included `validate`, `deliver`, strict `check`, and real-browser `browser-check` gates passed. Use its compact summary; run standalone commands only for a separate request or focused failure diagnosis.

5. A non-zero exit is never success. Read compact stdout or `evidence.summaryReceipt`, then [repair the failed gate](references/delivery-contract.md#failed-finalize-and-candidate-repair), including its repair limit. Preserve requested meaning and source evidence. For several tangled Architecture routes, read [Architecture layout repair](references/architecture-layout-repair.md); for measured field or geometry failures, read [Authoring contract](references/authoring-contract.md). Edit the connected neighborhood and rerun the complete `finalize` command from step 4. Once a run has reached `browser-check`, the output path owns that evidence: give every later run its own `--out-dir <folder>/review-<n>`.

## Update awareness

`finalize` and standalone `deliver` include `update` in their receipts. Do not run a separate check for the same delivery. If `update.noticeRequired` is true, read `references/update-awareness.md` and keep one compact update notice in your final response to the user, even after a quality gate fails. For a task with several diagrams, mention the update once in the final response. Snooze or ignore a reminder only when the user explicitly asks; never install or update on your own initiative.

Before the first candidate, use the authoring references and relevant repository source, not Archify implementation or tests. Inspect Archify implementation if diagnostics remain unactionable after focused repairs.


## Type router

| Type | Use for | Schema | Example |
|---|---|---|---|
| `architecture` | Components, services, cloud/security boundaries, infrastructure; what something everyday is made of | `schemas/architecture.schema.json` | System descriptions, services, libraries, and CLI repos: `examples/web-app.architecture.json`; deployment repos: `examples/production-deployment.architecture.json` |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD; plans and step-by-step life processes | `schemas/workflow.schema.json` | `examples/agent-tool-call.workflow.json` |
| `sequence` | API call chains, request lifecycles, async traces, returns; back-and-forth between people | `schemas/sequence.schema.json` | `examples/cache-miss-request.sequence.json` |
| `dataflow` | Pipelines, ETL/ELT, lineage, governance, consumers; where money or documents go | `schemas/dataflow.schema.json` | `examples/product-analytics.dataflow.json` |
| `lifecycle` | State/status transitions, retries, waiting and terminal states; where an application or order stands | `schemas/lifecycle.schema.json` | `examples/deployment-release.lifecycle.json` |
| `erd` | Tables/entities, attributes, primary/foreign/unique keys, cardinality between them | `schemas/erd.schema.json` | `examples/orders.erd.json` |
| `tree` | Single-parent containment: repository/module trees, capability or feature breakdowns, org-style decomposition | `schemas/tree.schema.json` | `examples/payment-platform.tree.json` |
| `class` | Classes, interfaces, selected members, and dependency/association/inheritance/realization/composition between types | `schemas/class.schema.json` | `examples/payments.class.json` |
| `timeline` | When things happened: incident reviews, release histories, timestamped events on a proportional clock with source lanes | `schemas/timeline.schema.json` | `examples/payment-incident.timeline.json` |
| `waterfall` | Where the time went: span durations, overlap, and nesting of one request or agent run on a common time axis | `schemas/waterfall.schema.json` | `examples/checkout-request.waterfall.json` |

When choosing among native diagram types is ambiguous, run `node bin/archify.mjs guide "<scenario>" --json`. Scenario proof examples are structural references, not facts to copy.

For an everyday subject, keep the same diagram modes and semantic types, then name them for the reader: use everyday `icon` values and `meta.legend` labels as in [Node icons](references/authoring-contract.md#node-icons). Ask for missing personal facts instead of inventing dates, amounts, or rules.

## Mermaid input

Read Mermaid for topology and meaning, then author fresh Archify JSON; do not mechanically render Mermaid styling.

- `flowchart` / `graph` → `workflow`, or `architecture` for a component map.
- `sequenceDiagram` → `sequence`; participants become semantic participants and arrows become messages.
- `stateDiagram` → `lifecycle`; states and transitions retain meaning, not Mermaid style.
- `erDiagram` → `erd`; entity and relationship names, keys, and cardinality retain meaning, not Mermaid style.
- `classDiagram` → `class`; type kinds, selected members, and relationship kinds retain meaning, not Mermaid style.

## Delivery

Use the `finalize` command above for the first candidate and after a repair.

`finalize` stops at the first non-passing gate. Its compact stdout and `<output-stem>.finalize-summary.json` are ordinary evidence. A passing run creates no screenshots and reports `visualReview: "not-requested"`.

When a passing Architecture receipt reports `visualReviewRecommendation.signals.resolvedCrossovers`, copy the candidate aside and apply the hints in one edit that changes only node positions and sizes: every node, relationship (including its `from` and `to`), label, and source stays as it was. Rerun the complete `finalize` once with `--out-dir <folder>/review-2`, because the previous HTML already owns its browser evidence. `--out-dir` relocates the new browser-check and default finalize receipts, not the HTML or its delivery receipt. Successful delivery rewrites that pair at the requested output path; earlier review evidence remains bound to its original artifact bytes. See [review evidence paths](references/delivery-contract.md#a-new-candidate-at-an-existing-output-path). If that run fails, reports more crossings, or reports the same crossings with more `signals.routesOverSuggestedBends`, restore the copy and finalize it with `--out-dir <folder>/review-3`. Do not start a second placement round. Hints about extra bends alone are optional.

When `layoutReviewRecommendation.action` is `inspect-sequence-width`, follow [Sequence width review](references/delivery-contract.md#sequence-width-review) before handing off a newly authored Sequence.

Perceptual review is optional for ordinary generation, including a newly positioned Architecture. Use [Optional capture evidence](references/delivery-contract.md#optional-capture-evidence), with `--out-dir <folder>/visual-check`, when the user requests visual review, during development audits, or for a concrete route/browser concern. `visualReviewRecommendation` is advisory. Inspect captures before claiming visual quality; qualify any check claim as automated when perceptual review has not occurred.

Read [Delivery contract](references/delivery-contract.md) for failed gates, standalone commands, provenance/recovery, repeated delivery, exports, or opening. Native diagram recovery follows `deliver` → strict provenance `check` → `browser-check`; captures require strict provenance. Explainer delivery uses validate, deliver and check as described in its authoring guide.

For workflow viewport overflow, read [Workflow viewport repair](references/authoring-contract.md#workflow-viewport-repair) before the next layout edit.

When reporting verification details, distinguish artifact checks, browser evidence, captures, and actual perceptual review. For an explicitly requested immediate preview or active desktop loop, see [Optional opening](references/delivery-contract.md#optional-opening).

## Optional viewer capabilities

Live motion is enabled by default for every rendered diagram; omit `meta.animation`. The Viewer’s Live/Still button controls playback.

Read `references/viewer-runtime.md` only when the user explicitly asks for Share Cards, Route/Reach cards, motion, deep links, presentation, search/focus, or another Viewer Runtime feature.

## Setup and fallback

No install is required inside the skill package. For setup diagnosis, verify with:

```bash
node bin/archify.mjs doctor
node bin/archify.mjs demo <output-directory>
```

For native diagrams, when shell access is unavailable, hand-place architecture SVG into `assets/template.html`, use CSS semantic classes rather than inline colors, and follow the visual review contract in `references/delivery-contract.md`. Explainers require their renderer and real delivery gates; if those are unavailable, report the limitation and give a text answer when useful, without claiming HTML delivery.

## Output

Reply in the user's language, as briefly as the result allows; the diagram carries the content, so a single diagram usually needs one line.

- Lead with a clickable Markdown link to the HTML: a descriptive title, not the file name, and its absolute path, wrapped in `<...>` when it contains spaces.
- When the user wants to understand a system or codebase rather than draw a described subject, add one or two sentences with the key takeaway. Skip sentences that only restate what the diagram obviously shows.
- State anything that changes how the diagram should be read: the abstraction level or deliberately omitted parts when a reader might expect them, illustrative rather than measured values, missing source evidence, or requested content dropped or merged during repair.
- For several diagrams, report completion once with a link to an existing overview or compact per-diagram links, not a directory path.

Do not recap commands, repair rounds, hashes, quality profiles, or check lists; they stay in the receipts. If asked whether the diagram was verified, answer in one line, such as “Automated checks passed; not visually reviewed.” Give receipt links and details only for reproducibility or troubleshooting. Disclose requested visual review that could not run, and claim visual inspection only when performed. Keep the required update notice under Update awareness.

Example: `Created [Checkout request timing](/abs/path/checkout-timing.html). Durations are illustrative, not measured.`

For an explainer, reply in two or three lines: the conclusion and the page link. Mention gates only when one failed or writing warnings remain; do not paste the draft.

After an explainer made on request, when no `[archify explainer: ...]` line is in context, end the reply with one optional line offering the proactive mode, once per conversation, for example: “需要的话，以后遇到解释、对比、排查这类问题，我可以主动做成这样的页面，要开启吗？” If the user accepts, add `[archify explainer: proactive] Make an Archify explainer page, unasked, for explanations, comparisons, decisions, diagnoses, reviews and plans that need a table, steps or several sections.` to the global rules file of the current agent (such as `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` or `~/.config/devin/AGENTS.md`) and name the file; deleting the line turns it off. If the user declines, offer to add `[archify explainer: on-demand]` so the question does not return.
