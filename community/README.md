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
2. Fork this repository, branch from the latest `dev`, and add **one metadata file**: `community/packages/<name>.json`, following [`package.schema.json`](package.schema.json). `<name>` is lowercase kebab-case and must equal the `name` field.
3. From the repository root, validate locally before opening the PR (Node.js 18+, no npm dependencies needed):

   ```bash
   node scripts/check-community-packages.mjs
   ```

4. Open a PR **targeting `dev`** (per [CONTRIBUTING.md](../CONTRIBUTING.md)) that adds only your metadata file. Include evidence links in the `evidence` field — validation receipts, screenshots, rendered example artifacts.

A merge into `dev` does not publish the website. The public catalog updates after promotion to `main` and a successful Pages deployment; there is no promised review or publication time.

[Schema](package.schema.json) · [Existing entries](packages/) · [完整中文步骤](#中文摘要)

<details>
<summary>Submission example, field requirements, and updates</summary>

Start in a local clone of your fork. Add `upstream` only if it is not already configured; otherwise verify that it points to this repository.

```bash
git remote add upstream https://github.com/tt-a1i/archify.git
git fetch upstream dev
git switch -c community/my-archify-recipes upstream/dev
```

Save the following as `community/packages/my-archify-recipes.json`. Replace the name, author, descriptions, and **all example.com URLs** with your public package and evidence. The version `3.0.1` and IR `[1]` illustrate the format, not a compatibility claim for your package; use versions you have actually verified.

```json
{
  "name": "my-archify-recipes",
  "type": "recipe",
  "summary": {
    "en": "Example recipe library for explaining web application request flows.",
    "zh": "用于说明 Web 应用请求流程的场景配方库示例。"
  },
  "author": {
    "name": "YOUR_NAME",
    "url": "https://example.com/author"
  },
  "repository": "https://example.com/my-archify-recipes",
  "archify": "3.0.1",
  "schemaVersions": [1],
  "tags": ["recipes", "web"],
  "evidence": [
    {
      "label": "Example artifact and validation receipt",
      "url": "https://example.com/my-archify-recipes/evidence"
    }
  ]
}
```

Run `node scripts/check-community-packages.mjs` from the repository root, commit only your metadata file, push the branch to your fork, and open a PR against **`tt-a1i/archify:dev`** using the repository PR template. Report the check result and link evidence for the claimed behavior and compatibility. Do not include credentials, private source, personal information, or customer data in evidence.

- Required fields: `name`, `type`, `summary`, `author`, `repository`, `archify`, and `schemaVersions`. Unknown fields are rejected.
- `name`: 3–64 lowercase letters, digits, or hyphens, starting and ending with a letter or digit; the file name must match. `summary.en`: 10–160 characters; `summary.zh`: 6–120 characters. `author.name` is required.
- `archify`: an exact version, caret/tilde range, or bounded range such as `3.0.1`, `^3.0.1`, `~3.0.1`, or `>=3.0.0 <4.0.0`. `latest`, wildcards, and prerelease suffixes are not accepted by this metadata contract.
- `schemaVersions`: the nonempty, unique list of positive-integer Archify JSON IR `schema_version` values your package supports, not your package version.
- Optional fields are `author.url`, `homepage`, `tags` (up to 6 unique items), and `evidence` (up to 8 `{label, url}` items). Although the schema does not require `evidence`, the submission instructions above ask for evidence links. Follow the schema for remaining length and character limits.

The check validates metadata and URL syntax; it does not fetch links, verify that claimed versions exist, prove compatibility, or execute your package. Supply evidence for those claims. Passing the check is not review approval or endorsement.

**Updating a listing:** publish the package update in your own repository or registry, edit the existing metadata file with any changed compatibility, summary, and evidence, then validate and submit a PR to `dev` again. Keep published and pending versions distinct. Authors maintain their own packages; removal follows [Takedown](#takedown).

</details>

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


<details>
<summary>展开中文提交步骤、字段说明和维护指南</summary>

可提交五种独立包：`skill`（领域技能包）、`recipe`（场景配方库）、`brand-marks`（品牌标识或预设）、`locale`（`meta.translations` 语言目录）、`wrapper`（生成 JSON IR 并调用 CLI 的独立工具）。它们由作者维护，不会被 Archify 渲染器加载执行。

1. 在自己的公开仓库或 npm 发布包，写清用途、使用方式、实际测试过的 Archify 和 IR 版本。准备公开的校验回执、示例产物或截图，移除凭据、私人源码、个人信息和客户数据。
2. Fork 本仓库，在本地副本中从最新 `dev` 建分支。上方英文折叠区给出了 `upstream` 和建分支命令；已有 `upstream` 时先核对地址，不重复添加。
3. 按上方 JSON 示例新增 `community/packages/<name>.json`，替换作者、简介、名称、全部占位 URL 和版本。示例中的 `example.com` 不是可提交的证据，`3.0.1` / `[1]` 也不代表你的包已经通过兼容性验证。
4. 在仓库根目录运行 `node scripts/check-community-packages.mjs`。需要 Node.js 18+，这个检查无需安装 npm 依赖。
5. 只提交新增的元数据文件，推送到自己的 fork，按仓库 PR 模板向 **`tt-a1i/archify:dev`** 提 PR，附实际校验结果与证据。校验通过不等于审核批准；进入 `main` 且 Pages 部署成功后才会更新公开目录，不承诺审核或上线时限。

必填字段是 `name`、`type`、`summary`、`author`、`repository`、`archify`、`schemaVersions`。`summary.en` 为 10–160 字符，`summary.zh` 为 6–120 字符，两种语言都要填；`author.name` 必填。名称为 3–64 个小写字母、数字或连字符，首尾不能为连字符，并须与文件名一致。其他长度和字符限制见 [schema](package.schema.json)。

`archify` 支持精确版本、`^3.0.1`、`~3.0.1`、`>=3.0.0 <4.0.0` 这些形式，不接受 `latest`、通配符或预发布后缀。`schemaVersions` 是实际支持的 Archify JSON IR 版本，填非空、无重复的正整数数组。校验器只检查格式，不检查版本是否真实存在或是否实际兼容，别填写未经验证的宽范围。

可选字段为 `author.url`、`homepage`、`tags`（最多 6 个且不重复）、`evidence`（最多 8 个 `{label, url}`）。`evidence` 虽非 schema 必填项，提交指南仍要求提供证据。所有 URL 必须为 HTTPS，且不能含凭据、空白、控制字符或反斜杠；检查不会请求这些链接，也不会执行你的包。字段必须来自 schema，不要添加自定义审批或精选字段。

安全要求沿用现有规则：无遥测、不以托管服务为必需条件、不在 Archify 内执行第三方代码。收录不代表官方背书，元数据校验也不是功能或安全认证。

**更新条目：** 先在自己的仓库或包注册表发布更新，再修改原 JSON 的简介、兼容声明和证据，重新校验并向 `dev` 提 PR；清楚区分已发布和待发布版本。目前没有另行承诺的更新频率或响应时限。

**申请移除：** 作者可随时通过 PR 或 issue 申请移除自己的条目。恶意包、已弃维护且源码链接损坏、兼容声明长期失真的条目可由维护者移除，下架通过 PR 留痕。完整规则见 [Takedown](#takedown)。

</details>
