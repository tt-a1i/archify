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
`pk`, `fk`, or `uk`, or a list of them: a junction table's column is often part of
the primary key and a foreign key to the same parent, and stating one role would
hide the other. Each role draws its own badge, tinted in its legend's family, a
role named twice draws once, and the key column is measured from the widest badge
run in the table — never narrower than the shared width, wider when the badges
need it. Every `fk`
role — alone or inside a list — must also name its target as `"entity.attribute"`
in `references`, and that target is checked against the declared entities and
attributes.

A relationship reads `from` -> `to` and is drawn with crow's foot notation at
both ends. The foot opens toward the entity whose cardinality it describes: its
toes stand on that table's edge and its apex sits one foot back along the line,
so the glyph cannot be read as an arrowhead pointing at the table. Both ends
declare their own maximum: `fromCardinality`/`toCardinality` take `one` or
`many` and are required, because a maximum the author never stated is a fact the
diagram would be inventing; `fromOptional`/`toOptional` add the optional circle
past the apex and lower that end's minimum from one to zero.
`identifying: false` draws the non-identifying dashed line, and it owns the dash:
a `variant` that would draw the relationship solid alongside it is rejected by
the schema, because the solid line would state the opposite of the fact. The
variant still selects the accent for every identifying relationship.

## Layout and routing

`layout.mode: "grid"` places each entity by `row`/`col`. Every raw attribute index
owns the width of its widest entity and every raw row index owns the height of
its tallest, so boxes in one band line up without hand measurement and an empty
index leaves a routing channel. `pos` overrides the cell for a bounded
exception.

Relationships route through the orthogonal router the other typed renderers use
(`../architecture/routing.mjs`), so the same contracts apply: automatic port
spreading on a shared entity, the endpoint-side contract, the route-rhythm
floors, and the universal Clean Flow gate. The ERD is a caller, not a fork: it
passes `sideFor`, `maxPortSpacing`, `preferredCandidates`, and
`compositionFloors: false`, and reads the planning-free `inferredSides` and the
`ports` map. Each option is inert when omitted, which is how architecture and
lifecycle keep their routing byte for byte. Five differences are specific to this
renderer:

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
tables carrying that tag fill a solid rectangle of grid cells — every cell of
their bounding box holds one of them. A single row, a single column, and a filled
rectangular block are all that same claim (an L or diagonal is not); a one-table
domain is that claim at its smallest. The
band is measured from the placed boxes and carries the tag as its caption, which
is what makes a grouped schema readable at a glance: the reader sees blocks
instead of six equally weighted boxes.

A tag whose members do not fill one rectangle earns no band, because a band
around them would enclose cells the domain does not own and claim a grouping the
placement contradicts. The band is the only place a domain name is drawn, so the
renderer returns `erd/domain-not-drawn` rather than publishing a diagram whose
tables are complete and whose domain cannot be named. Move the members into one
rectangle, split the tag, or drop it. The same diagnostic covers the other ways the
name can go missing: a member placed outside the grid, because a band is measured
from cells and absolute coordinates have none; two members in one cell, which the
grid placement check reports instead so the author gets the pair that has to move;
a band whose padding would cover an unrelated table, which happens when
`layout.gapX`/`gapY` are smaller than the padding; and a caption the canvas does
not reach, which a `layout.origin` closer to the edge than the padding produces.

The header carries the table title alone. It is centered on the table's own
center line and held inside the interval it is measured against — the sigil porch
on the left, the padding on the right — so it does not run past either while the
shared text model's advance estimate holds. A title that cannot fit the header at
a readable size raises `erd/header-text-capacity`; widen the table or shorten the
title. Existing header and entity dimensions are preserved unless the author
changes them. An authored `sublabel` is not drawn: it stays on the node as
`data-node-sublabel` and in the accessible name.

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

The legend has two groups split by a divider. Key entries draw the same badge a
field row draws; relationship entries draw a short route meeting a table edge
with the marker's own glyph. ERD kinds are column keys and relationship ends,
not node kinds, so the entries stay out of the Viewer's counted node lens, which
would badge each one with a false zero. Hovering or keyboard-focusing an entry
highlights its matches in the SVG itself: a key fades the other field rows and
outlines the matching badges; a relationship end recolours that glyph wherever
it is drawn and fades routes that do not carry it. Static exports keep the plain
legend.

A canvas taller than one screen is a normal schema, not a defect. An automatic
canvas declares `data-reader-fit="intrinsic-height"` and
`data-reader-min-text="7.5"`, which is the Reader's permission to narrow a tall
schema down to the point where the page fits — never below that declared minimum,
so the field rows stay readable and anything taller than that scrolls; an
authored `meta.viewBox` keeps the authored fit contract. Field rows, their types,
and the key glyph carry `data-detail="context"` on the text itself, because the
Reader sizes the diagram from the texts that declare a level — a field that is
only context inside a row group would be shrunk past the readable floor on a tall
schema.

Narrowing is a floor, not a goal. The bundled eleven-table example measures, at
1440x900 and with the same tables and typography, as a 1230x678 canvas the Reader
renders at the full 1346px (scale 1.09), so its field types land at 11.5px. The
same tables grouped as four horizontal domains instead form a 910x874 canvas that
the Reader narrows to 777px (scale 0.85), landing the same types at 9.0px. A
horizontal arrangement that reaches the reader width instead of being narrowed
still trades text size for the columns it needs, which is why the measurement
here is the pair and not a rule about which axis is right.

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
domain the same concise `tag` and keep them in one contiguous, non-interleaved run
— a row with adjacent columns or a column with adjacent rows; that run is what the
band is measured from. Give each domain a column of its own when the whole schema
has to be visible at once: the domain then reads top to bottom, the relationships
between neighbouring domains run left to right, and the canvas stays wide enough
for the Reader to show it at full text size. A wide entity is a taller wall for
the router to get around, and the projected text minimum still applies at
1440x900, so prefer a compact grouped grid over shrinking or hiding fields.
