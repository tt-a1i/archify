# Archify for Hermes Agent

Community [Hermes Agent](https://hermes-agent.nousresearch.com/) integration for [Archify](https://github.com/tt-a1i/archify). This is **not** an official Nous Research product and does not imply Nous endorsement.

This is a **Skill-only** plugin. It does not register native Python render tools, telemetry, MCP servers, credentials handling, or background services. Hermes still needs **Node.js 18+**. The compiler remains `node bin/archify.mjs`.

There is no Python port of the renderers. A Python assistant uses Archify the same way Cursor does: author typed JSON, then run the Node CLI. Hermes is not an agent-switcher target.

## Install (shows up in available skills)

This command installs the published Skill from [`tt-a1i/archify`](https://github.com/tt-a1i/archify) (`archify/SKILL.md` plus the Node renderer). Hermes already indexes that package as `skills-sh/tt-a1i/archify/archify`. After this repository's Hermes docs land on `main`, keep using the same identifier; `skills.sh` may lag a few hours behind GitHub.

```bash
hermes skills install skills-sh/tt-a1i/archify/archify -y
```

Requires Node.js 18+ on the machine (or in the Hermes Docker image). Restart Hermes, then ask:

```text
Use the archify skill to map this repository's runtime architecture.
Show 8–12 core components, one primary path, external dependencies, and trust boundaries.
Put supporting detail in cards instead of adding more edges.
After delivery, return the exact workspace paths of the specification JSON and the HTML artifact.
```

Run `node bin/archify.mjs` from the installed Skill directory (`~/.hermes/skills/archify` or `%USERPROFILE%\.hermes\skills\archify`), or pass absolute paths.

If `hermes skills inspect skills-sh/tt-a1i/archify/archify` cannot resolve the identifier, wait for the skills.sh index or use the checkout symlink below. Do not invent a different owner/repo path: forks are different packages.

### Local checkout (this branch)

Replace the source path with your checkout.

Linux / macOS:

```bash
ln -sfn /absolute/path/to/archify/archify ~/.hermes/skills/archify
```

Windows PowerShell:

```powershell
New-Item -ItemType SymbolicLink -Force -Path "$env:USERPROFILE\.hermes\skills\archify" -Target "C:\absolute\path\to\archify\archify"
```

### Docker

Hermes Docker mounts `~/.hermes` at `/opt/data`. Run the install on the **host** so files land in that volume, or bind-mount `/absolute/path/to/archify/archify` to `/opt/data/skills/archify`. A host symlink whose target is outside the volume is invisible in the container.

## Optional namespaced plugin

Plugin skills are opt-in (`skill_view("archify:archify")`) and are not listed in the system prompt index. Install the Skill first so `register()` can resolve `SKILL.md` from `~/.hermes/skills/archify`. A checkout of this repository also works: `integrations/hermes-agent` falls back to `archify/SKILL.md`.

Linux / macOS:

```bash
ln -sfn /absolute/path/to/archify/integrations/hermes-agent ~/.hermes/plugins/archify
hermes plugins enable archify
```

Windows PowerShell:

```powershell
New-Item -ItemType SymbolicLink -Force -Path "$env:USERPROFILE\.hermes\plugins\archify" -Target "C:\absolute\path\to\archify\integrations\hermes-agent"
hermes plugins enable archify
```

`register()` looks for `SKILL.md` in this order: an optional packed `skills/archify` copy, the in-repo `archify/` package, `ARCHIFY_SKILL_ROOT`, then `HERMES_HOME/skills/archify` (default `~/.hermes/skills/archify`).

## Uninstall

```bash
hermes skills uninstall archify
```

Linux / macOS leftover cleanup:

```bash
rm ~/.hermes/skills/archify
hermes plugins disable archify
rm ~/.hermes/plugins/archify
```

Windows PowerShell:

```powershell
Remove-Item "$env:USERPROFILE\.hermes\skills\archify"
hermes plugins disable archify
Remove-Item "$env:USERPROFILE\.hermes\plugins\archify"
```

## Scope

- Compatible with Hermes directory plugins (`plugin.yaml` + `register(ctx)`).
- Does not add Archify to the Cursor / Codex / Claude Code / OpenCode agent switcher.
- Does not claim merge safety, blast radius, or live-infrastructure verification.
