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

```json
{
  "schema_version": 3,
  "diagram_type": "lifecycle",
  "meta": { "title": "Deployment Release Lifecycle", "output": "deployment-release.html" },
  "mainPath": ["queued", "building", "verifying", "ready", "live"],
  "states": [],
  "transitions": [],
  "cards": []
}
```

A complete example lives at `archify/examples/deployment-release.lifecycle.json`.

- `mainPath` is the happy path from the initial state. Every consecutive pair
  needs a transition; the first such transition is drawn as the main row.
- `states[]` carry meaning only: `id`, `type`, `label`, optional `sublabel`,
  `tag`, `step`, `icon`, `brand` and `sources`.
- `transitions[]` carry `from`, `to`, optional `id`, `label`, `note` and
  `variant`. There are no routing or label-position controls.

## Layout

The geometry follows from the structure alone:

| Element | Placement |
|---------|-----------|
| Main path | One left-to-right row. Each gap fits its transition label. The first state receives the UML initial marker. |
| Loops and skips | A transition between two non-consecutive main-path states (or back to an earlier one, or a self-transition) is an arc above the row. Shorter arcs nest inside longer ones; ports order so an outer riser never crosses an inner arc. |
| Other states | One row per distance from the main path. A state starts under the states it connects to in the row above; overlapping states pack side by side. |
| Between rows | Orthogonal routes through a shared gap. Horizontal runs take separate tracks, chosen to minimise crossings; near-vertical routes snap straight or widen to a readable jog. |
| Shared exits | When one state is entered from several main-path phases through transitions that share label, note and variant, consecutive phases receive a dashed composite frame and one exit per target, as in a UML superstate; non-consecutive phases share a bus with junction dots. Exits that differ stay separate connectors with their own labels. |
| Same lower row | Neighbours connect side to side, parallel transitions fanning out around the shared edge (at most five per pair of states). Dense parallel labels and notes increase their lane spacing and the height of that lower row to keep clear; other pairs loop under the row. |
| Labels | Above main-path arrows, on arc and loop runs, otherwise beside the segment next to the lower state. Every label keeps clear of other routes, states and labels; if one cannot, all spacing grows and layout repeats. |

Every route carries a crossover halo, so an unavoidable crossing (for example,
two overlapping loops) stays legible. Lines are orthogonal with rounded corners.

## Legend and state marks

State color follows `states[].type`: active and start are cyan, waiting amber,
decision purple, success green, failure rose, neutral and external slate. The
first main-path state carries the initial marker; a state with no outgoing
transition gets a double border as a final state. The default legend derives
kinds from the rendered states, always lists the initial marker, and adds a
non-interactive `final` entry when a final state exists. Supported
`meta.legend.entries` keys, in stable order, are `start`, `active`, `waiting`,
`decision`, `success`, `failure`, `neutral`, and `external`.

State decorations share one top rail: the type sigil and `step` on the left and
the brand mark at the right corner. Only states a reader should notice get a
default sigil: `waiting` (hourglass), `decision` (diamond), `success` (check),
`failure` (cross) and `external`; `start`, `active` and `neutral` states have
none unless `icon` sets one, except as a final state, which gets a stop sigil
so every outcome is marked. State width grows from 140px to 220px to fit its
text at the preferred size (12px label, 9px sublabel, 8px tag) before the text
shrinks.

## Validation

Schema violations exit non-zero with path-prefixed messages. The renderer also
rejects duplicate state ids, unknown or repeated `mainPath` states, a
`mainPath` step without a transition, unknown transition endpoints, state text
that cannot fit the widest state, a canvas wider than its smallest text allows
on a desktop (`lifecycle/too-wide`), and a label that cannot be placed after the
spacing rounds (`lifecycle/label-unplaced`), and more than five parallel
transitions between two neighbouring states
(`lifecycle/crowded-side-transitions`). Each failure is a typed diagnostic
with supported fixes.

The final artifact check applies the shared composition gates (orthogonal
segments, crossings, corridors, label clearance and route rhythm). Routes of one
shared-exit bus declare `data-composition-junction`; they may share only that
horizontal bus, the identical first tick from the same source port, and, when
they end at the same state, the merged drop into it. Internal vertical runs
remain subject to the corridor check.

## Design rules

- Treat the main path as the story: about six phases at most.
- Put interruptions, waits and exits off the main path; the renderer places them.
- Give an exit shared by several phases one label, such as “cancel”.
- A recoverable failure needs a real transition back.
- Use `success` for completion, `failure` for failure exits, `waiting` for
  pauses, and `decision` for quality gates.
