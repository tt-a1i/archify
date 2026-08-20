# 校验与交付排错

Archify 会按阶段报告失败。先看命令退出码；自动化运行时，建议保存 JSON 回执，不要解析人类可读的 stderr（标准错误输出）。

## 保存机器可读回执

在 `archify/` 目录运行校验：

```bash
node bin/archify.mjs validate workflow path/to/diagram.json \
  --quality showcase --json > validation.json
```

成功回执包含 `ok: true`、`checks` 和 `composition`。失败回执包含 `ok: false`、`stage` 和 `diagnostics` 数组。每条诊断包含：

- `code`：稳定的规则或失败类别；
- `subject`：被报告的输入、节点、关系或输出；
- `evidence`：测量结果或系统证据；
- `supportedFixes`：当前 Renderer 支持的修复方式。

即使写出了回执，退出码非零仍代表失败。不要通过整图重写来重试：修复被点名的对象后，再运行同一条命令。

## 判断失败阶段和诊断前缀

顶层 `stage` 表示流水线停在哪一步，它与诊断 `code` 前缀是两件事。对于 `validate`，当前阶段包括：

| `stage` | 含义 | 第一动作 |
| --- | --- | --- |
| `input` | JSON 文件无法读取或解析 | 检查路径、权限和 JSON 语法 |
| `render` | Renderer 拒绝了源文件、作者事实或布局 | 阅读 `diagnostics[]`，修复被点名的对象 |
| `check` | 最终 HTML 成品或构图检查失败 | 先阅读 `checker` 和构图诊断，再修改源文件 |

`deliver` 还可能在无法创建候选文件、读取可信回执或替换目标时报告 `prepare`、`receipt` 和 `commit`。

Architecture `compare` 使用自己的 stage 列表。当前值为 `input`、`prepare`、`validate`、`compare`、`artifact`、`commit` 和 `internal`：

| `stage` | 含义 | 第一动作 |
| --- | --- | --- |
| `input` | 无法读取或解析 base 或 head 快照 | 检查两侧 JSON 路径、权限和语法 |
| `prepare` | 无法解析输出路径或创建候选文件 | 选择可写的 HTML 路径，并让回执与它同目录 |
| `validate` | 其中一份快照未通过 Renderer 校验 | 修复被点名的 `subject.side` 快照，然后重新 compare |
| `compare` | 两份快照无法分类为 delta | 为比较对象补上唯一稳定 ID，并确认它们描述同一系统 |
| `artifact` | 生成的 Before/Delta/After HTML 未通过自身检查 | 保留回执，不要替换上一对可信文件 |
| `commit` | 无法同时替换 HTML 和回执 | 选择普通文件路径重试，不要删除上一对文件 |
| `internal` | 提交前失败且没有已分类诊断 | 保留完整回执，先检查其中的证据 |

快照在 compare 期间未通过最终 HTML 检查时，回执也可能报告 `check`。

诊断前缀描述规则，不描述流水线阶段：

| 前缀 | 通常出现于 | 第一动作 |
| --- | --- | --- |
| `input/*` | `input` | 检查路径、权限和 JSON 语法 |
| `schema/*`、`relationship/*`、`guided-view/*`、`clean-flow/*` | `render` | 对照 Schema，修复被点名的 ID、视图或线路 |
| `legend/*`、`engineering/*`、`repository-evidence/*` | `render` | 补正作者声明的展示、工程或固定版本证据事实 |
| `composition/*`、`artifact/*` | `check` | 调整被点名的线路或标签，然后重新运行最终检查 |
| `output/*`、`delivery/*` | `prepare`、`receipt` 或 `commit` | 选择安全可写的目标，并保留上一份成品 |
| `delta/*` | `input`、`prepare`、`validate`、`compare`、`artifact`、`commit` 或 `internal` | 修复被点名的快照或输出目标，并保留上一对 HTML/回执 |
| `internal/*` | `render` 或后续交付阶段 | 保留完整回执，先检查其中的证据再重试 |

这里按前缀分组；具体规则和修复旋钮由当前 Renderer 负责，后续可能增加。

## 修复输入和 Schema 错误

`input/json-parse` 表示文件不是合法 JSON。先运行 JSON Parser（解析器），不要一开始就排查布局：

```bash
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('valid JSON')" path/to/diagram.json
```

`schema/additionalProperties` 表示字段不属于当前 Schema。Archify 的每一层都采用严格 Schema；例如 `colour`，或者从其他图表类型复制来的字段，都会被拒绝。删除未知字段，或按 [Schema 说明](../archify/schemas/README.md) 使用准确字段。

`relationship/duplicate-id` 表示同一个关系集合中有两个关系使用了相同的作者 ID。每个集合内的 ID 必须唯一。不写 ID 的关系仍然有效；写入 ID 后，可以得到稳定的 `#relation=<id>` 链接。

## 修复几何与质量错误

探索密集图时可以使用 `--quality standard`；需要正式成品通过更严格的构图门禁时使用 `--quality showcase`。CLI 选项优先于 `meta.quality_profile`。

遇到构图诊断时：

1. 阅读回执里的 `subject` 和 `evidence`。
2. 只修改被点名的关系、标签或布局控制。
3. 优先采用 `supportedFixes` 中的具体修复方式。
4. 重新校验，并将错误数量与上一次回执比较。

常见例子：

- `composition/proper-crossing`：用支持的 `via` 或 channel 控制，为无关关系分配不同通道。
- `composition/label-route-clearance`：移动标签或另一条线路，不要隐藏标签。
- `composition/container-border-run`：让业务线路从清晰开口垂直穿过结构边框，不要沿边框走。
- `clean-flow/edge-through-node`：绕开无关的语义节点重新布线。

Architecture 专用的布局检查可以帮助定位解析后的几何：

```bash
node bin/archify.mjs inspect architecture path/to/diagram.json
```

没有诊断要求时，不要持续增加手工坐标。编图契约限制聚焦修复轮数，避免成品变成一堆偶然例外的集合。

## 交付失败时

当输出要交给别人或作为 CI 产物时，使用 `deliver --json`：

```bash
node bin/archify.mjs deliver workflow path/to/diagram.json \
  workflow.html --quality showcase --json > delivery.json
```

如果渲染或最终成品检查失败，`deliver` 会以非零退出，并保留上一份可信输出。失败回执会标明失败发生在 `input`、`prepare`、`render`、`check`、`receipt` 或 `commit`。修复源文件或输出路径后重试；不要删除上一份成品来让命令通过。

## Architecture compare 失败时

`compare` 会分类两份 Architecture 快照，并写出 HTML 和 sidecar 回执。失败使用 `delta/*` 诊断码。常见第一动作：

- `delta/base-input` 或 `delta/head-input`：修复被点名的快照路径或 JSON 语法。
- `delta/relationship-id-required`：为每个被比较的关系补上唯一的作者 ID。
- `delta/artifact-invalid`：保留上一对可信 HTML/回执，并检查 delta 检查结果。
- `delta/commit-target`：为 HTML 和回执都选择普通文件路径。

修复被点名的快照或输出目标后，再运行同一条 `compare` 命令。不要删除上一对文件来让命令通过。

对已有 HTML 文件，可以把源校验和成品检查分开：

```bash
node bin/archify.mjs check workflow.html
node bin/archify.mjs visual-check workflow.html --json
```

`check` 是确定性的成品校验。环境有 Chrome 或 Chromium 时，`visual-check` 会收集浏览器证据；退出码 2 表示没有可用浏览器，因此跳过了视觉采集。两者都不能替代人工视觉复核。

## 仓库证据失败时

Architecture 源码证据是可选的，并且必须固定到具体版本。使用时要显式传入本地检出目录：

```bash
node bin/archify.mjs validate architecture path/to/diagram.json \
  --repo-root path/to/repository --json
```

检查 JSON 中的仓库 URL 是否与本地 Git 远端一致，revision 是否为完整 commit SHA，每个源码路径是否为相对 POSIX 路径，以及请求的行号在该版本中是否存在。事实缺失时不要猜路径或 commit。

## 延伸阅读

- [交付契约](../archify/references/delivery-contract.md)：原子交付、视觉复核和交付回执。
- [Skill 契约](../archify/SKILL.md)：有上限的修复行为。
