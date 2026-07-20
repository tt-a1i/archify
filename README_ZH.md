<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://tt-a1i.github.io/archify/gallery.html"><img src="docs/assets/archify-live-proof.gif" alt="三个经过验证的 Archify 成品依次展示 Signal Flow、Blueprint 和 Classic 预设" width="960"/></a>
  <br/>
  <sub><strong>三个真实生成、校验通过的成品。</strong> Signal Flow · Blueprint · Classic · <a href="https://tt-a1i.github.io/archify/gallery.html">打开可交互验证作品集 ↗</a></sub>
</p>

# Archify

**聊两句就画出好看的架构图、技术流程图、调用时序图、数据流图和生命周期图。深色 / 浅色一键切，还能动起来。导出清晰 PNG / JPEG / WebP / SVG / WebM。**

Archify 是一个可用于 Claude、Codex CLI 和 opencode 的 agent skill：你用大白话描述自己的系统或流程，它就把你的描述变成一张做工精细的技术图 —— 一个单文件 HTML，在浏览器里打开就能切主题、复制到剪贴板、导出成各种图片格式。

- **不需要会画图** —— 把组件和连接关系说给 Claude 就行
- **支持 workflow / sequence / data flow / lifecycle** —— 技术流程、审批链、工具调用、CI/CD、请求调用链、数据管线、PII 边界、状态机都可以画
- **内置主题切换** —— 深色 / 浅色一键切，浏览器记住偏好
- **三套有契约的视觉预设** —— `classic` 保持稳定默认，`signal-flow` 适合有光感的演示，`blueprint` 适合部署与设计评审
- **一眼识别 Semantic Sigils** —— 五种 renderer 会给前端、后端、数据库、云、安全、消息流、外部系统与生命周期状态加上小型主题自适应 SVG 语义印记，不需要品牌图标包、网络请求或新 schema 字段
- **沿真实路径移动的 Semantic Flow Tokens** —— 精确关系预览会沿作者定义的起点→终点几何携带调用、数据、事件、安全或生命周期状态标记；这一有限动效服务桌面读图，遵守 Still/减少动态且不进入标准导出
- **Semantic Story Carrier** —— 引导故事会在唯一真实关系上复用同一套语义标记，让镜头移动时也能看懂正在传递什么；带标签的边按稳定身份去重，普通嵌入、Still 与导出保持静态
- **让动态可控，但不丢语义** —— 开启 Trace 的成品只运行一次有限环境动效，随后稳定回到作者定义的实线、安全虚线和异步虚线，并显示一个 44px 的 `Live` / `Still` 开关；Story、Route、Lens 与预览仍保留有意触发的一次性动态，`Still` 会停在完整静态读法上
- **每个缩放层级只读刚好的信息** —— `MAP` 保持全局安静，`READ` 显示职责与关系标签，`FULL` 再展开标签、备注、步骤和分类；语义聚焦会自动显示当前问题需要的精确细节
- **不用先读文档也能探索成品** —— 按 <kbd>?</kbd> 打开 Diagram Guide：查看精确节点、关系和故事数量，并直接执行查找、路径、雷达、语义透镜、故事和演示动作
- **先预览意图，再决定是否聚焦** —— 悬停或用键盘聚焦任意节点，只让它直接相关的入向与出向路径流动；点击或按 Enter 后，再把同一跳上下文锁定到 Semantic Passport
- **检查并播放任意真实链路** —— 按 <kbd>R</kbd> 或点击 `PATH`，搜索有效起点和可达终点后，可逐站检查或沿精确最短作者有向路径播放一次有限 Route Journey，再复制只包含端点问题的 `#route=` 链接
- **直接追踪并分享命名关系** —— 悬停或用键盘到达任意作者关系线，即可预览真实起点、路径和终点；点击、触摸、Enter 或 Space 会钉住精确关系行，可选作者关系 `id` 还能生成持久的 `#relation=` 链接
- **读懂并分享当前节点** —— Semantic Passport 会显示 renderer 给出的类型、职责、结构范围、作者标签和稳定 ID，并可一键复制现有的 `#focus=<id>` 链接
- **快速找到任意节点** —— 按 <kbd>/</kbd> 搜索标题、职责、结构范围、标签、类型或稳定 ID；选择结果后自动复位视口，在受限宽画布中定位节点，并进入同一个可分享的语义聚焦
- **选择、检查、预判、播放并分享能看懂路径的引导故事** —— 紧凑的 Story Shelf 会保留 Play 与每个命名章节，把冷启动总览的空间还给图；读者进入后再展开完整 Director，Story Trail 的每一站仍是原生 beat 控件，Story Horizon 继续区分唯一下一站与更远未来
- **跟着故事走，也不丢局部上下文** —— 由读者启动的播放会同时框住上一站、当前站和下一站，镜头稳定后才继续，并会立即让位给暂停、手动导航、`Still` 或“减少动态效果”
- **让语义控制镜头** —— 节点邻域、关系跳转、Finder 结果和故事步骤会带安全留白自动入镜；用户手动缩放、拖拽或滑动时立即接管，并暂停自动播放
- **在大图里始终知道自己在哪** —— 按 <kbd>M</kbd> 打开 Semantic Radar：它用类型色显示全图和当前视窗，可按稳定 ID 点击节点，也支持拖动和方向键桌面导航
- **对比系统角色但不丢掉全局方位** —— 按 <kbd>L</kbd> 打开带精确计数的 Semantic Lens：选择一种类型查看真实流量，再选择一种类型，只统计两类之间的直接作者关系；克制的方向信号只沿这些真实命中边流动，并可复制稳定的 `#lens=` 视图
- **把精确图例当作实时地图** —— 架构、工作流和生命周期图里的类型行会显示编译后节点数量；悬停或键盘聚焦时安静预览对应拓扑，点击、轻触、Enter 或 Space 后把该类型固定到 Semantic Lens；边样式或节点/边混合语义的图例会诚实地保持静态
- **分享一个会自我解释的章节** —— 使用 `?play=1#view=...` 展示标题、精确 Story Trail 路径、实时状态和进度，以可读的逐站节奏播放后停住供阅读；开启“减少动态效果”的读者会看到同一章节并标记为 `Still`
- **进入演示舞台** —— 按 <kbd>F</kbd> 让动态图占满浏览器视口，同时保留故事控制；`?present=1&play=1#view=...` 可直接分享当前演示页，Escape 会先退出视图/聚焦，再离开舞台
- **零依赖平移缩放** —— 用内置视图控件检查复杂图，导出仍然保持完整、无临时变换的标准结果
- **一键复制到剪贴板** —— 直接贴到 Slack、飞书、微信、Notion、GitHub issue
- **导出图片超清晰** —— PNG / JPEG / WebP 全部由浏览器在最高 4× 源分辨率下**原生光栅化**（不是位图放大，没有糊），或导出 SVG 做真矢量
- **动态结果可分享** —— 开启 Trace 的图可直接在浏览器录制 6 秒 WebM，不依赖 Puppeteer 或 ffmpeg
- **SVG 自动跟系统深浅色** —— 导出的 SVG 内嵌两套变量 + `@media (prefers-color-scheme)`，贴到 GitHub README 里，读者切深浅色图跟着切（不用两张 PNG + `<picture>` 包起来）
- **内置质量闭环** —— renderer 驱动的图会经过 JSON schema 校验、布局检查、通用的节点穿线 Clean Flow Gate，以及构图收据：关系线沿结构容器边框行走会在所有 profile 中阻断，`showcase` 还会拒绝小于 8px 的线路小钩、小于 16px 的内部转折和无关关系 X 交叉，同时不会误杀普通端点短桩
- **语义技术标签** —— 可以把组件写成 `aws.lambda`、`postgres`、`redis`、`github-actions`、`openai` 等；Archify 会把它们映射到合适的视觉类别，不需要完整图标库
- **单文件 HTML** —— 生成的 HTML 零运行时依赖，发一个文件就能分享
- **聊天迭代** —— "把 Redis 挪到左边"、"鉴权服务换成玫红"、"加个 Kafka"

![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![Agent Skill](https://img.shields.io/badge/Agent-Skill-7C3AED?style=flat-square)
![Version](https://img.shields.io/badge/version-2.11.0-0891b2?style=flat-square)

**[在线落地页 → tt-a1i.github.io/archify](https://tt-a1i.github.io/archify/)** · **[场景选图指南 → guide.html](https://tt-a1i.github.io/archify/guide.html)** · **[自动生成验证作品集 → gallery.html](https://tt-a1i.github.io/archify/gallery.html)**

在线落地页会在首屏直接露出真实生成的图面：只有一个有限、可交互的成品证明，不用假图，也不做自动轮播。

**60 秒开始：**

```bash
npx skills add tt-a1i/archify -g
```

然后告诉你的 agent：`使用 archify 梳理这个仓库的运行时架构。`

## 预览

同一张图，两套主题，一键切换：

| 深色 | 浅色 |
|---|---|
| ![深色主题](docs/assets/archify-dark.png) | ![浅色主题](docs/assets/archify-light.png) |

Export 菜单 —— 复制到剪贴板 + 静态和动态格式下载：

![导出菜单](docs/assets/archify-menu.png)

想亲自体验：下载或克隆仓库后打开 [`examples/web-app.html`](examples/web-app.html)。按 <kbd>?</kbd> 打开 Diagram Guide，按 <kbd>R</kbd> 探查路径，按 <kbd>/</kbd> 查找节点，按 <kbd>M</kbd> 打开 Semantic Radar，按 <kbd>L</kbd> 打开 Semantic Lens，按 <kbd>F</kbd> 进入演示舞台，按 <kbd>T</kbd> 切换主题，按 <kbd>E</kbd> 打开导出菜单。

## 快速开始

### 1. 安装

```bash
npx skills add tt-a1i/archify -g
```

这条命令通过开源的 [`skills` CLI](https://github.com/vercel-labs/skills) 为支持的 Agent 安装 Archify。

如果只想临时体验，不做永久安装：

```bash
npx skills use tt-a1i/archify@archify --agent codex
```

需要时可以把 `codex` 换成 `claude-code` 或 `opencode`。

### 2. 先画一个边界清楚的视图

不要一开始就要求一张图解释整个仓库。先从 Overview 开始：

```text
分析这个仓库，然后使用 archify 生成一张高层运行时架构图。
只保留 8–12 个核心组件，突出一条主要请求或数据路径，并标出外部依赖与信任边界。
辅助信息放进说明卡片，不要继续增加连线。
```

如果只想解释一条调用链：

```text
使用 archify 画出这条登录流程：Browser -> Web App -> API -> JWT 校验 ->
Redis Session 查询 -> PostgreSQL 回源。把缓存未命中作为次要路径。
```

### 3. 在对话中细调

只要当前会话里仍保留源 JSON，就可以继续说：`增加 Redis`、`把鉴权移到左侧`、`突出回滚路径`。

最终得到的是一个可直接在现代浏览器中打开的 HTML 文件，并可导出 PNG、JPEG、WebP、SVG；开启 Trace 后还可导出 WebM。

## 图表类型

先确定你想回答的问题，再选择对应视图：

不知道该用哪一种图？可以打开[交互式场景指南](https://tt-a1i.github.io/archify/guide.html)，也可以直接询问零依赖 CLI。它会从 11 个小而专的配方中给出推荐，同时返回证据清单、使用边界、表现建议和可复制提示词：

```bash
node archify/bin/archify.mjs guide "展示带 Redis 缓存未命中的 API 请求"
node archify/bin/archify.mjs guide "梳理 Kafka Topic、消费者组、重放和死信队列" --json
```

| 类型 | 最适合 | Prompt 中应包含 |
|---|---|---|
| **Architecture** | 组件、服务、存储和系统边界 | 范围、核心组件、主要路径 |
| **Workflow** | CI/CD、审批、工具调用、runbook | 参与者、顺序、分支、异常 |
| **Sequence** | API 调用、缓存回源、鉴权和异步链路 | 调用方、被调用方、返回和时序 |
| **Data Flow** | 数据管线、血缘、PII 和下游消费 | 来源、转换、存储、敏感边界 |
| **Lifecycle** | 状态机、等待、重试和终态 | 状态、事件、重试与取消路径 |

Architecture 示例：

- [`examples/web-app.html`](examples/web-app.html) — 精简 SaaS 架构
- [`examples/archify-repo.html`](examples/archify-repo.html) — Archify 的 Skill → JSON IR → Renderer 流水线
- [`examples/archify-repo-grid.html`](examples/archify-repo-grid.html) — 显式 `row` / `col` 网格布局
- [`examples/maka-architecture.html`](examples/maka-architecture.html) — 第三方桌面 Agent 工作台

Workflow 使用泳道、清晰主路径和克制的次要分支。

![Workflow 示例](docs/assets/archify-workflow.png)

Sequence 聚焦一段随时间展开的交互。

![Sequence 示例](docs/assets/archify-sequence.png)

Data Flow 明确表现数据移动、转换以及敏感边界。

![Data Flow 示例](docs/assets/archify-dataflow.png)

Lifecycle 区分正常进展、等待态、重试路径和终态。

![Lifecycle 示例](docs/assets/archify-lifecycle.png)

## 为什么用 Archify

- **用布局判断代替通用自动布局** —— Agent 根据要讲的故事决定层级、间距、线路和视觉重点。
- **Typed JSON IR** —— 五种图都由对应 Schema 和 Renderer 驱动。
- **交付前验证** —— Schema、布局、HTML 和 SVG 检查会尽早发现结构错误和明显的可读性问题；Clean Flow 会精确指出节点穿线几何，构图收据会拒绝关系线贴着结构容器边框行走、分类最终可见的 X 交叉、区分端点短桩与拥挤转折，并在路由角色尚未校准前继续把 bend / stretch 保留为中性证据。
- **便于分享** —— 一个 HTML 文件即可打开，无需服务器或前端框架；外部字体不可用时会使用本地字体。
- **语义技术标签** —— `postgres`、`redis`、`aws.lambda`、`github-actions` 等名称会参与视觉分类，不需要沉重的图标运行时。

Archify 不是通用绘图编辑器，也不是 Mermaid 换肤工具。它的目标是把技术意图编译成适合沟通的成品图。

## 安装方式

推荐直接使用：

```bash
npx skills add tt-a1i/archify -g
```

同一个 [`archify.zip`](archify.zip) 也可以手动安装：

| 使用方式 | 安装位置或方法 | 能力 |
|---|---|---|
| **Claude Code** | `~/.claude/skills/` 或 `.claude/skills/` | 完整 Renderer + 校验流程 |
| **Codex CLI** | `~/.agents/skills/` 或 `.agents/skills/` | 完整 Renderer + 校验流程 |
| **opencode** | `~/.config/opencode/skills/`、`.opencode/skills/` 或 `.agents/skills/` | 完整 Renderer + 校验流程 |
| **Claude.ai** | 在 Settings → Capabilities → Skills 上传 `archify.zip` | 取决于沙箱是否允许执行 Node.js |
| **Project Knowledge** | 把 `archify.zip` 上传到项目知识库 | 仅 Prompt 驱动的 Architecture 模式 |

Claude.ai 的 Skills 上传入口：

![Claude Skills 设置页](docs/assets/claude-skills-settings.png)

手动安装就是把压缩包解压到对应目录。分发包已包含独立校验器，不需要执行 `npm install`。

## 工作原理

Renderer 驱动的图会经过一条简短、可检查的流水线：

| 步骤 | 发生什么 |
|---|---|
| **生成 JSON IR** | Agent 先生成类型化描述，而不是直接修改最终 SVG。 |
| **校验** | 内置独立校验器检查 Schema，无需安装运行时依赖。 |
| **渲染** | 对应 Renderer 生成 HTML/SVG。 |
| **检查** | 布局和 Artifact 检查发现无效坐标、损坏 SVG 和不安全线路。 |
| **迭代** | 修改集中在 JSON IR，尽量保持无关结构稳定。 |

从仓库源码运行 CLI：

```bash
cd archify
node bin/archify.mjs doctor
node bin/archify.mjs demo /tmp/archify-demo
node bin/archify.mjs guide "展示 CI/CD 检查、审批、发布和回滚"
node bin/archify.mjs render workflow examples/agent-tool-call.workflow.json /tmp/workflow.html
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --json
node bin/archify.mjs validate workflow examples/agent-tool-call.workflow.json --quality showcase --json
node bin/archify.mjs check /tmp/workflow.html
node bin/archify.mjs examples
```

演示场景可以选择开启轻量 Trace 动画：

```json
{
  "meta": {
    "title": "Release Flow",
    "animation": "trace",
    "visual_preset": "signal-flow"
  }
}
```

`visual_preset` 是可选项：`classic` 保持稳定默认，`signal-flow` 提供有光感的分层画布和更紧凑的动态节奏，`blueprint` 则提供高对比工程网格、方正评审材质和更精确的边界表达，同时不改变图形几何。开启 Trace 的成品会提供统一的 `Live` / `Still` Motion Governor：环境动效只播放一次，随后恢复作者定义的关系线型，并让位给更强的语义动作；`Still` 会暂停正在播放的 Story 且切回 `Live` 后不会擅自续播，浏览器存储可用时也会记住读者选择。动态 `prefers-reduced-motion` 与页面隐藏会走同一条安全停止路径；不设置 `animation` 时则保持真正静态，也不显示动态控制。

可选的 `meta.views` 可以把一张稳定总览变成简短的引导阅读序列。每个视图只包含唯一 ID、标题、有序的既有语义节点 ID 和可选说明，不能移动或重绘底层图。尚未进入章节时，Story Shelf 只保留紧凑的引导视图身份、Play 和所有作者章节，把暂时无效的导演控件收起；选择章节、开始播放或恢复有效深链后，完整 Director 会立即展开，Show all 或 Escape 则回到 Shelf。Named Chapter Rail 会列出每个作者标题和两位序号；尚未选中章节时，候选项会诚实显示从总览出发的 `=0 +N −0`，选中后当前章节保留停靠点数，其余候选则显示精确的 `=保留 +进入 −离开` 聚焦差异。精细指针悬停或键盘聚焦会在不改变当前章节、镜头、Story Trail 与 URL 的前提下显示同一份静态 Chapter Delta Preview；Escape 只撤销预览并保留焦点，触屏仍然首次轻触直接激活。选择章节继续委托给上一步/下一步与 `#view=` 共用的引导视图状态。当相邻章节拥有真实的稳定 ID 共同节点时，Shared Anchor Handoff 会先把该节点保持在原位并说明连续关系，再完成一次可打断的相机移动；没有共同节点时则明确使用 `no-anchor` 重定向，不编造连续性。Story Beat Navigator 会把每个解析后的有序停靠点做成原生控件，并且只把相邻节点之间精确 authored edge 分类为正向、反向、grouped 或 multiple；直接激活会钉住 beat，不改变章节、焦点集、镜头、滚动或 URL，唯一无歧义的边最多运行一次有限信号，Play 则从同一 beat 剩余 dwell 继续。**Copy moment** 会在必要时冻结播放，并生成稳定的 `#view=<view-id>&beat=<node-id>` 链接；打开后无动画恢复这个作者节点，无效 beat 则安全退回有效章节。JSON、原始边样式、SVG 几何和标准导出都保持不变。

Story Follow Camera 会框住当前 authored 窗口，Story Director Strip 则用真实路径、边标签、职责与上下文解释当前镜头，不编造关系。Story Horizon 以静态的 `past → active → next → pending` 层级预告唯一的下一节点，并且只复用该下一步已经解析出的真实边；grouped 不造边，multiple 保留全部作者关系，最终 beat 不残留预告，也不会提前移动镜头。桌面 Presentation 播放时保留上一步、下一步与暂停，只暂时收起次要故事控件，暂停后完整恢复。

## 使用生成结果

在现代浏览器中打开 HTML，右上角提供三个入口：

- **Theme** —— 切换深色和浅色，快捷键 <kbd>T</kbd>。
- **Present** —— 让实时图占满浏览器视口，不改变图形或导出结果，快捷键 <kbd>F</kbd>。
- **Export** —— 复制 PNG，或下载 PNG、JPEG、WebP、SVG；开启 Trace 时还能导出 6 秒 WebM，快捷键 <kbd>E</kbd>。

Reading Depth 从只保留主标签与拓扑的 `MAP 100%` 开始，到 `READ 125%` 显示职责与关系标签，再到 `FULL 175%` 展开标签、备注、步骤和分类。聚焦、Semantic Lens、Intent Trace、Route Probe、Story Trail、Direct Relationship Pin 与关系预览会在任意缩放下自动显示当前问题需要的局部细节；打印和导出始终保留完整图。

每条作者关系现在也都是直接入口。不可见的 24px 非缩放命中轨道会精确贴合原有几何，但不会把画面里的线变粗。精细指针悬停或键盘漫游会预览真实起点、路径与终点；点击、触摸、Enter 或 Space 会打开起点 Passport，并钉住现有 Relationship Lens 的精确关系行。五种关系数组都可以提供可选作者 `id`；命名关系会写入并复制 `#relation=<relationship-id>`，即使关系数组重新排序，也能恢复同一条作者关系。标准 SVG 保留 `data-edge-id` 作为语义身份，运行时命中轨道与信号副本则会移除它。旧的无 ID 文档仍然有效，其关系钉住状态只留在本页，Copy 会安全回退到起点节点；私有数字 key 永远不会进入分享 URL，重复作者关系 ID 会在输出前失败。Focus、Story、Route、Lens 与 Chapter 等更强状态仍然优先，普通嵌入、打印和标准导出保持干净。

图本身也可以探索。在正式聚焦前，悬停节点或用键盘到达它，就会启动 Intent Trace：无关元素轻轻退后，只有该节点直接相关的入向、出向和自环路径显示带方向的短促流动信号。触屏用户不模拟悬停，仍然一次点击直达聚焦；减少动态偏好的用户会看到同样的一跳静态对比。按 <kbd>R</kbd> 或使用 `PATH` 可启动 Route Probe：先选起点，再从高亮的可达节点中选择终点，Archify 会用确定性的最少跳数有向路径框选并追踪整条链路，在紧凑回执中列出每一站，并提供 `#route=<source>~<target>` 复制链接；它不会用无向路径制造看似方便但语义错误的回退，减少动态模式则显示同样的静态结果。点击节点，或按 <kbd>Enter</kbd> / <kbd>Space</kbd>，即可把该节点、直接邻居和关联路径锁定；Semantic Camera 会在不遮挡 Relationship Lens 的前提下框选这一跳邻域。Semantic Passport 会立即说明该节点由 renderer 给出的类型、职责、结构范围、作者标签和稳定 ID；Copy link 会写入当前 `#focus=<id>` 深链。Lens 会给每条入向、出向和自环关系命名；在手机上，完整列表默认收在明确的关系数量按钮后面，让紧凑 Passport 不会盖住选中节点。悬停某一行，或用方向键、Home、End 到达它时，其余关系会暂时变暗，画布会精确指出这条关系的起点、路径和终点；激活该行即可沿边跳转，并把镜头交给相邻节点。按 <kbd>M</kbd> 打开 Semantic Radar：它用类型色显示简化全图和实时视窗框；点击雷达节点即可聚焦，拖动表面或使用方向键可重新居中，Escape 关闭。雷达只在图表可见时停靠，会尽量避开焦点节点和 Passport；手机受限横向图会报告实际可见宽度，并且雷达始终不进入嵌入、打印或标准 SVG 导出。按 <kbd>/</kbd> 打开 Node Finder，可搜索同一组标题、职责、结构范围、标签、类型或稳定 ID；每条结果会显示上下文和关系数量，选择后自动复位并框选该节点。带引导视图的图还会提供播放/暂停、上一步、下一步和显示全图控件。Named Chapter Rail 会预先显示所有作者章节和精确章节聚焦差异；Left/Right/Home/End 只移动焦点，并静态预览 `保留 / 进入 / 离开` 成员，不会切换当前图。激活仍委托给同一个 `activeIndex` 与 `#view=` 状态，焦点进入轨道时会暂停播放，把下一步交还读者；Escape 只撤掉差异预览并把焦点留在原处。Story Beat Navigator 把 Story Trail 的每个已解析停靠点变成原生控件：点击、触摸、Enter 或 Space 会暂停并钉住精确 beat，同时保持章节、选中焦点、镜头、受限滚动和 `#view=` URL 不变。回执会区分真实正向边、反向 authored edge、没有直接关系的 grouped transition，以及多条 authored edge；只有唯一且无歧义的精确边可以播放一次有限信号。键盘焦点本身只会在当前 playhead 暂停，Play 会从这个 beat 尚未完成的 dwell 继续，而不是重启章节。播放时，较早 beat 会沉降，当前节点及精确相邻关系保持最高权重，未来 beat 仍然可见，下一章则会等 Shared Anchor Handoff 完成后才开始。按 <kbd>P</kbd> 播放完整故事，或用 <kbd>[</kbd> / <kbd>]</kbd> 手动换章。分享链接 `?play=1#view=<view-id>` 则只让该命名章节播放一次 3.2 秒，不会自动跳到下一章，并会遵守 `prefers-reduced-motion`。嵌入模式的 Share Chapter Cue 会显示章节名、精确作者路径、当前 `Step NN / NN`、Playing/Settled/Paused/Still 状态和同一个一次性进度，并始终留在 SVG 与导出之外。每个章节都会用受限缩放和留白框选作者指定的节点；用户手动缩放、拖拽或在手机上滑动时，会接管镜头并暂停播放。演示舞台会隐藏支持性卡片并让图占满视口，但保留这些实时控制。页面隐藏或读者开始自由探索时也会自动暂停；按 <kbd>Escape</kbd> 会先关闭雷达或 Route Probe，再撤销 Chapter Delta Preview、退出当前引导视图/聚焦，最后离开舞台。使用 <kbd>+</kbd>、<kbd>-</kbd>、<kbd>0</kbd> 缩放或复位，放大后可以拖动画布。节点聚焦记录在 `#focus=<node-id>`，作者关系钉住记录在 `#relation=<relationship-id>`，路径探查记录在 `#route=<source>~<target>`，引导故事记录在 `#view=<view-id>`；导出始终使用完整、未变换的原图。

Relationship Lens 的关系预览是一次性方向提示，不是环境动画。用精细指针进入某一行，或用方向键、Home、End 把焦点移到该行时，Archify 只在对应稳定边键的真实几何上播放一次约 1.2 秒的起点→终点脉冲；移动标记会根据编译后的渲染器证据区分调用、数据、事件、安全边界与生命周期状态变化，入向关系仍按作者定义的真实方向移动。脉冲结束后，精确边与两端节点保持静态强调。窄屏复用同一套基础容错，不作为独立产品面；减少动态偏好直接显示同样的静态含义。该临时信号不会进入嵌入、打印、SVG 或栅格导出。

Route Probe 完成后还会显示 Route Journey。原生路径节点、Previous、Next、Journey/Pause/Replay 与 Overview 控件会保留整条最短路径作为上下文，同时强化一个有序位置及其精确入向关系。只有读者主动按下播放才会启动一次有限旅程；暂停后从剩余停留时间继续，路径焦点、手动平移缩放、Guide、页面隐藏、Motion Still 和减少动态都会立即接管。静态模式仍可逐站手动检查。Escape 依次执行暂停、回到 Overview、清除路径；分享的 `#route=<source>~<target>` 始终只记录端点，并静态恢复到 Overview，绝不自动播放。

Route Probe 正在选择端点时，按 <kbd>/</kbd>、使用常规 Finder 控件，或点击 `Find start` / `Find target`，都会把 Node Finder 切换成上下文端点选择器。起点搜索会略过无出向关系的死路；终点搜索只保留按作者方向真实可达的节点，并提前显示最短跳数。Escape 只关闭 Finder，不会丢掉正在进行的路径问题；离开 Route Probe 后，Finder 仍保持原来的语义聚焦行为。

按 <kbd>?</kbd> 或点击问号控件可打开 Diagram Guide。它会读取编译后的真实成品，报告精确语义节点、关系和引导视图数量，再通过面向结果的任务行直接运行现有 Finder、Route Probe、Semantic Radar、Semantic Lens、Story Trail 与 Presentation 交互。面板内支持方向键、Home、End、直接快捷键和 Escape；打开时会暂停播放并关闭互相遮挡的面板，但不会清除当前聚焦或正在进行的路径问题。

按 <kbd>L</kbd> 或点击 `LENS` 可以在不丢失全局方位的前提下比较编译后的语义类型。架构、工作流和生命周期图中与节点类型精确对应的图例行也会直接显示编译计数：精细指针悬停或键盘聚焦时，会安静预览对应节点、相连作者关系和对端节点；点击、轻触、Enter 或 Space 后，把该类型固定并打开同一个 Lens。Sequence 与 Data Flow 图例仍保持静态，因为其行表达的是边变体或节点/边混合含义，而不是一种精确类型。每种 Lens 类型都会显示精确节点数；单选时保留该类节点、所有相接关系和对端节点，双选时只突出并统计两类之间的直接作者关系。只有这些精确的作者路径会出现由选择触发的一次短方向脉冲：出向/正向、入向/反向和同类流量视觉上各自明确，但节点不会移动，连线也不会重排。一次性信号会继承当前视觉预设，在减少动态模式下变为静态，命中超过 24 条边时自动静默，并且不进入嵌入、打印与标准导出。无关拓扑只是柔和退后，不会消失；关闭面板会保留当前选择，`#lens=<kind>~<kind>` 可恢复同一视图，Escape 会先关闭面板、再清除选择。

| 格式 | 适合 |
|---|---|
| **复制 PNG** | 飞书、Slack、Notion、GitHub 评论和快速评审 |
| **PNG / JPEG / WebP** | 演示文稿、文档、网站和印刷 |
| **SVG** | README、博客、Figma、Illustrator 和无损缩放 |
| **WebM** | 产品演示、版本说明、社交媒体和动态文档 |

位图会以浏览器允许的最高安全分辨率原生渲染，最高 4×。图太大时会自动降到 3× 或 2×，避免超过 Canvas 限制。

导出的 SVG 同时包含深色、浅色变量和 `prefers-color-scheme`，因此同一个文件可以跟随读者的系统主题。

常用 URL 参数：

- `?theme=light` 或 `?theme=dark` —— 固定初始主题。
- `?present=1` —— 直接进入演示舞台；可与 `?play=1#view=<view-id>` 组合成可分享的实时演示页。
- `?play=1` —— 当前命名视图只播放一次 3.2 秒，嵌入模式同时显示标题、路径、状态和进度提示，然后停住；不带 `#view` 时播放第一个作者视图。不会自动换章，并遵守减少动态效果设置。
- `?openExport=1` —— 加载后自动打开导出菜单。
- `#focus=<node-id>` —— 打开时聚焦指定语义节点及其一跳邻域。
- `#relation=<relationship-id>` —— 打开时恢复一条带作者稳定 ID 的精确关系。
- `#route=<source-id>~<target-id>` —— 恢复两个语义节点之间作者关系上的最短有向路径。
- `#view=<view-id>` —— 打开 `meta.views` 定义的命名阅读路径。
- `#view=<view-id>&beat=<node-id>` —— 打开一个精确、静态的 Story Moment；只有需要从该处播放剩余章节时才添加 `?play=1`。

WebP、WebM 和剪贴板能力取决于浏览器；WebM 只在使用 `animation: "trace"` 时开放。外部字体不可用时，HTML 会使用本地字体 fallback。

## Prompt 模板

**仓库概览**

```text
梳理这个仓库的运行时架构，最多保留 12 个核心组件。
展示主要请求路径、外部系统和信任边界，把实现细节放进说明卡片。
```

**CI/CD Workflow**

```text
画一张 CI/CD workflow：pull request -> tests -> approval -> build image ->
staging -> smoke test -> production。把 rollback 画成次要失败路径。
```

**数据血缘**

```text
画一张从 Web、Mobile 事件经过 Consent Gate、Kafka、Warehouse、Feature Store，
最终到 Dashboard 和 ML 消费方的数据流图，并明确标出 PII 边界。
```

## 参考

语义标签会参与颜色和分组：

| 示例 | 类别 |
|---|---|
| `react`、`nextjs`、`ios`、`browser` | 前端 |
| `node`、`go-service`、`python-worker`、`api-gateway` | 后端 |
| `postgres`、`redis`、`s3`、`bigquery`、`snowflake` | 数据和存储 |
| `aws.lambda`、`gcp.pubsub`、`azure.functions`、`kubernetes` | 云与基础设施 |
| `auth0`、`oauth`、`vault`、`security-group` | 安全 |
| `kafka`、`rabbitmq`、`sqs`、`nats` | 消息系统 |
| `stripe`、`github-actions`、`openai`、`slack` | 外部系统 |

Renderer 输入请查看 [Schema 说明](archify/schemas/README.md)，版本历史请查看 [CHANGELOG.md](CHANGELOG.md)。

## 当前状态与路线图

当前 Viewer 已在五种 Renderer 模式中提供渐进式 `MAP` / `READ` / `FULL` Reading Depth。

Archify 2.11 的五种 Renderer 模式都已经使用 Typed JSON IR，并支持可分享的作者关系 ID、聚焦前 Intent Trace 路径预览、带有限可检查 Route Journey 的双端点 Route Probe 分析、稳定语义标记、Semantic Camera、实时 Semantic Radar 全局导航、带 Chapter Delta Preview、Shared Anchor Handoff、可直接检查 Story Beat Navigator 与 Shareable Story Moment 的命名章节轨、读者可控的 Live/Still Motion Governor、带可复制焦点链接的 Semantic Passport、具名入向/出向 Relationship Lens、Node Finder 搜索导航、一跳聚焦、可分享的演示舞台、平移缩放、Signal Flow 动态效果和浏览器原生 WebM 导出。项目页现在不再用静态效果图充当首要证据，而是直接展示 Signal Flow、Blueprint 和 Classic 三个真实、会动、可点击的成品。[验证作品集](https://tt-a1i.github.io/archify/gallery.html) 会从仓库内 11 个场景示例自动重建；每个配方都发布对应交互成品、三个命名阅读视图、精确 JSON 源、七项校验和源摘要，不依赖手写且可能过期的能力声明。

规划和产品边界请查看 [ROADMAP.md](ROADMAP.md)。自动 Mermaid Parser、通用自动布局、托管分享服务和 WYSIWYG 编辑器目前都不是目标。

## 致谢

Archify 基于 Cocoon AI 的 [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) v1.0 进行 Fork 和重写。

原项目的视觉语言仍归功于 Cocoon AI。Archify 2.x 在其基础上增加了主题、导出、Typed Renderer、校验、无障碍支持和统一 CLI。两个项目都采用 MIT License。

## License

[MIT](LICENSE) —— 可以自由使用、修改和分发。

## 参与贡献

欢迎提交 Issue、Pull Request 和分享生成的图。报告产物问题时，请尽量附上 Prompt、图表类型和 Archify 版本。修改内置示例或独立 Viewer 后，请运行 `node scripts/build-gallery.mjs` 同步自动生成的作品集。
