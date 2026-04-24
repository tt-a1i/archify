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
    "subtitle": "State machine for planning, execution, waits, retries, and terminal outcomes",
    "viewBox": [980, 720]
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

- Use lanes for lifecycle layers: active run states, suspended states,
  recovery loops, and terminal outcomes.
- Place states with lane IDs and column indexes.
- Keep the active path left-to-right, then exit into a distinct terminal
  outcome when the lifecycle ends.
- Use `success` for terminal success, `failure` for failure/terminal error,
  `waiting` for pauses, and `decision` for gates.
- Use `emphasis` for the main transition path.
- Use `security` for cancellation, timeout, failure, policy, and blocked paths.
- Use `dashed` for retry, resume, async, or non-primary transitions.
- Keep transition labels short: `start`, `plan ready`, `needs approval`,
  `retry`, `timeout`, `cancel`.

The renderer fails when it can detect layout problems, including duplicate state
IDs, unknown lanes, unknown transition endpoints, states outside their lanes,
overlapping states, unreadably short transitions, or a legend outside the
viewBox.
