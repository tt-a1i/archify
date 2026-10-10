# Data Flow Renderer

Render `diagram_type: "dataflow"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/dataflow/render-dataflow.mjs input.dataflow.json output.html
```

The renderer validates input against `archify/schemas/dataflow.schema.json`
with the bundled standalone validator. No dependency installation is required.

If `output.html` is omitted, the renderer uses the required `meta.output` value
from the JSON file.

## Input

Data-flow JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "dataflow",
  "meta": {
    "title": "Product Analytics Data Flow",
    "output": "product-analytics-dataflow.html",
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

## Legend

The default visual legend derives kinds from `flows[].variant` (omitting
`variant` means `default`) and adds `database` only when a database node exists.
Supported `meta.legend.entries` keys, in stable order, are `emphasis`,
`security`, `dashed`, `database`, and `default`. Flow variants remain
visual-only because Archify has no compiled edge-kind facts in this slice. A
present `database` entry is different: it comes from exact
`nodes[].type: "database"` facts, so it publishes the normal Semantic Legend
count, accessible name, and keyboard interaction. Forcing `database` visible
without a database node keeps it visual-only.

## Layout budget

| Constant | Value |
|----------|-------|
| viewBox | omitted width fits all stage frames and nodes, including authored widths, with 24px right padding and a 480px minimum (five default-width stages need 1068); height defaults to 720 and fits content in fully automatic showcase; schema minimum `[360, 360]` |
| Stages (2–5) | centers at x = 100 + stage×215; stage band 168 wide, header at y 46 |
| Row tops (`row` 0–4) | y = 128, 242, 356, 470, 584 (plus `yOffset`) |
| Default node | 112×58 |
| Node area | x within `[24, width − 24]`; y within `[104, height − 74 − node height]` |
| Node spacing | ≥10px between any two nodes (checked across stages and rows) |
| Flow length | ≥34px between endpoints |
| Legend row | y = height − 36 |

Route presets for flows: `straight`, `vertical-channel`, `bottom-channel`,
`top-channel`, explicit `via` points, or the default `auto` (midpoint elbow).

An authored `meta.viewBox` remains authoritative. When it is omitted, canvas
width fits stage frames and nodes in both `standard` and `showcase`, including
explicit node widths. Enlarging width cannot repair left-edge overflow.

Showcase node sizing, typography, automatic height, port bridges and label
placement apply only when `meta.viewBox` and every node's `width` are omitted.
An authored canvas or node width preserves those established layout behaviors,
as does `standard`. The effective quality profile is
`process.env.ARCHIFY_QUALITY_PROFILE || meta.quality_profile`; the public CLI's
`--quality standard|showcase` sets the environment override.

For a fully automatic showcase, node widths can grow within their stage and
canvas budget to keep supporting text readable at desktop projection. Height
follows actual node bounds, routed points and rendered label plates, leaving
24px below content plus the 74px stage/legend reserve. Rows and authored routes
remain authoritative; inactive channel controls do not enlarge the canvas.

Automatic routes use perpendicular bridges for vertical ports and small
port-spread differences. Unpinned labels receive one bounded placement pass,
with at most 36px mask clearance from their own route. Distant free space is
rejected in favor of the original placement and its collision diagnostic.
Explicit `labelAt`, `labelDx`, `labelDy` and `labelSegment` remain authoritative,
including zero offsets. Existing valid labels are retained.

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
the readable diagram area (`dataflow/node-above-area` / `dataflow/node-below-area`;
the below-area diagnostic offers `meta.viewBox[1]` raises only while the raised
page still fits the target viewport, and names the height range that does —
page containment is the modeled axis, while projected text readability is
reported separately by the delivery checks (`viewer/projected-text-readability`)),
node overlap, labels colliding with nodes or other
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
