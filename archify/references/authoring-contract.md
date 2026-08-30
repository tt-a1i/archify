# Authoring contract

Read this reference only after the Fast authoring path calls for more detail. The schemas and examples remain authoritative.

## Schema lookup

Load `authoring-kit <type> --json --context-json` once. Its compact model packet contains the parsed mode schema, `schemas/common.schema.json`, and a bounded shape-only exemplar; the complete gallery example is identified by digest but omitted from model context. It also supplies the per-type first-screen `layoutBudget`, semantic-requirements template, type-accurate commands, capabilities, workflow, and unchanged quality guards. Ordinary authoring should not reread this full reference unless the packet explicitly routes here for detailed geometry or evidence rules. The mode schemas use `$ref`, so the common file is where shared enums live.

- `componentType`: `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, `external`
- `variant`: `default`, `emphasis`, `security`, `dashed`
- Relationship IDs use the shared identifier pattern and must be unique in their collection.

Do not invent fields. Use only the shape exemplar for field structure, then author fresh IDs, wording, facts, topology, and layout.

## Workflow layout contracts

Use schema v2 for new workflows and keep schema v1 when an existing source must
retain fixed geometry. In both versions, `col` stays in `0..5` and semantic
edge labels are never deleted as a spacing repair. Do not change only
`schema_version` when absolute coordinates exist: follow the canonical
[migration and layout-receipt contract](../renderers/workflow/README.md#migration-and-layout-receipt).
The complete normative invariants live in the workflow renderer's
[layout contracts](../renderers/workflow/README.md#layout-contracts).

## Legend contract

Omit `meta.legend` for the truthful default: `auto` lists only semantic kinds
present in typed IR. Use `mode: "all"` for a renderer reference or
`mode: "hidden"` to remove the full legend. Under `entries`, only keys listed
by the selected mode schema are valid; each key accepts `label`, `visible`, or
both. `visible: true` may show an unused supported convention, while
`visible: false` hides it. `hidden` cannot be overridden.

A label override changes reader wording only. Never infer a kind from prose or
use the legend to compensate for missing nodes, states, messages, or flows.
Long labels are measured and wrap into deterministic rows. Architecture's
implicit automatic viewBox grows from that same measured footprint. For
backwards compatibility, a legacy document with no `meta.legend` may omit an
implicit auto legend that cannot fit its explicit viewBox; this never changes
its typed topology. Adding `meta.legend` makes the presentation intentional and
strict: if its resolved labels cannot fit the authored viewBox, shorten or hide
them, or widen the viewBox using the emitted diagnostic.

## Language consistency

Choose one primary authored language. An explicit user choice wins; otherwise
use the language of the request, or the conversation's dominant language when
the request itself is language-neutral. Separately choose the Viewer locale.
For supported languages, always write the matching `meta.locale`: `"en"` for
English or `"zh-CN"` for Simplified Chinese. The renderer consumes the authored
locale without inferring language from diagram strings. Documents that omit it
remain valid and default to English.

`meta.locale` controls only renderer-owned reader surfaces: `<html lang>`, the
document-title suffix, default SVG description and focus labels, default legend
labels, and fixed Viewer controls, statuses, accessibility names, and errors.
It never translates authored content. Apply the primary language separately to
titles, subtitles, node and relationship copy, boundaries, lanes, groups,
guided views, legend label overrides, and cards. A bilingual diagram still
chooses one primary locale for the Viewer; follow an explicit primary-language
request, then prompt order or conversation dominance.

For a requested language outside `en` and `zh-CN`, do not write an unsupported
locale. Keep every reader-facing authored string in the requested language,
omit `meta.locale` so the renderer safely uses English, and explicitly tell the
user that fixed Viewer UI and `<html lang>` remain English and the artifact is
not fully localized. The fallback applies only to renderer-owned surfaces; it
never permits authored copy to fall back to English. Do not silently substitute
`zh-CN` for another language or Chinese locale.

Keep exact product names, code identifiers, commands, protocols, API paths, and
environment names intact. Those terms may remain English inside localized copy,
but surrounding explanatory prose must still use the selected language.
Renderer-owned default legend labels follow `meta.locale`; author a
`meta.legend.entries.*.label` override only when the diagram needs different
domain wording, and keep that authored override in the primary language.

## Visual preset default

Omit `meta.visual_preset` by default. The renderer then opens the diagram in
`classic` for both light and dark color modes. Color mode and visual preset are
independent viewer state: switching Light / Dark must preserve the current
preset. Author `signal-flow`, `blueprint`, or `editorial` only when the user
explicitly requests that visual style.

## Engineering profile default

Omit `meta.engineering_profile` for an ordinary system architecture. Region,
cluster, and security boundary wording do not by themselves enable an
engineering profile. Enable `deployment-ownership` only when the user
explicitly asks for a production deployment topology, ownership handoff, or
fail-closed deployment review and the source facts are known. Once enabled,
do not remove the engineering profile merely to pass validation; repair the
authored facts or report the diagnostics truthfully.

## Title hierarchy

Use one concise title and let the diagram carry the explanation. Omit
`meta.subtitle` by default, and never use it to restate the title, nodes, edges,
or cards. Include one short supporting line only when the user explicitly asks
for a subtitle; an omitted or blank subtitle must not leave an empty visual row
in the generated viewer.

## Executable geometry rules

- Node anchors start at side midpoints. `left`/`right` change the horizontal endpoint; `top`/`bottom` change the vertical endpoint. For an automatic Architecture relationship, unobstructed facing ports whose axis offset is under 16px may share one horizontal or vertical axis when both endpoints retain the 16px corner gutter. If exactly one endpoint belongs to a spread group, only its unshared counterpart moves; relationships spread at both endpoints keep their distinct ports and outside bridge.
- Named channels resolve to the matching side centers unless the author explicitly overrides them: Data-flow `bottom-channel`/`top-channel` use bottom/bottom or top/top; Workflow `bottom-channel`/`up-channel` use bottom/bottom or top/top; Lifecycle additionally maps `left-channel`/`right-channel` to left/left or right/right. Validation checks both the endpoint's actual border and its perpendicular approach, so a downward-looking segment that starts on a left/right border cannot masquerade as a bottom port.
- Renderer-owned paths remove consecutive duplicate and redundant collinear points before SVG emission. For arrows that terminate on a node, the logical composition endpoint remains on the node border while the painted path is shortened by the marker-tip overshoot, half the node stroke, and a 1px visual gap. A final run-up that cannot fit this setback fails the Clean Flow gate instead of allowing the arrowhead to merge with the node border.
- A side is a direction contract. The first and final route segment must be perpendicular and outward/inward in the named direction.
- Automatic Port Spread is a default renderer behavior for architecture, workflow, data-flow, and lifecycle diagrams. Shared automatic endpoints spread deterministically and symmetrically with a 16px corner gutter. It does not apply to sequence messages, single relationships, or explicit `via`, `channelX`, `channelY`, or non-`auto` routes. `labelAt` controls only label placement and does not disable endpoint spreading.
- Showcase route rhythm: every nonzero segment must be at least 8px; every interior segment must be at least 16px. When spread ports are nearly parallel, the router uses a 24px endpoint stub and a 16px outside bridge instead of manufacturing a tiny dogleg.
- Shared endpoint corridors are allowed only when they remain semantically unambiguous. Unrelated collinear overlap of 8px or more fails showcase.
- Container borders are intentional pass-through geometry, but a long edge running along a structural border is not.
- An edge crossing an unrelated opaque node is always a hard failure, independent of quality profile.

### Spacing and labels

Spacing recommendations mean clear gap between boxes, not center distance. A 200px center distance between 165px-wide nodes leaves only 35px of clear gap.

For a relationship label, require:

```text
clear gap > label mask width + 8px breathing room
label mask width ≈ 6.5px × ASCII units + 13px
CJK characters count as two units
```

Relationship labels are semantic data. If the gap is too small, move the label,
adjust the route or spacing, then shorten the wording while preserving meaning.
Omit only wording already fully implied by both endpoints and carrying no
protocol, action, direction, synchronous/asynchronous behavior, or
cross-boundary mechanism. Preserve every meaningful label.
Deleting it is not a spacing repair. If a relationship starts unlabeled because
its endpoints fully imply it, explain why the wording is redundant; this is a
semantic authoring choice, not a spacing repair. In workflow v2, let the compiler
allocate its measured mask before applying a diagnosed `labelAt`,
`labelDx`/`labelDy`, or `labelSegment`. Apply one diagnosed geometry control at
a time.

### Repair order

1. Fix missing/invalid `meta.quality_profile` and schema errors.
2. Fix node overlap or out-of-range placement.
3. Fix edge-through-node and endpoint-direction errors.
4. Fix crossings, ambiguous corridors, border runs, and route rhythm.
5. Fix label-to-node, label-to-label, then label-to-route clearance.

Run `validate` after every edit with one reused `--repair-history <repair-history.json>` path and the request-derived `--require-authored-language <en|zh-CN>` gate. Consume `diagnostics[]` by stable `code`, exact `subject`, measured `evidence`, and `supportedFixes`. If the diagnostic gives `labelAt`, use that point instead of estimating another offset. Follow `structural-reflow-required` before bounded stop, preserve all semantics, and validate that reflow with `--repair-mode structural-reflow`. The controller allows two reflows and stops only after five identical unresolved attempts following exhausted reflows, or after 24 total attempts.

## Mode placement

### Architecture

Use one left-to-right spine with short vertical branches. Prefer 6–12 primary components and group only real ownership, trust, process, or deployment boundaries. Boundaries do not replace relationships.
For a repository `project-overview`, target 6–10 source-backed components and cover entry, configuration, control, runtime, observability, and integration roles.

Grid placement is preferred when the schema supports it. Free positions are appropriate for a bounded exception, not for prose-level coordinate planning. Keep external actors outside the system boundary when that is factually true.

### Workflow

Lanes express responsibility or phase. Columns `0..5` express logical
progression. Start new workflows on `readable-v2`; retain `fixed-v1` only for
legacy geometry compatibility. Keep the happy path monotonic, preserve semantic
edge labels, and route retries and exception returns outside the main lane
corridor.
For a repository `project-overview`, target 7–10 source-backed nodes and cover trigger, parse, validate, apply, observe, failure, and outcome roles.

Use workflow schema v2 for new sources. Its constraint-driven compiler treats
columns as logical ranks and derives readable geometry from measured content.
Keep schema v1 only when preserving fixed legacy geometry byte-for-byte.

### Sequence

Participants are ordered by conversation role. Messages own their vertical order. Use return/async/security variants for meaning, not decoration; sequence does not use Automatic Port Spread.
For a repository `project-overview`, target 5–7 participants and 9–13 messages across caller, ingress, coordinator, runtime, and observer roles.

### Dataflow

Stages express transformation or custody. Rows separate parallel streams. Label only data contracts, classifications, or cross-boundary movement that is not obvious.
For a repository `project-overview`, target 7–10 nodes and cover source, transform, control/store, runtime sink, and observability consumer roles. A chain of runtime statuses is lifecycle content, not a data flow.

### Lifecycle

Main phases use columns `0..4`; event and terminal bands use columns `0..2`.
Event/terminal column `N` aligns to the same x coordinate as main column
`N + 2`. A recoverable failure needs a real transition back to an active state.
A card or guided view saying “retry” is not topology.
For a repository `project-overview`, target 7–9 states and cover initial, registered, active, changing, recovery, and terminal roles.

## Repository evidence

When the diagram must reflect real code, pin one full commit and run `project-index <repo-root> --revision <commit> --output <index.json>` once. Reuse that mechanical file/import/symbol/package index across every diagram for the same revision. Query compact candidate slices with `project-index query <index.json> --symbol ... --import ... --path ...`; the query returns mechanical matches and editable selection hints, never inferred topology. Confirm facts and summaries, then use `evidence-ledger hydrate <index.json> <selections.json>` to fill revision, blob, and range hashes in one batched read. Run `evidence-ledger verify <ledger.json> --project-index <index.json> --repo-root <path>` immediately before handoff. Verification requires the original ProjectIndex receipt and checks its digest, origin, revision, selected file facts, Git blobs, and range hashes; a missing or changed receipt fails closed. Use `--repo-root <path>` when the chosen renderer supports evidence receipts. Never infer runtime causality from file proximity or naming alone.
Before authoring the candidate, write the packet's semantic-requirements document. Schema v2 requires `scopeProfile`: use `project-overview` for repository overviews and project suites, and `focused` only for an explicitly narrow subject. The project-overview profile enforces per-type entity/relationship density, semantic-role coverage, unique claims, and distinct source-file breadth; focused retains the bounded two-entity/one-relationship floor. Every item names accepted technical labels and references one or more claim IDs in the verified ledger. Candidate IDs remain free, but `authoring-run finalize` binds required labels to exactly one candidate entity, checks directed relationships, verifies evidence breadth, and requires 100% claim presence. Schema v1 remains a legacy focused profile. The requirements bytes are bound when `authoring-run start ... --requirements <requirements.json>` creates the envelope, so later edits fail closed.
The shared ProjectIndex and EvidenceLedger workflow supports repository-backed
authoring for all five diagram types. The renderer-level
`--repo-root <path>` is architecture-only and is accepted by architecture
`render`, `validate`, `deliver`, `preview`, and `compare`; workflow, sequence,
dataflow, and lifecycle reject it. Never infer runtime causality from file
proximity or naming alone.

## Hand-placed fallback

Use only when no renderer can run. Start from `assets/template.html`, keep semantic CSS classes, preserve the inline SVG/accessibility structure, and run the delivery visual checklist. Never introduce inline literal colors that break dark/light parity.
