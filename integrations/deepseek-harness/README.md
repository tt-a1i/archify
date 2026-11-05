# `@tt-a1i/archify-dsh`

Community DeepSeek Harness integration for [Archify](https://github.com/tt-a1i/archify). This is **not** an official DeepSeek product and does not imply DeepSeek endorsement.

The currently published npm package is **v1.0.0**. It bundles Archify Skill **3.0.1** and supports the exact developer-preview **`@deepseek-ai/dsh@0.1.2-rc.1`** on Node.js **`^22.19.0 || >=24.0.0`**. The 1.0 adapter contract covers this exact DSH host version; it does not make the host stable or guarantee compatibility with other DSH versions.

Version 1.0.0 was published on 2026-10-04: [npm package](https://www.npmjs.com/package/@tt-a1i/archify-dsh/v/1.0.0) · [release and verified tarball](https://github.com/tt-a1i/archify/releases/tag/archify-dsh-v1.0.0). It is a Skill-only bundle: it inserts one filesystem Skill provider named `archify-plugin` and exposes **Archify 3.0.1**, pinned to stable `main` commit `7158026e852f3aa6578c741e673b46d7878c92c1`. This snapshot includes the Skill installation fix from [#704](https://github.com/tt-a1i/archify/pull/704), which landed after the `v3.0.1` tag; it is not a byte-for-byte copy of that tag. The packaged `package.json` and `skill-release.json` both declare 3.0.1. Compared with the previous plugin 0.1.0, it includes the Archify 3.x authoring and delivery flow, authored brand marks, Workflow schema v2, Viewer localization, and update awareness.

`release.json` records the current candidate's immutable Skill source commit, Skill version, and target DSH acceptance version; historical release pins remain in their tags. Packaging uses the canonical clean-Skill stager against that commit, preserving license notices and excluding development files. Adapter version 0.1.0 and its `archify-dsh-v0.1.0` tag remain unchanged; reproduce that old release by checking out its tag first.

The adapter registers no native render/validate/deliver tools, custom Web client, Produced Files chips, telemetry, credentials handling, background services, or install hooks. The bundled Skill includes an optional, notification-only stable Archify update checker; it never upgrades the plugin. Authored remote brand assets may also use the Skill's bounded network path. The adapter itself makes no network requests.

## Pending 1.1.0 candidate — not published

[#1153](https://github.com/tt-a1i/archify/issues/1153) prepares **adapter 1.1.0**, bundling **Archify 3.2.0** from immutable stable `main` commit `edf158c4e7a1d18d20cc329840f864289634c090`, with **`@deepseek-ai/dsh@0.2.1-rc.2`** as its exact acceptance target. This is a candidate, not an npm availability or completed support claim. The public install command and community catalog remain on published 1.0.0 until a separately authorized publication is verified.

The snapshot adds 3.1's ERD, Class, Tree, Timeline and Waterfall types and 3.2's one-page explainer. It includes the Apache-2.0 transition (`9c306ee89`) and standalone third-party notice fix (`edf158c4e`) after the `v3.2.0` tag; it is not a byte-for-byte copy of that tag. Both bundled version manifests declare 3.2.0. The adapter remains MIT-licensed; the bundled Skill is Apache-2.0 and retains historical MIT grants and third-party notices. Inspect `LICENSE`, `LICENSE-MIT`, `NOTICE` and `THIRD_PARTY_NOTICES.md` in the actual bundled Skill, not just the outer package's license field.

Before publication, retain candidate-head receipts for clean installation, full Skill loading, installed `doctor`/`demo`, same-profile upgrades from **both 0.1.0 and 1.0.0**, and uninstall/base-profile preservation. Record the tarball digest, immutable source, exact host/command source, OS, Node and date. Add same-name `archify` conflicts to these checks, not just distinct test Skills. Candidate acceptance results belong in the linked PR/release record; the historical matrix below does not certify this candidate. Three-platform release acceptance and native Desktop/Electron acceptance remain separate; untested platforms, running-host updates and Desktop are not covered by a CLI pass. No support range for all `0.2.x` hosts is claimed.

### Which Archify actually loads?

On the candidate host, personal and project Skill sources outrank the bundled snapshot. An existing same-name `archify` can therefore shadow the bundle, even after the plugin has upgraded successfully. Upgrading the plugin does **not** necessarily upgrade the effective Skill. The acceptance matrix must check the actual loaded body and source path for older personal and project copies, then check that removing only the disposable test copy restores the bundled body. A version in the installed package alone is insufficient evidence.

When diagnosing a real installation, inspect the effective `archify` source path and version before changing anything. Updating or removing a personal/project copy is a separate user-controlled action; do not delete live Skills automatically to make the bundle win.

## Default Skill roots: unreleased fix

Published **1.0.0** sets `includeDefaultRoots: false`. If its `archify-plugin` provider is the profile's only live filesystem Skill source, personal and project Skills disappear while Archify remains available. This was reported on macOS Desktop `0.2.0-rc.2` in [#906](https://github.com/tt-a1i/archify/issues/906).

The **unreleased source fix** sets `includeDefaultRoots: true`, retaining the host's default personal and project roots alongside the packaged Archify root. The provider name and bundle directory are unchanged. The install command below still installs published 1.0.0, **not this fix**; no new adapter version has been published.

The acceptance script now seeds distinct Skills in both DSH and shared-agent personal/project roots and checks their actual loaded bodies and paths after clean installation and same-profile upgrade. It repeats those checks with the base filesystem provider disabled, so the Archify provider must preserve the roots by itself. The immutable 0.1.0 and 1.0.0 upgrade baselines retain their original `false` expectation; the candidate requires `true`.

Candidate automated checks target the exact npm CLI host in `release.json` (`0.2.1-rc.2`); configuring that target is not an acceptance result. They do not establish macOS Desktop `0.2.0-rc.2` acceptance or explain why the reporter's original provider was inactive. That native Desktop verification remains pending; the published support statement is unchanged.

## Patch execution boundary

The `cordis.patch.yml` file is configuration consumed by the DSH host. Its `bundledSkillDir` value uses the host loader's `!!js` expression to resolve the installed package's `skills` directory when the entry is activated. This expression runs in the DSH host process, outside the agent sandbox; it is not an inert YAML value and should be treated as host-loaded code.

The current expression is intentionally limited to Node's built-in `path` and `module` helpers for package resolution. It does not fetch data, read credentials, spawn processes, or register another permission path. The normal `lib/index.js` resolver documents the same package-root logic, but the filesystem provider is mounted directly by the patch, so that module is not the activation hook for this bundle. Keep the published install exact-pinned and review any patch change as host-process code.

## Install

Use the prebuilt npm package with an exact version. Do not install from Git source.

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@1.0.0
```

## Upgrade

The 1.0.0 release gate covers both a clean installation and upgrading the previous plugin 0.1.0 to 1.0.0 in the same isolated profile on `@deepseek-ai/dsh@0.1.2-rc.1`. The older host `0.1.0-rc.6` is not a supported 1.0 target: update the host separately before upgrading the plugin. The Node requirement remains `^22.19.0 || >=24.0.0`; the three-platform release gate runs on Node 22. See the [adapter changelog](CHANGELOG.md) for the bundled Archify change.

Run the same exact-version install command above in each profile that uses Archify. Updating DSH itself or the Archify repository does not update an already installed plugin.

For newer-host investigations, see the [host migration review and evidence matrix](#host-migration-review). The CLI checks recorded there do not extend the published support contract to Desktop or other DSH versions.

Do **not** use `dsh plugin add tt-a1i/archify`: the repository root is not a DSH package and has no bundle metadata (see [#341](https://github.com/tt-a1i/archify/issues/341)). For an npm download problem, a locally downloaded, integrity-verified `.tgz` can be passed to `dsh plugin --profile web add /absolute/path/to/package.tgz`.

## Host activation configuration

The bundle's `cordis.patch.yml` contains a `!!js` expression that DSH evaluates during host activation. Its current purpose is limited to resolving the installed `@tt-a1i/archify-dsh` package from the profile `baseUrl` and locating its packaged `skills` directory. The expression does not itself make network requests or handle credentials, but it is evaluated host-process code rather than entirely declarative data. Review the patch when upgrading, and keep the exact-version install guidance above.

## Release maintenance

Every Archify release records a sync or deferral decision in the [DSH synchronization checklist](../../CONTRIBUTING.md#release-checklist-dsh-synchronization). Plugin and Archify versions are independent.

On a release branch, bump `package.json`, update `release.json` with the full source commit and matching Skill/DSH versions, and prepare `PACKAGE_README.md`, which is staged as the npm package’s `README.md`. This repository README tracks publication status separately. The pack command reads adapter files and release metadata from the current adapter Git HEAD blob: commit those changes before packing; working-tree edits are not package inputs. Run:

```bash
node --test integrations/deepseek-harness/test/*.test.mjs
node integrations/deepseek-harness/scripts/distribution-acceptance.mjs
node integrations/deepseek-harness/scripts/pack.mjs --out /tmp/archify-dsh.tgz --json
```

Distribution acceptance requires Node 22 for the canonical ZIP regression check and pnpm 10.

Run it from a Git checkout with full history (CI uses `fetch-depth: 0`), not an exported source archive: packaging needs the source commit in `release.json`, and the shadowing fixture reads `archify/SKILL.md` from historical commit `7158026e852f3aa6578c741e673b46d7878c92c1`. If that object is missing from a shallow checkout, fetch the repository history before acceptance; the script does not silently substitute the current Skill or fetch a moving branch.

Acceptance installs the real pinned DSH runtime and tarball in temporary profiles, checks discovery and loading, runs `doctor` and `demo` through the installed CLI, and checks uninstall. It also installs each integrity-pinned published baseline (0.1.0 and 1.0.0) in a separate temporary profile, upgrades that same profile to the candidate, checks both Skill identities and loading, exercises the upgraded CLI, and verifies removal preserves the base profile. The full source-version package smoke runs on a temporary copy of the installed Skill because it rewrites bundled examples; the copy preserves pnpm store hard links in the actual installation. Release CI runs this on Linux, macOS, and Windows. Publish only the tested tarball as a new version; tag the corresponding adapter commit as `archify-dsh-v<version>`. After each publication is publicly verified, update the public install examples and community metadata to the verified version. Rebuilding a released adapter uses its tag and recorded Skill commit, not a moving branch.

## Host migration review

<details>
<summary>Review procedure, 0.2 host findings, and support-evidence matrix</summary>

Use this review within the [central DSH release checklist](../../CONTRIBUTING.md#release-checklist-dsh-synchronization), without creating another release pipeline. Keep three identities separate: the **adapter version**, the **bundled Archify version / immutable source**, and the **exact DSH host**. The historical review below concerns 1.0.0 / 3.0.1, not the pending 1.1.0 / 3.2.0 candidate. `release.json.dshVersion` pins this repository's acceptance runtime; it is not a host-enforced minimum version or a promise about later hosts.

For each new target:

1. Record the actual npm package or Desktop binary source, exact version and immutable source commit, Node/OS, profile and command owner. Read the repository rules and existing acceptance results before changing anything. Use only authorized disposable profiles; leave live installations and unrelated configuration alone.
2. Compare the adapter's consumed surface against both exact official host revisions: bundle metadata, patch parsing/activation and `baseUrl`, filesystem provider configuration and Skill loading, and manifest/dependency compatibility checks. Separate Host, Web Client and standalone Skill CLI APIs. A migration card applies only if this adapter uses that surface; record missing version edges rather than treating a zero-hit scan as a complete audit.
3. Baseline the existing package contracts. For an approved implementation change, rerun affected checks and real isolated installation, discovery/load, installed CLI smoke, same-profile upgrade and uninstall. Keep dependency cohorts coherent. Do not run a community verifier or its install lifecycle scripts implicitly, widen peer ranges, grant version exemptions, or disable security scanning to obtain a pass.
4. Attach the tested artifact digest, source/host coordinates, date and results to the release record. Explicitly distinguish reused results from new-head checks and missing native-platform coverage. Change the support statement only after the proposed scope has its own acceptance evidence; publication remains a separate action.

### Review recorded on 2026-10-05

The comparison uses official DeepSeek Harness tags resolved to these commits, not a moving `latest`:

| Host | Official source commit |
| --- | --- |
| `0.1.2-rc.1` | [`a66e4702047846cdaa10c66c9d3df3951f5ea70d`](https://github.com/deepseek-ai/deepseek-harness/tree/a66e4702047846cdaa10c66c9d3df3951f5ea70d) |
| `0.2.0-rc.2` | [`639ed015397290b3745d163aafe02ffee4aa3f84`](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84) |
| `0.2.1-alpha.1` | [`5badb15009ae1756c3afe0ae0cef1faafc290ccc`](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc) |

| Actual touchpoint | Finding across those sources | Consequence for this adapter |
| --- | --- | --- |
| `package.json` → `dsh.bundle.patch` | The host still accepts a single patch-file string; newer hosts also support a list. See [profile bundle loading](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/src/profile.ts). | The existing one-file declaration needs no conversion. |
| `cordis.patch.yml` → `!!js` / profile `baseUrl` | The [include YAML schema](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/include/src/index.ts) preserves expression nodes; [loader interpolation](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/loader/src/config/utils.ts) still evaluates against the context. | Keep package resolution via `createRequire(baseUrl).resolve(...)`. The expression remains host-process code. `lib/index.js` is not the bundle's activation hook. Config dump alone is insufficient; the existing probes actually load the Skill. |
| `@deepseek-ai/dsh-skill-filesystem` | `inject: ['skills']`, provider registration, `providerName`, `includeDefaultRoots` and `bundledSkillDir` remain available. Newer [provider code](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/skill/skill-filesystem/src/index.ts) resolves the loaded Skill file's real path; the provider source is unchanged between the two reviewed 0.2 tags. | One `archify-plugin` provider with packaged resources still loads in the recorded CLI tests. Watcher disposal and Windows hot replacement require separate native evidence. |
| Manifest / DSH peer enforcement | The two 0.2 tags have the same [compatibility checker](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/src/plugin-compatibility.ts). It checks declared `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peers with `includePrerelease: true`; the published adapter has no dependency or peer fields. | There is no DSH peer mismatch to reject here. A successful check does not certify support; no manifest change is justified by this review. |

The actual official npm `@deepseek-ai/dsh-app-boot` checker was also exercised with synthetic peer declarations (no exemptions). These are boundary examples, **not recommended ranges**:

| DSH peer declaration | `0.2.0-rc.2` | `0.2.1-alpha.1` |
| --- | --- | --- |
| None, as published | No incompatible peer reported | No incompatible peer reported |
| `0.1.2-rc.1` or `^0.1.2-rc.1` | Rejected | Rejected |
| `^0.2.0` | Rejected | Accepted |
| `^0.2.0-rc.1` | Accepted | Accepted |
| `>=0.1.0 <0.2.0` | Accepted | Rejected |

In particular, prerelease inclusion does not lower `^0.2.0`'s stable lower bound, while the literal upper bound `<0.2.0` admits `0.2.0-rc.2`. Do not infer a safe support range from its spelling or from one passing install. This review leaves the published manifest and the `0.1.2-rc.1` support contract unchanged.

The adapter has no Web Client, custom Remote service, session-fork hook, toolview renderer, schedule bundle or host native-command integration. Changes to those APIs in the reviewed community cards do not call for adapter changes. The bundled Skill's Node CLI and platform opener are a separate execution surface; they still need native-platform smoke when that surface or its claimed coverage changes.

### Evidence matrix and outstanding work

All rows below concern the **published 1.0.0 tarball**, SHA256 `d009c4709000915e254d709b8f023b20d2cced142cd086e56f03d96baf370b50`, from adapter tag commit `594f6087358610bd16e64e5602976020871b6bff`, containing the Archify snapshot above. These are historical acceptance results, not a new release of this documentation revision.

| Exact host / carrier | Environment and procedure | Evidence / status |
| --- | --- | --- |
| Official npm CLI `0.1.2-rc.1` | Linux/macOS/Windows, Node 22, isolated profiles; clean install, load, installed CLI smoke, 0.1.0 → 1.0.0 upgrade, uninstall/base-profile preservation. No running Desktop updater. | Published support baseline: [three-platform tag gate](https://github.com/tt-a1i/archify/actions/runs/37219862967), [release record dated 2026-10-04](https://github.com/tt-a1i/archify/releases/tag/archify-dsh-v1.0.0). |
| Official npm CLI `0.2.0-rc.2` | macOS, Node 26.8.1, pnpm 11.5.2, isolated `web` profile; clean install, unique discovery/full load, `doctor`/`demo`, uninstall, same-profile 0.1.0 → 1.0.0 upgrade and repeat checks. CLI probes stop before package mutation. | Passed in the 2026-10-05 investigation; [maintainer evidence](https://github.com/tt-a1i/archify/issues/716#issuecomment-5991963398). Reused, not an expansion of support. |
| Official npm CLI `0.2.1-alpha.1` | Same isolated macOS procedure and Node/pnpm versions as the preceding row. | Passed in the same [2026-10-05 investigation](https://github.com/tt-a1i/archify/issues/716#issuecomment-5991963398); reused, not an expansion of support. |
| Other OS/Node combinations on these 0.2 hosts; packaged Electron Desktop | Not covered by the two macOS CLI experiments. Reporter: Windows 11 build 26200, Desktop `0.2.0-rc.2`, separate CLI `0.2.1-alpha.1`, updater `1.6.4`; new adapter not yet installed when reported. | Pending native acceptance and exact Desktop binary/command provenance in [#716](https://github.com/tt-a1i/archify/issues/716). No Windows/Desktop success claim. |

The 0.2 experiment installed official npm host dependencies with lifecycle scripts disabled; it tested Skill behavior, not all host native features. It did not rerun the full release gate or source-version package smoke. Its success cannot stand in for Electron packaging, Node 24, or a live third-party updater.

For Desktop evidence, distinguish the standalone npm CLI from the command installed through Desktop's menu. The [official Desktop ownership documentation](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/README.md#installation-ownership) reserves `desktop` for Electron: only the Desktop-installed command can manage its initialized profile while the application is fully quit. Do not use the standalone CLI or overwrite existing configuration to bypass this boundary. Confirm the binary and command source before any disposable-profile test.

Two external tracks remain open: Windows watcher/rename behavior in [updater #37](https://github.com/Airmetro/dsh-update-checker/issues/37), and the third-party gate's exact rule/file/line evidence in [#716](https://github.com/tt-a1i/archify/issues/716). Watchers are a candidate cause, not a reproduced Windows root cause. Do not equate fault-injected rollback tests with observed data loss, or static package review with clearance of all scanner findings. Native acceptance must separately cover clean install/load, exited-host upgrade/uninstall, and any claimed running-host update path without disabling scanning.

### Community reference boundary

The independent community [dsh-plugin-upgrade-skill reference](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/ef075767b476e8000c716a18f848028eebcd5aef) informed the touchpoint inventory; it is not an official DeepSeek compatibility guarantee and was not installed or executed. At that snapshot, its [version index](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/ef075767b476e8000c716a18f848028eebcd5aef/skills/plugin-upgrade/references/README.md) has no carded edge for `0.1.7-rc.1 → 0.1.7-rc.2`, `0.2.0-rc.1 → 0.2.0-rc.2`, or `0.2.0-rc.2 → 0.2.1-alpha.1`. The rc.2 field notes are not complete version cards. This targeted official-source review covers Archify's consumed surface across those gaps, not every upstream API.

Its planner is heuristic; its runtime verifier executes installation lifecycle scripts and is POSIX-only. Its release guide still contains a `0.1.1-rc.2` baseline and a broad `<0.2.0` example. Do not copy those examples as this adapter's dependency or support policy. Keep source review, host-checker acceptance, real runtime evidence and publication authorization distinct.

</details>

## Invoke

Ask DSH to load Archify by name:

```text
Use the archify skill to map this repository's runtime architecture.
Show 8–12 core components, one primary path, external dependencies, and trust boundaries.
Put supporting detail in cards instead of adding more edges.
After delivery, return the exact workspace paths of the specification JSON and the HTML artifact.
```

Archify then runs through DSH's ordinary Skill, shell, and filesystem paths. Generated JSON and HTML are normal workspace files.

## Produced Files limitation

Files created by shell commands do **not** automatically appear in the Web Produced Files strip. Ask the agent to return the **exact workspace paths** of the specification JSON and the HTML artifact, then open those files from the workspace.

## Uninstall

```bash
dsh plugin --profile web remove @tt-a1i/archify-dsh
```

The standard plugin command removes the adapter dependency and bundle layer. The base profile remains usable.

## Security posture

- The adapter has no telemetry, network client, credentials handling, or background service
- No `prepare`, `install`, or `postinstall` scripts
- Host-loaded adapter code does not spawn processes or open a second permission path
- Package resolution, provider load, and composition errors fail during normal DSH boot
