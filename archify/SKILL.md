---
name: archify
description: Create polished, validated architecture, workflow, sequence, data-flow, and lifecycle/state diagrams as explorable standalone HTML with inline SVG, dark/light themes, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export. Accept plain-language requirements or pasted Mermaid flowchart, sequenceDiagram, and stateDiagram input; inspect repository evidence when the diagram must reflect real code. Use when the user asks to visualize system architecture, infrastructure, cloud/security/network topology, technical workflows, API call sequences, request lifecycles, data pipelines, ETL/ELT, data lineage, state machines, or to convert/beautify Mermaid.
license: MIT
metadata:
  version: "2.16"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify

Create a self-contained, interactive HTML diagram from a small typed JSON specification. Static output is the default; enable motion only when the user asks for a demo or presentation.

## Fast authoring path

Use this bounded path for ordinary generation. Do not read the optional Viewer Runtime reference unless the user asks about those features.

1. Choose `architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle` from the question.
2. Load the complete ordinary authoring packet in one compact, fail-closed call:
   `node bin/archify.mjs authoring-kit <type> --json --context-json --expect-contract d0f08e111e63fdb056cb56192b1107bdf161a40ad2efdd4ebb4a1af97e7f798e`.
   The pinned digest belongs to this skill release. A mismatch means the deployed skill and code drifted: stop and report it with the guard intact. Use the packet's parsed type schema, common schema, bounded shape-only exemplar, `layoutBudget`, `semanticScope`, type-accurate commands, workflow, and quality guards; the complete gallery example is intentionally omitted from compact model context. Do not rediscover those files or reread the full contracts for an ordinary diagram. Fresh authorship means new stable IDs, domain wording, topology, and layout; never reconstruct or copy the omitted example. When real product identity matters, query `node bin/archify.mjs brands "<name>" --json`; read `references/brand-marks.md` only for an unknown brand with a user-provided URL. When diagrams must reflect a repository revision, build one shared mechanical index, use the packet's `projectQuery` plus revision-pinned `sourceSearch`/`sourceInspect` commands, copy the packet's `evidenceSelectionTemplate.document` bare array, replace its example values, repeat the item for every confirmed fact, then hydrate and run `evidenceVerify`. Next, create `<requirements.json>` from `semanticRequirementsTemplate` before the candidate. Keep `scopeProfile: "project-overview"` for repository overviews and multi-diagram project suites; use `focused` only when the user explicitly narrows the subject. Every required entity and directed relationship must use source-specific accepted labels, cover the type's required semantic roles, and reference verified ledger `claimIds` across the required source breadth. Never guess an object wrapper for the evidence array, substitute working-tree reads or an old verification receipt for pinned facts, or start a repository-backed authoring run without `--requirements <requirements.json>`.
3. Requirements then artifact: after freezing repository requirements, the next tool action must write the candidate. Write the candidate before inspecting renderer internals. Do not plan exact coordinates in prose. Stay within the packet's `layoutBudget`: treat `maximumRecommendedViewBoxWidth` and `desktopReadability` as hard authoring constraints. At the maximum width, every fitted node label and sublabel must remain at or above `minimumSourceNodeTextPxAtMaximumWidth`; shorten surrounding prose, widen the affected node, or reflow the same semantics before reducing type. Start with one clear main path, short side branches, and concise labels. For `project-overview`, cover every required semantic role and author within `targetPrimaryRange`; the two-node shape exemplar is never a density target. Set `meta.quality_profile` to `"showcase"` unless the user explicitly requests a dense `standard` map. Start with automatic routes and labels. Do not add `via`, `channelX`, `channelY`, or `labelAt` before a diagnostic calls for one; apply at most one diagnosed geometry control per repair.
   New workflow sources use `schema_version: 2` and its readable layout contract; keep `schema_version: 1` only when preserving an existing workflow's fixed geometry.
4. Validate after every candidate edit. On the first deterministic pass and immediately before handoff, add `--preflight` so all four desktop containment viewports pass before delivery:

   ```bash
   node bin/archify.mjs validate <type> <candidate.json> --quality showcase --require-authored-language <en|zh-CN> --repair-history <repair-history.json> --json
   node bin/archify.mjs validate <type> <candidate.json> --quality showcase --require-authored-language <en|zh-CN> --repair-history <repair-history.json> --preflight --json
   ```

   Reuse one repair-history file for the candidate. For several frozen candidates, use one shared pre-delivery browser session with `validate-batch <candidates.json>` instead of starting Chrome once per candidate; every manifest candidate must carry its `requiredLanguage`, `repairHistory`, and current `repairMode` so the batch gate preserves the same language and repair-controller state. A receipt with only 4 artifact checks is basic validation, never showcase acceptance. A showcase pass must report all 9 artifact checks with 0 composition errors and 0 warnings. On failure, use the receipt's bounded `repairPlan`; its quality guards forbid semantic deletion, typography reduction, clipping, and overflow hiding. When `structural-reflow-required` appears, recompose the same semantics within `layoutBudget`, then mark that validation with `--repair-mode structural-reflow`; the controller allows two structural reflows and stops only after their budget is exhausted with five identical failures, or after 24 total attempts. Stop after `bounded-stop`. If the candidate omits or misspells the exact `meta.quality_profile` field, fix it before geometry. A passing final validation freezes the candidate: never edit it afterward.
   For a workflow v2 geometry diagnosis, run `node bin/archify.mjs validate workflow <candidate.json> --layout-json` and use the stable compiler receipt; solver internals are not authoring controls.
5. For a delivered HTML, `deliver` is the final acceptance command:

   ```bash
   node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --require-authored-language <en|zh-CN> --json
   ```

   A non-zero exit can never be described as success. A failed delivery preserves any previous output, so do not run `visual-check` on that path: it would inspect the stale last-good artifact, not the failed candidate. If validation fails, change only the diagnosed `subject`, verify `evidence`, choose from `repairPlan.actions[].supportedFixes`, and rerun. Continue focused correction while the objective error count reaches a new minimum. A plateau requests semantics-preserving structural reflow before bounded stop; never treat two merely non-improving rounds as terminal while reflow budget remains.
   Repository-backed model authoring must finish through the packet's `authoringRunFinalize`, which rejects bundled-example contamination, repeated low-information placeholders, missing semantic entities/relationships, unverified claim IDs, stale candidate bytes, and incomplete validation/preflight receipts. If bounded work cannot produce a ready handoff, run `authoring-run stop <authoring-run.json> --status failed|blocked|aborted --reason <code> --json` so elapsed authoring time is still recorded; never invent a successful timing receipt.

## Update awareness

After the first candidate exists, run the packaged checker `scripts/check-update.mjs` once with Node and continue the requested workflow. If the command cannot run, continue without mentioning the check.

- For `silent`, continue without mentioning the update check.
- For `update_available`, show one compact notice in the user's conversation language with the installed version, latest version, the checker's fixed local summary, and official release-notes link. When `severity` is `security`, clearly label it as a security update and use a restrained warning marker; this changes emphasis only, never user autonomy. Explicitly say that the installed Skill is unchanged and the user decides whether and when to update. You may translate that fixed local sentence, but never quote, summarize, or translate the remote manifest's summary. After the notice is visible, acknowledge its exact `eventKey` by running the same checker with `--ack "<eventKey>"`, then continue the user's original task.

The notice is information, not permission. Keep the installed version unchanged; this v0.1 workflow never downloads, installs, or executes an update, and silence is never consent.

Do not read `renderers/shared/geometry.mjs`, renderer source, validator source, tests, or benchmarks before the first candidate. Inspect implementation only for an unsupported internal diagnostic or after two focused repairs fail.

Workflow note: use schema v2 for new workflows; preserve schema v1 when an
existing source needs fixed legacy geometry. Keep semantic edge labels and act
on the compiler diagnostic. The canonical layout, pin, migration, and receipt
contract is in [`renderers/workflow/README.md`](renderers/workflow/README.md#layout-contracts).
Prefer one primary `mainPath` lane, or keep each semantic lane in one contiguous
segment; do not alternate back and forth between lanes. Put tool, error, and
recovery branches in adjacent lanes near their decision column. When a geometry
diagnostic reports crossings on a repeatedly re-entering main path, remove stale
route controls and structurally reflow the same semantics before more local edits.

Lifecycle note: phase columns `0..4` occupy the main rail; event/terminal column `N` in `0..2` aligns exactly beneath main column `N + 2`. A recoverable state uses `type: "failure"` plus a real transition back to the active state.

## Type router

| Type | Use for |
|---|---|
| `architecture` | Components, services, cloud/security boundaries, infrastructure |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD |
| `sequence` | API call chains, request lifecycles, async traces, returns |
| `dataflow` | Pipelines, ETL/ELT, lineage, governance, consumers |
| `lifecycle` | State/status transitions, retries, waiting and terminal states |

When ambiguous, run `node bin/archify.mjs guide "<scenario>" --json`. Scenario proof examples are structural references, not facts to copy.

## Mermaid input

Read Mermaid for topology and meaning, then author fresh Archify JSON; do not mechanically render Mermaid styling.

- `flowchart` / `graph` → `workflow`, or `architecture` for a component map.
- `sequenceDiagram` → `sequence`; participants become semantic participants and arrows become messages.
- `stateDiagram` → `lifecycle`; states and transitions retain meaning, not Mermaid style.

## Authoring invariants

- One obvious main path; side branches leave the nearest main-path node. Remove low-value edges before adding routing controls.
- Omit `meta.visual_preset` by default so every diagram opens in `classic`, regardless of whether its resolved color mode is light or dark. Color mode and visual preset are independent: switching Light / Dark must preserve the current preset. Set `signal-flow`, `blueprint`, or `editorial` only when the user explicitly requests that visual style.
- Omit `meta.subtitle` by default. Never invent a subtitle that restates the title, nodes, or cards; include one short supporting line only when the user explicitly asks for it.
- Treat the standalone desktop viewer as a first-screen artifact by default, not a shallow strip. Generate one responsive artifact for laptops and external displays—never device-specific HTML or alternate topology. The viewer may adapt only the outer reading width from the live viewport height; it must preserve the authored SVG/viewBox, proportions, semantic geometry, and normal document flow. On a wide or tall desktop, use enough authored vertical rhythm that the diagram panel and its necessary conclusion cards occupy the screen as a balanced whole; runtime scaling cannot repair an over-compressed Y layout or an undersized explicit `meta.viewBox`. Before handoff, open the real HTML at 1440×900, 1600×1000, and 1920×1080; additionally check 2048×1320 whenever the composition is intended for a large desktop display. Require `document.documentElement.scrollWidth <= window.innerWidth` and `scrollHeight <= window.innerHeight` at every checked size, while visually checking that the diagram remains comfortably readable and vertically balanced at the largest checked viewport. Repair overflow by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. If the largest viewport still has a conspicuous empty lower band at the viewer's width cap, redistribute authored Y positions and increase the viewBox height proportionally; do not add filler copy or decorative cards. Never counterfeit a pass with `overflow: hidden`, clipped content, an internal diagram scroller, stretched SVG height, or smaller typography. Narrow/mobile layouts may scroll vertically when containment requires it.
- Omit `meta.legend` for the truthful `auto` default. When needed, use only `mode: auto|all|hidden` and renderer-supported `entries.<kind>.label|visible`; labels never change semantics.
- Choose one primary authored language from an explicit user choice; otherwise follow the request or conversation's dominant language. `meta.locale` controls only renderer-owned Viewer UI: use `"en"` or `"zh-CN"` for the corresponding supported primary language. For every other language, omit `meta.locale` and explicitly disclose that the fixed Viewer UI and `<html lang>` fall back to English. The renderer never translates authored content. See `references/authoring-contract.md` for details.
- Preserve exact product names, code identifiers, commands, protocols, API paths, and environment names. They may remain English inside localized copy, but never justify leaving the surrounding explanatory prose in another language.
- Brand identity is optional and explicit. Put a canonical built-in ID in `brand` when the node names that real product. If no preset matches and the user supplied the official HTTP(S) URL, first run `node bin/archify.mjs brands capture "<url>" --json`, then author the returned digest-pinned `brand` object. Render and validate never perform an unpinned capture. Otherwise omit `brand`. Never infer a brand from a vague role such as "database", and never let a badge replace the semantic `type`, label, or relationship facts.
- For workflow diagrams, use schema v2's constraint-driven readable layout for new sources. Keep schema v1 only when fixed legacy geometry must remain byte-for-byte compatible.
- For sequence diagrams, omit `meta.column_fit` for the stable `fixed` layout. Set it to `"spread"` when a wide viewBox would otherwise leave unused horizontal space or when meaningful participant labels do not fit the fixed boxes; do not shorten semantic labels before trying `spread`.
- Component types are `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, and `external`; variants are `default`, `emphasis`, `security`, and `dashed`.
- Relationship labels are semantic data. When one collides, move the label, adjust the route or spacing, then shorten the wording while preserving meaning. Omit only wording that is already fully implied by both endpoints and contains no protocol, action, direction, synchronous/asynchronous behavior, or cross-boundary mechanism. Preserve every meaningful label; deleting it is not a geometry repair. If a relationship starts unlabeled because its endpoints fully imply it, explain why the wording is redundant; this is a semantic authoring choice, not a geometry repair.
- Omit `meta.engineering_profile` by default. Region, cluster, and security boundary wording do not by themselves enable it. Enable `deployment-ownership` only when the user explicitly asks for a production deployment topology, ownership handoff, or fail-closed deployment review and the source facts are known. Once enabled, must not remove the engineering profile merely to pass validation; repair the facts or report the diagnostics truthfully.
- Spacing means clear gap, not center distance. For a relationship label, clear gap must exceed its measured mask width; follow the label-preserving repair order.
- Automatic routes own their endpoint sides. A side is a direction contract: the first and final segment must leave/enter perpendicular to that side.
- Named channel routes own matching side-center defaults: `bottom-channel` uses bottom/bottom, `top-channel` or workflow `up-channel` uses top/top, and lifecycle `left-channel`/`right-channel` use left/left or right/right. Explicit `fromSide`/`toSide` may override these defaults only when the resulting first/final segments still cross those node borders perpendicularly.
- Renderer-owned relationship paths are normalized before painting, so consecutive duplicates and redundant collinear points never become zero-length SVG segments. Arrowed node relationships keep their logical endpoint on the selected border but paint the path with marker-aware target setback (`marker overshoot + half node stroke + 1px`); a target run-up too short to fit that setback is a blocking Clean Flow error.
- Automatic Port Spread is a default renderer behavior for architecture, workflow, data-flow, and lifecycle. It skips single relationships and explicit `via`, `channelX`, `channelY`, or non-`auto` routes. `labelAt` controls only label placement and never disables endpoint spreading. Near parallel ports use an outside bridge so automatic routing cannot create a sub-8px segment or sub-16px interior turn. Architecture separately keeps unobstructed facing automatic ports (`left`/`right` or `top`/`bottom`) on one shared axis when their offset is under 16px and both ports retain corner clearance. If exactly one endpoint was spread, only the unshared endpoint may move onto that axis; if both endpoints were spread, keep the outside bridge so competing ports remain distinct.
- Never accept an edge crossing an unrelated opaque node, an ambiguous shared corridor, or a relationship label masking another route.

Read `references/authoring-contract.md` only when you need field enums, spacing math, geometry repair rules, repository evidence, or mode-specific placement.

## Delivery

Use `validate` during repair and `deliver` once for final acceptance. Delivery freezes the exact specification bytes into a private same-directory snapshot, renders and checks that snapshot, atomically commits the HTML, and reports SHA-256 plus byte counts for both specification and artifact.

After delivery, collect bounded desktop evidence without modifying or rerendering the trusted HTML. Pass several artifacts to one command when checking a suite; Archify probes once and reuses one reset browser session:

```bash
node bin/archify.mjs visual-check <output.html> --json
node bin/archify.mjs visual-check <architecture.html> <workflow.html> <sequence.html> <dataflow.html> <lifecycle.html> --json
```

For a repeatable multi-diagram run, use `run-suite` with a full pinned commit, an isolated output directory, and a manifest of typed `validate` → `deliver` → `visual-check` commands. Set `sharedViewportPreflight: true` for already-frozen candidates so one reset Chrome session performs every pre-delivery viewport check; manifests with candidate-producing `exec` commands retain isolated preflight. The runner records append-only timing events, exact child-process spans, and canonical per-stage/suite receipts; it never authors diagram semantics or calls a model.

`visual-check` measures containment at 1440×900, 1600×1000, 1920×1080, and 2048×1320; captures light/dark screenshots at the smallest and largest sizes; and writes a relative-path contact sheet plus JSON sidecars beside the artifact. Its automated receipt always reports `visualReview: "pending"`: screenshots are evidence for inspection, never an automatic polish claim. Exit 0 means containment and captures passed, 1 means overflow or capture failure, and 2 means Chrome/Chromium was unavailable and the receipt is `skipped`. The command never changes the delivered HTML.

Add `--open` only when the user wants an immediate local preview. For an active desktop authoring loop, the optional command is:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Never start preview by default. Read `references/delivery-contract.md` when using preview, repository evidence, export receipts, visual review, or post-commit opening.

## Optional viewer capabilities

Generated HTML already contains theme switching, pan/zoom, search, focus, relationship tracing, semantic views, presentation, and truthful exports. These are reader capabilities, not extra authoring work. `meta.animation: "trace"` is opt-in; `meta.views` is optional and should contain at most five curated chapters.

Read `references/viewer-runtime.md` only when the user explicitly asks for Share Cards, Route/Reach cards, motion, guided stories, deep links, presentation, search/focus, or another Viewer Runtime feature.

## Setup and fallback

No install is required inside the skill package. Verify with:

```bash
node bin/archify.mjs doctor
node bin/archify.mjs demo <output-directory>
```

When shell access is unavailable, hand-place architecture SVG into `assets/template.html`, use CSS semantic classes rather than inline colors, and follow the visual review contract in `references/delivery-contract.md`.

## Output

Return the checked HTML path, diagram type, validation summary, specification/artifact receipt, and truthful visual-review status. Do not claim success for a non-zero command or claim visual inspection you did not perform.
