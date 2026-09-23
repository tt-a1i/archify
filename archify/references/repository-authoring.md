# Repository-backed architecture authoring

Use this reference when a diagram must explain a real repository. The source is
the authority for responsibilities, calls, boundaries, and persistence. The
diagram is complete when the requested meaning is covered and every asserted
fact has supporting source evidence.

Load the remaining authoring files in one shell command that prints them all
(`cat a b c` or `Get-Content a,b,c`), not one read per file; each extra read is
a full model round trip: `references/authoring-defaults.md`,
`schemas/architecture.schema.json`, `schemas/common.schema.json`, and the
architecture example from the Type router that fits the repository.

## Explore on demand

1. **Freeze identity.** From the target repository, record `git rev-parse
   HEAD`, `git remote get-url origin`, and `git status --short`. Remove HTTP(S)
   userinfo (including usernames, passwords, and tokens) before recording the
   origin or placing it in the candidate. Pin the credential-free URL and
   forty-character revision in `meta.repository`; use `link_mode: "local-only"`
   for a local fixture whose HTTPS URL is only a repository identity. If the
   worktree is dirty, record the changed paths. Repository evidence is verified
   against committed bytes at the pinned revision, not working-tree edits:
   inspect a clean checkout at that revision for any cited changed path. Do not
   present uncommitted bytes as evidence for `HEAD`; `local-only` does not record
   a verifiable snapshot of those bytes.

2. **Map the slice.** Use project instructions, manifests, entry points,
   registrations, and deployment configuration to locate candidate runtime
   units. Read the entry, configuration, and modules relevant to the request.
   When those leads do not identify the relevant module in a large repository,
   run `node bin/archify.mjs inspect-repo <repo-root> --evidence-pack --json`
   once and read the pack once. The pack is an answer, not a work queue:
   `modules` and `graph` are the derived import graph, written as
   G = (V, E): `graph.V[i]` is a module path and each `graph.E` row is
   `[from, to, importCount]` with indices into V. `boundaries` carries
   the configuration facts, and `coverage` states what the scan cannot see.
   Draw the primary request path end to end first, from the system's input
   through its processing to its output or durable effect, then add side
   paths. `graph.E` is import coupling, not data flow: use it to place and
   group components, and draw an import as a relationship only when no
   runtime channel explains the coupling, labelled as a dependency (for
   example `imports`).
   Treat `unscanned` languages and `dynamic` import counts as boundaries to
   confirm through build or binding configuration, not as absence. The
   `questions` list is at most a dozen ranked optional leads; answer only the
   ones whose answer could change a boundary in the requested diagram, and
   ignore the rest. A question's `excerpts` already hold the numbered lines at
   its anchors; answer from them and open an anchor file only when its excerpt
   cannot settle the question. Console scripts that the pack mapped onto a file
   (`boundaries.entrypoints[].files`) are separate processes and need no read.
   `modules` lists runtime modules only; `supportModules` (tests, maintenance
   scripts, data and documentation folders) are context, not components, and
   stay out of an architecture diagram unless the request is about them.
   Pack modules are candidates, not one node each: group directory modules
   that are only code organization for one runtime responsibility (a model
   stack of models, layers and kernels, say) into one component. Keep
   separate every datastore, every process or trust boundary, every protocol
   peer, and every callback path (a CLI that an external process runs to call
   back into the runtime), even when they live inside one module. Size alone
   is not a reason either way. Modules in another language (a Rust
   gateway, Go bindings) have no import edges to the rest;
   `crossLanguage.routeReferences` lists HTTP route strings in one module that
   match routes another module declares, ranked by how specific the shared
   routes are. These are candidates for you to judge, not edges: when a
   cross-language component would otherwise float unconnected, read its one
   reference anchor and draw the link only if the code there calls the other
   service. `runtimeChannels` lists where runtime modules spawn processes,
   use message queues (ZeroMQ, multiprocessing queues, Redis, Kafka, AMQP,
   NATS), open databases or write structured files (`datastore`), serve or
   call gRPC, serve or open WebSockets, serve or call HTTP,
   and start worker threads; `targets` names what a channel reaches (a
   process target, a spawned command, a queue socket and address):
   possible runtime links an import graph cannot show. Each channel's `excerpt`
   holds numbered call lines. Treat a listed channel as a lead: trace source
   evidence for both the caller and its peer before drawing a connection.
   Open the anchor and follow the target when the excerpt alone is insufficient;
   preserve an unknown or omit the connection if the peer cannot be verified.
   Do not infer runtime causality from file proximity or naming. For a
   repository-backed architecture, finalize rejects an
   isolated component or a group of components with no connection to the rest
   of the diagram. When one file inside a module owns the module's
   relationship, attach the relationship to the module's component instead of
   splitting that file into a separate node that leaves its parent
   unconnected. Module paths
   are directories; cite a module's `sample` or `entrypoints` file as its
   source, not the directory or a guessed `__init__.py`. For per-file edges,
   look up the specific module or file in the `detail` graph on disk instead of
   rereading the pack or scanning source. Do not loop `--batch` pages when the
   pack is available; fall back to `inspect-repo <repo-root> --json` batching
   only where the pack cannot run. The scan returns file paths and bounded
   configuration facts; configuration identifiers can be sensitive, so keep
   the output local. Confirm diagram claims in source as usual.
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

Repository-backed components need concise, truthful `sources` references. Keep
control ownership separate from filesystem I/O: the code that reads or writes
a file owns that action, while a pure in-memory transform receives and returns
values. Use the existing examples for valid field shape, then replace all
identifiers, wording, source paths, and claims with inspected repository facts.
