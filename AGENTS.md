# AGENTS.md

Instructions for coding agents working on this repository.

## Installing Archify

Installing, updating, removing, or reinstalling Archify changes live agent
configuration outside this checkout. Do that only when the user names that exact
action directly, such as "install Archify" or "update the global Archify Skill."
An implied need or a request to edit, test, review, commit, push, merge, release,
publish, or sync this repository is not consent.

Before any live installation mutation:

1. Confirm the exact action, source, agent, and global or project scope. Do not
   infer `--all`; use `--yes` only after those values are explicit. A reinstall
   is an update/install operation, not permission to remove unrelated paths.
2. For a Skills CLI add, first run
   `npx -y skills add tt-a1i/archify --list --full-depth`. This documented
   `--list` mode must discover exactly one Skill named `archify`. On a command
   error, zero matches, or multiple matches, stop and report the output without
   running a mutating command.
3. Install from the canonical `tt-a1i/archify` source. Do not use a path under a
   system temporary directory, a Git worktree, or another session-scoped
   checkout as a local package source. A deliberate local-source install may
   use a clean, durable checkout only when the user explicitly asks for it;
   prefer `--copy` unless they explicitly request managed symlinks.
4. Before a manual copy or extraction, fail if the destination exists; report
   the exact path and never delete or replace it unless the user explicitly
   approves that named path after seeing the conflict. For Skills CLI and
   package-manager operations, use their own conflict handling,
   never add an unrequested force flag, and report every skipped, replaced, or
   failed destination.
5. Afterward, report the exact command, source, action, skill or package, agent,
   scope, and result. Never describe a partial installation as success.

For `skills update`, name `archify` and pass `--global` or `--project` explicitly;
do not run an unscoped bulk update. For `skills remove`, name `archify`, specify
its scope and requested agents, and never use `--all`. Manual `archify.zip`
extraction, Claude.ai upload, DSH plugin add/remove, and package-manager
installation follow the same action/scope confirmation and reporting rules; use
the documented exact destination or package version and preserve unrelated
files. The Skill's update checker is notification-only, so an update notice
never authorizes installation.

## Repository workflow

Follow [`CONTRIBUTING.md`](CONTRIBUTING.md) for planning, compatibility,
validation, generated artifacts, and pull-request evidence. In particular:

- start from the latest `main` and keep one behavior per pull request;
- run the narrowest relevant test first and `npm test` from `archify/` before
  final review;
- rebuild `archify.zip` only when packaged Skill bytes change;
- do not claim remote CI passed unless it ran on the current head;
- never include secrets, private repository content, personal data, or customer
  data in repository artifacts.
