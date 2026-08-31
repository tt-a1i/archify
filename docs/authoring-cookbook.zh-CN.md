# Archify 编图实践手册

Archify 首先是面向 Agent 的 Skill。普通用户只需向支持 Skill 的 Agent 描述想要的图；不必学习 Schema，也不必自己运行 `validate`、`inspect` 或 `deliver`。

下面的手工流程面向集成、贡献和排错。命令假设你位于仓库的 `archify/` 目录，或已经安装好的 Archify Skill 根目录。

## 1. 检查安装

Archify 要求 Node.js 18 或更高版本。开始编图前先运行 doctor：

```bash
node bin/archify.mjs doctor
```

如果通过兼容 npm 的 Skill 工具安装，可以执行：

```bash
npx skills add tt-a1i/archify -g
```

## 2. 选择图表类型

根据读者需要回答的问题选择类型：

| 类型 | 适合说明 | 可从这里开始 |
| --- | --- | --- |
| `architecture` | 组件、服务、存储和边界 | `examples/web-app.architecture.json` |
| `workflow` | 有序工作、审批、分支和 Runbook | `examples/agent-tool-call.workflow.json` |
| `sequence` | 调用、返回、缓存未命中和时序 | `examples/cache-miss-request.sequence.json` |
| `dataflow` | 数据移动、转换和消费者 | `examples/product-analytics.dataflow.json` |
| `lifecycle` | 状态、重试、等待和终态 | `examples/agent-run.lifecycle.json` |

不确定类型时，可以询问内置场景指南：

```bash
node bin/archify.mjs guide "展示带 Redis 缓存未命中的 API 请求" --json --lang zh
```

指南会推荐类型并返回配方，但不会替你创建图。

## 3. 编写边界清楚的源文件

从一个明确故事开始。第一张图建议只保留约 8–12 个主要节点、一条主路径，以及确实能帮助解释问题的分支。相比复制大型生成成品，直接参考仓库内示例更稳妥。

每个源文件都需要 `schema_version`、`diagram_type`、`meta.title`，以及对应 Renderer 要求的结构数组。精确字段和允许值请阅读 [Schema 说明](../archify/schemas/README.md)。

如果要生成基于仓库证据的 Architecture 图，需要在 JSON 中加入固定版本的仓库元数据和源码范围，再把本地仓库路径传给命令：

```bash
node bin/archify.mjs validate architecture path/to/diagram.json \
  --repo-root path/to/repository --quality showcase --json
```

Archify 会校验 Git 远端、commit、blob 和请求的代码行。无法验证仓库或版本时，不要添加源码证据。

## 4. 先校验，再交付

探索阶段可以使用 `standard`，正式成品或仓库内证明建议使用 `showcase`：

```bash
node bin/archify.mjs validate architecture examples/web-app.architecture.json \
  --quality showcase --json
```

成功时，JSON 回执包含成品检查和构图摘要。失败时，回执包含 `stage` 和 `diagnostics[]`；只修复被点名的对象，并优先使用 `supportedFixes` 中列出的修复方式。退出码非零时，绝不能描述为校验成功。

Architecture 图需要检查布局时，可以使用 Renderer 的机器可读布局输出：

```bash
node bin/archify.mjs inspect architecture path/to/diagram.json
```

`inspect` 当前只支持 Architecture，适合诊断信息指向线路或摆放问题时使用。

## 5. 交付可信成品

`render` 适合快速本地输出；当文件要交给别人、用于发布或作为 CI 产物时，请使用 `deliver`：

```bash
node bin/archify.mjs deliver architecture examples/web-app.architecture.json \
  web-app.html --quality showcase --json
```

`deliver` 会冻结输入字节，在目标文件同目录生成候选文件，运行最终成品检查，并且只在全部门禁通过后替换目标。回执包含源文件和成品的 SHA-256 哈希。只有需要立即本地打开时才加 `--open`：

```bash
node bin/archify.mjs deliver architecture examples/web-app.architecture.json \
  web-app.html --quality showcase --open --json
```

要比较两份 Architecture 快照，请使用 `compare`。它会在 HTML 旁边写入 sidecar 回执：

```bash
node bin/archify.mjs compare architecture base.json head.json \
  architecture-delta.html --quality showcase --json
```

## 6. 检查最终文件

确定性校验不会在真实浏览器中运行 Viewer。如果环境有 Chrome 或 Chromium，请对刚刚交付的 HTML 收集自动化浏览器证据：

```bash
node bin/archify.mjs visual-check web-app.html --json
```

这份回执只证明有限范围内的运行时表现，并不批准视觉质量。仍需单独检查 HTML 或生成的截图。记录补充性的手工浏览器工作时必须遵循[交付契约](../archify/references/delivery-contract.md)；不受约束的目检只影响视觉复核结论。

自动化浏览器证据的规范覆盖、成品绑定、视觉复核状态和交付回执字段请参阅交付契约。编图不变量和有上限的修复循环请参阅 [Skill 契约](../archify/SKILL.md)。
