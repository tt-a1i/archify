# Lifecycle Renderer

Render `diagram_type: "lifecycle"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/lifecycle/render-lifecycle.mjs input.lifecycle.json output.html
```

If `output.html` is omitted, the renderer uses `meta.output` from the JSON file
or falls back to `lifecycle.html` in the current working directory.

## Input

Lifecycle JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "lifecycle",
  "meta": {
    "title": "Agent Run Lifecycle",
    "subtitle": "Lifecycle phases, interruptions, recovery, and terminal exits",
    "viewBox": [980, 660]
  },
  "lanes": [],
  "states": [],
  "transitions": [],
  "cards": []
}
```

The schema lives at:

```text
archify/schemas/lifecycle.schema.json
```

## Design Rules

- Treat lifecycle diagrams as a phase map, not a dense state-transition graph.
- Put the primary lifecycle on one horizontal rail using the `main` lane.
- Use `step` labels for ordered phases, such as `01`, `02`, and `03`.
- Use lower lanes only for interruptions, recovery, and terminal exits.
- Keep transition labels out of the main SVG unless the label is essential;
  prefer node labels, tags, legend entries, and summary cards.
- Avoid diagonal and crossing lines. Terminal exits should drop vertically from
  their source event whenever possible.
- Use `success` for completion, `failure` for failure/terminal exits,
  `waiting` for pauses, and `decision` for quality gates.

The renderer fails when it can detect layout problems, including duplicate state
IDs, unknown lanes, unknown transition endpoints, states outside their lanes,
overlapping states, unreadably short transitions, or a legend outside the
viewBox.
