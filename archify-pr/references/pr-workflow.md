# PR workflow

Use this reference after the user explicitly asks for PR visualization, or accepts the optional offer. Every command runs through the companion wrapper; it delegates unchanged to the core Skill's `archify pr` commands. The code is the authority; the diagrams show what changed, where, and with what neighbours. They never grade the change.

## 1. Read the real change

Run preflight against a checkout with current remote refs. Supply the PR’s actual target when it differs from the remote default.

```sh
node <archify-pr-root>/bin/archify-pr.mjs pr preflight --repo-root <repo> --base origin/<base> --head HEAD --init <pack-dir> --json
```

Preflight resolves the merge-base and head, counts changed files and lines, classifies paths, and returns `materiality` and `policy`. Omit `--init` for a read-only check. With `--init`, fill in the generated manifest’s title and views before building. An existing manifest is preserved. Inspect the changed hunks with `git diff --find-renames <baseSha> <headSha>`.

On GitHub, use `policy.target` as the value of attach’s `--target`. A standalone rule such as `[archify pr: ask, target=comment]` in the repository root’s `AGENTS.md` or `CONTRIBUTING.md` sets the team preference. Preflight gives priority to explicit `--mode` and `--target`, then personal rules, then repository rules, then `ask` and `body`. Only a personal rule or explicit request can enable proactive attachment.

### Personal rule discovery

Explicit `--global-rules <path>` selects one personal file. Otherwise preflight checks the current host’s file: Codex `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`), Claude Code `$CLAUDE_CONFIG_DIR/CLAUDE.md` (default `~/.claude/CLAUDE.md`), Cursor `~/.cursor/AGENTS.md`, or Devin `$XDG_CONFIG_HOME/devin/AGENTS.md` (default `~/.config/devin/AGENTS.md`). Home comes from `HOME`, then `USERPROFILE`, then the operating system. These are discovery locations; use the explicit path for other rule storage.

Host detection uses Codex, Claude Code, Cursor or Devin process markers; `ARCHIFY_AGENT=codex|claude|cursor|devin` selects the host explicitly. A matching host rule wins over other agents’ preferences. If its file has no directive, or no host is identified, preflight checks the other locations and gives `on-demand` priority. Other fallback rules resolve to `ask`. Among rules for the resulting mode (`on-demand` when present, otherwise `ask`), one shared explicit target is retained; different explicit targets use `body` with source `global-conflict`. Rules without a target inherit the repository target when none of the selected rules specifies one. Fallback discovery never enables `proactive`. Only the selected host’s personal rule, an explicit personal path, or `--mode proactive` can do that. Files inside the repository, including symlink targets, retain the repository’s `ask` cap.

Rules must be standalone lines outside Markdown code examples and HTML comments. Each CLI policy field overrides its corresponding personal or repository field. Small schema and migration changes remain materiality candidates even when fewer than 40 lines change; inspect the code before offering.


## 2. Slice by dependency

Order the views the way the change propagates, and draw only the layers the PR actually touches:

1. **Storage shape** — `erd` when migrations, tables, columns, keys or indexes change. Mark a retyped column with `change: "modified"` and `previousType`.
2. **Boundaries and state** — `lifecycle` for state machines and transitions, `architecture` for new or retired services, stores, queues and their relationships, `workflow` for a changed decision path.
3. **Interaction and payloads** — `sequence` for a changed call order or a new hop, `dataflow` for a changed transformation path. Put the request or event body on `messages[].payload` / `flows[].payload` (`summary`, `contentType`, `before`, `after` or `sample`); the Viewer diffs before/after in the Semantic Passport and the SVG never carries it.

A one-table migration is one `erd` view. A new service with a new call is an `architecture` view plus a `sequence` view. Do not pad a pack with a view whose only content is `unchanged`.

## 3. Merged superset with one hop of context

Each view is a single diagram that contains both sides of the change:

- Author the union of before and after. Keep every element at its authored position; the renderer draws `change: "removed"` elements as ghosts in place and never re-layouts around them.
- Mark each element once with `change`: `added`, `modified`, `removed`. Leave `unchanged` for the neighbours that make the change readable — the direct caller, the store it writes, the state it leaves — and stop there (one hop). Omit `change` entirely on an ordinary diagram; the legend only appears when at least one element carries a change state.
- Set `emphasis: true` on the one or two elements the reviewer must find first. It thickens stroke and label weight; it is not a severity.
- Keep the overview small enough to read at GitHub's column width. When one branch needs more than that, give it its own view with `"collapsed": true` so the Markdown folds it into `<details>`.
- `change` and `emphasis` are accepted on architecture components, boundaries and connections; workflow lanes, groups, nodes and edges; sequence participants, segments and messages; dataflow nodes and flows; lifecycle states and transitions; ERD entities, attributes and relationships; class types, attributes, methods and relationships; tree nodes; timeline lanes and events; and waterfall spans (`previousType` is also accepted on changed ERD and class attributes).

## 4. Manifest and pack

The manifest (`archify-pr` delegates to `<archify-root>/schemas/pr-pack.schema.json`; worked example `<archify-root>/examples/checkout-ledger.pr-pack.json`) lists:

- `title`, `summary`;
- `baseRef`/`headRef` or `baseSha`/`headSha`;
- `views[]` with `id`, `title`, `type`, `input` (path relative to the manifest), and optional `caption`, `collapsed`, `storyOnly`, `theme` and `preset`;
- optional root-level `preset`, `nodeBadges` (`"labeled"` or `"compact"`), `story` walkthrough spec, `changes[]` table (`changeTableLimit`), and objective `stats`.

A view without `preset` inherits the pack preset (`classic` when unset). Set it on a view only when that view must override the pack preset.

## 5. Story walkthrough

For complex or cross-layer PRs, author root-level `story` in `pr-pack.json` to compile a self-contained 960x560 animated walkthrough SVG with active-step countdown progress bars as the hero visual:

- `duration`, `stages`, optional `loop` (defaults to `true`), `nodeBadges` (defaults to `"labeled"`), `pair.shared`, `enter`/`connect`/`fade`/`focus`/`relabel`, `traces`, `metrics`, `detail`, and ordered `steps`.
- Omit `steps[].at` (after an optional opening beat) to auto-space captions evenly.
- Set `detail.mode: "diff"` with `baseLines` + `lines` or `maxLines`, plus optional `selections[].baseLines`, to render a Git-verified `−` / `+` excerpt between `baseSha` and `headSha`.
- Standard 4-stage template (`duration: 24`, adjust as needed):
  - `0s – 4.5s`: baseline `before` stage; highlight removed nodes and paths.
  - `4.0s – 13.5s`: paired `after` transition (`pair.at: 4.0`; `enter` + `connect` at `4.8s–6.5s`; `traces` at `7.5s–12.5s`).
  - `13.2s – 18.5s`: secondary contract or data view (`erd` / `sequence`).
  - `18.2s – 24.0s`: `code_focus` plus right-side `detail` (`mode: "diff"`) and before/after `metrics`.
- Mark helper or focus views `storyOnly: true` so they compose into the story without standalone images, and keep deep reference views (`erd`, `workflow`, `sequence`, …) `collapsed: true` so reviewers can expand them inside `<details>`.

## 6. Command loop

```sh
# each view: validate, deliver, check and browser-check one change-marked candidate
node <archify-pr-root>/bin/archify-pr.mjs finalize <type> <view.json> <view.html> --repo-root <repo> --quality showcase --json

# optional single-view export for a comment or another forge
node <archify-pr-root>/bin/archify-pr.mjs export-svg <type> <view.json> <out/view> --theme both --json

# GitHub pack (set target to policy.target or the user’s explicit choice)
node <archify-pr-root>/bin/archify-pr.mjs pr validate <pr-pack.json> --repo-root <repo> --json
node <archify-pr-root>/bin/archify-pr.mjs pr build <pr-pack.json> --out-dir <out> --repo-root <repo> --json
node <archify-pr-root>/bin/archify-pr.mjs pr attach <pr-number-or-url> --manifest <out>/pr-pack.receipt.json --target "$target" --dry-run --json
node <archify-pr-root>/bin/archify-pr.mjs pr attach <pr-number-or-url> --manifest <out>/pr-pack.receipt.json --target "$target" --json
```

On GitLab, use a static pack of standalone views. Sign in to the MR host with a
version of `glab` that supports `glab api --form`. Use the full HTTPS MR URL.
The GitLab target defaults to `comment`.

```sh
node <archify-pr-root>/bin/archify-pr.mjs pr build <pr-pack.json> --out-dir <out> --repo-root <repo> --platform gitlab --json
node <archify-pr-root>/bin/archify-pr.mjs pr attach <gitlab-mr-url> --manifest <out>/pr-pack.receipt.json --dry-run --json
node <archify-pr-root>/bin/archify-pr.mjs pr attach <gitlab-mr-url> --manifest <out>/pr-pack.receipt.json --json
```

GitLab attach checks the MR head, uploads changed SVGs to the target project,
and creates or updates the signed-in user's Archify comment. If an upload or
note write fails, retry the command. Files already uploaded during a failed
attempt can remain in project storage.

`build` writes pinned view snapshots, offline HTML, Camo-safe dual-theme SVGs, `pr-pack.md` with asset placeholders, and `pr-pack.receipt.json`.

On refresh, `attach` reads asset hashes and URLs from the hidden metadata in the selected body or sticky comment. It uploads only changed SVGs. A text-only refresh writes the pack in place with the existing URLs. GitHub diff links are filled with the actual PR URL during attach.

On GitHub, `attach` uploads the SVGs with `gh … --attach`, rewrites the placeholders to the returned `user-attachments` URLs, and replaces only the `<!-- archify-pr-pack:start/end -->` block, so a hand-written description and a re-run both survive. `--target comment` keeps one sticky comment instead. Use `--no-html` when only SVGs are needed, `--platform gitlab|generic` for a single-theme image, and `--animate-flow` only when the user asks for a finite flow animation.

When only the default target applies and the PR already has a written description, show the dry run or confirm the body target before writing.

## 7. Repair by diagnostic

Rerun the same command after fixing the cause:

- `pr-pack/invalid-source-anchor` — choose a changed file and check the one-based line against the pinned Git blob. Put `path` and `line` on a change row or story step for a head-side link. Use `baseLine` for a deletion and `basePath` on a renamed change row for its old path. Select a line visible in the PR diff. GitHub can fold unchanged context or large files even when the cited line exists. GitHub builds include links in the table and below the story; other platforms show the location as text.
- `pr-attach/head-sha-outdated` — compare the receipt head with the online PR head, push or fetch as appropriate, and rebuild at the intended commit. Use `--allow-stale` only when deliberately attaching an older pack.
- `repository-evidence/*` — the cited path or line is wrong at the pinned revision. A removed element is checked at `meta.repository.base_revision` (the merge-base), everything else at `revision`; `build` fills both from the verified SHAs. Fix the citation, never the mark.
- `pr-pack/base-sha-not-merge-base`, `pr-pack/head-sha-mismatch`, `pr-pack/view-revision-mismatch` — re-read step 1; the manifest or a view pins a different commit.
- `pr-pack/unknown-change-view` — a `changes[].view` names an undeclared view id.
- `pr-pack/risk-verdict` — the text contains `SAFE`, `LOW RISK`, `MERGEABLE`, `NO IMPACT` or `VERIFIED PR`. Remove it.
- `pr-story/empty-diff`, `pr-story/invalid-detail` — `detail` found no `+/−` lines or an excerpt omitted required `lines`/`baseLines`.
- `pr-attach/*` — read the receipt: preflight stops before any `gh` call for more than 50 attachments, a 5 MiB asset, an old `gh` (< 2.99.0) or a missing login; a failed second step restores the original body or deletes the temporary comment and reports it under `rollback`. Run `--dry-run` first on an unfamiliar repository.
- A change legend missing from the exported SVG means the authored canvas is too small: widen it rather than hiding the legend.
- `archify-pr/core-skill-missing` — the core `archify` Skill is unavailable or `ARCHIFY_BIN` is wrong. Report the suggested install command; never install or update the core Skill unless the user explicitly asks.

## 8. Wrap up

Report the attached `user-attachments` URLs, the view titles and any objective counts. Do not add a severity or mergeability judgment, and do not claim visual quality you have not checked.
