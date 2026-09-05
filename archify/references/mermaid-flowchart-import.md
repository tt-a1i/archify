# Mermaid flowchart import contract

Read this reference before running `archify import flowchart`. The importer
turns a documented subset of Mermaid `flowchart` / `graph` source into typed
architecture IR (schema v1). It treats Mermaid as source topology — nodes,
edges, labels, and subgraph grouping — and never copies Mermaid layout,
styling, or class definitions.

## Target-mode selection

`archify import flowchart` always produces **architecture** IR: it imports a
component map (components, connections, region boundaries). For a process
view (approval gates, runbooks, CI/CD), author fresh `workflow` JSON by hand
per `SKILL.md` — the deterministic importer does not infer swimlanes or
process phases. After import, continue through the normal gates:

```bash
node bin/archify.mjs import flowchart input.mmd imported.json --json
node bin/archify.mjs validate architecture imported.json --quality showcase --json
node bin/archify.mjs deliver architecture imported.json output.html --json
```

An imported IR passes the same validation and delivery gates as hand-authored
JSON; the final standalone HTML is produced by `deliver`, not by the importer.

## Supported subset

### Declarations

The first non-comment, non-blank line must declare the diagram type and
direction. `flowchart` and `graph` are equivalent. All four directions are
honored, including mirrored depth placement for `RL` and `BT`:

```mermaid
flowchart TD
```

`TB` (alias `TD`) lays sources above targets, `BT` below, `LR` left-to-right,
and `RL` right-to-left. `%%` comments and blank lines are ignored.

### Node declarations

`id[Label]` declares a component. The shape maps to an Archify
`componentType`; a bare id (used directly in an edge) defaults to `backend`
with the id as its label. A later explicit declaration updates an earlier
implicit one (Mermaid uses the latest text); two different explicit
declarations for the same id are rejected rather than silently resolved.

| Mermaid shape | Archify `componentType` |
| --- | --- |
| `id((Text))` | `cloud` |
| `id[(Text)]` | `database` |
| `id(Text)` | `backend` |
| `id[Text]` | `backend` |
| `id{Text}` | `security` |
| `id>Text]` | `external` |
| `id/Text\\` | `backend` |

Quoted labels (`id["Text with ] inside"]`) preserve brackets verbatim. Label
text is imported as-is; HTML/markdown inside labels is never interpreted.

### Edge declarations

| Mermaid form | Imported connection |
| --- | --- |
| `-->` | directed (default variant) |
| `-.->`, `-..->` | directed, `variant: "dashed"` |
| `==>` | directed, `variant: "emphasis"` |
| `-- Text -->`, `-. Text .->` | directed with `label: "Text"` |
| `A -->\|Text\| B` | directed with `label: "Text"` |

Open links — solid `---` / `--->` and dotted `-.-` / `-..-` — are **not**
supported: they carry no arrowhead, and Archify connections always carry an
arrowhead, so remapping them would change their meaning. They exit non-zero
with `import/unsupported-edge-syntax`.

### Subgraphs

`subgraph Label` … `end` becomes an architecture `boundaries` region whose
`wraps` lists the component ids declared inside it. Nested subgraphs are
tracked: a component declared inside nested subgraphs is recorded in the
`wraps` list of every enclosing region, so no region is emitted empty. The
diagram-level direction applies to every region. The Mermaid `direction`
directive inside a subgraph is rejected with
`import/unsupported-direction-directive` instead of inventing components.

## Failure contract

Unsupported, ambiguous, or malformed syntax exits non-zero, prints a receipt
(`--json`) or a human-readable diagnostic, and never writes the output file.
Diagnostics carry a stable `code`, `subject.line`/`subject.column`, concrete
`evidence`, and executable `supportedFixes`:

```text
$ node bin/archify.mjs import flowchart unsupported-open-link.mmd --json
{
  "schemaVersion": 1,
  "command": "import",
  "source": "mermaid-flowchart",
  "ok": false,
  "error": "Mermaid open link \"---\" (and long-arrow forms like \"--->\") is not supported: ...",
  "diagnostics": [
    {
      "code": "import/unsupported-edge-syntax",
      "severity": "error",
      "message": "...",
      "subject": { "line": 2, "column": 8 },
      "evidence": { "source": { "line": 2, "column": 8 } },
      "supportedFixes": [
        "use \"-->\" for a directed edge, \"-.->\" for a dotted edge, or \"==>\" for an emphasized edge"
      ]
    }
  ]
}
```

Importer diagnostic codes (all prefixed `import/`):

- `import/flowchart-missing-declaration` — first line is not a typed declaration.
- `import/flowchart-empty-source` — no declaration found at all.
- `import/flowchart-no-components` — no nodes declared.
- `import/flowchart-invalid-node-id` — expected a node identifier.
- `import/flowchart-unclosed-node-shape` / `import/flowchart-unclosed-quote` — shape or label not closed.
- `import/flowchart-unclosed-edge-label` — `|` label not closed.
- `import/flowchart-unbalanced-end` / `import/flowchart-unclosed-subgraph` — `subgraph`/`end` mismatch.
- `import/flowchart-undefined-source` / `import/flowchart-undefined-target` — edge endpoint never declared.
- `import/flowchart-conflicting-node-declaration` — same id declared twice with different explicit text/shape.
- `import/unsupported-edge-syntax` — open link `---` (or long-arrow form).
- `import/unsupported-direction-directive` — Mermaid `direction` directive.
- `import/unsupported-keyword-*` — styling/interaction directives (`classDef`, `style`, `click`, …).

## Runnable example

```bash
cat > /tmp/api-flow.mmd <<'EOF'
flowchart LR
  Web[Web App] --> API(API Server)
  API -->|reads| DB[(PostgreSQL)]
  API --> Cache[(Redis Cache)]
  subgraph Edge
    Web
  end
EOF
node bin/archify.mjs import flowchart /tmp/api-flow.mmd /tmp/api-flow.json --json
# → {"ok": true, "components": 4, "connections": 3, ...}
node bin/archify.mjs validate architecture /tmp/api-flow.json --quality showcase --json
node bin/archify.mjs deliver architecture /tmp/api-flow.json /tmp/api-flow.html --json
```

Regression fixtures live in `test/fixtures/flowchart/` and cover valid,
malformed, unsupported, and adversarial inputs
(`test/flowchart-import.test.mjs`).
