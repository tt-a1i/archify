---
name: archify
description: Create polished, validated architecture, workflow, sequence, data-flow, and lifecycle/state diagrams as explorable standalone HTML with inline SVG, dark/light themes, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export. Accept plain-language requirements or pasted Mermaid flowchart, sequenceDiagram, and stateDiagram input; inspect repository evidence when the diagram must reflect real code. Use when the user asks to visualize system architecture, infrastructure, cloud/security/network topology, technical workflows, API call sequences, request lifecycles, data pipelines, ETL/ELT, data lineage, state machines, or to convert/beautify Mermaid.
license: MIT
metadata:
  version: "2.14"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify

Create a self-contained, interactive HTML diagram from a small typed JSON specification. Static output is the default; enable motion only when the user asks for a demo or presentation.

## Fast authoring path

Use this bounded path for ordinary generation. Do not read the optional Viewer Runtime reference unless the user asks about those features.

1. Choose `architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle` from the question.
2. Read one matching schema in `schemas/`, `schemas/common.schema.json`, and one matching JSON example in `examples/`. Read only those files. Fresh authorship means new stable IDs, domain wording, and layout; use the example for field shape, not facts.
3. Artifact first: the next tool action must write the candidate. Write the candidate before inspecting renderer internals. Do not plan exact coordinates in prose. Start with one clear main path, short side branches, sparse labels, and at most 12 primary nodes. Set `meta.quality_profile` to `"showcase"` unless the user explicitly requests a dense `standard` map. Start with automatic routes and labels. Do not add `via`, `channelX`, `channelY`, or `labelAt` before a diagnostic calls for one; apply at most one diagnosed geometry control per repair.
4. Validate after every candidate edit and immediately before handoff:

   ```bash
   node bin/archify.mjs validate <type> <candidate.json> --quality showcase --json
   ```

   A receipt with only 4 artifact checks is basic validation, never showcase acceptance. A showcase pass must report all 9 artifact checks with 0 composition errors and 0 warnings. If the candidate omits or misspells the exact `meta.quality_profile` field, fix it before geometry. A passing final validation freezes the candidate: never edit it afterward.
5. For a delivered HTML, `deliver` is the final acceptance command:

   ```bash
   node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json
   ```

   A non-zero exit can never be described as success. If validation fails, change only the diagnosed `subject`, verify `evidence`, choose from `supportedFixes`, and rerun. Continue focused correction while the objective error count reaches a new minimum. If two consecutive rounds do not improve that best count, stop and report the unresolved diagnostics truthfully.

Do not read `renderers/shared/geometry.mjs`, renderer source, validator source, tests, or benchmarks before the first candidate. Inspect implementation only for an unsupported internal diagnostic or after two focused repairs fail.

Lifecycle note: phase columns `0..4` occupy the main rail; event/outcome columns `0..2` align beneath later phases. A recoverable state uses `type: "failure"` plus a real transition back to the active state.

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
- Match every reader-facing authored string to the language of the user's request, or the conversation's dominant language when the request is language-neutral. Apply it consistently to titles/subtitles, node/edge/boundary/lane/group text, guided-view labels/notes, legend label overrides, and card titles/items; use another language or bilingual copy only when the user asks.
- Preserve exact product names, code identifiers, commands, protocols, API paths, and environment names. They may remain English inside localized copy, but never justify leaving the surrounding explanatory prose in another language.
- For sequence diagrams, omit `meta.column_fit` for the stable `fixed` layout. Set it to `"spread"` when a wide viewBox would otherwise leave unused horizontal space or when meaningful participant labels do not fit the fixed boxes; do not shorten semantic labels before trying `spread`.
- Component types are `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, and `external`; variants are `default`, `emphasis`, `security`, and `dashed`.
- Relationship labels are semantic data. When one collides, move the label, adjust the route or spacing, then shorten the wording while preserving meaning. Only delete a label when both endpoints fully imply the relationship and it contains no protocol, action, direction, synchronous/asynchronous behavior, or cross-boundary mechanism; explain why the deleted label is redundant. Never delete a meaningful label merely to pass `showcase`.
- Omit `meta.engineering_profile` by default. Region, cluster, and security boundary wording do not by themselves enable it. Enable `deployment-ownership` only when the user explicitly asks for a production deployment topology, ownership handoff, or fail-closed deployment review and the source facts are known. Once enabled, must not remove the engineering profile merely to pass validation; repair the facts or report the diagnostics truthfully.
- Spacing means clear gap, not center distance. For a relationship label, clear gap must exceed its measured mask width; use the label-preserving repair order before considering deletion.
- Automatic routes own their endpoint sides. A side is a direction contract: the first and final segment must leave/enter perpendicular to that side.
- Automatic Port Spread is a default renderer behavior for architecture, workflow, data-flow, and lifecycle. It skips single relationships and explicit `via`, `channelX`, `channelY`, `labelAt`, or non-`auto` routes. Near parallel ports use an outside bridge so automatic routing cannot create a sub-8px segment or sub-16px interior turn. Architecture separately keeps unobstructed facing automatic ports (`left`/`right` or `top`/`bottom`) on one shared axis when their offset is under 16px and both ports retain corner clearance. If exactly one endpoint was spread, only the unshared endpoint may move onto that axis; if both endpoints were spread, keep the outside bridge so competing ports remain distinct.
- Never accept an edge crossing an unrelated opaque node, an ambiguous shared corridor, or a relationship label masking another route.

Read `references/authoring-contract.md` only when you need field enums, spacing math, geometry repair rules, repository evidence, or mode-specific placement.

## Delivery

Use `validate` during repair and `deliver` once for final acceptance. Delivery freezes the exact specification bytes into a private same-directory snapshot, renders and checks that snapshot, atomically commits the HTML, and reports SHA-256 plus byte counts for both specification and artifact.

After delivery, collect bounded desktop evidence without modifying or rerendering the trusted HTML:

```bash
node bin/archify.mjs visual-check <output.html> --json
```

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
