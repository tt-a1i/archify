# Authoring Cookbook

Archify is primarily an Agent-facing Skill. Normal users can ask a Skill-capable Agent to generate the diagram; they do not need to learn the schema or run `validate`, `inspect`, or `deliver` themselves.

The manual workflow below is a reference for integration, contribution, and troubleshooting. The commands assume that you are in the repository's `archify/` directory, or in the root of an installed Archify skill.

## 1. Check the installation

Archify requires Node.js 18 or later. Run the doctor command before authoring a diagram:

```bash
node bin/archify.mjs doctor
```

If you are installing from npm-compatible skill tooling, the global install is:

```bash
npx skills add tt-a1i/archify -g
```

## 2. Choose a diagram type

Use the type that matches the question you want the reader to answer:

| Type | Use it for | Start with |
| --- | --- | --- |
| `architecture` | Components, services, storage, and boundaries | `examples/web-app.architecture.json` |
| `workflow` | Ordered work, approvals, branches, and runbooks | `examples/agent-tool-call.workflow.json` |
| `sequence` | Calls, returns, cache misses, and timing | `examples/cache-miss-request.sequence.json` |
| `dataflow` | Data movement, transformations, and consumers | `examples/product-analytics.dataflow.json` |
| `lifecycle` | States, retries, waits, and terminal outcomes | `examples/agent-run.lifecycle.json` |

When the type is unclear, ask the built-in scenario guide:

```bash
node bin/archify.mjs guide "Show an API request with a Redis cache miss" --json
```

The guide recommends a type and returns a recipe. It does not create the diagram for you.

## 3. Author one bounded source file

Start with one clear story. Keep the first diagram to roughly 8–12 primary nodes, one main path, and only the branches that help explain the question. The checked-in examples are safer starting points than copying a large generated artifact.

Every source needs a `schema_version`, a `diagram_type`, a `meta.title`, and the structural arrays required by that renderer. Read the [schema reference](../archify/schemas/README.md) for the exact fields and allowed values.

For a repository-backed Architecture diagram, add revision-pinned repository metadata and source ranges to the JSON, then pass the local repository path to the command:

```bash
node bin/archify.mjs validate architecture path/to/diagram.json \
  --repo-root path/to/repository --quality showcase --json
```

Archify verifies the Git origin, commit, blobs, and requested lines. Do not add source evidence when the repository or revision cannot be verified.

## 4. Validate before rendering a handoff

Use `standard` while exploring and `showcase` for a polished artifact or checked-in proof:

```bash
node bin/archify.mjs validate architecture examples/web-app.architecture.json \
  --quality showcase --json
```

On success, the JSON receipt contains the artifact checks and composition summary. On failure, it contains a `stage` and `diagnostics[]`; repair the named subject and use the listed `supportedFixes` before trying another change. A non-zero exit code is never a successful validation.

For Architecture layout inspection, use the renderer's machine-readable layout output:

```bash
node bin/archify.mjs inspect architecture path/to/diagram.json
```

`inspect` is currently Architecture-only and is useful when a geometry diagnostic names a route or placement problem.

## 5. Deliver the trusted artifact

`render` is useful for a quick local output. Use `deliver` when the file is a handoff, release artifact, or CI output:

```bash
node bin/archify.mjs deliver architecture examples/web-app.architecture.json \
  web-app.html --quality showcase --json
```

`deliver` freezes the input bytes, renders a same-directory candidate, runs the final artifact checks, and replaces the target only after every gate passes. Its receipt includes specification and artifact SHA-256 hashes. Add `--open` only for an interactive local handoff:

```bash
node bin/archify.mjs deliver architecture examples/web-app.architecture.json \
  web-app.html --quality showcase --open --json
```

To compare two Architecture snapshots, use `compare`. It writes the HTML and a sidecar receipt beside it:

```bash
node bin/archify.mjs compare architecture base.json head.json \
  architecture-delta.html --quality showcase --json
```

## 6. Inspect the exact final file

The deterministic checks do not exercise the Viewer in a browser. Collect automated browser evidence from the exact delivered HTML when Chrome or Chromium is available:

```bash
node bin/archify.mjs visual-check web-app.html --json
```

This receipt measures bounded runtime behavior; it does not approve perceptual polish. Inspect the HTML or generated screenshots separately. Follow the [delivery contract](../archify/references/delivery-contract.md) when recording supplementary manual browser work; an unconstrained glance supports only perceptual review.

Use the delivery contract for the canonical browser-evidence coverage, artifact binding, visual-review status, and handoff fields. The [Skill contract](../archify/SKILL.md) explains the authoring invariants and the bounded repair loop.
