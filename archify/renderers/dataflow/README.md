# Data Flow Renderer

Render `diagram_type: "dataflow"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/dataflow/render-dataflow.mjs input.dataflow.json output.html
```

The renderer validates input against `archify/schemas/dataflow.schema.json`
with the bundled standalone validator. No dependency installation is required.

If `output.html` is omitted, the renderer uses `meta.output` from the JSON file
or falls back to `dataflow.html` in the current working directory.

## Input

Data-flow JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "dataflow",
  "meta": {
    "title": "Product Analytics Data Flow",
    "subtitle": "Events, consent, PII isolation, warehouse sync, and consumers",
    "viewBox": [940, 720]
  },
  "stages": [],
  "nodes": [],
  "flows": [],
  "cards": []
}
```

A complete worked example lives at
`archify/examples/product-analytics.dataflow.json`.

The schema lives at:

```text
archify/schemas/dataflow.schema.json
```

## Layout budget

| Constant | Value |
|----------|-------|
| viewBox | default `[940, 720]`; schema minimum `[360, 360]` |
| Stages (2–5) | centers at x = 100 + stage×215; stage band 168 wide, header at y 46 |
| Row tops (`row` 0–4) | y = 128, 242, 356, 470, 584 (plus `yOffset`) |
| Default node | 112×58 |
| Node area | x within `[24, width − 24]`; y within `[104, height − 74]` |
| Node spacing | ≥10px between any two nodes (checked across stages and rows) |
| Flow length | ≥34px between endpoints |
| Legend row | y = height − 36 |

Route presets for flows: `straight`, `vertical-channel`, `bottom-channel`,
`top-channel`, explicit `via` points, or the default `auto` (midpoint elbow).

## Design Rules

- Use stages for data lifecycle boundaries: source, ingest, process, store,
  consume.
- Place nodes by stage index and row index; do not hand-place raw SVG for the
  common case.
- Use flow labels to name the data asset, not the transport primitive:
  `clickstream`, `identity map`, `normalized facts`, `feature vectors`.
- Use `classification` for short sensitivity or governance context:
  `PII touch`, `non-PII`, `approved only`, `batch`, `read-only`.
- Use `security` for PII, policy, consent, access-control, or restricted joins.
- Use `emphasis` for the primary data path and `dashed` for async or batch
  derivations.
- Keep labels short enough to fit in narrow previews.

Schema violations exit non-zero with path-prefixed messages annotated with the
element's id or label. The renderer additionally fails when it can detect
layout problems, including missing stages, duplicate node IDs, nodes outside
the readable diagram area, node overlap, labels colliding with nodes or other
labels, labels wider than their node, unknown flow endpoints, missing flow
labels, unreadably short flows, flows crossing unrelated nodes (2px Clean Flow
clearance), or stages that exceed the viewBox. Stage frames remain intentional
pass-through containers. Text width
is estimated CJK-aware: fullwidth glyphs count as two units.

Set `meta.quality_profile` to `showcase` for polished delivery. Unrelated proper
X crossings then fail with `composition/proper-crossing`; default `standard`
keeps them as artifact-receipt warnings. Collinear stage corridors are outside
the proper-X rule, but a separate gate warns in `standard` and fails in
`showcase` when unrelated flows overlap for at least 8px. Shared semantic
endpoints, point touches, and shorter overlaps remain valid. Showcase also
rejects any route segment below 8px and any interior turn segment below 16px;
ordinary 8–15px endpoint stubs remain valid.
