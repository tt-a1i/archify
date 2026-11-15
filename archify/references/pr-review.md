# PR review authoring

Use this reference when the user asks to explain or visualize a pull request,
a branch change, a `git diff`, or wants change diagrams attached to a PR. The
whole path runs on the local checkout and the standard `gh` CLI: no extra API
key, no hosted service. The code is the authority; the diagrams show what
changed, where, and with what neighbours. They never grade the change.

## 1. Read the real change

Review the three-dot range the forge shows, not the working tree and not a
two-dot diff against a base that moved on:

```sh
git fetch origin <base>
merge_base=$(git merge-base origin/<base> HEAD)
git diff --stat --find-renames "$merge_base"...HEAD
git diff --find-renames "$merge_base"...HEAD -- <paths you need>
git rev-parse HEAD            # headSha
echo "$merge_base"            # baseSha
```

Record both SHAs: the pack manifest and every repository-backed view pin them,
and `archify pr validate` refuses a base that is not the merge-base of the head.
Read renamed and deleted files from the diff, then the surrounding modules at
`HEAD` and, for deletions, at the merge-base (`git show <merge_base>:<path>`).

## 2. Slice by dependency (change stacks)

Order the views the way the change propagates, and draw only the layers the PR
actually touches:

1. **Storage shape** — `erd` when migrations, tables, columns, keys or indexes
   change. Mark a retyped column with `change: "modified"` and `previousType`.
2. **Boundaries and state** — `lifecycle` for state machines and transitions,
   `architecture` for new or retired services, stores, queues and their
   relationships, `workflow` for a changed decision path.
3. **Interaction and payloads** — `sequence` for a changed call order or a new
   hop, `dataflow` for a changed transformation path. Put the request or event
   body on `messages[].payload` / `flows[].payload` (`summary`, `contentType`,
   `before`, `after` or `sample`); the Viewer diffs before/after in the Semantic
   Passport and the SVG never carries it.

A one-table migration is one `erd` view. A new service with a new call is an
`architecture` view plus a `sequence` view. Do not pad a pack with a view whose
only content is `unchanged`.

## 3. Merged superset with one hop of context

Each view is a single diagram that contains both sides of the change:

- Author the union of before and after. Keep every element at its authored
  position; the renderer draws `change: "removed"` elements as ghosts in place
  and never re-layouts around them.
- Mark each element once with `change`: `added`, `modified`, `removed`. Leave
  `unchanged` for the neighbours that make the change readable — the direct
  caller, the store it writes, the state it leaves — and stop there (one hop).
  Omit `change` entirely on an ordinary diagram; the legend only appears when at
  least one element carries a change state.
- Set `emphasis: true` on the one or two elements the reviewer must find first.
  It thickens stroke and label weight; it is not a severity.
- Keep the overview small enough to read at GitHub's column width. When one
  branch needs more than that, give it its own view with `"collapsed": true` so
  the Markdown folds it into `<details>`, and keep the overview's nodes to the
  change plus their one-hop neighbours. A diagram where every edge crosses
  another is not evidence; split it.
- `change` and `emphasis` are accepted on architecture components, boundaries
  and connections; workflow lanes, groups, nodes and edges; sequence
  participants, segments and messages; dataflow nodes and flows; lifecycle
  states and transitions; ERD entities, attributes and relationships. Diagrams
  without these keys validate and render exactly as before.

## 4. Choose the route

| Situation | Route |
| --- | --- |
| Explain what a PR changes across one or several diagram types | Inline `change` marks on merged-superset candidates, then `archify pr build` for a multi-view pack with Markdown and dual-theme SVGs. |
| Audit two complete architecture snapshots (base and head), including a count of every moved, added or removed component | `archify compare architecture <base.json> <head.json> --json` for its Before \| Delta \| After report. Author the snapshots as full architecture diagrams without `change` keys. |
| Both | Run `compare` for the audit numbers, cite the counts in the manifest `stats`, and draw the inline-change views for the reader. |

`compare` needs two full snapshots and only covers `architecture`; inline
marks need one candidate per view and cover six types. Neither route emits a
risk opinion.

## 5. Command loop

```sh
# each view: validate, deliver, check and browser-check one change-marked candidate
node bin/archify.mjs finalize <type> <view.json> <view.html> --repo-root <repo> --quality showcase --json

# optional single-view export for a comment or another forge
node bin/archify.mjs export-svg <type> <view.json> <out/view> --theme both --json

# the pack
node bin/archify.mjs pr validate <pr-pack.json> --repo-root <repo> --json
node bin/archify.mjs pr build <pr-pack.json> --out-dir <out> --repo-root <repo> --json
node bin/archify.mjs pr attach <pr-number-or-url> --manifest <out>/pr-pack.receipt.json --dry-run --json
node bin/archify.mjs pr attach <pr-number-or-url> --manifest <out>/pr-pack.receipt.json --json
```

The manifest (`schemas/pr-pack.schema.json`; worked example
`examples/checkout-ledger.pr-pack.json` with its three change-marked views)
lists `title`, `summary`,
`baseRef`/`headRef` (or `baseSha`/`headSha`), `views[]` with `id`, `title`,
`type`, `input` (path relative to the manifest), optional `caption`,
`collapsed`, `theme`, and an optional `changes[]` table plus objective
`stats`. A view without `preset` bakes with the diagram's own
`meta.visual_preset` (classic when unset); set `preset` to override it.
`build` writes `views/<id>.json` snapshots pinned to the verified
revisions, offline `views/<id>.html` (source links and payload diffs live
here), `views/<id>-light.svg` / `-dark.svg` that pass strict XML and GitHub's
Camo limits, `pr-pack.md` with asset placeholders, and `pr-pack.receipt.json`.
`attach` uploads the SVGs with `gh … --attach`, rewrites the placeholders to
the returned `user-attachments` URLs, and replaces only the
`<!-- archify-pr-pack:start/end -->` block, so a hand-written description and
a re-run both survive. `--target comment` keeps one sticky comment instead.
Use `--no-html` when only the SVGs are needed, `--platform gitlab|generic`
for a single-theme `![…](…)` image, and `--animate-flow` only when the user
asks for a finite flow animation on `sequence`/`dataflow`; the default SVG is
static and nothing moves the canvas.

Repair by diagnostic, then rerun the same command:

- `repository-evidence/*` — the cited path or line is wrong at the pinned
  revision. A removed element is checked at `meta.repository.base_revision`
  (the merge-base), everything else at `revision`; `build` fills both from the
  verified SHAs when the candidate omits them. Fix the citation, never the
  mark.
- `pr-pack/base-sha-not-merge-base`, `pr-pack/head-sha-mismatch`,
  `pr-pack/view-revision-mismatch` — re-read step 1; the manifest or a view
  pins a different commit than the checkout.
- `pr-pack/unknown-change-view` — a `changes[].view` names a view id that the
  manifest does not declare.
- `pr-pack/risk-verdict` — the text contains `SAFE`, `LOW RISK`, `MERGEABLE`,
  `NO IMPACT` or `VERIFIED PR`. Remove it. Report counts, names and the
  diagrams; the reviewer owns the verdict.
- `pr-attach/*` — read the receipt: preflight stops before any `gh` call for
  more than 50 attachments, a 5 MiB asset, an old `gh` (< 2.99.0) or a missing
  login; a failed second step restores the original body or deletes the
  temporary comment and reports it under `rollback`. Run `--dry-run` first on
  an unfamiliar repository.
- A change legend that does not appear in the exported SVG means the authored
  canvas is too small for it: widen the diagram's authored size rather than
  hiding the legend.
