# Data Flow Renderer

Render `diagram_type: "dataflow"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/dataflow/render-dataflow.mjs input.dataflow.json output.html
```

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
    "viewBox": [900, 720]
  },
  "stages": [],
  "nodes": [],
  "flows": [],
  "cards": []
}
```

The schema lives at:

```text
archify/schemas/dataflow.schema.json
```

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

The renderer fails when it can detect layout problems, including missing stages,
duplicate node IDs, nodes outside the readable diagram area, node overlap,
unknown flow endpoints, missing flow labels, unreadably short flows, or stages
that exceed the viewBox.
