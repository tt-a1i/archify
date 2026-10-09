# `@tt-a1i/archify-dsh` 1.0.0

Community DeepSeek Harness integration for [Archify](https://github.com/tt-a1i/archify). This is **not** an official DeepSeek product and does not imply DeepSeek endorsement.

This package bundles **Archify 3.0.1** from stable commit `7158026e852f3aa6578c741e673b46d7878c92c1`, including the installation fix after the `v3.0.1` tag. Both bundled version manifests declare 3.0.1. Adapter and Archify versions are independent.

The 1.0 adapter contract covers the exact tested developer-preview host **`@deepseek-ai/dsh@0.1.2-rc.1`** and Node.js **`^22.19.0 || >=24.0.0`**. It does not make the host stable or guarantee compatibility with other DSH versions. The release gate exercises clean installation and plugin 0.1.0 → 1.0.0 upgrade on Linux, macOS, and Windows using Node 22.

## Install or upgrade

After this version is available in the npm registry, install the exact version in each profile that uses Archify:

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@1.0.0
```

The same command upgrades an existing plugin. Update the DSH host separately to the supported version first; the older `0.1.0-rc.6` host is not a supported 1.0 target. Updating DSH itself or the Archify repository does not update an installed plugin. Do not install from Git source: the repository root is not a DSH package.

For an npm download problem, an integrity-verified tarball can be installed with `dsh plugin --profile web add /absolute/path/to/package.tgz`. See the [changelog](CHANGELOG.md) for the bundled Archify changes and the [repository integration README](https://github.com/tt-a1i/archify/tree/main/integrations/deepseek-harness) for publication status.

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

`release.json` records the immutable Skill source and exact acceptance host. Reproduce this version from its adapter tag `archify-dsh-v1.0.0` once published, using the committed pack script; use the recorded source rather than a moving branch.
