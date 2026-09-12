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
- Entity boxes are opaque obstacles. When a third entity sits between two
  aligned anchors, the renderer emits a U-shaped detour around it, and a route
  that still cannot clear an unrelated entity fails with
  `clean-flow/edge-through-node` rather than being drawn through the box.

The renderer also reports ER-specific diagnostics: unknown entities in
`from`/`to`, unknown attribute names and unresolved `references`, duplicate attribute
names, self-referencing relationships, overlapping entity boxes, and rows whose
text cannot fit inside the declared entity width.

## Reading a schema

Show the keys and the few attributes a reader needs; put the full table in
`cards`. A wide entity is a taller wall for the router to get around, and the
projected text minimum still applies at 1440x900, so a box that fights the
layout is usually a sign to cut attributes rather than to widen the box.
