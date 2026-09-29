# Lifecycle Renderer

Render `diagram_type: "lifecycle"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/lifecycle/render-lifecycle.mjs input.lifecycle.json output.html
```

The renderer validates input against `archify/schemas/lifecycle.schema.json`
with the bundled standalone validator. No dependency installation is required.

If `output.html` is omitted, the renderer uses the required `meta.output` value
from the JSON file.

## Input

Lifecycle JSON files must set:

```json
{
  "schema_version": 2,
  "diagram_type": "lifecycle",
  "meta": {
    "title": "Deployment Release Lifecycle",
    "output": "deployment-release-lifecycle.html"
  },
  "lanes": [],
  "states": [],
  "transitions": [],
  "cards": []
}
```

`schema_version` is `1` or `2`; author new diagrams as `2`. Lane ids `main`
(required) and `terminal` are reserved in both versions.

- **v2** renders one row per populated lane: `main` first, `terminal` last,
  other lanes in `lanes[]` order, each titled in the left gutter. A complete
  example lives at `archify/examples/deployment-release.lifecycle.json`.
- **v1** keeps the fixed three bands: `main` is the top phase band,
  `terminal` the bottom outcome band, and every other lane shares the middle
  event band, whose header joins their labels with ` + `. A complete example
  lives at `archify/examples/agent-run.lifecycle.json`.

The schema lives at:

```text
archify/schemas/lifecycle.schema.json
```

## Legend and state marks

State color follows `states[].type`: active and start are cyan, waiting amber,
decision purple, success green, failure rose, neutral and external slate.
Structure is drawn, not colored: every `start` state gets a UML initial marker
(a dot and arrow into its left side), and a state with no outgoing transition
gets a double border as a final state (in v1, a main state followed by
another main column is not final, because the implied rail continues).

The default legend derives kinds from `states[].type`; the `start` entry shows
the initial marker, and a non-interactive `final` entry appears when a final
state exists. Supported `meta.legend.entries` keys, in stable order, are
`start`, `active`, `waiting`, `decision`, `success`, `failure`, `neutral`, and
`external`. Labels and visibility may be overridden through the shared legend
contract; only kinds backed by rendered states receive Semantic Legend
controls.

State decorations share one top rail: the type sigil and `step` on the left,
the brand mark at the right corner, and the Viewer's runtime source badge just
left of the brand. Label layout reserves the badge's width whenever the state
has verified repository sources.

## Layout budget (v2)

| Item | Value |
|------|-------|
| Columns | `col` 0–4, one x grid shared by every row |
| Default state | 140×64 (text 11px label, 8px sublabel and tag) |
| Column gap | 64px, widened until a labelled same-row neighbour transition fits beside its line; all gaps shrink toward 44px when the canvas would exceed the desktop readability budget of the smallest state text |
| Row gap | at least 120px, opened further for the horizontal tracks its routes need |
| Canvas | sized from the rows, columns, and measured legend when `meta.viewBox` is omitted; an authored `viewBox` is honored and validated |

Transitions without `via`, a channel, or a non-`auto` route use the v2 grid
router: neighbours in one row connect horizontally (a reciprocal pair runs as
two parallel lines), rows connect through the facing top/bottom sides with one
turn in a row gap, a state blocking a straight descent sends the route through
the empty corridor between columns, and an unlabelled route blocked in an
outer column loops around the outside of the grid. Each gap assigns tracks in
the order that minimizes crossings. There is no implied rail; a forward
transition between two `main` states without a `variant` renders as the
emphasized primary path. Showcase labels are ranked beside their line, then on
it, then outward past neighbouring parallels.

Explicit `fromSide` / `toSide` values remain authoritative. Pins that match the
grid router's chosen sides keep its routes and adaptive row gaps. If an automatic
transition pins a different side, the scene uses the shared side-aware obstacle
planner, retaining the v2 state grid and shared port spreading.

## Layout budget (v1)

| Band | Lane id | Top y | Column centers | Default state |
|------|---------|-------|----------------|---------------|
| Phase | `main` (required) | 126 | `col` 0–4 → x = 94, 248, 402, 556, 710 | 118×62 |
| Event | any other id | 278 | `col` 0–2 → x = 402, 556, 710 | 126×58 |
| Outcome | `terminal` | 450 | `col` 0–2 → x = 402, 556, 710 | 118×58 |

Event and terminal columns are intentionally offset from the main rail:
event/terminal `col: N` uses the same x coordinate as main `col: N + 2`.
For example, lower-band columns 0, 1, and 2 align beneath main columns 2, 3,
and 4 respectively.

| Constant | Value |
|----------|-------|
| viewBox | default `[980, 660]`; schema minimum `[420, 566]` |
| State area | x within `[32, width − 32]`; state bottom at or above `height − 122` |
| State spacing | ≥10px between any two states — checked across lanes, because all event lanes share one band; separate same-band states with `col` or `yOffset` |
| Transition length | ≥32px between endpoints |
| Legend row | final baseline y = height − 36; extra measured rows wrap upward |

The primary lifecycle rail runs along the phase band and extends to the
furthest occupied phase column. Route presets for transitions: `straight`,
`drop` (bend at `channelY`, defaulting to the vertical midpoint),
`bottom-channel`, `top-channel`, `right-channel`, `left-channel`, explicit
`via` points, or the default `auto`. Multi-segment transitions get rounded
corners; tune them with `cornerRadius` (default 10, `0` for sharp bends).

Transition `label` and `note` are independently optional. A non-empty `note`
renders even when `label` is omitted or empty, using its existing secondary
text style on a single row and retaining the note's fine-detail visibility.
With both fields present, the note stays below the label. Notes participate in
automatic label placement, route-space reservation, and label collision checks;
the existing `labelAt`, `labelDx`, `labelDy`, and
`labelSegment` controls also position a note-only text block.

## Design Rules

- Treat lifecycle diagrams as a phase map, not a dense state-transition graph.
- Put the primary lifecycle on one horizontal row using the `main` lane; in v2,
  author each step of it as a transition.
- In v2, place an interruption, recovery, or exit in the column of the state it
  leaves so its transition drops straight down.
- Use `step` labels for ordered phases, such as `01`, `02`, and `03`.
- Use lower lanes only for interruptions, recovery, and terminal exits.
- Keep transition labels out of the main SVG unless the label is essential;
  prefer node labels, tags, legend entries, and summary cards.
- Prefer axis-aligned lines and avoid crossings. Terminal exits should drop
  vertically from their source event whenever possible. Explicit `straight`
  routes remain supported; see the [authored routing contract](../../references/authoring-contract.md#executable-geometry-rules).
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
rounded `Q` corners. Collinear corridors remain outside the proper-X rule, but
a separate gate warns in `standard` and fails in `showcase` when unrelated
transitions overlap for at least 8px. Shared semantic endpoints, point touches,
and shorter overlaps remain valid. Showcase also rejects any route segment
below 8px and any interior turn segment below 16px; ordinary 8–15px endpoint
stubs remain valid.
