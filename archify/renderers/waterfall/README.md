# Execution Waterfall Renderer

Render `diagram_type: "waterfall"` JSON files into the standard Archify HTML template.

```bash
node archify/renderers/waterfall/render-waterfall.mjs input.waterfall.json output.html
```

`--layout-json` prints the axis, scale, ticks, and every row's timing and bar
geometry instead of HTML.

## Input

```json
{
  "schema_version": 1,
  "diagram_type": "waterfall",
  "meta": { "title": "Checkout request", "evidence": "illustrative", "unit": "ms" },
  "spans": [
    { "id": "request", "name": "POST /checkout", "start": 0, "end": 1200 },
    { "id": "auth", "name": "Authenticate caller", "start": 0, "duration": 100, "parent": "request" }
  ]
}
```

A span states `start` and either `end` or `duration` (both only if they agree),
in `meta.unit` (`us`, `ms`, or `s`; default `ms`), measured from a common trace
origin. `parent`, `status` (`ok`, `error`, `cancelled`, `incomplete`),
`service`, `detail`, and `sources` are optional. `meta.evidence`
(`measured` / `illustrative`) is required and drawn as a badge.

| Code | Refused input |
| --- | --- |
| `waterfall/invalid-timing` | end before start, end and duration that disagree, or no end/duration on a span that is not `incomplete` (negative values fail the schema) |
| `waterfall/missing-parent` | `parent` names an undeclared span |
| `waterfall/cycle` | parent links that loop |
| `waterfall/duplicate-id` | an id declared twice |

An `incomplete` span without an end is drawn to the last recorded instant of
the trace with a dashed body and an open edge, labelled `incomplete, ≥ X` — a
lower bound, never a measured duration. Several root spans are allowed.

## Layout

Rows are depth-first: every span is followed by its children in start order,
indented with tree guides in the name column, so nesting reads from the left
and time reads from the bar. One linear scale maps the trace from its earliest
start to its latest end onto `layout.width` (default 760 px); ticks use 1/2/2.5/5
steps. Overlapping bars on different rows are concurrent work.

A span with children is drawn as a tinted, outlined bracket over its time; a
span that does the work itself is a solid bar, so the paint separates inclusive
summaries from leaf work. Colour states the `service`: each service gets its own
palette family in order of first appearance (a span without one inherits its
parent's; unowned spans are neutral), with a dot in the name column and a legend
entry when more than one service appears. Red is reserved for `status: "error"`.

Each bar carries its exact duration just after its end; the canvas reserves
room past the axis for the widest label, so short operations stay labelled. The
header states the wall-clock total and range. The Semantic Passport shows the
exact start–end, duration, and share as "N% of T wall-clock"; parent durations
are inclusive and are never added to their children. No critical path or
waiting time is drawn: the input has no dependency model to support one.

## Tested size

`examples/example-rebuild.waterfall.json` is a measured trace: 25 spans from one
local run that rendered and checked eight bundled examples across three
concurrent workers (child-process start to exit, `performance.now()` offsets).
It renders in about 0.2s and passes the showcase gates.
