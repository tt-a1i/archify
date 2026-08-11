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
motion-forward presentation), `blueprint` (high-contrast engineering review),
or `editorial` (warm publication-style design review and documentation).
Presets change only viewer styling; they do not alter semantic IDs or geometry.
Sequence `meta` additionally accepts `column_fit`. The default `fixed` keeps
the historical 108px column gap and 86px participant boxes, so an authored
diagram renders at the same coordinates no matter how wide its viewBox is.
`spread` derives the gap and box width from the viewBox instead, which turns a
wide canvas into column distance and label room rather than empty space on the
right. Lane order, IDs, and message semantics are unchanged either way.

It may also include up to five guided `views`. Each view has a unique `id`, a
reader-facing `label`, a non-empty `focus` list of existing semantic node IDs,
and an optional short `note`.

### Legend presentation contract

Every `meta` object accepts the same optional legend shape without changing
`schema_version: 1`:

```json
"legend": {
  "mode": "auto",
  "entries": {
    "security": { "label": "restricted data", "visible": true }
  }
}
```

`mode` is `auto` (the default), `all`, or `hidden`. `auto` includes only kinds
present in typed IR; `all` includes the renderer's full stable catalog;
`hidden` removes the complete legend and takes precedence over entry overrides.
Architecture documents that omit an explicit `viewBox` size that automatic
viewBox from the same measured resolved legend footprint used for final SVG
layout. Across all renderers, legacy documents that omit `meta.legend` use a
compatibility-safe implicit `auto`: if the resolved legend cannot fit an
explicit authored viewBox without overlap, Archify omits the complete legend
instead of turning a previously valid schema-v1 document into a hard failure.
Once an author adds `meta.legend` (including explicit `mode: "auto"`), the
layout is intentional and unfit labels or bands fail with a path-prefixed
diagnostic. An entry may set a non-empty, bounded `label`, boolean `visible`,
or both.
`visible: false` removes a resolved entry and `visible: true` forces a supported
but unused kind into the visual legend. Unknown kinds and properties fail
strict validation.

Supported keys are renderer-owned:

| Renderer | `meta.legend.entries` keys |
|---|---|
| Architecture | `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, `external` |
| Workflow | `frontend`, `backend`, `security`, `messagebus`, `database`, `cloud`, `external` |
| Sequence | `emphasis`, `return`, `security`, `dashed`, `default` |
| Dataflow | `emphasis`, `security`, `dashed`, `database`, `default` |
| Lifecycle | `start`, `active`, `waiting`, `decision`, `success`, `failure`, `neutral`, `external` |

Labels are presentation only: they do not rename the stable kind, change
nodes/relationships, or create Semantic Lens edge facts. Sequence message and
Dataflow flow-variant entries are visual keys. Component/state entries backed
by exact compiled node facts receive the interactive Semantic Legend bridge;
this includes Dataflow `database` when a real `nodes[].type: "database"` fact
exists.

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
- `legendMode` and `legendEntry` — the shared strict mode and label/visibility
  override shapes used by each renderer-owned key map
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

## Visual quality and engineering truth

`meta.quality_profile` and `meta.engineering_profile` answer different
questions. `quality_profile` is available in all five modes and controls how
strictly Archify judges composition. `engineering_profile` is an optional
Architecture-only semantic contract; omitting it preserves the ordinary v1
behavior.

The first engineering profile is `deployment-ownership`. Enable it only when
the user wants a fail-closed deployment review and the source facts are known.
It requires every non-external component to name an owner in `tag` and belong
to exactly one `region`; the document must contain both `region` and
`security-group` boundaries; every `database` must be inside a
`security-group`; each security group must contain members from one shared
region; and every connection whose region or security-group membership changes
must name the real crossing mechanism in `label`.

The profile validates only authored IR. It does not discover infrastructure,
infer owners, or prove that a diagram matches a live environment. If a fact is
unknown, leave the profile unset or obtain the fact instead of inventing it.

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
