# Entity-Relationship Renderer

Render `diagram_type: "erd"` JSON files into the standard Archify HTML template.

```bash
node archify/renderers/erd/render-erd.mjs input.erd.json output.html
```

The renderer validates input against `archify/schemas/erd.schema.json` with the
bundled standalone validator. No dependency installation is required.

If `output.html` is omitted, the renderer uses `meta.output` from the JSON file
or falls back to `erd.html` in the current working directory.

After rendering, run the artifact checker:

```bash
node archify/scripts/check-render-output.mjs output.html
```

## Input

ERD JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "erd",
  "meta": { "title": "Order management schema" },
  "entities": [],
  "relationships": [],
  "cards": []
}
```

An entity carries the table name in `label`, its attributes in `attributes`, and a
`row`/`col` cell in the banded grid. The box height follows the declared attribute
count, so the layout never needs hand-measured sizes. An attribute's `key` accepts
`pk`, `fk`, or `uk`; an `fk` must also name its target as `"entity.attribute"` in
`references`, and that target is checked against the declared entities and
attributes.

A relationship reads `from` -> `to` and is drawn with crow's foot notation at
both ends. The foot opens toward the entity whose cardinality it describes: its
toes stand on that table's edge and its apex sits one foot back along the line,
so the glyph cannot be read as an arrowhead pointing at the table. Both ends
declare their own maximum: `fromCardinality`/`toCardinality` take `one` or
`many` and are required, because a maximum the author never stated is a fact the
diagram would be inventing; `fromOptional`/`toOptional` add the optional circle
past the apex and lower that end's minimum from one to zero.
`identifying: false` draws the non-identifying dashed line.

## Layout and routing

`layout.mode: "grid"` places each entity by `row`/`col`. Every raw attribute index
owns the width of its widest entity and every raw row index owns the height of
its tallest, so boxes in one band line up without hand measurement and an empty
index leaves a routing channel. `pos` overrides the cell for a bounded
exception.

Relationships route through the shared orthogonal router, so the same contracts
as every other type apply: automatic port spreading on a shared entity, the
endpoint-side contract, the route-rhythm floors, and the universal Clean Flow
gate. Five differences are specific to this renderer:

- Endpoints resolve horizontal-first, like every other non-architecture type: a
  relationship leaves and enters on the left/right whenever the tables sit side
  by side, and only falls back to a top/bottom port when they share a column. The
  shared router's default is architecture's dominant-axis inference, which would
  split one fan-in into two groups whenever a target happened to sit further away
  vertically than horizontally.
- Automatic ports on one side spread up to 24 units apart, because a cardinality
  glyph is 14 units tall: at the shared 14-unit spread two crow's feet on one table
  edge read as a single smudge. That spacing is a cap, not a floor — a side only
  fits `(extent - 32) / (ends - 1)` — so a table with more relationship ends than
  its side has room for fails with `layout/marker-capacity`, which names the
  table, the side, the spacing, and the three ways out.
- Relationships that would share one corridor get a deterministic lane offset,
  so parallel foreign keys never sit on the identical channel line.
- Relationships that share one entity side (a fan-in of foreign keys, or a
  fan-out parent) and one marker style bundle onto a single trunk just outside
  that side: one bus line with a short branch per relationship, instead of a
  sheaf of parallel lanes. The trunk bridges one port step of uncovered bus, so
  the port spread above still reads as one line. The trunk is only a preferred
  route — a branch that would break the endpoint contract or clip an entity falls
  back to the ordinary families and stays unbundled, and anything authored
  (`route`, `via`, `labelAt`) keeps its own line. Logical routes still traverse
  the trunk, so every gate, label, and the layout report see the full geometry.
- Entity boxes are opaque obstacles. When a third entity sits between two
  aligned anchors, the shared obstacle grid routes around it, and a route that
  still cannot clear an unrelated entity fails with
  `clean-flow/edge-through-node` rather than being drawn through the box.

The renderer also reports ER-specific diagnostics: unknown entities in
`from`/`to`, unknown attribute names and unresolved `references`, duplicate attribute
names, self-referencing relationships, overlapping entity boxes, and rows whose
text cannot fit inside the declared entity width.

## Domain bands

`tag` names a table's functional domain, and a domain is drawn as a band when the
tables carrying that tag occupy a contiguous run of grid cells — one row with
adjacent columns, or one column with adjacent rows. The band is measured from the
placed boxes and carries the tag as its caption, which is what makes a grouped
schema readable at a glance: the reader sees blocks instead of six equally
weighted boxes.

A tag spread across the canvas earns no band, because a band around the gap would
claim a grouping the placement contradicts; that tag stays in the table header
instead, together with any `sublabel`. A single-table domain always reads that
way. `sublabel` is the per-table note and is never drawn on a band.

## Cardinality ink

The crow's foot, the single bar, and the optional circle are drawn in the theme's
muted text ink rather than the shared arrow token: at the light theme's arrow
colour a glyph over a table fill sits near 2:1 contrast and reads as a smudge,
while the muted text ink clears the 3:1 non-text floor in both themes. The legend
repeats the same ink and stroke weight, and its labels render one step larger and
heavier than the shared legend default, so the legend shows the reader the exact
glyph the diagram draws.

## The legend band

The default legend is part of the generated content, so an automatic canvas is
sized to hold it: the shared measurement decides whether the reserved strip
fits, and the drawing area grows a band at a time until it does. A route or a
relationship label that still collides with the placed band is a real capacity
failure and raises the diagnostic instead of dropping the key, and an authored
`meta.viewBox` — a fixed drawing area — names the capacity it lacks
(`legend/vertical-overflow`, `legend/label-too-wide`, or `legend/content-overlap`,
each with the fix that resolves it).

A canvas taller than one screen is a normal schema, not a defect. An automatic
canvas declares `data-reader-fit="intrinsic-height"` and
`data-reader-min-text="7.5"`, so the Viewer scrolls it at a readable size instead
of shrinking the tables; an authored `meta.viewBox` keeps the authored fit
contract. Field rows, their types, and the key glyph carry
`data-detail="context"` on the text itself, because the Viewer sizes the diagram
from the texts that declare a level — a field that is only context inside a row
group would be shrunk past the readable floor on a tall schema.

## Typography

Table rows are text a reader scans, so the ERD's rhythm is looser than the generic
diagram rhythm: a 30-unit header, 20-unit rows, a 13-unit table name, 11-unit
field names, and a 10.5-unit type. The type keeps the same ink as the field name
because it is data, not an aside: at the muted token it measured 3.98:1 against a
table fill, under the 4.5:1 text floor, which is why it read as faint in review.
A row whose text cannot fit is a diagnostic rather than a silently truncated
cell, so a narrow table names the field it cannot show and asks for a wider box.

Field rows, their types, and the key glyph each carry `data-detail="context"` on
the text itself, not only on the row group: the Viewer's reader sizes the diagram
from the texts that declare a level, so a tall schema would otherwise be shrunk
past the readable floor. An automatic canvas also declares
`data-reader-fit="intrinsic-height"`, which is what lets a schema taller than one
screen scroll at a readable size instead of being squeezed to fit; an authored
`meta.viewBox` keeps the authored fit contract.

Relationship labels are set at 9 units in the relationship's own accent, with the
mask measured from the same factor, so a labelled schema keeps its semantic text
above the readable floor. They are the smallest text the diagram carries, and
they are semantic data: a collision is a repair (move the label, widen the
corridor), never a reason to drop the wording.

## Reading a schema

An ERD is also a table catalogue. For a schema with more than 8 tables or 50
fields, start with `meta.quality_profile: "standard"` so complete field
visibility remains the priority; promote to `showcase` only after the grouped
layout is genuinely readable. Include every physical column in
`entities[].attributes`, keep its SQL type, and preserve the source comment in the
type string as `SQL_TYPE｜中文备注` when the schema has no separate comment field.
The renderer shows ERD attribute rows at the default `read` level, so fields do
not depend on hover or focus. Use cards only for supplementary constraints,
inferred relationships, and domain rules; never use them to hide the full table.

Group tables by functional domain before assigning grid cells. Give members of one
domain the same concise `tag` and keep them in a contiguous, non-interleaved block;
that block is what the band is measured from. A wide entity is a taller wall for
the router to get around, and the projected text
minimum still applies at 1440x900, so prefer a compact grouped grid and a smaller
number of columns before shrinking or hiding fields.
