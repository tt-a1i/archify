# Repository-backed authoring

Use this reference when a diagram of any type must explain a real repository. The source is
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
   URL and revision. Web links require a supported GitHub, Gitee, or GitLab HTTPS
   origin; GitHub, Gitee, gitlab.com, and a self-managed GitLab host declared with
   `provider: "gitlab"` match their SSH origin on the same host. If the
   worktree is dirty, note the changed paths in your reply; the candidate has no field for them. Repository evidence is verified
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
   for a convenient label. When a dispatcher selects between runtimes, follow
   each supported branch that the diagram groups under the same node. If those
   branches execute in different places or reach the outside world through
   different components, show the distinction or name the narrower scope on
   the diagram.

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
   A configured provider, an injected adapter, a local stub, and a durable
   service are different claims; label the one the source supports.

4. **Record evidence while reading.** Keep exact repository-relative paths and
   inclusive line ranges for each component and meaningful relationship. Follow
   actual branches, retries, fallbacks, and error handling. A function that is
   exported or configured but never called by the normal path is an optional
   capability, not a required runtime edge. For a claim about authoritative
   state change or control ownership, trace to the actual write or execution
   site and the conditions that permit it; an upstream caller alone does not
   establish those conditions.

   Trace each direction of a round trip separately. A request and its reply can
   use one channel while state updates use another. For a state transition,
   read the branch that assigns the next state. An error reported to the user
   can accompany an ordinary transition, so an error label alone does not
   establish a separate state.

   For a shortcut or fallback, read the entire condition at the call site.
   Preserve each clause whose absence would change which path runs. Check the
   arrow, its label, and any explanatory card against a case where just one
   of those clauses changes.

5. **Name uncertainty.** Write unresolved questions beside the claim they
   affect: for example, “`writeFile` is called here; durability is unknown.”
   Resolve a question by reading the next relevant source range or preserve it
   as an explicit unknown. Never turn a label, package description, or config
   value into an unobserved service or behavior.

Stop exploring when every requested responsibility, relationship, and boundary
has supporting source entailment and the remaining unknowns cannot change that
coverage. There is no node, edge, citation, view, card, or boundary count to
hit. Do not add a summary step merely to signal completion.

Batch independent relevant files when known. Read source excerpts with their original
line numbers (for example, `nl -ba <file> | sed -n '40,90p'`). Copy citation
start and end lines from the displayed source, including the actual final line
when an excerpt reaches EOF. Each additional read should answer
an unresolved question that can change the diagram. Reuse concise facts and
their source ranges already verified in this task; across revisions, recheck
the affected entry points, configuration, dependencies, and evidence.

## Evidence by diagram type

Only the primary elements carry `sources`, at most three ranges each:
Architecture components, Workflow, Dataflow and Tree nodes, Sequence
participants, Lifecycle states, ERD entities, Class types, Timeline events and
Waterfall spans. Relationships, messages, flows and transitions have none: cite
the call, write or transition site on the element that owns it (the caller, the
writer, the state being left) and keep further evidence in a note or card. A
folder node cites its own README or entry file, or else the file that defines
or runs it. A Timeline event cites a file at the pinned revision that records
it, such as a changelog entry, and takes its time from a tag or commit in that
history, or noon local time for a date-only record. A tag or commit outside
that history is not citable. Say either in a card. A Waterfall without a
recorded trace uses `meta.evidence: "illustrative"` and keeps its durations
labelled as such; do not run the project only to time it.

When finalizing a native diagram with `--repo-root`, read
`repositoryReferences` in the summary. Its revision and count identify
the pinned source ranges Archify checked. If it reports `not-declared`,
add the missing pin and citations before delivering a repository-backed
diagram. Reading the cited code establishes what each arrow means.

## Check the reader's answer

With the finished diagram open, answer the original question using only what a
reader can see. For a topology arrow, say who initiates the connection, who
receives it and what crosses it. If the receiver forwards the operation, show
that handoff or explicitly label the link as logical. For a branch, say what
selects it. For a question about where an output comes from, follow its inputs
in the direction they travel. For example, a stored result supplies the report
generator, which writes the report. If an arrow depicts a read request, label
the operation so the reader can distinguish that request from the returned data.
Compare the answer with the source that implements it. A qualifier
in a card cannot fix an arrow that points at the wrong process.

When independent review is available and allowed, give a fresh reader the
original question, the rendered diagram and access to the pinned repository.
Ask them to write their reading before opening the implementation, then flag
any concrete contradiction or ambiguity that changes their answer. Otherwise
do the same check yourself. Correct material discrepancies in the editable
input and review the resulting diagram after the next complete finalize.

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
references, while boundaries or cards are added only when they
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
references use `path`, `line`, and optional `end_line`.

Repository-backed components need concise, truthful `sources` references. Preserve
control ownership when summarizing filesystem I/O: the code that reads or writes
a file owns that action, while a pure in-memory transform receives and returns
values. This fact-check does not require a separate overview node for every helper. Use the existing examples for valid field shape, then replace all
identifiers, wording, source paths, and claims with inspected repository facts.
