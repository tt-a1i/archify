# Lifecycle Renderer

Render `diagram_type: "lifecycle"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/lifecycle/render-lifecycle.mjs input.lifecycle.json output.html
```

The renderer validates input against `archify/schemas/lifecycle.schema.json`
with the bundled standalone validator. No dependency installation is required.

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

Lane ids are semantic and reserved: a lane with id `main` is required and maps
to the top phase band; `terminal` maps to the bottom outcome band; every other
lane id (up to 4 lanes total) shares the single middle event band. The three
band headers render from your lane labels — the middle band joins the labels of
all event lanes with ` + `. A complete worked example lives at
`archify/examples/agent-run.lifecycle.json`.

The schema lives at:

```text
archify/schemas/lifecycle.schema.json
```

## Layout budget

| Band | Lane id | Top y | Column centers | Default state |
|------|---------|-------|----------------|---------------|
| Phase | `main` (required) | 126 | `col` 0–4 → x = 94, 248, 402, 556, 710 | 118×62 |
| Event | any other id | 278 | `col` 0–2 → x = 402, 556, 710 | 126×58 |
| Outcome | `terminal` | 450 | `col` 0–2 → x = 402, 556, 710 | 118×58 |

| Constant | Value |
|----------|-------|
| viewBox | default `[980, 660]`; schema minimum `[420, 360]` |
| State area | x within `[32, width − 32]`; y within `[64, legend y − 24]` |
| State spacing | ≥10px between any two states — checked across lanes, because all event lanes share one band; separate same-band states with `col` or `yOffset` |
| Transition length | ≥32px between endpoints |
| Legend row | y = height − 98 |

The primary lifecycle rail runs along the phase band and extends to the
furthest occupied phase column. Route presets for transitions: `straight`,
`drop` (bend at `channelY`, defaulting to the vertical midpoint),
`bottom-channel`, `top-channel`, `right-channel`, `left-channel`, explicit
`via` points, or the default `auto`. Multi-segment transitions get rounded
corners; tune them with `cornerRadius` (default 10, `0` for sharp bends).

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

Schema violations exit non-zero with path-prefixed messages annotated with the
element's id or label. The renderer additionally fails when it can detect
layout problems, including a missing `main` lane, duplicate state IDs, unknown
lanes, unknown transition endpoints, states outside the lifecycle area,
overlapping states (including across lanes), labels colliding with states or
other labels, labels wider than their state, unreadably short transitions, or
transitions crossing unrelated states (2px Clean Flow clearance). Lifecycle
bands remain intentional pass-through containers.
Text width is estimated CJK-aware: fullwidth glyphs count as two units.

Set `meta.quality_profile` to `showcase` for polished delivery. Unrelated proper
X crossings then fail with `composition/proper-crossing`; default `standard`
keeps them as artifact-receipt warnings. The final artifact check samples
rounded `Q` corners, while shared endpoints, touches, and collinear corridors
remain exempt. Showcase also rejects any route segment below 8px and any
interior turn segment below 16px; ordinary 8–15px endpoint stubs remain valid.
