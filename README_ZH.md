<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

![Archify 主视觉](docs/assets/archify-readme-hero.png)

# Archify

**在对话里，把代码仓库或系统描述变成漂亮、可靠、可交互的系统地图。**

Archify 是一套基于 Node.js 的渲染与校验系统，并以 Agent Skill 的形式支持 Raven、Cursor、Claude Code、Codex CLI 和 OpenCode。Agent 负责生成 Typed JSON IR，Archify 再校验并确定性编译为便携、独立的 HTML/SVG 成品。

- **打开就是成品** —— 五种技术图、四套视觉预设、深浅主题、内置品牌徽标，以及显式启用的有限动态
- **合并前先看清架构变化** —— 把两份已校验快照对比为 Before / Delta / After，准确区分新增、删除、语义变化、移动和重路由
- **每次探索都有依据** —— 搜索节点、按需打开版本校验过的源码、追踪作者定义的上下游可达范围与精确路径、对比角色、播放故事，但不编造拓扑
- **一个文件即可放心交付** —— Typed JSON IR 和确定性校验生成独立 HTML，并支持 PNG、SVG、WebM 与 1200×630 分享卡片

![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![Agent Skill](https://img.shields.io/badge/Agent-Skill-7C3AED?style=flat-square)
![开发版本](https://img.shields.io/badge/version-2.17.0--dev.0-0891b2?style=flat-square)

**当前开发版本：** `v2.17.0-dev.0`。详见[版本历史](CHANGELOG.md#unreleased)。

**[在线项目页](https://tt-a1i.github.io/archify/)** · **[场景选图指南](https://tt-a1i.github.io/archify/guide.html)** · **[Proof Lab](https://tt-a1i.github.io/archify/gallery.html)**

```bash
npx skills add tt-a1i/archify -g
```
使用 Cursor？打开[可切换 Agent 的快速开始页](https://tt-a1i.github.io/archify/start.html?agent=cursor&type=architecture)，即可获得准确的全局或当前仓库安装命令。

**不需要绑定代码库：**在任意 Agent 对话里描述系统即可。

## ❤️ 赞助伙伴

<table>
  <tr><td align="center" width="240"><a href="https://apinebula.ai/ref/wywnaATT"><img src="docs/assets/sponsors/apinebula-archify.jpg" alt="APINEBULA" width="200" /></a><br/><strong><a href="https://apinebula.ai/ref/wywnaATT">APINEBULA</a></strong></td><td>感谢 APINEBULA 赞助 Archify。APINEBULA 通过统一接口提供 Claude、GPT、Gemini 等主流模型。通过 <a href="https://apinebula.ai/ref/wywnaATT">Archify 专属链接</a>注册并填写优惠码 <strong><code>Archify</code></strong>，即可享受<strong>9 折优惠</strong>。</td></tr>
  <tr><td align="center" width="240"><a href="https://github.com/EverMind-AI/Raven"><img src="docs/assets/sponsors/evermind-archify-raven.png" alt="Archify × Raven" width="200" /></a><br/><strong><a href="https://github.com/EverMind-AI">EverMind</a> · <a href="https://github.com/EverMind-AI/Raven">Raven</a></strong></td><td>感谢 EverMind 赞助 Archify。EverMind 专注 Agent 记忆基础设施，旗下 <a href="https://github.com/EverMind-AI/Raven"><strong>Raven</strong></a> 已支持 Archify Skill，让 Raven 工作流可以直接生成经过验证的交互式系统地图。</td></tr>
</table>

> 想赞助 Archify？[欢迎通过邮件联系我们。](mailto:2801884530@qq.com)

## 看看 Archify 能做什么

下面都是真实生成的 Archify 成品，不是产品效果图。点击画面即可打开对应的可分享交互状态。

<p align="center">
  <a href="https://tt-a1i.github.io/archify/gallery.html"><img src="docs/assets/archify-live-proof.gif" alt="三个经过验证的 Archify 成品依次展示 Signal Flow、Blueprint 和 Classic 预设" width="960"/></a>
  <br/>
  <sub><strong>三个真实生成、校验通过的成品。</strong> Signal Flow · Blueprint · Classic · <a href="https://tt-a1i.github.io/archify/gallery.html">打开可交互验证作品集 ↗</a></sub>
</p>

| 引导故事 | 路径探查 | 语义角色对比 |
|---|---|---|
| [![Agent 工作流正在播放一个作者章节](docs/assets/archify-demo-story.png)](https://tt-a1i.github.io/archify/gallery/artifacts/agent-tool-call.workflow.html?theme=dark&present=1&play=1#view=happy-path) | [![缓存未命中时从 Web App 到 Postgres 的路径](docs/assets/archify-demo-route.png)](https://tt-a1i.github.io/archify/gallery/artifacts/cache-miss.sequence.html?theme=dark&present=1#route=web~db) | [![生产架构中后端与数据库角色的真实关系](docs/assets/archify-demo-lens.png)](https://tt-a1i.github.io/archify/gallery/artifacts/production-deployment.architecture.html?theme=dark&present=1#lens=backend~database) |
| 播放一次有限的命名章节。 | 检查最短的作者有向路径。 | 对比语义角色之间的真实流量。 |

[Proof Lab](https://tt-a1i.github.io/archify/gallery.html) 收录全部 11 个仓库内场景、JSON 源、命名视图和校验回执。

### 从真实仓库读出来，不是只靠 Prompt 画出来

[![根据公开仓库 mco-org/mco 生成的 MCO 运行时架构图](docs/assets/mco-runtime-share-card.png)](https://tt-a1i.github.io/archify/cases/mco-runtime.architecture.html?theme=dark&present=1#view=dispatch-path)

Archify 追踪 [`mco-org/mco`](https://github.com/mco-org/mco) 的 `9f1a1cf` 版本并生成这张校验地图。**[打开成品 ↗](https://tt-a1i.github.io/archify/cases/mco-runtime.architecture.html?theme=dark&present=1#view=dispatch-path)** · [追踪下游 ↗](https://tt-a1i.github.io/archify/cases/mco-runtime.architecture.html?theme=dark#focus=router&reach=downstream) · [Typed Source](docs/cases/mco-runtime.architecture.json)

## 预览

同一张图，两套主题，一键切换：

| 深色 | 浅色 |
|---|---|
| ![深色主题](docs/assets/archify-dark.png) | ![浅色主题](docs/assets/archify-light.png) |

Export 菜单支持复制 PNG，并下载静态或动态格式：

![导出菜单](docs/assets/archify-menu.png)

需要用于 README、Release 或社交平台的标准 1200×630 图片时，使用 **Copy Share Card**。

路径解析后，**Export → Route Share Card** 会把真实路径下载为 1200×630 PNG，并保留完整拓扑上下文。

![Route Share Card：突出 Users 到 API Server 的精确路径，同时保留完整架构作为上下文](docs/assets/archify-route-share-card.png)

完成 authored `Upstream` 或 `Downstream` reach 后，**Export → Reach Share Card** 会捕获这次阅读结果，但不冒充运行时影响分析。

![MCO downstream Reach Share Card：展示从 Command Router 出发的已创作关系](docs/assets/mco-runtime-reach-share-card.png)

在本地打开 [`examples/web-app.html`](examples/web-app.html)，即可体验完整 Viewer。

## 快速开始

### 1. 安装

```bash
npx skills add tt-a1i/archify -g
```

显式、非交互地安装到 Cursor：

```bash
npx -y skills add tt-a1i/archify --skill archify --agent cursor --global --copy --yes
```

如果只想临时体验：

```bash
npx skills use tt-a1i/archify@archify --agent codex
```

DeepSeek Harness（社区集成、显式启用）：运行 `dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0`；参见[兼容范围、限制与安全说明](integrations/deepseek-harness/README.md)。[Agent 切换器](https://tt-a1i.github.io/archify/start.html?agent=cursor&type=architecture)只为 `cursor`、`codex`、`claude-code` 和 `opencode` 生成命令。Raven 仅支持 ZIP 手动安装：将 [`archify.zip`](archify.zip) 解压到 `~/.raven/workspace/skills`，解压后会得到 `~/.raven/workspace/skills/archify`；Raven 不属于切换器目标。

安装后的 Skill 包含一个低频、失败静默的发布检查，它最多只显示可选更新提醒，绝不会自行下载或安装更新。一次成功检查后，下次网络请求通常约在 72 小时（±20%）后发出；检查失败后，活跃使用可能在首次 6 小时、后续 24 小时退避到期时重试。请求只访问 `https://tt-a1i.github.io/archify/skill-updates/archify/stable.json`。服务端会自然获得 IP、请求时间和常规 HTTP 元数据；检查器不会发送本地版本、Agent、项目数据、用户输入、账户/设备标识，也不会保存或回传 ETag。是否更新以及何时更新始终由你决定。如需完全关闭检查（包括网络请求和提醒状态写入），请在 Agent 环境中设置 `ARCHIFY_UPDATE_CHECK_DISABLED=1`。

### 2. 直接从描述开始——不需要代码库

```text
用 Archify 画出：Browser -> API -> Redis 缓存 -> PostgreSQL 回源。
```

需要源码证据时，打开仓库后改用：

```text
分析这个仓库，然后使用 archify 生成一张高层运行时架构图。
只保留 8–12 个核心组件，突出一条主要路径，并标出外部依赖与信任边界。
辅助信息放进说明卡片，不要继续增加连线。
```

### 3. 在对话中细调

继续说：`增加 Redis`、`把鉴权移到左侧`、`突出回滚路径`。Archify 会保留 Typed Source，只修改相关部分。

## 选择合适的图表

| 类型 | 最适合 | Prompt 中应包含 |
|---|---|---|
| **Architecture** | 组件、服务、存储和系统边界 | 范围、核心组件、主要路径 |
| **Workflow** | CI/CD、审批、工具调用、Runbook | 参与者、顺序、分支、异常 |
| **Sequence** | API 调用、缓存回源、鉴权、异步链路 | 调用方、被调用方、返回、时序 |
| **Data Flow** | 数据管线、血缘、PII、下游消费者 | 来源、转换、存储、边界 |
| **Lifecycle** | 状态、重试、等待、终态 | 状态、事件、重试与取消路径 |

做生产部署评审时，Architecture 可以按需启用 `deployment-ownership`
工程画像：负责人、单一区域归属、数据库私有边界或边界穿越机制缺失时会直接阻断。
它不会被静默开启，只校验作者写入的事实，不代表线上基础设施已经核验。可查看
[通过校验的部署证明](https://tt-a1i.github.io/archify/gallery.html#proof-deployment-ownership)。

做设计或 PR 评审时，Architecture Delta 生成已校验的 Before / Delta / After 和机器回执。精确选择任一作者变更，或播放一次有限 Review；全程只读，不推断影响、风险或合并安全。

`node archify/bin/archify.mjs compare architecture base.json head.json architecture-delta.html --json`

[![Architecture Delta：展示作者明确写出的新增、删除、变化和移动](docs/assets/architecture-delta-proof.jpg)](examples/checkout-platform-delta.html)

不知道选哪一种？打开[交互式场景指南](https://tt-a1i.github.io/archify/guide.html)，或直接询问零依赖 CLI：

```bash
node archify/bin/archify.mjs guide "展示带 Redis 缓存未命中的 API 请求"
node archify/bin/archify.mjs guide "梳理 Kafka Topic、消费者组、重放和死信队列" --json
```

Workflow 用泳道保持主路径清晰：

![Workflow 示例](docs/assets/archify-workflow.png)

Sequence 解释一次交互随时间如何推进：

![Sequence 示例](docs/assets/archify-sequence.png)

Data Flow 突出数据移动和敏感边界：

![Data Flow 示例](docs/assets/archify-dataflow.png)

Lifecycle 区分正常进展、等待、重试和终态：

![Lifecycle 示例](docs/assets/archify-lifecycle.png)

Architecture 示例：[`Web App`](examples/web-app.html) · [`Archify Pipeline`](examples/archify-repo.html) · [`Grid 布局`](examples/archify-repo-grid.html) · [`桌面 Agent`](examples/maka-architecture.html)

## 为什么用 Archify

- **用布局判断代替通用自动布局** —— Agent 根据故事选择层级、留白、线路和强调关系；共享的自动端点会确定性展开，不再让多支箭头堆在同一个中点。
- **Typed JSON IR** —— 每种 Renderer 模式都有 Schema 和可复现的源文件。
- **原子交付前校验** —— Schema、布局、HTML/SVG、线路和标签到其他路径的净空检查必须全部通过，Showcase 成品才会替换上一份可信结果。
- **失败也有结构化修复回执** —— `validate --json` 和 `deliver --json` 会返回稳定规则码、准确对象、测量证据和真正支持的修复旋钮，不再让 Agent 从 Node 堆栈或自由文本里猜。
- **保留最后好图的实时预览** —— 可选桌面循环只监听一个 JSON；只有最新候选通过全部门禁才刷新，半写入或无效保存时继续显示上一份验证成品。
- **交互不编造拓扑** —— 聚焦、上下游可达范围、精确路径、角色对比和故事都复用作者定义的节点与关系，也不把图上可达误报成真实运行时影响。
- **只在需要时附源码证据** —— 有证据的 Architecture 节点会显示 `SRC n`，并可打开由 Git 校验、固定到公开 commit 的文件与行号；普通成品不携带源码信息。
- **结果默认便携** —— 一个 HTML 文件即可分享；导出永远是完整原图，不携带临时 Viewer 状态。

Archify 不是通用绘图编辑器，也不是 Mermaid 主题；它负责把技术意图变成可交流的成品。

## 工作原理

| 步骤 | 发生什么 |
|---|---|
| **生成** | Agent 根据描述创建 Typed JSON IR。 |
| **校验** | 内置 Validator 和布局规则检查源文件；失败时用机器可读 JSON 指出准确的局部修复。 |
| **预览（可选）** | 仅 loopback 的桌面会话监听一个源文件，只刷新验证版本；失败时保留最后好图。 |
| **交付** | 在目标同目录生成并检查候选；只有通过门禁的结果才原子替换目标文件，随后可选用 `--open` 打开这个确切成品。 |
| **迭代** | Agent 修改源文件，不干扰无关结构。 |

仓库常用命令：

```bash
cd archify
node bin/archify.mjs doctor
node bin/archify.mjs demo /tmp/archify-demo
node bin/archify.mjs guide "展示 CI/CD 检查、审批、部署和回滚"
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --quality showcase --json
node bin/archify.mjs preview workflow examples/agent-tool-call.workflow.json /tmp/workflow.html --quality showcase
node bin/archify.mjs deliver workflow examples/agent-tool-call.workflow.json /tmp/workflow.html --quality showcase --open --json
```

`preview` 是显式启用的桌面创作模式，不是默认后台服务：它只在随机端口监听 `127.0.0.1`，只观察指定 JSON，失败时保留上一份验证输出，并通过 Ctrl-C 停止。测试或准备手动打开打印出的本地 URL 时可加 `--no-open`。生成的 HTML 不会携带 Preview Runtime。

`deliver --open` 适合一次性的本地交互交付。它默认关闭，并且只在验证成品原子提交后执行；系统无法打开时，交付仍保持成功，JSON 只写 stdout，stderr 会给出可手动打开的绝对路径。

失败时，`validate --json` 和 `deliver --json` 仍然只输出一个 JSON 对象。读取 `diagnostics[]`，只修改其中 `subject` 指向的对象，并使用 `supportedFixes` 列出的修复方式；不要整图重写，也不要突破 Skill 最多两轮的聚焦修复上限。确定性诊断仍不等于视觉复核。

动态和演示样式需要显式选择：

```json
{
  "meta": {
    "locale": "zh-CN",
    "animation": "trace",
    "visual_preset": "signal-flow"
  }
}
```

不设置 `animation` 时结果完全静态；`classic` 始终是默认视觉预设。设计评审、发布说明和技术文档可以显式选择 `editorial`，获得暖纸张与深墨色的编辑风格，同时保持几何完全不变。将 `meta.locale` 设为 `en` 或 `zh-CN`，可选择 `<html lang>`、默认图例、无障碍文案和所有固定 Viewer UI。作者编写的标题、节点、关系、章节和卡片不会被机器翻译。未带该字段的旧文件仍然有效，并默认使用英文。对于其他任何创作语言，应省略 `meta.locale`、保持 authored content 使用用户要求的语言，并主动告知用户固定 Viewer UI 与 `<html lang>` 回退为英文，因此该成品不属于完整本地化。

## 探索与分享

| 操作 | 控制方式 |
|---|---|
| 打开事实型 Diagram Guide | <kbd>?</kbd> |
| 查找并聚焦语义节点 | <kbd>/</kbd> |
| 追踪作者定义的上游 / 下游可达范围 | 聚焦节点 → `Upstream` / `Downstream` |
| 探查有向路径并逐站检查 | <kbd>R</kbd> 或“路径” |
| 对比一种或两种语义角色 | <kbd>L</kbd> 或“透镜” |
| 打开实时全局雷达 | <kbd>M</kbd> 或“地图” |
| 播放故事 / 切换章节 | <kbd>P</kbd> / <kbd>[</kbd> <kbd>]</kbd> |
| 进入 Presentation Stage | <kbd>F</kbd> |
| 选择视觉风格（<kbd>S</kbd> 循环）/ 切换主题 / 打开 Export | <kbd>S</kbd> / <kbd>T</kbd> / <kbd>E</kbd> |
| 缩放或复位 | <kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd> |

稳定链接可以恢复 `#focus=<id>`、`#focus=<id>&reach=upstream|downstream`、`#relation=<id>`、`#route=<source>~<target>`、`#lens=<kind>~<kind>` 和 `#view=<view-id>`。读者触发的动态有限运行、遵守 `prefers-reduced-motion`，并且不会进入标准导出。

完整生成与 Viewer 契约请查看 [`archify/SKILL.md`](archify/SKILL.md)。

## 安装方式

| 使用位置 | 安装位置或方法 | 能力 |
|---|---|---|
| **Raven** | ZIP 手动安装：将 `archify.zip` 解压到 `~/.raven/workspace/skills`，解压后会得到 `~/.raven/workspace/skills/archify` | 完整 Renderer + Validation 工作流 |
| **Claude Code** | `~/.claude/skills/` 或 `.claude/skills/` | 完整 Renderer + Validation 工作流 |
| **Codex CLI** | `~/.agents/skills/` 或 `.agents/skills/` | 完整 Renderer + Validation 工作流 |
| **opencode** | `~/.config/opencode/skills/`、`.opencode/skills/` 或 `.agents/skills/` | 完整 Renderer + Validation 工作流 |
| **Claude.ai** | Settings → Capabilities → Skills 中上传 `archify.zip` | 取决于沙箱是否提供 Node.js |
| **Project Knowledge** | 把 `archify.zip` 上传到项目 | Prompt 驱动的 Architecture Fallback |
| **DeepSeek Harness** | 显式启用：`dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0`；调用：`Use the archify skill to map this repository's runtime architecture.`；卸载：`dsh plugin --profile web remove @tt-a1i/archify-dsh`。 | 面向开发者预览版 `@deepseek-ai/dsh@0.1.0-rc.6` 的社区集成；Node `^22.19.0 \|\| >=24.0.0`；不是 DeepSeek 官方产品。没有遥测；shell 文件不会自动进入 Web Produced Files，请返回精确工作区路径。[详情](integrations/deepseek-harness/README.md)。 |

Claude.ai 中的上传入口：

![Claude Skills 设置](docs/assets/claude-skills-settings.png)

## 参考与边界

- [Schema 说明](archify/schemas/README.md)
- [Skill 与 Renderer 契约](archify/SKILL.md)
- [示例](archify/examples/)
- [Agent 编图手册](docs/authoring-cookbook.zh-CN.md) · [English](docs/authoring-cookbook.md)
- [版本历史](CHANGELOG.md)
- [路线图](ROADMAP.md)
- [自动生成的 Proof Lab](https://tt-a1i.github.io/archify/gallery.html)

自动 Mermaid Parser、通用自动布局、托管分享服务和 WYSIWYG 编辑器目前都不在产品范围内。

## License

[MIT](LICENSE) —— 可以自由使用、修改和分发。

## 参与贡献

欢迎提交 Issue、Pull Request 和真实场景图。请先阅读[贡献指南](CONTRIBUTING.md)；遇到问题时使用可复现 Bug 表单，也可以通过[社区 Showcase 表单](https://github.com/tt-a1i/archify/issues/new?template=showcase.yml)提交已验证成品。

较大的功能或行为调整请先通过 Issue 对齐价值、兼容边界和非目标，再基于最新 `main` 开发。一个 PR 尽量只解决一个问题；核心代码和回归测试先行，生成物最后统一重建。Archify 坚持 Agent-first，优先完善稳定的机器可读诊断和现有权威合同，避免新增容易与 CLI 漂移的重复说明。&nbsp;·&nbsp;[LINUX&nbsp;DO](https://linux.do)

## Star History

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tt-a1i/archify/star-history/assets/star-history-dark.svg" /><img alt="Star History" src="https://raw.githubusercontent.com/tt-a1i/archify/star-history/assets/star-history-light.svg" /></picture></p>
