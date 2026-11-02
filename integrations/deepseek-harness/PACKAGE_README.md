# `@tt-a1i/archify-dsh` 1.1.0

Community DeepSeek Harness integration for [Archify](https://github.com/tt-a1i/archify). This is **not** an official DeepSeek product and does not imply DeepSeek endorsement.

This package bundles **Archify 3.2.0** from stable commit `edf158c4e7a1d18d20cc329840f864289634c090`, including the Apache-2.0 transition and standalone third-party notice fixes after the `v3.2.0` tag; it is not a byte-for-byte copy of that tag. Both bundled version manifests declare 3.2.0. Adapter and Archify versions are independent.

The candidate acceptance target is the exact developer-preview host **`@deepseek-ai/dsh@0.2.1-rc.2`** and Node.js **`^22.19.0 || >=24.0.0`**. It does not make the host stable or guarantee compatibility with other DSH versions. The release gate must establish clean installation and same-profile upgrades from both plugin 0.1.0 and 1.0.0 to 1.1.0 on Linux, macOS, and Windows using Node 22. Configuring this target is not evidence that acceptance has passed; consult the repository release record. CLI acceptance does not establish Desktop/Electron or running-host updater support.

## Install or upgrade

After this version is available in the npm registry, install the exact version in each profile that uses Archify:

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@1.1.0
```

The same command upgrades an existing plugin. Host migration is a separate action: use the exact host recorded in the accepted release, not an inferred `0.2.x` range. Updating DSH itself or the Archify repository does not update an installed plugin. Do not install from Git source: the repository root is not a DSH package.

For an npm download problem, an integrity-verified tarball can be installed with `dsh plugin --profile web add /absolute/path/to/package.tgz`. See the [changelog](CHANGELOG.md) for the bundled Archify changes and the [repository integration README](https://github.com/tt-a1i/archify/tree/main/integrations/deepseek-harness) for publication status.

## Effective Skill source and licenses

Personal and project copies named `archify` outrank this bundle on the target host. A successful plugin upgrade does not necessarily upgrade the effective Skill. Check the actual loaded source path and body/version when diagnosing a stale Skill; do not automatically remove live personal/project copies.

The adapter remains MIT-licensed. The bundled Archify 3.2.0 Skill is Apache-2.0; its `LICENSE`, `LICENSE-MIT`, `NOTICE` and `THIRD_PARTY_NOTICES.md` preserve the applicable grants and attribution. The outer package license does not replace those bundled notices.

## Invoke

Ask DSH to load Archify by name:

```text
Use the archify skill to map this repository's runtime architecture.
Show 8–12 core components, one primary path, external dependencies, and trust boundaries.
Put supporting detail in cards instead of adding more edges.
After delivery, return the exact workspace paths of the specification JSON and the HTML artifact.
```

Archify uses DSH's ordinary Skill, shell, and filesystem paths. Generated files do not automatically appear in the Web Produced Files strip; ask for their **exact workspace paths** and open them from the workspace.

## Uninstall

```bash
dsh plugin --profile web remove @tt-a1i/archify-dsh
```

The standard plugin command removes the adapter dependency and bundle layer. The base profile remains usable.

## Activation and scope

The bundle mounts one filesystem Skill provider named `archify-plugin`. Its `cordis.patch.yml` contains a `!!js` expression evaluated by the DSH host outside the agent sandbox. The expression uses Node's built-in `path` and `module` helpers to locate this installed package's `skills` directory; it does not fetch data, read credentials, spawn processes, or register another permission path. Review patch changes as host-process code.

The adapter adds no native tools, custom Web client, telemetry, credentials handling, network client, background service, dependencies, or install hooks. The bundled Skill has an optional notification-only stable Archify update checker and bounded network access for authored remote brand assets. It never upgrades this plugin automatically.

`release.json` records the immutable Skill source and exact acceptance host. Reproduce this version from its adapter tag `archify-dsh-v1.1.0` once published, using the committed pack script; use the recorded source rather than a moving branch.
