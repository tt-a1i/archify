---
name: archify-pr
description: "Explain git branch changes, diffs, and GitHub pull requests or GitLab merge requests with visual architecture, workflow, sequence, ERD, or lifecycle walkthroughs. When a pull request carries material architectural, flow, schema, or async-state changes, lightly offer optional Archify PR diagrams and their review benefit without forcing them; build and attach Camo-safe dual-theme story or static diagrams when the user agrees or explicitly asks. Requires the companion archify core Skill."
license: Apache-2.0
metadata:
  version: "3.3"
  author: tt-a1i
---

# Archify PR

Turn a branch change or pull request into diagrams that show what changed, where it propagates, and with what neighbours. Read the code as the authority; report evidence, never a risk verdict.

Every command goes through this Skill's wrapper, `bin/archify-pr.mjs`:

```bash
node <archify-pr-root>/bin/archify-pr.mjs pr validate <manifest.json> --repo-root <repo> --json
```

The wrapper delegates unchanged to the installed core `archify/bin/archify.mjs`. It never downloads or installs anything.

## Route the request

### Explicit PR visualization

When the user asks to explain or visualize a PR, a branch change, or a `git diff`, or to run `archify pr`, start the workflow directly. Read [`references/pr-workflow.md`](references/pr-workflow.md), pin the three-dot range from `git merge-base`, and build the pack; do not ask whether a diagram is wanted.

For GitLab merge requests, build static views with `--platform gitlab` and attach them to a comment using the full MR URL. On GitHub, use the target from the request or preflight policy. When only the default applies and the shared PR already has a written description, show the attach dry run or confirm the target before writing.

### Ordinary PR preparation

When the user only asks to create or summarize a PR:

1. Run `node <archify-pr-root>/bin/archify-pr.mjs pr preflight --repo-root <repo> --json`. Pass the PR base with `--base <ref>` when it differs from the repository default.
2. Read `policy` and `materiality` from the result.
3. Follow the mode:
   - `on-demand`: stay silent and complete the text-only PR flow.
   - `ask`: make the optional offer only when the filter recommends it.
   - `proactive` (opt-in only): attach a diagram to a material PR without asking.

## Interaction modes

- `ask` (default, no rules line needed): offer diagrams for material changes only, then follow the user's answer.
- `on-demand`: never offer; act only on an explicit request. Rule line: `[archify pr: on-demand]`.
- `proactive`: build and attach for material changes without asking. Only when the user explicitly requests this mode. Rule line: `[archify pr: proactive]`.

A rule may also select the attach target, for example `[archify pr: ask, target=comment]`. An explicit request takes precedence (pass `--mode` or `--target` to preflight), followed by the current agent’s personal rules, then the repository root’s `AGENTS.md` or `CONTRIBUTING.md`. The default is `ask` with target `body`. Repository rules requesting `proactive` resolve to `ask`. Preflight discovers personal rules for Codex, Claude Code, Cursor and Devin. See [personal rule discovery](references/pr-workflow.md#personal-rule-discovery); pass `--global-rules <path>` to select the current agent’s personal file explicitly.

To switch personal modes, only when the user asks, write or replace one rule line in the current agent's global rules file (such as `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md` or `~/.config/devin/AGENTS.md`) and name the file. Deleting the line restores the repository or default policy. Never switch to `proactive` unasked.

## Materiality filter

If `materiality.shouldOffer` is false, finish the ordinary PR flow silently. For a candidate, inspect the changed code before offering. Stay silent when the change is any of:

- docs, Markdown, comments or copy only;
- lockfiles, version or dependency manifests, or simple configuration values;
- formatting, lint fixes, or file renames without a logic change;
- tests only, with no production architecture, interface or state change;
- a small single-point edit: one or two files clearly under about 40 changed lines, with no cross-module chain, API contract, state machine or migration change. Schema and migration changes remain candidates even below this threshold.

Offer a diagram only when at least one is true:

- a cross-module or cross-service topology or responsibility change spanning two or more layers or three or more core modules;
- an async queue, scheduled job, retry, idempotency or state-machine transition change;
- a database schema, foreign-key or index migration, or an added, removed or changed public API contract.

When unsure, stay silent. A missed offer costs less than an unwanted interruption.

## The offer

Use the user's current language and at most three short lines:

1. Name the part of this diff that is hard to read, concretely.
2. State the concrete value: for example one looping story walkthrough plus collapsible static before/after diagrams, hosted through GitHub `user-attachments`. On GitLab, offer static diagrams in an MR comment.
3. Say it is optional. If the user declines or ignores it, finish the text-only PR and do not ask again.

## Build and attach

When the user agrees, or asks explicitly, read [PR workflow](references/pr-workflow.md) for the full manifest, change-mark, story, command and attach loop. It covers:

- the `git merge-base` three-dot range and pinned `baseSha` / `headSha`;
- merged-superset views with one hop of context and change marks;
- the Story dynamic walkthrough with `storyOnly` helper views and `collapsed` static references;
- `detail.mode: "diff"` excerpts from real Git revisions;
- `pr validate`, `pr build`, `pr attach --dry-run`, then `pr attach`;
- diagnostic repair for `pr-pack/*`, `pr-story/*` and `pr-attach/*`.

## Missing core Skill

If the wrapper exits with `archify-pr/core-skill-missing`, the core `archify` Skill is not installed or `ARCHIFY_BIN` is wrong. Report the diagnostic and the install command it suggests to the user. Never run `npx skills add`, install, update or uninstall the core Skill yourself unless the user explicitly asks.

## Evidence rules

- Reproduce the three-dot diff the forge shows; never diff the working tree or a moved two-dot base.
- Cite repository paths and lines at the pinned revisions.
- Never write `SAFE`, `LOW RISK`, `MERGEABLE`, `NO IMPACT`, `VERIFIED PR` or any other risk verdict. Report counts, names and diagrams; the reviewer owns the verdict.
- Do not pad a pack with a view whose only content is `unchanged`.
