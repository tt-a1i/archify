# `@tt-a1i/archify-dsh`

Community DeepSeek Harness integration for [Archify](https://github.com/tt-a1i/archify). This is **not** an official DeepSeek product and does not imply DeepSeek endorsement.

v0.1.0 has experimental, CI-backed compatibility evidence only for developer-preview **`@deepseek-ai/dsh@0.1.0-rc.6`** on Node.js **`^22.19.0 || >=24.0.0`**. It is not a stable cross-version guarantee and does not make a compatibility claim for later DSH releases until those releases complete the same acceptance gate.

The package is a Skill-only bundle: its adapter delegates to DSH's public filesystem Skill provider with one isolated provider named `archify-plugin`, and exposes a clean static copy of the existing Archify Skill. It does not register native render/validate/deliver tools, a custom Web client, Produced Files chips, telemetry, network access, credentials handling, background services, or `prepare` / `install` / `postinstall` hooks.

## Install

For ordinary use, install the prebuilt npm package with an exact version.

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0
```

The integration checkout also keeps the exact static runtime payload in `.dsh-bundled-skills/archify`, so a DSH Store reviewer can inspect a fixed Git Commit without executing a build step. That source layout is an auditability property, not evidence of later DSH-version compatibility.

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
