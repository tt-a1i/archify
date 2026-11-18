# PR review authoring

Use this reference when the user asks to explain or visualize a pull request,
a branch change, a `git diff`, or wants change diagrams attached to a PR. The
whole path runs on the local checkout and the standard `gh` CLI: no extra API
key, no hosted service. The code is the authority; the diagrams show what
changed, where, and with what neighbours. They never grade the change.

## 1. Read the real change

Run preflight against a checkout with current remote refs. Supply the PR’s actual target when it differs from the remote default.

```sh
node bin/archify.mjs pr preflight --repo-root <repo> --base origin/<base> --head HEAD --init <pack-dir> --json
```

Preflight resolves the merge-base and head, counts changed files and lines, classifies paths, and returns `materiality` and `policy`. Omit `--init` for a read-only check. With `--init`, fill in the generated manifest’s title and views before building. An existing manifest is preserved. Inspect the changed hunks with `git diff --find-renames <baseSha> <headSha>`.

Use `policy.target` as the value of attach’s `--target`. A standalone rule such as `[archify pr: ask, target=comment]` in the repository root’s `AGENTS.md` or `CONTRIBUTING.md` sets the team preference. Preflight gives priority to explicit `--mode` and `--target`, then personal rules, then repository rules, then `ask` and `body`. Only a personal rule or explicit request can enable proactive attachment.

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
  states and transitions; ERD entities, attributes and relationships; class
  types, attributes, methods and relationships; tree nodes; timeline lanes and
  events; and waterfall spans (`previousType` is also accepted on changed ERD
  and class attributes). Diagrams without these keys validate and render
  exactly as before.

## 4. Choose the route

| Situation | Route |
| --- | --- |
| Explain what a PR changes across one or several diagram types | Inline `change` marks on merged-superset candidates, then `archify pr build` for a multi-view pack with Markdown and dual-theme SVGs. |
| Audit two complete architecture snapshots (base and head), including a count of every moved, added or removed component | `archify compare architecture <base.json> <head.json> --json` for its Before \| Delta \| After report. Author the snapshots as full architecture diagrams without `change` keys. |
| Both | Run `compare` for the audit numbers, cite the counts in the manifest `stats`, and draw the inline-change views for the reader. |

`compare` needs two full snapshots and only covers `architecture`; inline
marks need one candidate per view and cover ten diagram types. Neither route
emits a risk opinion.

## 5. Command loop

```sh
# each view: validate, deliver, check and browser-check one change-marked candidate
node bin/archify.mjs finalize <type> <view.json> <view.html> --repo-root <repo> --quality showcase --json

# optional single-view export for a comment or another forge
node bin/archify.mjs export-svg <type> <view.json> <out/view> --theme both --json

# the pack (set target to policy.target or the user’s explicit choice)
node bin/archify.mjs pr validate <pr-pack.json> --repo-root <repo> --json
node bin/archify.mjs pr build <pr-pack.json> --out-dir <out> --repo-root <repo> --json
node bin/archify.mjs pr attach <pr-number-or-url> --manifest <out>/pr-pack.receipt.json --target "$target" --dry-run --json
node bin/archify.mjs pr attach <pr-number-or-url> --manifest <out>/pr-pack.receipt.json --target "$target" --json
```

The manifest (`schemas/pr-pack.schema.json`; worked example
`examples/checkout-ledger.pr-pack.json` with its three change-marked views)
lists `title`, `summary`,
`baseRef`/`headRef` (or `baseSha`/`headSha`), `views[]` with `id`, `title`,
`type`, `input` (path relative to the manifest), optional `caption`,
`collapsed`, `storyOnly`, `theme`, `preset`, an optional `story` walkthrough
spec, and an optional `changes[]` table plus objective `stats`.
- A view without `preset` inherits `preset` from the pack manifest
  (`classic` when unset), and `pr build` stamps that unified preset onto the
  built view snapshot's `meta.visual_preset`; set `preset` on a view only when
  that view must override the pack preset.
- For complex or cross-layer PRs, author `story` (`duration`, `stages`, optional
  `loop` defaulting to `true`, `nodeBadges` defaulting to `"labeled"` across
  both the story and static PR pack views including ERD/Class headers,
  `pair.shared`, `enter`/`connect`/`fade`/`focus`/`relabel`, `traces`, `metrics`,
  `detail`, and ordered `steps`) to compile a self-contained 960x560 animated
  walkthrough SVG as the hero PR visual with active-step countdown progress
  bars.
  - Omit `steps[].at` (after an optional opening beat) to auto-space captions
    evenly between timed steps or across `duration`.
  - Set `detail.mode: "diff"` (with `baseLines` + `lines` or `maxLines` hunk
    selection, plus optional `selections[].baseLines`) to render a genuine
    Git-verified `−` / `+` before-and-after diff excerpt between `baseSha` and
    `headSha` instead of a single-revision excerpt.
  - Standard 4-stage timing template (`duration: 24`, adjust as needed):
    - `0s – 4.5s`: Baseline `before` stage (highlight removed nodes/paths).
    - `4.0s – 13.5s`: Paired `after` transition (`pair.at: 4.0`, `enter` +
      `connect` at `4.8s–6.5s`, `traces` motion along new paths at `7.5s–12.5s`).
    - `13.2s – 18.5s`: Secondary contract/data view (`erd` / `sequence`).
    - `18.2s – 24.0s`: `code_focus` left-node + right `detail` (`mode: "diff"`)
      + before/after `metrics`.
  - Mark helper baseline or focus views `storyOnly: true` so they compose into
    the story without emitting standalone images, and keep deep reference views
    (`erd`, `workflow`, `sequence`, etc.) as `collapsed: true` so reviewers can
    expand static diagrams inside `<details>`.
`build` writes `views/<id>.json` snapshots pinned to the verified
revisions, offline `views/<id>.html` (source links and payload diffs live
here), `views/<id>-light.svg` / `-dark.svg` that pass strict XML and GitHub's
Camo limits, `pr-pack.md` with asset placeholders, and `pr-pack.receipt.json`.
On refresh, `attach` reads asset hashes and URLs from the hidden metadata in the selected body or sticky comment. It uploads only changed SVGs. A text-only refresh writes the pack in place with the existing URLs. GitHub diff links are filled with the actual PR URL during attach.

`attach` uploads the SVGs with `gh … --attach`, rewrites the placeholders to
the returned `user-attachments` URLs, and replaces only the
`<!-- archify-pr-pack:start/end -->` block, so a hand-written description and
a re-run both survive. `--target comment` keeps one sticky comment instead.
Use `--no-html` when only the SVGs are needed, `--platform gitlab|generic`
for a single-theme `![…](…)` image, and `--animate-flow` only when the user
asks for a finite flow animation on `sequence`/`dataflow`; the default SVG is
static and nothing moves the canvas.

Repair by diagnostic, then rerun the same command:

- `pr-pack/invalid-source-anchor` — choose a changed file and check the one-based line against the pinned Git blob. Put `path` and `line` on a change row or story step for a head-side link. Use `baseLine` for a deletion and `basePath` on a renamed change row for its old path. Select a line visible in the PR diff. GitHub can fold unchanged context or large files even when the cited line exists. GitHub builds include links in the table and below the story; other platforms show the location as text.
- `pr-attach/head-sha-outdated` — compare the receipt head with the online PR head, push or fetch as appropriate, and rebuild at the intended commit. Use `--allow-stale` only when deliberately attaching an older pack.
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
- `pr-story/empty-diff`, `pr-story/invalid-detail` — `story.detail` in
  `mode: "diff"` found no `+/−` lines in the selected range, or an excerpt /
  selection omitted required `lines`/`baseLines`. Cite changed lines between
  `baseSha` and `headSha` or omit `baseLines`/`lines` to slice the hunk.
- `pr-attach/*` — read the receipt: preflight stops before any `gh` call for
  more than 50 attachments, a 5 MiB asset, an old `gh` (< 2.99.0) or a missing
  login; a failed second step restores the original body or deletes the
  temporary comment and reports it under `rollback`. Run `--dry-run` first on
  an unfamiliar repository.
- A change legend that does not appear in the exported SVG means the authored
  canvas is too small for it: widen the diagram's authored size rather than
  hiding the legend.
