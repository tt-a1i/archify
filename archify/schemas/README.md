# Archify JSON IR Schemas

Each typed renderer consumes a JSON intermediate representation (IR) validated
against one of the schemas in this folder before any layout work happens.

## Files

| Schema | Governs | Structural arrays |
|--------|---------|-------------------|
| `workflow.schema.json` | `diagram_type: "workflow"` | `lanes`, `phases`, `groups`, `mainPath`, `nodes`, `edges` |
| `sequence.schema.json` | `diagram_type: "sequence"` | `participants`, `segments`, `messages`, `activations` |
| `dataflow.schema.json` | `diagram_type: "dataflow"` | `stages`, `nodes`, `flows` |
| `lifecycle.schema.json` | `diagram_type: "lifecycle"` | `lanes`, `states`, `transitions` |
| `architecture.schema.json` | `diagram_type: "architecture"` | `components`, `boundaries`, `connections` |
| `common.schema.json` | shared `$defs` only (no top-level document) | — |

Every diagram schema requires `schema_version`, `diagram_type`, `meta` (with
`title`), and its structural arrays — except `segments`, `activations`, and
`cards`, which are optional — and sets `additionalProperties: false` at every
level, so unknown fields are rejected rather than silently ignored.

Every `meta` object also accepts `animation: "trace"` for opt-in SVG/CSS motion
in generated HTML. Omit it, or set `"none"`, for the default static output.
`visual_preset` accepts `classic` (the stable default), `signal-flow` (luminous
motion-forward presentation), or `blueprint` (high-contrast engineering review).
Presets change only viewer styling; they do not alter semantic IDs or geometry.
It may also include up to five guided `views`. Each view has a unique `id`, a
reader-facing `label`, a non-empty `focus` list of existing semantic node IDs,
and an optional short `note`.

Every relationship collection (`connections`, `edges`, `messages`, `flows`, and
`transitions`) accepts an optional author-controlled `id` using the shared ID
pattern. The renderer keeps its source-order runtime key separately, while the
authored ID enables a stable `#relation=<id>` viewer link that survives array
reordering. ID-less documents remain valid and their relationship pins stay
local to the current page.

## schema_version policy

`schema_version` is `"const": 1`. The constant pins the IR contract: a file
that validates today keeps validating and rendering on every 2.x release.
Additive viewer, accessibility, and presentation improvements may enhance the
generated HTML, but they must not reinterpret authored IR or turn a previously
valid profile-less v1 file into a new hard layout failure. A breaking change to
any IR shape bumps the constant to `2`; renderers will then reject version-1
files with a clear schema error instead of misrendering them. Additive,
backwards-compatible fields do not bump the version.

## Shared definitions (common.schema.json)

The five diagram schemas reference `common.schema.json#/$defs/...`:

- `id` — element identifiers, pattern `^[a-zA-Z][a-zA-Z0-9_-]*$`
- `point` — an `[x, y]` pair of numbers (used by `via` and `labelAt`)
- `componentType` — `frontend`, `backend`, `database`, `cloud`, `security`,
  `messagebus`, `external`
- `variant` — `default`, `emphasis`, `security`, `dashed` (sequence messages
  extend this list locally with `return`)
- `guidedViews` — the bounded, read-only reader paths accepted by `meta.views`
- `cards` — the summary-card blocks rendered below the SVG

Lifecycle state `type` is mode-specific (`start`/`active`/`waiting`/...) and
stays in `lifecycle.schema.json`.

## Runtime validation

At development time, `scripts/generate-validators.mjs` compiles all five
schemas with ajv's draft 2020-12 standalone generator using `strict: true` and
`allErrors: true`. The generated `renderers/shared/generated-validators.mjs`
is committed and shipped with the skill, so runtime validation has no npm or
network dependency. `renderers/shared/validator.mjs` applies the matching
standalone validator before the renderer's own layout checks.
The shared loader then checks cross-collection facts that JSON Schema cannot
express cleanly here: duplicate view IDs, duplicate focus IDs, focus IDs that do
not exist in the diagram's semantic collection, and duplicate authored
relationship IDs within the mode's relationship collection.

Architecture additionally supports opt-in, revision-pinned repository evidence.
`meta.repository` names a public GitHub URL and full commit SHA; a component may
carry one to three `sources` with repo-relative POSIX paths, optional line
ranges, and optional labels. Shape is schema-checked, then the renderer requires
`--repo-root`: the local Git origin must match, and Git must prove the commit,
blobs, and requested lines. Verified evidence is embedded outside the canonical
SVG for the Semantic Passport and Node Finder; ordinary documents and visual
exports carry no repository evidence.

`npm test` runs the generator in check mode and fails when the committed
validators drift from their schemas.

## Error format

Schema violations exit non-zero. Each ajv error is reported on its own line as
the instance path — annotated with the nearest enclosing element's `id` or
`label` — followed by the message and parameters:

```text
workflow schema validation failed:
  /nodes/3 (id/label: "router") must NOT have additional properties {"additionalProperty":"colour"}
```

Schemas catch shape errors (types, enums, ranges, unknown fields); geometry
problems such as overlaps and label collisions are the renderers' job.
