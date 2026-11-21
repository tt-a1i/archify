# Archify 对比 Mermaid、Excalidraw、PlantUML 与 D2：AI Coding Agent 画图工具怎么选？

**先说结论：** 只需在 Markdown 里嵌几行小图，选 Mermaid；一群人需要同屏自由拖框头脑风暴，选 Excalidraw；团队已有 CI 纯文本 DSL 或 C4 架构建模流水线，选 PlantUML、D2 或 LikeC4。而在寻找更适合 **AI Coding Agent（Claude Code、Cursor、Codex、OpenCode、GitHub Copilot）的 Mermaid 替代方案**、希望**零画图语法门槛快速把任何复杂的事讲清楚**——不管是软件架构、科普原理、工作复盘，还是旅游攻略、租房避坑、理财/年假规划——想交给 Agent 直接产出一份**不穿模、高颜值、可交互的单文件 HTML（10 种原生图型）**，或者**结论先行、图文联动、内置 4 套排版风格的一页式解答（Explainer）**时，选 **Archify**。

<span id="answer" class="section-anchor" aria-hidden="true"></span>

## 不限于代码：把万物变成可互动的高颜值网页作品

Archify 是 [archify.si](https://archify.si) 上的开源 Agent Skill（Apache-2.0），源码位于 [github.com/tt-a1i/archify](https://github.com/tt-a1i/archify)。使用它**完全不需要先有代码仓库，也不用背画图语法**：你只需要像平时聊天一样说出想法，或者把已有草稿、Mermaid 文本、仓库路径交给 Agent。

Agent 会在极短时间内帮你选定最贴合问题的结构——覆盖**十种原生图型**（`architecture` 架构图、`workflow` 工作流、`sequence` 时序图、`dataflow` 数据流、`lifecycle` 状态生命周期、`erd` 实体关系、`class` 类图、`tree` 树图、`timeline` 时间线、`waterfall` 瀑布图），或编写 `.archify.md` 生成**一页式解答（Explainer）**——再经本地确定性布局、防穿模路由与校验门禁（原生图表默认执行真实浏览器检查；一页式解答默认执行结构与交付校验，传入 `--browser-check` 时按需开启浏览器检查），交付一个**双击即可离线打开、还能让 Agent 继续二次扩展**的精致 HTML 成品。

正因如此，Archify 和“纯文本画图渲染器”或“空白画板”并非简单替代关系：它既能帮你读懂真实代码仓（如 [MCO 运行时案例](cases/mco-runtime.html)），也能几句话做出[上海四天 CityWalk 互动行程](cases/community/shanghai-citywalk.html)和[大城市首次租房避坑指南](cases/explainer/first-rental.html)。如果你的诉求仅仅是在 README 里塞三四个方框，直接写 Mermaid 依然最轻省。

<span id="matrix" class="section-anchor" aria-hidden="true"></span>

## 一张表看差异

| 对比维度 | Archify | Mermaid | Excalidraw | PlantUML / D2 |
| --- | --- | --- | --- | --- |
| 创作门槛与速度 | Agent 自然语言快速直出 | 需手写并调试语法 | 需鼠标手工画框对齐 | 需手写较重 DSL |
| 覆盖题材范围 | 生活/科普/规划/代码均可 | 文档内嵌小流程 | 白板手绘头脑风暴 | 偏工程与 UML 建模 |
| 图型与表达形式 | 10 种图型 + 4 风格 Explainer | 常规语法图 | 自由画布 | 丰富 UML / 架构图 |
| 排版美感与防乱 | 确定性路由+浏览器检查+双主题 | 节点多易连线交叉 | 取决于手工排版 | 自动静态排版 |
| 阅读交互体验 | 聚焦/链路高亮/图文同步亮/导出 | 多为静态 SVG | 导出后为静态图 | 多为静态图 |
| 一页式解答能力 | 结论+图+表+步骤+溯源并排 | 不支持 | 不支持 | 不支持 |
| 交付与扩展性 | 独立 HTML，可对话继续加功能 | 依赖宿主 Markdown | 云端/画布文件 | 依赖渲染服务 |
| 最适合的场景 | 高颜值快速讲透复杂万物 | GitHub 小型示意图 | 多人实时涂鸦讨论 | 纯文本 CI 版本流 |

这张表对比的是默认定位与强项。熟练作者同样可以把 Mermaid 写得很干净，几分钟的 Excalidraw 草图也常比正式图表更适合即时对齐——选型只需围绕读者的使用方式。

<span id="boundaries" class="section-anchor" aria-hidden="true"></span>

## 什么时候不该选 Archify

- **选 Mermaid**：图只有十几步、必须直接嵌入 GitHub / 博客 Markdown 代码块，且需要人手随时改几行文本。
- **选 Excalidraw（含 Excalidraw MCP）**：价值在于多人同屏实时手绘、对话直接生成可拖放的白板草图，保留轻松的手绘自由感。
- **选 PlantUML 或 D2**：团队已将纯文本图表接入 CI 流水线，追求文本行级 diff 或高密度形式化 UML 记号。
- **选 LikeC4**：团队需要专门面向 C4 架构分层的强类型 Architecture-as-Code DSL，并在代码库中持续维护模型关系。
- **选 BI 或可观测性工具**：需要监控实时在线指标、告警大盘或实时链路采样；Archify 交付的是创作好的静态 HTML 成品，而非监控后端。
- **选云端托管协作平台（如 Eraser.io）**：需要账号权限体系与多人同时编辑同一张云端画布；Archify 主打本地、免登录、无依赖交付。

同时，Archify 也不承诺无损解析全部 Mermaid 高级语法、无需引导就自动看懂任意超大型仓库，或仅靠结构校验替现实业务的真实性背书——工具保证排版干净与渲染可信，事实把关仍属于创作者。

<span id="workflows" class="section-anchor" aria-hidden="true"></span>

## 四个高频实战场景

### 1. 不限于代码：把生活规划、旅行攻略或复杂决策一页讲透

不需要仓库也能用：看看[一年年假怎么排流程图](cases/life/leave-plan.workflow.html)、[租房看房议价时序图](cases/life/renting.sequence.html)、[月薪现金流去向图](cases/life/monthly-money.dataflow.html)、[求职投递状态机](cases/life/job-search.lifecycle.html)，以及[大城市首次租房签合同避坑 Explainer](cases/explainer/first-rental.html)。更特别的是，因为成品本身就是干净独立的 HTML，社区用户甚至在生成[上海四天 CityWalk 行程图](cases/community/shanghai-citywalk.html)后继续让 Agent 加上高德/小红书跳转、抵达打卡与停留记录。你可以直接在[工作流快速开始](start.html?type=workflow&input=description)用一句话试画。

### 2. 把越画越乱的 Mermaid 草稿快速“挽救成成品”

如果手头的 Mermaid 已经节点密密麻麻、连线四处穿模，直接把源码贴给配置好的 Agent，让它用 Archify 重新理清逻辑并产出带聚焦和高亮追踪的 HTML。详见 [Mermaid 输入指南](agent-diagrams.html#mermaid-input)。注意这**不是无损转换**：Agent 会理解图中的真实关系并重写出干净的 JSON，而不会机械保留原草稿里的样式指令或前端回调。

### 3. 一张图讲不完的问题：用 Explainer 图文联动一页讲透

科普原理解析、故障复盘、业务方案评审或深度教程，往往既要结论又要图和步骤对照。Archify 的 `.archify.md` 一页式解答会先给出明确结论与理由，再分成面板将文字、表格、步骤与已校验示意图左右并排——**读到哪一步，图上就自动高亮哪一部分**，支持 **4 套高颜值排版风格**、深浅主题、长图/PDF 导出及单面板追问。点击体验真实成品：[P99 尾延迟暴涨一页式解答](cases/explainer/p99-tail-latency.html)与[首次访问 HTTPS 发生了什么](cases/explainer/tls-first-visit.html)。

### 4. 需要源码依据时：梳理真实代码仓库不靠猜

落回软件工程场景时，可以让 Agent 沿固定 Git 提交读取真实代码片段并挂载文件依据，避免模型“幻觉画框”。见 [MCO 运行时案例](cases/mco-runtime.html)、[MCO 交互架构成品](cases/mco-runtime.architecture.html)与[仓库证据清单](agent-diagrams.html#repository-evidence)。

<span id="limits" class="section-anchor" aria-hidden="true"></span>

## 选 Archify 之前先确认

- 手边是否有支持读写文件与 Node.js 的 Coding Agent（如 Claude Code、Codex、Cursor、OpenCode 或 GitHub Copilot）？
- 你是否希望跳过繁琐的画图语法和手工对齐，直接获得**十种原生图型**或**四种风格的图文联动 Explainer**？
- 你的读者是否需要点击聚焦、深浅色切换、高清导出（PNG / SVG / WebP / WebM / PDF）或可继续扩展的 HTML 交付物？
- 当场景不需要死守 Markdown 代码块内嵌、而是可以交付一个双击即开的独立 HTML 时，Archify 的体验与说服力优势最明显。

如果只是在文档里随手放三五个框，Mermaid 依然最顺手；一旦你想用**高颜值、快节奏、强交互**把任何复杂想法、生活攻略或技术系统一眼讲透，建议从[场景指南](guide.html)、[Agent 画图指南](agent-diagrams.html)或[快速上手安装页](start.html)开始尝试。
