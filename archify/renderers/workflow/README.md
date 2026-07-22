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
  "schema_version": 1,
  "diagram_type": "workflow",
  "meta": {
    "title": "Agent Tool Call Workflow",
    "subtitle": "Renderer-driven workflow prototype"
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

Omit `meta.viewBox` for the common case: the width is fixed at 720 and the
height is derived from the lane count, so lanes and legend always fit. A
complete worked example lives at
`archify/examples/agent-tool-call.workflow.json`.

The schema lives at:

```text
archify/schemas/workflow.schema.json
```

## Layout budget

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
3↔4 (70px) cannot both hold default-width 92px nodes in the same lane — skip a
column or reduce `width`.

## Design Rules

- Use lanes for ownership or runtime boundaries.
- Use phase headers for high-level story beats such as Intake, Plan, Execute, and Report.
- Use groups for parallel checks, branch handling, or bounded work within a lane; every group must contain at least one node.
- Use `lane.variant: "exception"` for human wait, denial, retry, fallback, and failure lanes instead of mixing those paths into the happy path.
- Set `mainPath` when the diagram has a clear happy path; the renderer validates that consecutive ids have matching edges and move left-to-right.
- Place nodes with lane IDs and column indexes, not raw SVG coordinates.
- Leave short adjacent links unlabeled; the arrow is enough.
- Use labels for cross-lane decisions, approvals, async traces, and return paths.
- Prefer route presets — `drop` (bend between lanes; `bias` 0–1 picks where),
  `outside-right`, `return-left`, `bottom-channel`, and `up-channel` — before
  using raw `via` points. `straight` and the default `auto` cover the rest.
- Keep workflow examples compact enough to render well in narrow chat/browser
  previews.

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

Set `meta.quality_profile` to `showcase` for polished delivery. Unrelated proper
X crossings then fail with `composition/proper-crossing`; default `standard`
keeps them as artifact-receipt warnings. Collinear lane corridors are outside
the proper-X rule, but a separate gate warns in `standard` and fails in
`showcase` when unrelated edges overlap for at least 8px. Shared semantic
endpoints, point touches, and shorter overlaps remain valid. Showcase also
rejects any route segment below 8px and any interior turn segment below 16px;
ordinary 8–15px endpoint stubs remain valid for fixed lane gaps.
