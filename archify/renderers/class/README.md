# Class and Interface Renderer

Render `diagram_type: "class"` JSON files into the standard Archify HTML template.

```bash
node archify/renderers/class/render-class.mjs input.class.json output.html
```

The renderer validates input against `archify/schemas/class.schema.json` with the
bundled standalone validator. No dependency installation is required. If
`output.html` is omitted, it uses `meta.output` or falls back to `class.html` in
the current working directory. `--layout-json` prints the placed types and
routes instead of writing HTML.

## Input

```json
{
  "schema_version": 1,
  "diagram_type": "class",
  "meta": { "title": "Payment module types" },
  "types": [],
  "relationships": [],
  "cards": []
}
```

A type carries its name in `label`, its `kind`, a `row`/`col` grid cell (or an
absolute `pos`), and optional `sublabel`, `attributes`, `methods`, and `sources`.
Authors choose the members the explanation needs; a type may show none.

| `kind` | Header | Colour family |
| --- | --- | --- |
| `class` | name only | backend |
| `abstract` | `«abstract»`, italic name | backend |
| `interface` | `«interface»` | frontend |
| `enum` | `«enumeration»`; `attributes` are the constants | messagebus |
| `record` | `«record»` | database |

An attribute is `{ name, type?, visibility?, static? }` and draws as
`+ name: Type`. A method is `{ name, parameters?, returns?, visibility?,
static?, abstract? }` and draws as `+ name(parameters): Returns`. Visibility
uses the UML glyphs `+` public, `#` protected, `~` package, `-` private; a
static member is underlined and an abstract method is italic. Interface
attributes describe property contracts (for example, TypeScript's
`interface Person { name: string }`); they do not imply stored implementation
state. Interfaces may also declare static constants.

## Relationships

Every relationship reads `from` -> `to`, and `kind` owns the whole notation, so
an implementation can never look like a call arrow:

| `kind` | Meaning | Line | Marker |
| --- | --- | --- | --- |
| `dependency` | `from` uses `to` | dashed | open arrow at `to` |
| `association` | `from` holds a reference to `to` | solid | open arrow at `to` |
| `inheritance` | `from` extends `to` | solid | hollow triangle at `to` |
| `realization` | `from` implements interface `to` | dashed | hollow triangle at `to` |
| `composition` | `from` owns `to` and its lifetime | solid | filled diamond at `from` |
| `aggregation` | `from` groups `to` without owning it | solid | hollow diamond at `from` |

Semantic checks: a realization runs from a non-interface to an interface
(`class/realization-target`); inheritance never crosses the interface boundary
(`class/inheritance-kind`); inheritance cannot form a cycle
(`class/inheritance-cycle`); a relationship cannot connect a type to itself.

## Layout

`layout.mode: "grid"` (the default) places types by `row`/`col` on the banded
grid shared with the ERD renderer: each column takes its widest type and each
row its tallest. Types are centred in their row band so a relationship between
two types of one row is a straight line. A half-step `col` (e.g. `1.5`) centres
a type between two columns without sizing either, which is how a supertype sits
symmetrically over two subtypes; it occupies both neighbouring cells. `layout.gapX`/`gapY` (default 128/84)
leave room for markers and labels; `layout.typeW` (180) is the minimum and
`layout.typeMaxW` (300) the maximum automatic width.

Members are never truncated. A type without `width` grows to its widest member
up to `typeMaxW`; longer members wrap. A wrapped method is set like formatter
output: `name(` ends the first line, parameters hang one step deeper (breaking
after commas), and `): Return` closes it. Visibility glyphs and type
annotations are set in the muted ink so member names carry the row. An authored `width` is
authoritative, and only a title that does not fit it is an error
(`class/title-text-capacity`).

Generalizations are routed vertically whenever the two types are not side by
side, so supertypes stand above their subtypes. Two or more automatic
generalizations of one kind into one supertype, from subtypes placed below it
with at least 40px of gap, draw as one hierarchy bus: a single triangle and
trunk, a horizontal bus halfway down the gap, and a drop to each subtype. The
bus is drawn from the supertype outward so a dashed realization bus keeps one
dash phase. Its `data-motion-path` carries the source-to-target route so Viewer
tokens and flow overlays follow the relationship's semantic direction. A bus
that would cross another type falls back to ordinary routes.
All other relationships use the shared orthogonal router
(`../architecture/routing.mjs`) and the shared Clean Flow, crossing, corridor,
rhythm, and label-clearance gates.

Labels sit on the segment with the most room: above a horizontal run, beside a
vertical one. `labelAt`, `labelDx`/`labelDy`, and `labelSegment` override it.

## Reader and export

An automatic canvas declares `data-reader-fit="intrinsic-height"` and a 7.5px
reader text floor, like the ERD, so a tall model scrolls instead of shrinking
members past legibility. The legend lists the relationship kinds present, drawn
in their own notation; hovering or focusing an entry dims the other kinds. Every
type is a focusable node whose passport shows its kind and `sublabel`; supplied
`sources` appear as repository evidence. The notation lives in the SVG's own
`<style>` and markers, so SVG/PNG export keeps it.

## Tested size

`examples/payment-processors.class.json` (11 types, 10 relationships, long
signatures) renders in about 0.2s and passes the showcase gates at a 7.5px
projected text minimum in a 1440px desktop reader. Wider models need more rows
rather than more columns to stay above that floor.
