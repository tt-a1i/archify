# Mermaid Importers

Turn an existing Mermaid source file into typed Archify IR that continues
through the normal `validate` / `render` / `deliver` workflow.

```bash
archify import <format> <input.mmd> [output.json] [--json] [--title text] [--outcome state=success|failure]
```

Without `output.json` the IR is written to stdout. With `--json` the command
writes a machine-readable receipt to stdout instead, and every failure exits
non-zero with `diagnostics[]` rather than prose. Nothing is written when the
import fails, so a failed run never overwrites the last valid output.

| Format | Mermaid source | Archify target |
|--------|----------------|----------------|
| `state` | `stateDiagram-v2`, `stateDiagram` | `lifecycle` |

## `state` → `lifecycle`

```bash
archify import state examples/release-train.state.mmd release-train.lifecycle.json \
  --outcome Live=success --outcome Cancelled=failure --outcome RolledBack=success
archify validate lifecycle release-train.lifecycle.json
archify render lifecycle release-train.lifecycle.json release-train.html
```

`archify/examples/release-train.state.mmd` is the runnable source for the
commands above. Mermaid is read as state and transition *meaning*. Layout and
styling are not imported: the lifecycle bands are a fixed phase / event /
outcome contract, so a Mermaid `direction` is reported in the receipt as
carried-but-not-applied instead of being silently honoured.

### Supported subset

| Mermaid | Import result |
|---------|----------------|
| `stateDiagram-v2` / `stateDiagram` header | required first statement |
| `--- title: ... ---` frontmatter | `meta.title` (overridden by `--title`) |
| `%%` comment | ignored, including trailing comments outside quotes |
| `direction TB\|TD\|BT\|LR\|RL` | accepted, listed in `receipt.ignoredDirectives` |
| `A --> B` | one entry in `transitions[]` |
| `A --> B : guard` | `transitions[].label` |
| `state "description" as id` | state `id` with `label` = description |
| `id : description` | state `id` with `sublabel` = description |
| `state id` | state `id` with `label` = `id` |
| `state id <<choice>>` | `type: "decision"` |
| `note left of id` / `note right of id` (inline or `end note` block) | state `sublabel` |
| `[*] --> A` | `A` becomes the single entry phase, `type: "start"` |
| `A --> [*]` | `A` becomes a terminal outcome |

### State kinds

Kinds are decided by construct, never by guessing from a state's name:

| Rule (first match wins) | `states[].type` |
|--------------------------|-----------------|
| `state id <<choice>>` | `decision` |
| target of `[*] -->` | `start` |
| source of `--> [*]`, with `--outcome id=success\|failure` | `success` / `failure` |
| source of `--> [*]`, without an override | `neutral` |
| everything else | `active` |

Mermaid has no construct that means "waiting for an event" or "outside this
system", so the importer never emits the `waiting` or `external` kinds. It also
never infers `success` or `failure` from wording such as "Failed" or "Done":
Mermaid's `[*]` terminal says *that* the lifecycle ends, not *how* it ended.
Terminal states therefore default to `neutral`, and `--outcome` is the one way
to state the outcome explicitly.

### Pseudo-states and placement

`[*]` is a pseudo-state, not a state. It is preserved as the kind of the state
it touches rather than as a node, so nothing is dropped and no unnamed box is
invented. A diagram needs exactly one `[*] --> state` entry; zero or several
entry points are ambiguous and fail.

The lifecycle bands are then filled deterministically:

| Band | Lane | Holds | Capacity |
|------|------|-------|----------|
| Phase | `main` | the spine: the longest simple path from the entry state, ties resolved by source order | 5 |
| Event | `events` | every other non-terminal state, in source order | 3 |
| Outcome | `terminal` | every terminal state that is not on the spine, in source order | 3 |

Transitions are routed through the empty corridors between bands. The importer
computes the same geometry the lifecycle renderer computes, so a route or guard
label that cannot be placed clear of the states is reported as an import
diagnostic instead of becoming a broken artifact. Imported diagrams target the
`standard` quality profile; `showcase` adds corridor and rhythm budgets that a
generated layout may not meet without manual routing.

### Rejected constructs

Everything below is valid Mermaid that Archify refuses to guess at. Each exits
non-zero with a stable code, the source line, and an executable fix.

| Code | Construct |
|------|-----------|
| `import/state-missing-header` | first statement is not `stateDiagram` / `stateDiagram-v2` |
| `import/state-unsupported-composite` | `state id { ... }` nested regions |
| `import/state-unsupported-concurrency` | the `--` concurrency separator |
| `import/state-unsupported-fork-join` | `<<fork>>` / `<<join>>` |
| `import/state-unsupported-annotation` | any other `<<...>>` annotation |
| `import/state-unsupported-directive` | `classDef`, `class`, `style`, `click`, `link`, `callback`, `accTitle`, `accDescr` |
| `import/state-unsupported-floating-note` | `note "text" as id` |
| `import/state-unsupported-self-transition` | `A --> A` (the renderer needs 32px between endpoints) |
| `import/state-unsupported-frontmatter` | frontmatter keys other than `title` |
| `import/state-missing-initial` / `import/state-multiple-initial` | zero or several `[*] -->` entries |
| `import/state-capacity-exceeded` | more states than a band holds |
| `import/state-malformed-transition` | a transition missing a source, a target, or chaining `-->` |
| `import/state-unclosed-quote`, `import/state-malformed-declaration` | broken `state` declarations |
| `import/state-unterminated-note`, `import/state-malformed-note` | broken notes |
| `import/state-duplicate-note`, `import/state-duplicate-description` | two descriptions competing for one state |
| `import/state-invalid-id` | a state id outside `^[a-zA-Z][a-zA-Z0-9_-]*$` |
| `import/state-label-too-long`, `import/state-note-too-long`, `import/state-transition-label-too-long`, `import/state-label-unplaceable`, `import/state-route-unplaceable` | text or topology that cannot be drawn legibly |
| `import/state-unsafe-text`, `import/state-empty-text` | text that cannot survive a JSON artifact or an SVG |

Composite states are rejected rather than flattened: flattening would have to
invent transitions between the inner region and its siblings, and inventing
topology is worse than refusing the file.

### Untrusted input

Mermaid text is treated as untrusted. Labels may contain quotes, angle
brackets, `-->`, and HTML or Mermaid entity codes; they are carried through as
literal text, escaped once by the renderer, and never decoded or re-parsed.
Characters that cannot round-trip through JSON and XML — C0 controls, `U+007F`,
`U+2028`, `U+2029`, `U+FEFF` — are rejected by name instead of stripped,
because silently rewriting a label would change the diagram's meaning.
