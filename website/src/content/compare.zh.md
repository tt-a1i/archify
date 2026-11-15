# Archify、Mermaid、Excalidraw、PlantUML 怎么选？

**先说结论：** 如果图要直接写进 Markdown 代码块，选 Mermaid；如果是一群人实时手绘白板，选 Excalidraw；如果图表本来就是纳入 CI 的纯文本，选 PlantUML 或 D2。如果你想让 Coding Agent 读一段描述、一份已有 Mermaid 草稿或真实代码仓库，产出经过布局校验、可交互的独立 HTML 图，或者一份结论先行、标注出处的一页式解答，再考虑 Archify。这四类工具的重叠，比宣传里看起来少得多。

<span id="answer" class="section-anchor" aria-hidden="true"></span>

## 分工其实很清楚

Archify 是 [archify.si](https://archify.si) 上的开源 Agent Skill（Apache-2.0），源码在 [github.com/tt-a1i/archify](https://github.com/tt-a1i/archify)。Agent 为图表编写类型化 JSON，为一页式解答编写 `.archify.md` 草稿；Archify 再校验 schema、计算布局与连线、执行真实浏览器检查，最后写出一个不需要构建步骤、不需要联网就能打开的 HTML 文件。

所以 Archify 不是“画图渲染器”的同类替代。它要解决的是更难的部分：读证据、选结构、让复杂图不出现连线穿模，并给读者留下检查成品的入口。如果你的需求只是“把这段文本渲染成 README 里的一张图”，那 Archify 确实过重了。

<span id="matrix" class="section-anchor" aria-hidden="true"></span>

## 一张表看差异

| 对比维度 | Archify | Mermaid | Excalidraw | PlantUML / D2 |
| --- | --- | --- | --- | --- |
| 主要创作方式 | Coding Agent 编写类型化 JSON 或 Markdown 草稿 | 手写文本语法 | 在画布上手工绘制 | 手写文本语法 |
| 支持的输入 | 自然语言、计划、已有 Mermaid 文本、固定提交的代码库证据 | 图表文本 | 鼠标或触控笔迹 | 图表文本 |
| 输出产物 | 一个独立的交互 HTML 成品及其源稿 | 渲染在 Markdown 或宿主页面里的 SVG/PNG | 画布场景，通常导出为图片或分享链接 | 渲染后的图片 |
| 复杂多节点可读性 | 校验 schema、几何与路由，并做浏览器检查；支持聚焦与路径高亮 | 取决于渲染器与作者排版 | 取决于手绘质量 | 布局主要靠显式指定或自动算法，没有交互层 |
| 交互探索 | 聚焦、上下游追踪、路径高亮、源码卡 | 通常为静态图 | 导出后为静态图 | 通常为静态图 |
| 一页式解答 | 文字、表格、步骤、图表、代码与已验证图表面板 | 不支持 | 不支持 | 不支持 |
| 运行环境 | 创作需要能读写文件并运行 Node.js 的 Agent，阅读只需浏览器 | 宿主提供渲染器 | 浏览器或客户端 | 渲染器或服务端 |
| 最适合的场景 | Agent 生成、有证据链的图表与一页式技术解答 | Markdown 里的小型示意图 | 实时视觉讨论 | 纳入版本控制的文本图表 |

这张表说的是默认强项，不是绝对边界。熟练的作者能把 Mermaid 排得很漂亮，一张手绘 Excalidraw 草图也常常比正式图表更快讲清问题。关键是让工具匹配工作，而不是评出赢家。

<span id="boundaries" class="section-anchor" aria-hidden="true"></span>

## 什么时候不该选 Archify

- **选 Mermaid**：图不大、必须直接渲染在 GitHub 或文档站里，而且最好保持为几行可编辑文本。大多数 README 示意图，Mermaid 仍然是阻力最小的选择。
- **选 Excalidraw**：价值就在多人一起画、风格随意，或者参与者根本不愿意写图表语法。
- **选 PlantUML 或 D2**：团队已经把图表当作文本管理，希望在代码评审里看到确定性 diff，并在 CI 里渲染。PlantUML 对 UML 记号的覆盖也比 Archify 的类图、时序图模式更完整。
- **选 BI 或可观测性工具**：问题本身是实时指标、仪表盘或链路追踪。Archify 输出的是编写好的成品，不是实时监控界面。
- **选托管协作服务**：需要多人同时编辑同一张图并管理权限。Archify 不是托管编辑器。

同样地，Archify 不承诺自动解析全部 Mermaid 语法，不自动发现系统结构，也不能证明图表与生产行为一致。校验通过只说明编写出的成品符合检查，不证明每项业务判断为真。

<span id="workflows" class="section-anchor" aria-hidden="true"></span>

## 三个高频工作流

### 1. 已有的 Mermaid 图越画越乱

把 Mermaid 源码贴给配置好的 Agent，让它按关系重新编写为 Archify 的 workflow 或 architecture 图。[Mermaid 输入指南](agent-diagrams.html#mermaid-input)给了一个四步示例、可直接复制的提示词，以及接受结果前要核对的内容。然后打开[从 workflow 描述开始](start.html?type=workflow&input=description)，换成你自己的范围明确的提示词。

这不是无损转换。Agent 读懂关系后重新编写 JSON，样式、布局指令和回调不应假定会自动保留。

### 2. 不想再手工从代码库画框

让 Agent 只追踪某一个请求或任务在仓库里的路径，说明它检查的提交版本，并区分运行时组件与构建工具。[MCO 运行时案例](cases/mco-runtime.html)是一个固定提交的完整示例，[MCO 架构成品](cases/mco-runtime.architecture.html)展示了最终图表。[仓库证据清单](agent-diagrams.html#repository-evidence)列出了接受源码依据图表前该问的问题。

### 3. 一张图讲不完一个问题

故障复盘或协议机制往往不止一张图。一页式解答先给结论和理由，再按面板回答子问题，每个面板可以混合文字、表格、步骤、图表、代码和经过校验的图。可以看 [P99 尾延迟一页式解答](cases/explainer/p99-tail-latency.html)和[首次 TLS 访问一页式解答](cases/explainer/tls-first-visit.html)。这些是已经记录的示例成品，不是即时生成。

<span id="limits" class="section-anchor" aria-hidden="true"></span>

## 选 Archify 之前先确认

- 你是否有一个能读写文件、运行 Node.js 的 Agent 环境？
- 输入是否不止是图表语法——而是一段描述、一份草稿或代码库证据？
- 读者是否需要交互、源码出处，或结论先行的文字解答？
- 你是否能接受交付独立 HTML 成品，而不是 Markdown 可直接渲染的代码块？

如果前三个问题的答案都是“否”，先用 Mermaid。如果最后一个条件是硬性要求，Mermaid 就是正确选择。Archify 的优势出现在图表需要被生成、检查、解释，并作为可检查的交付物阅读时。

继续看[场景指南](guide.html)选择图表类型，阅读[Agent 画图指南](agent-diagrams.html)了解检查流程，或者直接[开始安装](start.html)到你的 Agent。
