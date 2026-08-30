# `@tt-a1i/archify-dsh`

Community DeepSeek Harness integration for [Archify](https://github.com/tt-a1i/archify). This is **not** an official DeepSeek product and does not imply DeepSeek endorsement.

v0.1.0 is experimental compatibility with developer-preview **`@deepseek-ai/dsh@0.1.0-rc.6`** on Node.js **`^22.19.0 || >=24.0.0`**. It is not a stable cross-version guarantee.

The package is a Skill-only bundle: it inserts one filesystem Skill provider named `archify-plugin` and exposes the Archify 2.14 snapshot released with this package. It does not register native render/validate/deliver tools, a custom Web client, Produced Files chips, telemetry, network access, credentials handling, background services, or `prepare` / `install` / `postinstall` hooks.

Release maintenance is immutable: rebuilding `0.1.0` reads its payload from the `archify-dsh-v0.1.0` tag. Later Archify changes, including the embedded update notifier, are intentionally excluded until a separately authorized DSH release receives a new version.

## Install

Use the prebuilt npm package with an exact version. Do not install from Git source.

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0
```

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

- No telemetry, network client, credentials handling, or background service
- No `prepare`, `install`, or `postinstall` scripts
- Host-loaded adapter code does not spawn processes or open a second permission path
- Package resolution, provider load, and composition errors fail during normal DSH boot
