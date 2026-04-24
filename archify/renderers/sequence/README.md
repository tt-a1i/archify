# Sequence Renderer

Render `diagram_type: "sequence"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/sequence/render-sequence.mjs input.sequence.json output.html
```

If `output.html` is omitted, the renderer uses `meta.output` from the JSON file
or falls back to `sequence.html` in the current working directory.

## Input

Sequence JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "sequence",
  "meta": {
    "title": "Cache Miss Request Sequence",
    "subtitle": "Frontend request path with auth and cache fallback",
    "viewBox": [820, 760]
  },
  "participants": [],
  "segments": [],
  "messages": [],
  "activations": [],
  "cards": []
}
```

The schema lives at:

```text
archify/schemas/sequence.schema.json
```

## Design Rules

- Put participants across the top, ordered by the story the reader should
  follow.
- Time moves downward.
- Use `emphasis` for the main request path.
- Use `security` for auth, consent, permission, and policy calls.
- Use `return` for quiet response messages.
- Use `dashed` for async trace, event, logging, and non-blocking work.
- Use segments as light background guides; keep segment labels short.
- Keep labels short enough to fit in narrow previews.

The renderer fails when it can detect layout problems, including missing
participants, duplicate participant IDs, unknown message endpoints, messages
outside the readable timeline, overly tight vertical message spacing, invalid
activation ranges, or participants that exceed the viewBox.
