# Sequence Renderer

Render `diagram_type: "sequence"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/sequence/render-sequence.mjs input.sequence.json output.html
```

The renderer validates input against `archify/schemas/sequence.schema.json`
with the bundled standalone validator. No dependency installation is required.

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
    "viewBox": [920, 760]
  },
  "participants": [],
  "segments": [],
  "messages": [],
  "activations": [],
  "cards": []
}
```

The timeline scales with the viewBox height: a taller `meta.viewBox` buys more
message room, a shorter one shrinks the readable band instead of clipping. A
complete worked example lives at
`archify/examples/cache-miss-request.sequence.json`.

The schema lives at:

```text
archify/schemas/sequence.schema.json
```

## Layout budget

| Constant | Value |
|----------|-------|
| viewBox | default `[920, 760]`; schema minimum `[480, 480]` |
| Participant boxes | 86×54 at y 72; centers at x = 62 + index×108 |
| Participant count | last center + 43 must be ≤ width − 40 (8 fit at width 920) |
| Lifelines | from y 142 down to height − 65; band must be ≥120px tall |
| Message `y` range | `[160, height − 83]` |
| Message spacing | ≥28px vertical between messages that share horizontal space |
| Arrow span | ≥60px horizontal between the two participants |
| Segments | y pixel ranges with `to > from`, inside `[72, lifeline bottom + 20]` |
| Legend row | y = height − 54 |

`segments[].from/to` and `activations[].from/to` are y pixel coordinates, not
participant ids; activations also require `to > from`.

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

Schema violations exit non-zero with path-prefixed messages annotated with the
element's id or label. The renderer additionally fails when it can detect
layout problems, including missing participants, duplicate participant IDs,
participant labels wider than their box, unknown message endpoints, messages
outside the readable timeline, overly tight vertical spacing between messages
that overlap horizontally, invalid segment or activation ranges, or
participants that exceed the viewBox. The shared Clean Flow contract treats
participant headers as semantic boxes while explicitly allowing messages to
cross intermediate lifelines, activation bars, and segment frames. Text width is estimated CJK-aware:
fullwidth glyphs count as two units.

Set `meta.quality_profile` to `showcase` for polished delivery. Unrelated proper
message X crossings then fail with `composition/proper-crossing`; default
`standard` keeps them as artifact-receipt warnings. Messages may still cross
intermediate lifelines, and shared endpoints/touches/collinear corridors remain
outside the proper-X contract. Showcase also rejects any route segment below
8px and any interior turn segment below 16px; ordinary 8–15px endpoint stubs
remain valid.
