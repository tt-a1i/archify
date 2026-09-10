# Archify first-class Cursor onboarding research

> Snapshot: 2026-07-23. Sources are limited to Cursor's official documentation and changelog, the official `vercel-labs/skills` repository and CLI, Archify's own issue/docs/tests, and first-party peer repositories.

## Decision

**Recommendation:** add Cursor as a first-class installation surface for the existing `archify` Skill. Do not fork `SKILL.md`, add a Cursor-only runtime, or call the work complete until one real Cursor Editor/CLI session discovers the Skill and produces a verified artifact.

Use an explicit agent, skill, scope, and copy mode in product copy:

```bash
# Individual use: available in every Cursor project
npx -y skills add tt-a1i/archify --skill archify --agent cursor --global --copy --yes

# Team/repository use: installed only in the current project
npx -y skills add tt-a1i/archify --skill archify --agent cursor --copy --yes
```

For a reproducible test fixture, pin the version that was verified in this snapshot:

```bash
npx -y skills@1.5.20 add tt-a1i/archify --skill archify --agent cursor --copy --yes
```

`skills@1.5.20` is the published version in the official package source at this snapshot. Its CLI supports `--agent`, `--skill`, `--global`, `--copy`, and `--yes`.[`skills` package version](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/package.json#L1-L8) · [`skills add` options](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/README.md#L50-L60)

The unpinned command is the better user-facing default because it receives installer fixes. Pin the CLI in automated acceptance tests so a registry release cannot silently change the expected layout.

## Post-research acceptance

The live gate identified below subsequently passed on the same date. A fresh Cursor Agent CLI `2026.07.20-8cc9c0b` session discovered the project installation at `.agents/skills/archify/SKILL.md`, ran `doctor`, authored typed Architecture JSON, and delivered a showcase artifact with 9/9 checks and zero composition findings. Independent validation plus built-in-browser review confirmed the receipt, readable main/failure paths, working authored chapter, and zero console warnings or errors. See the dated [Cursor acceptance record](./cursor-acceptance-2026-07.md).

This supports first-class Cursor onboarding for the recorded environment. It still does not claim identical quality across every Cursor release or model.

## Verified facts

### Cursor's native contract

- Cursor 2.4 introduced Agent Skills in both the Editor and CLI. Skills can be discovered by the agent from context or invoked from the slash-command menu.[Cursor 2.4 changelog](https://cursor.com/changelog/2-4)
- Cursor automatically loads project skills from `.agents/skills/` and `.cursor/skills/`, and user-level skills from `~/.agents/skills/` and `~/.cursor/skills/`.[Cursor skill directories](https://cursor.com/docs/skills#skill-directories)
- The unit is a folder containing `SKILL.md`; scripts, references, and assets may live beside it. Cursor presents discovered skills under **Customize → Skills → Agent Decides**.[Cursor Skills documentation](https://cursor.com/docs/skills)
- Cursor's GitHub UI import flow is documented as **Customize → Rules → Add Rule → Remote Rule (Github)**, but the official page does not specify how a nested skill is selected or which local scope/path receives it.[Cursor GitHub import](https://cursor.com/docs/skills#installing-skills-from-github)

Therefore these are valid Cursor-native endpoints:

| Scope | Valid Skill roots | Archify entry |
|---|---|---|
| Project | `.agents/skills/`, `.cursor/skills/` | `<root>/archify/SKILL.md` |
| User/global | `~/.agents/skills/`, `~/.cursor/skills/` | `<root>/archify/SKILL.md` |

### What the `skills` CLI actually supports

- The official CLI lists Cursor as install target `cursor`, with project path `.agents/skills/` and documented global path `~/.cursor/skills/`.[Supported agents table](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/README.md#L238-L265) · [Cursor agent configuration](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/agents.ts#L248-L255)
- Project scope is the default; `--global` makes the Skill available across projects. The CLI describes symlink mode as a canonical copy plus agent links, and copy mode as independent copies.[Scope and method documentation](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/README.md#L90-L104)
- Current installer code treats every agent whose project path is `.agents/skills/` as a universal agent. For a universal agent it resolves both project and global installs to the canonical `.agents/skills/` root.[Universal-agent resolution](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/installer.ts#L98-L129) · [Universal-agent predicate](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/agents.ts#L842-L847)
- Consequently, as of `1.5.20`, a Cursor-only **global** CLI install lands in `~/.agents/skills/archify`, not necessarily in the README's `~/.cursor/skills/archify`. This remains a valid Cursor directory, so discovery compatibility is not lost; documentation must not promise the latter physical path.[Global universal install behavior](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/installer.ts#L358-L371) · [Cursor global directories](https://cursor.com/docs/skills#skill-directories)
- `--copy` writes directly to the resolved agent path. Default symlink mode first creates a canonical copy, then links agent-specific paths when those paths differ; if linking fails it falls back to another copy.[Installer copy/symlink implementation](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/installer.ts#L336-L412)
- `skills use ... --agent cursor` is **not** supported by the current CLI. Its interactive launcher only registers `claude-code` and `codex`, and its own test expects Cursor launch to be rejected.[Interactive launcher allowlist](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/use.ts#L74-L86) · [Cursor rejection test](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/src/use.test.ts#L216-L222)

### Archify's current evidence

- [Issue #46](https://github.com/tt-a1i/archify/issues/46) is open and asks to collaborate on Cursor usage. It had no comments at this snapshot.
- The current Archify README names Claude, Codex CLI, and opencode, and its installation matrix does not include Cursor.[Current positioning](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/README.md#L11-L19) · [Current installation matrix](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/README.md#L223-L231)
- Archify requires Node.js 18 or newer, but its distributed renderer and validators do not require `npm install`.[Runtime contract](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/archify/package.json#L8-L13) · [Skill setup contract](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/archify/SKILL.md#L27-L33)
- Existing tests already simulate a copied installation with `node_modules` and repository-only tests removed, then exercise all five modes through `deliver` and run live preview.[Installed-copy fixture](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/archify/test/cli.test.mjs#L56-L69) · [Five-mode installed delivery](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/archify/test/cli.test.mjs#L357-L381) · [Installed preview](https://github.com/tt-a1i/archify/blob/e7e22a1e3243d51c1cfbfcce005db1d3355478b3/archify/test/cli.test.mjs#L383-L425)

### Live installer smoke performed for this research

From a fresh temporary directory, this exact command succeeded:

```bash
npx -y skills@1.5.20 add tt-a1i/archify \
  --skill archify --agent cursor --copy --yes
```

Observed evidence:

1. `npx -y skills@1.5.20 list --agent cursor --json` reported one project-scoped `Cursor` installation at `.agents/skills/archify`.
2. `node .agents/skills/archify/bin/archify.mjs doctor` exited 0.
3. Showcase validation of the installed architecture example exited 0 with nine checks and zero errors/warnings.
4. `deliver` exited 0 and produced a checked, self-contained HTML artifact with a SHA-256 receipt.

This installer smoke alone proves **install-path and packaged-runtime compatibility**. The separate live Cursor Agent gate recorded above subsequently proved discovery and execution for one dated environment; neither result generalizes across every Cursor release or model.

## Scope and installation trade-offs

| Choice | Verified behavior | Risk | Recommendation |
|---|---|---|---|
| Global | Current CLI resolves Cursor to `~/.agents/skills/archify`; Cursor officially scans that root. | A shell-capable Skill becomes available in every project; update timing is user-wide. | Default for an individual who wants Archify everywhere. Say exactly what scope it grants. |
| Project | Installs `.agents/skills/archify` plus `skills-lock.json` in the current repository. | The copied Skill is a substantial repository diff if committed, and can become stale relative to upstream. | Offer as the team/reproducible option, not as a silent default. |
| Default symlink mode | For multiple agents, keeps a canonical copy and creates agent links. For Cursor alone, canonical and agent project paths coincide, so the installed Skill is a real directory, not a live link to GitHub. | “Symlink” may be misread as automatic upstream updates; cross-platform links can fail. | Keep as an advanced/default-CLI behavior, but do not promise automatic updates. |
| `--copy` | Writes an independent Skill tree directly to the resolved Cursor path. | Multiple agent copies can drift and must be reinstalled/updated independently. | Use in the one-line Cursor command for predictable, reviewable files and parity with the tested smoke. |

Regardless of method, tell users that skills execute with the agent's permissions and should be reviewed before use; the official CLI prints this warning after installation.

## Defensible claims vs claims to avoid

### Defensible now

- “Cursor supports Agent Skills in its Editor and CLI.”
- “Install Archify for Cursor with `--agent cursor`; use `.agents/skills/archify` for a project or a Cursor-supported global Skill root for user scope.”
- “The installed Archify package passes `doctor`, validation, and checked HTML delivery without `npm install`, provided Node.js 18+ is available.”
- “Archify uses the same portable `SKILL.md` and renderer contract across Cursor, Claude, Codex, and opencode.”

### Claims to continue avoiding

- “Fully tested across Cursor” or “all Cursor models produce the same visual quality.” One dated Cursor Agent environment passed; broader versions and models were not benchmarked.
- “Try without installing via `npx skills use ... --agent cursor`.” Current `skills` explicitly rejects interactive Cursor launch.
- “The global CLI command installs to `~/.cursor/skills/archify`.” The current implementation resolves Cursor as universal and may use `~/.agents/skills/archify`.
- “Cursor's Remote Rule UI imports Archify correctly from the bare repository URL.” Cursor documents the UI, but not nested Skill selection; Archify's actual Skill lives under `archify/`.
- “The Skill updates automatically.” Both CLI modes create a local copy somewhere; updates require an explicit CLI update/reinstall or an independently managed checkout.

## What close peers teach us

- **GitNexus** turns editor support into an explicit product path: `npx gitnexus setup` auto-detects editors, while `gitnexus setup -c cursor,codex` makes the chosen integrations auditable; its README publishes a Cursor support row instead of relying on generic compatibility language.[GitNexus quick start](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L50-L58) · [GitNexus editor setup](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L201-L210) **Recommendation:** give Cursor its own visible selector/command and acceptance row, without adding an Archify setup daemon.
- **Fireworks Tech Graph** pins a known `skills` version, uses the real nested Skill path, targets agents explicitly, chooses copy mode, documents exact resulting directories, and tells users when runtime restart may be needed.[Fireworks install contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L193-L205) · [Fireworks discovery/update note](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L248-L256) **Recommendation:** use explicit `--skill archify --agent cursor --copy --yes`, pin only in tests, and offer “start a new Cursor Agent session if the Skill is not yet visible” as a conservative troubleshooting note rather than an official hard requirement.
- **GitDiagram** compresses first use to one memorable action—replace `hub` with `diagram` in a GitHub URL—then immediately shows the interactive result.[GitDiagram first-use contract](https://github.com/ahmedkhaleel2004/gitdiagram/blob/041d2feb4a9b1593dcf3bde2ca5b9ae7659becb9/README.md#L6-L20) **Recommendation:** pair the Cursor install command with one bounded prompt and `doctor`/`demo`; do not copy its hosted repository-ingestion model into Archify's local, self-contained trust boundary.

## Acceptance gates (3–5 tests)

1. **Project installation contract — automated.** In a clean temporary repository, run the pinned project command. Assert a real directory at `.agents/skills/archify`, valid `SKILL.md` frontmatter, a `skills-lock.json`, and `skills list --agent cursor --json` reporting scope `project` and agent `Cursor`.
2. **Global installation contract — automated in an isolated home/container.** Run the pinned global command without touching the developer's real home. Assert the resulting `archify/SKILL.md` is under a directory Cursor officially scans. For `skills@1.5.20`, expect `~/.agents/skills/archify`; do not hard-code `~/.cursor/skills` as the only valid result.
3. **Installed runtime contract — automated.** From the copied install with no `node_modules`, run `doctor`, then `deliver --quality showcase --json` for architecture, workflow, sequence, dataflow, and lifecycle. Require exit 0, a single JSON receipt, nine checks, zero errors, and an existing self-contained HTML file for every mode.
4. **Real Cursor discovery and invocation — manual release gate (passed 2026-07-23).** In a fresh Cursor Agent session, confirm Archify appears under **Customize → Skills** and is slash-invokable or context-discovered. Ask: `Use archify to map this repository's runtime architecture.` Confirm Cursor runs `doctor`, produces one typed source plus verified HTML, and the artifact opens without console errors. Record Cursor version, model, OS, and scope. The dated acceptance record captures the passing environment; future support claims should continue to name that boundary.
5. **Documentation and negative-contract gate — automated.** Keep README EN/ZH, start page source/generated page, landing page, and installation matrix on one exact Cursor command. Add a guard that fails if docs suggest `skills use ... --agent cursor`, promise `~/.cursor/skills` as the CLI's only global result, or claim end-to-end Cursor verification without a recorded smoke fixture.

## Smallest implementation slice

1. Add Cursor to the README opening sentence and installation matrix.
2. Add a Cursor selector to the existing Start surface; selecting it changes only the command, expected scope/path note, and one bounded first prompt.
3. Reuse the same `archify/SKILL.md`; add no Cursor fork or Cursor-specific diagram behavior.
4. Add the project installer canary and documentation consistency test.
5. Run the real Cursor acceptance gate, then decide whether the issue can be answered as supported or only install-compatible.
