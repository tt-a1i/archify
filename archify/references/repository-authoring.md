# Repository-backed architecture authoring

Use this reference when a diagram must explain a real repository. The source is
the authority for responsibilities, calls, boundaries, and persistence. The
diagram is complete when the requested meaning is covered and every asserted
fact has supporting source evidence.

## Explore on demand

1. **Freeze identity.** From the target repository, record `git rev-parse
   HEAD`, `git remote get-url origin`, and `git status --short`. Remove HTTP(S)
   userinfo (including usernames, passwords, and tokens) before recording the
   origin or placing it in the candidate. Preserve its transport, port, path and
   `.git` suffix; do not rewrite an internal SSH origin as HTTPS. Pin the credential-free URL and
   forty-character revision in `meta.repository`. Use `link_mode: "local-only"`
   for an SSH origin, unsupported forge, intentionally local-only source links,
   or a local fixture whose HTTPS URL is only a repository identity; retain the
   URL and revision. Web links require a supported GitHub or Gitee HTTPS origin. If the
   worktree is dirty, record the changed paths. Repository evidence is verified
   against committed bytes at the pinned revision, not working-tree edits:
   inspect a clean checkout at that revision for any cited changed path. Do not
   present uncommitted bytes as evidence for `HEAD`; `local-only` does not record
   a verifiable snapshot of those bytes.

2. **Map the slice.** Use project instructions, manifests, entry points,
   registrations, and deployment configuration to locate candidate runtime
   units. Read the entry, configuration, and modules relevant to the request.
   Follow imports and call sites
   until the requested responsibility reaches its actual input, output, or
   side effect. Read a small connected slice instead of scanning the repository
   for a convenient label.

3. **Trace ownership.** Derive runtime and I/O relationships from the observed
   actor, operation, and target at their call sites; deployment and trust
   relationships use the corresponding configuration or enforcement evidence. Distinguish the controller requesting
   an operation from the runtime that executes it and the store receiving bytes.
   For a file or database edge, the source must identify its actual reader or
   writer; a responsibility statement such as “maintains tasks” does not prove
   direct I/O. Keep these facts with the source locations while reading, without
   a separate planning artifact. Choose which distinctions need separate
   nodes using [Composition and meaning](authoring-defaults.md#composition-and-meaning);
   discovering an implementation role does not automatically add it to the overview.
   A configured provider, an injected adapter, a short-lived CLI command, a local stub, and a durable
   service are different claims; label the one the source supports. When a CLI command calls a local API, keep request submission distinct from authentication or role checks performed by the receiving handler. Trace the whole actor → transport → handler → executor chain before compressing it. For example, if an Agent's CLI command POSTs to a local HTTP API and the Runtime then writes to a Worker PTY, do not draw a route handler or the first Agent as directly owning that PTY. Show the API request and Runtime-owned delivery as edges or an adjacent explanation. Apply the same rule to a Worker report returning through the API. If several operations share one drawn edge, label the shared edge for all of them or split the relationships; do not silently drop a return/report path.
   Distinguish a data artifact from the store or process that creates it. If a shared workspace file is also read or edited directly by another actor, show or state that access so one drawn server edge does not imply exclusive ownership. Trace
   the normal path through any source-backed validation or delivery gate that
   determines whether the artifact reaches the user; do not let a summary card
   conceal a bypass implied by the main arrows.

4. **Record evidence while reading.** Keep exact repository-relative paths and
   inclusive line ranges for each component and meaningful relationship. Follow
   actual branches, retries, fallbacks, and error handling. For remote access, distinguish the actor establishing a connection from requests later travelling through it; a local outbound tunnel is not a gateway-initiated inbound connection. A function that is
   exported or configured but never called by the normal path is an optional
   capability, not a required runtime edge. For a claim about authoritative
   state change or control ownership, trace to the actual write or execution
   site and the conditions that permit it; an upstream caller alone does not
   establish those conditions. If a dispatch can queue until a process starts or resumes, a direct arrow must not imply immediate delivery in every state; put that condition in the edge or an adjacent explanation.

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

Repository-backed components need concise, truthful `sources` references. Preserve
control ownership when summarizing filesystem I/O: the code that reads or writes
a file owns that action, while a pure in-memory transform receives and returns
values. This fact-check does not require a separate overview node for every helper. Use the existing examples for valid field shape, then replace all
identifiers, wording, source paths, and claims with inspected repository facts.
