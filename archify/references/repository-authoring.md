# Repository-backed architecture authoring

Use this reference when a diagram must explain a real repository. The source is
the authority for responsibilities, calls, boundaries, and persistence. The
diagram is complete when the requested meaning is covered and every asserted
fact has supporting source evidence.

## Explore on demand

1. **Freeze identity.** From the target repository, record `git rev-parse
   HEAD`, `git remote get-url origin`, and `git status --short`. Pin the URL and
   forty-character revision in `meta.repository`; use `link_mode: "local-only"`
   for a local fixture whose HTTPS URL is only a credential-free identity. If
   the worktree is dirty, record the changed paths and treat them as part of
   the inspected source only when the task explicitly includes them.

2. **Map the slice.** Use project instructions, manifests, entry points,
   registrations, and deployment configuration to locate candidate runtime
   units. Read the entry, configuration, and modules relevant to the request.
   When those leads do not identify the relevant module in a large repository,
   run `node bin/archify.mjs inspect-repo <repo-root> --json` and use its
   directory inventory and `level1.boundaries` as discovery leads. Follow
   `coverage.nextArguments` only while an unresolved question needs more
   candidates. The scan returns file paths and bounded configuration facts;
   `coverage.complete` describes inventory coverage, not semantic completeness.
   A `truncated` or `factsTruncated` configuration, or
   `boundariesTruncated: true`, needs targeted inspection before treating the
   corresponding facts as complete. Configuration identifiers can be sensitive;
   keep the output local. Confirm diagram claims in source as usual.
   Follow imports and call sites
   until the requested responsibility reaches its actual input, output, or
   side effect. Read a small connected slice instead of scanning the repository
   for a convenient label.

3. **Trace ownership.** For each step, name the controller that owns the
   decision, the runtime that performs it, and the filesystem or durable store
   that supplies or receives bytes. Keep control ownership separate from file
   I/O. A configured provider, an injected adapter, a local stub, and a durable
   service are different claims; label the one the source supports.

4. **Record evidence while reading.** Keep exact repository-relative paths and
   inclusive line ranges for each component and meaningful relationship. Follow
   actual branches, retries, fallbacks, and error handling. A function that is
   exported or configured but never called by the normal path is an optional
   capability, not a required runtime edge.

5. **Name uncertainty.** Write unresolved questions beside the claim they
   affect: for example, “`writeFile` is called here; durability is unknown.”
   Resolve a question by reading the next relevant source range or preserve it
   as an explicit unknown. Never turn a label, package description, or config
   value into an unobserved service or behavior.

Stop exploring when every requested responsibility, relationship, and boundary
has supporting source entailment and the remaining unknowns cannot change that
coverage. There is no node, edge, citation, view, card, or boundary count to
hit. Do not add a summary step merely to signal completion.

Batch independent relevant files when known. Each additional read should answer
an unresolved question that can change the diagram. Reuse concise facts and
their source ranges already verified in this task; across revisions, recheck
the affected entry points, configuration, dependencies, and evidence.

## Choose an example by structure

Select the main example in the [Type router](../SKILL.md#type-router) before
loading its content, using the request and repository metadata already needed
for source inspection. Selection fits the existing read batch and needs no extra
message, command, or repository-wide scan. For mixed or unclear tasks, use the
requested responsibilities and entry points as they become known in normal
inspection; keep their actual roles. Read another example when a necessary
capability remains unexplained. Examples teach shape, not facts: a library need
not acquire filesystem nodes, and finished showcases still follow the
first-draft automatic-routing rule.

## Author from evidence

Use the mode's complete JSON shape, including repository identity,
components, and connections; every repository-backed component needs supporting source
references, while boundaries, cards, or guided views are added only when they
answer a real reader question. Let automatic routes and automatic
viewBox sizing work first. Keep the primary path readable, put exception paths
beside their owner, and leave filesystem stores outside a control boundary when
the source shows a separate responsibility.

An existing example teaches field shape, not facts or arbitrary values. It does
not authorize a new boundary kind, a long note, a viewBox size, or a route
control. Consult the specific mode schema and `schemas/common.schema.json`
whether or not the selected example already contains the field; use the
schema's enum, length, identifier, and repository rules. Architecture
boundaries currently use `kind: "region"` or `kind: "security-group"`; source
references use `path`, `line`, and optional `end_line`; guided-view notes have
their own limit.

Repository-backed components need concise, truthful `sources` references. For
the teaching fixture, `src/cli.mjs:7` supports the claim that the CLI reads the
input file, `src/cli.mjs:9` supports its output write, and
`src/transform.mjs:1-5` supports the pure in-memory normalizer. The authored
relationships therefore carry `cli → input: readFile`, `input → cli: decoded
text`, `cli → transform: normalizeLines`, `transform → cli: normalized text`,
and `cli → output: writeFile`; the complete valid JSON with positions,
boundaries, views, cards, and the pinned repository is
`examples/source-to-diagram/source-to-diagram.architecture.json`.

The complete materializable fixture for this pattern is in
`examples/source-to-diagram/`; use it to check repository identity, source
paths, and the distinction between CLI control and filesystem I/O.
