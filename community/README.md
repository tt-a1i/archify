# Archify Community Packages

A curated registry of **standalone packages that build on Archify**: domain skill packs, recipe libraries, brand kits, locale packs, and CLI wrappers. The catalog is rendered at [tt-a1i.github.io/archify/community.html](https://tt-a1i.github.io/archify/community.html) from the metadata files in [`packages/`](packages/).

Design rationale and non-goals are tracked in [issue #663](https://github.com/tt-a1i/archify/issues/663).

## What a community package is

A community package lives **outside** the Archify core and depends on it — the way the [Hermes](../integrations/hermes-agent/) and [DeepSeek Harness](../integrations/deepseek-harness/) integrations already do: author versioned JSON IR, invoke the Archify CLI, keep everything deterministic and fail-closed.

Archify has **no in-process plugin API, and none is planned for this registry**. Third-party code never executes inside the render pipeline, inside Archify CI, or inside the delivery trust model.

| Type | Contents | Example |
| --- | --- | --- |
| `skill` | Agent skill pack: SKILL.md, reference docs, examples for a domain | "Archify for Kubernetes" |
| `recipe` | Scenario/recipe library (the shape of `archify/recipes/scenarios.mjs`) | E-commerce architecture scenarios |
| `brand-marks` | Brand-mark catalog or visual preset | Corporate identity pack |
| `locale` | `meta.translations` catalog | Community-maintained language |
| `wrapper` | Standalone tool that emits Archify JSON IR and calls the CLI | Terraform state → diagram |

## Submitting a package

1. Publish your package in your own repository (or npm). Archify does not host package content.
2. Fork this repository and add **one metadata file**: `community/packages/<name>.json`, following [`package.schema.json`](package.schema.json). `<name>` is lowercase kebab-case and must equal the `name` field.
3. Validate locally before opening the PR:

   ```bash
   node scripts/check-community-packages.mjs
   ```

4. Open a PR **targeting `dev`** (per [CONTRIBUTING.md](../CONTRIBUTING.md)) that adds only your metadata file. Include evidence links in the `evidence` field — validation receipts, screenshots, rendered example artifacts.

Review follows the tiers in [REVIEWING.md](../REVIEWING.md). Approval criteria:

- Metadata passes `scripts/check-community-packages.mjs`. Links must be parseable HTTPS URLs with a host, no credentials, whitespace, control characters, or backslashes (the validator checks these URL semantics in addition to the schema). Website builds use the same validator and reject invalid entries.
- The declared `archify` compatibility range exists and the supported `schemaVersions` are real.
- The package performs what its summary claims, from the evidence you link.
- No telemetry, no hosted-service requirement, no code execution inside Archify.

Listing is **not endorsement**. The catalog marks community packages as community-maintained; the Archify maintainers verify only what can be verified deterministically and never run package code.

## Takedown

Removal is also a PR, on record. Maintainers may remove a listing when the package is malicious, abandoned with a broken source URL, or its compatibility claims become permanently stale. Authors may request removal of their own listing at any time via PR or issue.

## 中文摘要

社区 package 是**独立产物**，依赖并调用 Archify，而不是被 Archify 加载的插件。提交方式：fork 本仓库，按 `package.schema.json` 在 `community/packages/` 下新增一个元数据文件，本地跑 `node scripts/check-community-packages.mjs` 校验，然后向 `dev` 分支提 PR。收录不代表官方背书；下架同样以 PR 形式留痕。
