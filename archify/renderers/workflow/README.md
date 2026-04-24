# Workflow Renderer

Render `diagram_type: "workflow"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/workflow/render-workflow.mjs input.workflow.json output.html
```

If `output.html` is omitted, the renderer uses `meta.output` from the JSON file
or falls back to `workflow.html` in the current working directory.

## Input

Workflow JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "workflow",
  "meta": {
    "title": "Agent Tool Call Workflow",
    "subtitle": "Renderer-driven workflow prototype",
    "viewBox": [720, 780]
  },
  "lanes": [],
  "nodes": [],
  "edges": [],
  "cards": []
}
```

The schema lives at:

```text
archify/schemas/workflow.schema.json
```

## Design Rules

- Use lanes for ownership or runtime boundaries.
- Place nodes with lane IDs and column indexes, not raw SVG coordinates.
- Leave short adjacent links unlabeled; the arrow is enough.
- Use labels for cross-lane decisions, approvals, async traces, and return paths.
- Prefer route presets such as `drop`, `drop-left`, `drop-right`,
  `outside-right`, and `bottom-channel` before using raw `via` points.
- Keep workflow examples compact enough to render well in narrow chat/browser
  previews.

The renderer fails when it can detect layout problems, including node overlap,
nodes outside their lanes, unknown edge targets, legends outside the viewBox, or
straight arrows that are too short to read cleanly.
