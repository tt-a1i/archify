# Story authoring

```sh
node bin/archify.mjs story draft <native.html> <brief.json> --json
node bin/archify.mjs story attach <native.html> <brief.json> <enhanced.html> --json
```

`draft` writes the brief and `<brief-stem>.source.json`. Read the source map for
actual node IDs, connection IDs, directions, groups and legends, then replace
the outline with a complete brief in the user's language. To inspect without
writing files, use `story scan <native.html> --json`.

```json
{
  "version": 2,
  "title": "How a task reaches the worker",
  "intro": "Establish the whole path before following its handoffs.",
  "outro": "The queue separates accepting a task from finishing its work.",
  "scenes": [{
    "title": "Dispatch the work",
    "points": [{
      "anchor": "worker",
      "via": "dispatch",
      "title": "The worker receives the task",
      "text": "Explain this responsibility and its consequence.",
      "caption": "The queued task reaches the worker."
    }]
  }]
}
```

Give each area a distinct job:

- **Top — `scene.title`:** the chapter's topic, question or central judgment;
  stable while its points unfold.
- **Bottom — `point.caption`:** narrate the current action and connect it to
  the preceding or next step.
- **Side — `point.title` and `point.text`:** explain responsibilities,
  relationship meaning, conditions, branches or scope, supported by the local
  drawing and relevant legend.

Write captions separately; omitting one falls back to the point title. Avoid
paraphrasing the same assertion across areas. Optional `meaning` explains a
legend symbol in context; `figureCaption` explains the local drawing. Omit
these when they only repeat a visible label or the subtitle. Choose content
from the actual diagram; fixed input/output slots are not required.

- `anchor` selects a node; optional `via` selects an edge ID or array. Endpoints
  join the frame automatically. Select the connections to demonstrate in
  `via`; prose alone does not select them. Standalone events need no edge.
- Points appear in order. Point `focus` adds context; scene `focus` applies to
  every point. Scene `side` can be `left` or `right`.
- Point or scene `action`: `trace` follows edges in order, `parallel` shows
  branches together, `relation` shows associations without transfer. ER, class,
  tree, timeline and waterfall default to relations. Simultaneous presentation
  does not prove concurrent execution. Replay a transfer in a separate scene;
  static relations may support several points in one scene.
- Preserve alternatives, loops, returns and containment. For sequences, retain
  message order and return styles; selected opposite connections can share a
  local exchange drawing. Derive pairing and causality from the source;
  distinguish acceptance from completion when relevant.

Keep default timing unless needed. Point `seconds` sets reading time (at least
4); `travel` sets transfer duration (0.5–3 seconds). Top-level `opening` accepts
`auto`, `fit`, `scan-x` or `scan-y`; `auto` tours long graphs when needed for
legibility. The opening is capped at six seconds automatically.
Optional top-level `accent` is a literal hex color: `#rgb`, `#rgba`, `#rrggbb`
or `#rrggbbaa` (for example, `#477bbe`).

For code excerpts, pass `--repo-root <repository>` to `story attach`. Point
`code` selects `node` (default: anchor), source index `source` (default: 0),
optional `fromLine`, `toLine` and `emphasis` line numbers. Use verified ranges
at the HTML's pinned revision, at most twenty lines; do not invent bindings.

Deliver the enhanced HTML and editable brief. Rebuild from the original native
HTML. Export video only when requested.
