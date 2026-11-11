# Task review file

When you finish a task, write a review file so a human can review your work
with `task-view`. The file describes what you changed and why, as a small
graph.
The tool checks every reference you give against the files and Git; anything
without a reference is shown as "agent says". Be precise, not persuasive.

## When

- Once the task is complete, never during the work or after each edit.
- If you change more for the same task, rewrite its whole file; do not patch
  it.

## Where

`.review/change-<task>.json` in the repo where the task started, unless told
otherwise. `<task>` is a short kebab-case name for the task, for example
`change-rate-limit-login.json`: one file per task, so earlier reviews stay
next to it. Add `.review/` to `.git/info/exclude` if it is not ignored
already.

## Steps

1. Do not commit for the review. Commit only if this repo's own
   instructions (CLAUDE.md, AGENTS.md, CONTRIBUTING) or the user tell you
   to; otherwise leave changes uncommitted. The review covers them through
   the `WORKTREE` entry (step 3).
2. The shape below is complete; `task-view schema` prints the JSON Schema
   only if a validate error needs it.
3. Gather the evidence from the repo where the review file goes:
   `task-view gather --base <start> --format json`, where `<start>` is the
   commit you started from. Leave out `--base` if you committed nothing.
   - Several repos: name each with its own start,
     `task-view gather .=<start> ../client=<start>`. Repos you only read:
     add `--context ../api`.
   - An existing commit: `task-view gather --base <sha>^ --tip <sha>`.
   - Copy its `repos` into the review file as it is: paths, commits
     (`WORKTREE` first when work is uncommitted) and languages are already
     right. If you rename an id, use the new one in every ref.
   - Fix every error with its `hint` and run it again. `uncommitted_changes`
     or `head_ahead` means work the range leaves out; `empty_change` means a
     repo has nothing to review.
   - Never collect commits or the diff another way.
4. Read `files`: every changed file with its hunks. Hunk `lines` are
   final-state numbers, the ones refs use, and `commits` says which state
   wrote them. Every hunk's `lines` must fall inside a node's `range` or
   `file` ref: read the file at the final state and give each hunk to its
   node by the rules under Nodes. A hunk without
   `lines` (a deleted or emptied file) and a file without hunks (binary,
   pure rename) need the file's `ref`. A `truncated` hunk was cut short.
   Add `--lines 3` to see context around each hunk.
5. Write nodes, edges, flows, claims and notes (rules below).
6. Run `task-view validate .review/change-<task>.json --format json`.
7. Fix every error using its `hint`, then add nodes for every
   `unmentioned_hunk` warning and fix every `flow_gap`, `flow_without_code`
   and `node_not_in_flow` warning. Repeat until exit code 0 and none of
   those warnings, or explain the remaining ones in `notes`.
8. Tell the user: `task-view open .review/change-<task>.json`. It writes the
   page to `.review/generated/change-<task>.html`.

## File shape

```json
{ "version": 1, "summary": "<what was asked, what you did>",
  "repos": [...], "nodes": [...], "edges": [...], "flows": [...],
  "claims": [...], "notes": [...] }
```

`version`, `summary`, `repos` and `nodes` are required; the rest may be
left out. Write no other top-level field.

## Nodes

Apply these rules to every changed file, in order; two reviews of the same
change should end up with the same nodes.

1. **Declarations.** One node per changed declaration: the smallest named
   top-level function, method, component, class, constant or type that holds
   changed lines. Its range runs from its first line (doc comment included)
   to its last. All hunks inside it belong to that one node; a block nested
   in it (a branch of markup, an inner callback, a hook) never gets its own.
   A declaration the change deletes is a `deleted` node, read in the initial
   state.
2. **Imports.** Changed lines outside every declaration (imports,
   re-exports, other top-level statements) go in one node per file: kind
   `imports`, range from the first to the last such line.
3. **Tests.** One node per changed test file, kind `test`: a `file` ref for
   a new file, else a range from the first changed test or fixture to the
   last. Never one node per test case.
4. **Data.** One node per changed data or config file (JSON, YAML, locale
   strings, SQL migration), kind `config`, range from the first to the last
   changed line; a `file` ref for a new file.
5. **A whole new or deleted file** of code is one node with a `file` ref
   when it holds one declaration; otherwise rule 1 applies to it.
6. **Unchanged nodes**, only these: the unchanged entry that starts a flow
   (a route or screen your change is reached from), the other side of a
   boundary your change crosses (the real server route behind a mock you
   changed), and an unchanged declaration a flow passes through between two
   changed nodes (a changed handler calls an unchanged service that calls
   changed code). Give that one a `range` ref over its declaration and the
   edges on both sides; add only the declarations on the chain, not their
   other callers or callees. Endpoints, queues and external services get a
   node without `ref`.

Blank lines next to a node count as covered by it: never stretch a range
for one.

Fields:

- `id`: short, unique, lowercase kebab-case (`^[a-z0-9][a-z0-9-]{0,63}$`).
- `kind`, exactly one of:
  - `entry`: a route, screen, command or job a flow starts from;
  - `component`: a UI component;
  - `code`: any other function, method, class, constant or type;
  - `imports`: rule 2;
  - `test`: rule 3;
  - `config`: rule 4;
  - `endpoint`: an HTTP or RPC endpoint, queue or topic, without `ref`;
  - `external`: a service outside the repos, without `ref`;
  - `doc`: documentation.
- `label`: the declaration's name, or the file name for `imports`, `test`
  and `config` nodes.
- `change`: `added`, `modified`, `deleted` or `unchanged`.
- `ref`: `{ "type": "range", "repo", "file", "lines": [start, end] }`
  (1-based, inclusive, lines at `commits[0]`; at the state before the first
  commit for `deleted`), or `{ "type": "file", ... }` where a rule says so.
- `why`: one sentence, the reason for the change. Required when changed.
- `meta`: for tests, `{ "command": "<what you ran>", "observed": "passed" | "failed" | "not run" }`.
  Only write a result you saw in this session's output.

## Languages

`gather` sets `languages` for the changed files: glob to language name,
first match wins, e.g. `{ "**/*.tsx": "tsx", "**/*.ts": "typescript" }`.
Add globs for every other file you reference, context repos included. For
a file the globs can't describe, add `"language"` on its ref. Valid names:
`task-view languages`.

## Edges

`{ "from", "to", "kind", "ref" }`, `kind` exactly one of:

- `calls`: `from` calls a function or method of `to`;
- `renders`: `from` renders the component `to`;
- `requests`: `from` sends a request to the endpoint `to`;
- `serves`: `from` handles the endpoint `to`;
- `mocks`: `from` stands in for `to` in tests or a mock server;
- `uses`: `from` reads a constant, type, string or config value from `to`;
- `tests`: `from` is a test node that exercises `to`.

Add exactly one edge for each ordered pair of nodes where the `from` node's
lines call, render, request, serve, mock or use the `to` node; none for
anything else. Its `site` ref points at the first such line inside the
`from` node:

```json
{ "type": "site", "repo": "web", "file": "src/orders/OrderPage.tsx",
  "line": 33, "contains": "<OrderSummaryCard" }
```

`contains` is a short exact substring of that line. If you can't point at a
line, omit `ref`; never guess. A test node gets a `tests` edge to each node
its tests call or render directly; an end-to-end test that drives the app
instead gets one to the entry of each flow it drives. A node with no `tests`
edge has no test; the reviewer sees that, so write no notes explaining it.

## Flows

One flow per entry your change affects. An entry is a screen or route, a
user action (a button, a shortcut), a command, an endpoint or a job; two
actions that run the same handler are one flow.
`{ "id", "title", "path": [...] }`: `title` names the entry and what
happens, in a reader's words; `path` lists the ids of the nodes the entry
reaches through the changed code to the boundary, entry first. The edges
between those nodes give the flow its shape, so a flow branches wherever
the entry leads to several chains: put every branch in the one flow of its
entry, never one flow per branch.

- Every node in `path` must be reachable from the entry through edges
  between nodes of the same `path`. When the chain between two changed
  nodes runs through unchanged code, put that unchanged node in `path`
  (rule 6) instead of skipping it.
- `path` holds code only: never `test`, `imports`, `doc` or `config` nodes.
  Tests reach the code through `tests` edges, which the reviewer reads in
  the graph.
- Every added or modified `entry`, `code` and `component` node is in the
  `path` of at least one flow.

## Claims and notes

- `claims`: statements a reviewer might doubt,
  `{ "text", "about": [node ids], "evidence": [refs] }` (usually `site` or
  `range` refs). Without evidence, put it in `notes` instead.
- `notes`: doubts, shortcuts, things not done, assumptions. Plain sentences.
  Say what you didn't verify.

## Never

- Never change a ref only to silence a `contradicted` error. Fix the account
  or the code, and mention it in `notes` if the account was wrong.
- Never claim tests passed unless you saw the output in this session.
- Never leave changed lines out because they seem trivial.
- Never edit `commits` by hand. If you commit or edit files again after
  writing the review file, run `gather` again, update `repos` and every
  affected line number, then validate again.
