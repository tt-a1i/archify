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
count, so the layout never needs hand-measured sizes. A attribute's `key` accepts
`pk`, `fk`, or `uk`, and `references` names the target as `"entity.attribute"`.

A relationship reads `from` -> `to` and is drawn with crow's foot notation at
both ends. `fromCardinality`/`toCardinality` accept `one` or `many`, and
`fromOptional`/`toOptional` add the optional circle. Omitted cardinality means
`many` -> `one`: the ordinary foreign-key shape where many child rows point at
one parent row. `identifying: false` draws the non-identifying dashed line.

## Layout and routing

`layout.mode: "grid"` places each entity by `row`/`col`. Every raw attribute index
owns the width of its widest entity and every raw row index owns the height of
its tallest, so boxes in one band line up without hand measurement and an empty
index leaves a routing channel. `pos` overrides the cell for a bounded
exception.

Relationships route through the shared orthogonal router, so the same contracts
as every other type apply: automatic port spreading on a shared entity, the
endpoint-side contract, the route-rhythm floors, and the universal Clean Flow
gate. Two differences are specific to this renderer:

- Relationships that would share one corridor get a deterministic lane offset,
  so parallel foreign keys never sit on the identical channel line.
- Relationships that share one entity side (a fan-in of foreign keys, or a
  fan-out parent) and one marker style bundle onto a single trunk just outside
  that side: one bus line with a short branch per relationship, instead of a
  sheaf of parallel lanes. The trunk is only a preferred route — a branch that
  would break the endpoint contract or clip an entity falls back to the
  ordinary families and stays unbundled, and anything authored (`route`,
  `via`, `labelAt`) keeps its own line. Logical routes still traverse the
  trunk, so every gate, label, and the layout report see the full geometry.
- Entity boxes are opaque obstacles. When a third entity sits between two
  aligned anchors, the renderer emits a U-shaped detour around it, and a route
  that still cannot clear an unrelated entity fails with
  `clean-flow/edge-through-node` rather than being drawn through the box.

The renderer also reports ER-specific diagnostics: unknown entities in
`from`/`to`, unknown attribute names and unresolved `references`, duplicate attribute
names, self-referencing relationships, overlapping entity boxes, and rows whose
text cannot fit inside the declared entity width.

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
domain the same concise `tag` and keep them in a contiguous, non-interleaved block.
A wide entity is a taller wall for the router to get around, and the projected text
minimum still applies at 1440x900, so prefer a compact grouped grid and a smaller
number of columns before shrinking or hiding fields.
