# Workflow Renderer

Render `diagram_type: "workflow"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/workflow/render-workflow.mjs input.workflow.json output.html
```

The renderer validates input against `archify/schemas/workflow.schema.json`
with the bundled standalone validator. No dependency installation is required.

If `output.html` is omitted, the renderer uses `meta.output` from the JSON file
or falls back to `workflow.html` in the current working directory.

After rendering, run the artifact checker:

```bash
node archify/scripts/check-render-output.mjs output.html
```

It catches final-SVG issues that are easiest to see in a browser: non-finite
SVG values, accidental two-point diagonal arrows, and arrows crossing the
legend.

## Input

Workflow JSON files must set:

```json
{
  "schema_version": 2,
  "diagram_type": "workflow",
  "meta": {
    "title": "Agent Tool Call Workflow"
  },
  "lanes": [],
  "phases": [],
  "groups": [],
  "mainPath": [],
  "nodes": [],
  "edges": [],
  "cards": []
}
```

Use `schema_version: 2` for new workflows. Its readable layout compiler treats
every `col` as a logical rank in `0..5` and derives geometry from the measured
document. `schema_version: 1` remains the fixed legacy contract for existing
sources; valid v1 output is preserved byte-for-byte and never silently
reinterpreted as v2.

Omit `meta.viewBox` for the common v2 case so the compiler can use intrinsic
measured bounds. In v1, the omitted width remains fixed at 720 and height is
derived from lane count. A complete worked example lives at
`archify/examples/agent-tool-call.workflow.json`; its `schema_version` selects
the applicable contract.

The schema lives at:

```text
archify/schemas/workflow.schema.json
```

## Migration and layout receipt

Migrate an existing v1 source into a separate v2 file:

```bash
node archify/bin/archify.mjs migrate workflow old.json new.json --to-schema 2 --json
```

Running the command again with its schema-v2 output as the new source is an
idempotent verification pass: the destination bytes and geometry stay unchanged.

The command never overwrites the source by default. It maps absolute
`via[*][0]`, `labelAt[0]`, and `channelX` values from legacy to solved rank
space, preserves y coordinates unless a reported vertical constraint needs
author input, expands an explicit viewBox only for an unambiguous containment
repair, and writes the destination only after v2 compilation and artifact
checks pass. Ambiguous explicit pins fail without producing the destination.

Inspect the stable author-facing v2 plan with:

```bash
node archify/bin/archify.mjs validate workflow input.workflow.json --layout-json
```

The receipt reports the selected contract, measured `viewBox` and
`requiredViewBox`, solved columns, nodes, edges, labels, and causal diagnostics.
It deliberately omits solver iterations and candidate scores.

## Legend

The default legend derives component kinds from `nodes[].type`. Supported
`meta.legend.entries` keys, in stable order, are `frontend`, `backend`,
`security`, `messagebus`, `database`, `cloud`, and `external`. Labels and
visibility may be overridden through the shared legend contract; only kinds
backed by rendered nodes receive Semantic Legend controls.

## Layout contracts

### Fixed v1

| Constant | Value |
|----------|-------|
| viewBox | default `[720, auto]` — auto height = 52 + lanes×104 + (lanes−1)×20 + 124 |
| Lane frame | x 40, width 640, height 104, gap 20; first lane top at y 52 |
| Lane title strip | top 30px of each lane; node boxes must stay below it |
| Column centers (`col` 0–5) | x = 88, 220, 300, 430, 500, 625 |
| Phase headers | Optional `phases[]` render above the first lane, spanning `fromCol..toCol` |
| Lane groups | Optional `groups[]` frame parallel work or branch work inside one lane |
| Exception lanes | Set `lane.variant: "exception"` for retry, denial, fallback, or failure paths |
| Main path lint | Optional `mainPath[]` checks that happy-path steps have matching edges and do not move backward |
| Default node | 92×52 (height 68 when `tag` is set) |
| Node spacing | ≥8px between nodes in the same lane |
| Edge length | straight segments must span ≥28px |
| Legend row | y = lane bottom + 44; viewBox height must be ≥ legend y + 18 |

Column-center gaps are 132 / 80 / 130 / 70 / 125 px: columns 1↔2 (80px) and
3↔4 (70px) cannot both hold default-width 92px nodes in the same lane. Such an
invalid v1 source receives one causal `workflow/column-capacity` diagnostic and
a verified migration-to-v2 repair; v1 never falls through to adaptive layout.

### Readable v2

| Invariant | Contract |
|----------|----------|
| Logical columns | `col` is an integer in `0..5`; pixel centers are measured output |
| Adjacent-rank baseline | 120px center distance before document-specific constraints |
| Same-lane node clearance | ≥8px when vertical node intervals overlap |
| Facing direct edge | clear gap ≥`max(28px, measured label mask width + 8px)` |
| Automatic route rhythm | direct segment ≥28px; endpoint stub ≥8px; interior turn segment ≥16px |
| Implicit viewBox | intrinsic content bounds plus contract padding |
| Explicit viewBox | containment capacity; too-small input reports exact `requiredViewBox` and contributors |

The compiler applies constraints only to actual related or overlapping
same-lane nodes, so a wide node in an unrelated lane does not expand every
rank. Legacy centers are a soft preference after correctness constraints, not
a geometry promise. Phase and group frames derive from the solved rank bands.
Automatic routes are normalized once and the same final scene drives
validation and SVG serialization. Long automatic labels compare direct-gutter
growth with a legal channel instead of widening every downstream rank. Measured
multi-row legends participate in intrinsic height and explicit viewBox
capacity.

Authored `via`, `labelAt`, `channelX`, and `channelY` are absolute hard pins in
v2; an infeasible pin returns `workflow/explicit-pin-conflict` rather than being
silently moved. `fromSide` and `toSide` remain direction constraints. A route
preset restricts the automatic candidate family but is not itself an absolute
coordinate pin. When either endpoint side is omitted, the v2 compiler chooses
a feasible side; an authored side restricts that endpoint to the named port.

## Design Rules

- Use lanes for ownership or runtime boundaries.
- Use phase headers for high-level story beats such as Intake, Plan, Execute, and Report.
- Use groups for parallel checks, branch handling, or bounded work within a lane; every group must contain at least one node.
- Use `lane.variant: "exception"` for human wait, denial, retry, fallback, and failure lanes instead of mixing those paths into the happy path.
- Set `mainPath` when the diagram has a clear happy path; the renderer validates that consecutive ids have matching edges and move left-to-right.
- Place nodes with lane IDs and `col` indexes in `0..5`, not raw SVG coordinates.
- Preserve semantic edge labels. Readable v2 allocates measured label clearance;
  when a label does not fit, repair the reported capacity or route constraint
  instead of deleting meaning.
- Use labels for decisions, approvals, protocols, async traces, return paths,
  and any other relationship meaning not fully implied by its endpoints.
- Prefer route presets — `drop` (bend between lanes; `bias` 0–1 picks where),
  `outside-right`, `return-left`, `bottom-channel`, and `up-channel` — before
  using raw `via` points. `straight` and the default `auto` cover the rest.
- Keep workflow examples compact enough to render well in narrow chat/browser
  previews.

### Optional semantic checks

Layout validation cannot infer domain truth from labels or cards. When source
evidence establishes roots, terminals, mandatory direct relationships, or
mandatory directed reachability, encode those facts in `semanticChecks`:

```json
"semanticChecks": {
  "allowedRoots": ["request", "resource_catalog"],
  "allowedTerminals": ["reply", "audit_log"],
  "requiredEdges": [
    { "from": "dispatch", "to": "dispatch_ledger" }
  ],
  "requiredPaths": [
    { "from": "event_ledger", "to": "runtime_host" }
  ]
}
```

When `allowedRoots` or `allowedTerminals` is present, it is the complete allow
list for zero-incoming or zero-outgoing nodes respectively. `requiredEdges`
requires one exact authored direction; `requiredPaths` permits intermediate
nodes but follows authored edge direction. These checks run before layout, do
not alter SVG or receipt bytes, and must not be weakened merely to resolve a
route or composition diagnostic. Omit fields whose domain facts are unknown.

Schema violations exit non-zero with path-prefixed messages annotated with the
element's id or label. The renderer additionally fails when it can detect
layout problems, including node overlap, nodes outside their lanes, invalid
phase/group column ranges, empty groups, broken `mainPath` steps, unknown edge
targets, labels colliding with nodes or other labels, labels wider than their
node, legends outside the viewBox, or straight arrows that are too short to
read cleanly. The shared Clean Flow Gate also rejects edges crossing unrelated
nodes with 2px clearance; lanes, phases, and groups remain intentional
pass-through containers. Text width is estimated CJK-aware: fullwidth glyphs
count as two units.

Diagnostics are causal: a rank-capacity failure suppresses derivative short
edge, endpoint-direction, and label-overlap findings. Every
`supportedFixes[]` entry is verified by replanning the proposed edit, and a
diagnostic never proposes removing a semantic label when label presence does
not cause the failed invariant.

Set `meta.quality_profile` to `showcase` for polished delivery. Unrelated proper
X crossings then fail with `composition/proper-crossing`; default `standard`
keeps them as artifact-receipt warnings. Collinear lane corridors are outside
the proper-X rule, but a separate gate warns in `standard` and fails in
`showcase` when unrelated edges overlap for at least 8px. Shared semantic
endpoints, point touches, and shorter overlaps remain valid. Showcase also
rejects any route segment below 8px and any interior turn segment below 16px;
ordinary 8–15px endpoint stubs remain valid for fixed lane gaps.
