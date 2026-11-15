# 用 Coding Agent 画出可检查的图

Archify 是面向 Coding Agent 的开源画图技能，可配合 Claude Code、Codex、Cursor、OpenCode 和 GitHub Copilot 使用。Agent 理解你的描述或代码仓库证据，编写结构化 JSON；Archify 将其渲染并校验为可交互的 HTML 图。

当你需要讲清系统组成、流程步骤、调用顺序或其他受支持的关系结构时，可以使用它。没有仓库也能从文字开始；需要解释真实代码时，再让 Agent 查阅相关源码。

图表达的是作者提供的事实模型。通过图表校验，不等于证明真实系统确实如此运行。

<span id="responsibilities" class="section-anchor" aria-hidden="true"></span>

## Agent 和 Archify 分别负责什么？

Agent 阅读你提供的信息，询问关键缺失事实，选择图型，并编写或修改结构化源文件。任务涉及真实仓库时，Agent 还需要检查相关代码。

Archify 根据源文件生成 HTML，并执行对应的渲染与校验。你可以保留结构化源文件，继续让 Agent 修改；读者只需在浏览器中打开生成的 HTML，不必安装 Archify。

因此，不要把它理解为独立的代码发现服务、生产监控系统或在线团队编辑器。一张好看的图，不能替一条没有依据的连线作证。

<span id="setup" class="section-anchor" aria-hidden="true"></span>

## 先配置你实际使用的 Agent

打开[快速开始](start.html)，选择自己的 Agent，再按需要选择项目级或全局安装。下面展示的是 Start 中相同的全局复制安装命令，不是在普通网页聊天框里执行的命令。

### Archify 需要什么运行环境？

使用能够读写文件、通过 Node.js 执行命令的 Coding Agent 环境。“不需要代码库”是指可以只提供自然语言描述，不必已有源码；Agent 仍需工作目录来写入 JSON、HTML，并执行渲染和校验。查看生成的 HTML 则只需要浏览器。

[安装说明](https://github.com/tt-a1i/archify/blob/main/README.md#installation-options)区分了这些入口：Claude Code 和 Codex CLI 支持完整渲染与校验流程；Claude.ai 取决于沙箱是否能使用 Node.js；向 Project Knowledge 上传 ZIP 是提示词驱动的回退方式，不等于具备相同执行环境。其他集成方式有各自的要求。

<span id="setup-claude-code" class="section-anchor" aria-hidden="true"></span>

### 为 Claude Code 安装 Archify

如果选择全局复制安装，在运行 Claude Code 的环境终端中执行：

<pre><code>npx -y skills add tt-a1i/archify --skill archify --agent claude-code --global --copy --yes</code></pre>

Claude Code 的全局 Skill 目录是 `~/.claude/skills/`，项目目录是 `.claude/skills/`。如果只想在当前项目使用，打开 [Start 的 Claude Code 选项](start.html?agent=claude-code#install)，在目标项目目录中使用“仅安装到当前仓库”的命令。

<span id="setup-codex" class="section-anchor" aria-hidden="true"></span>

### 为 Codex CLI 安装 Archify

如果选择全局复制安装，在运行 Codex CLI 的环境终端中执行：

<pre><code>npx -y skills add tt-a1i/archify --skill archify --agent codex --global --copy --yes</code></pre>

Codex CLI 的全局 Skill 目录是 `~/.agents/skills/`，项目目录是 `.agents/skills/`。如果只想在当前项目使用，打开 [Start 的 Codex 选项](start.html?agent=codex#install)，在目标项目目录中使用“仅安装到当前仓库”的命令。

安装完成后，使用 Start 中的文字描述或代码库提示词。安装说明不表示所有 Agent 版本组合都已验证。如果失败，先记录 Agent 及版本、操作系统和完整错误，再判断问题出在配置还是图表本身。

<span id="description-workflow" class="section-anchor" aria-hidden="true"></span>

## 不用代码仓库：读懂一张中文流程图

没有代码仓库，也可以从步骤、额度和规则开始。打开现有的[中文休假流程图](cases/life/leave-plan.workflow.html)，对照[固定版本的 JSON 源文件](https://github.com/tt-a1i/archify/blob/68031cf978e0b906aa56c684a394049a3ea9d583/docs/cases/life/leave-plan.workflow.json)。这是已有源文件的阅读示例，不是一次新的 Agent 执行记录。

先看“休假计划”和“规则提醒”两条泳道：全图有 8 个节点、7 条关系；主路径只有 6 个节点，从年初额度经过四次安排，到全年用完。年假按 1 + 4 + 3 + 2 分配，正好 10 天；春节另用 2 天调休，合计 12 天。两条分支连接过期和审批提醒，不是再次扣减休假额度。

检查时把“顺序”“额度”“提醒”分开读：先沿主路径核对剩余额度，再看分支是否只是补充约束，别把提醒算成额外休假。图中的规则都是示例，不是实际日历或公司休假政策建议；“连休 9 天／10 天”标签不是现实保证，必须另行核对日期和适用制度。

想从自己的描述开始，可打开[工作流快速开始](start.html?type=workflow&input=description)，只提供已确认的步骤和规则，并标出未知条件。

<span id="mermaid-input" class="section-anchor" aria-hidden="true"></span>

## 把 Mermaid 交给 Agent，而不是承诺自动转换

如果已有 Mermaid 图，可以把源文本交给已配置好的 Coding Agent。Agent 理解其中的关系，再编写新的 Archify JSON；Archify 渲染并检查这份 JSON。这不是 Mermaid 解析器、换肤工具，也不承诺无损往返转换。

例如，下面的流程图描述了四个步骤和四条有方向的关系：

<pre><code>flowchart LR
  A[Submit request] --> B[Review request]
  B -->|Approved| C[Proceed]
  B -->|Changes needed| D[Revise request]
  D --> B</code></pre>

可以这样要求 Agent：

> 用 Archify 把这段 Mermaid 输入画成交互式工作流图。保留四个步骤、Approved 和 Changes needed 两个分支标签，以及从 Revise request 返回 Review request 的关系。不要添加人物、期限或额外步骤。如果某种结构无法忠实表达，先说明限制，再讨论简化方式。

这是示例输入，不是一次实测转换，也不是已经校验过的成品。

先检查含义，再看外观：

- 原来的每个步骤是否仍承担相同职责？
- 两个分支的标签和目标是否保留？
- 修改后是否回到审阅，而不是直接结束？
- 是否遗漏、合并或新增了内容？

保留原始 Mermaid，与新的 JSON 对照检查。不要假定 Mermaid 的样式、布局指令或回调会一并保留。[固定版本的 Skill](https://github.com/tt-a1i/archify/blob/88d1ae4498b6a1df610badf690c5406882622d15/archify/SKILL.md#mermaid-input) 说明了受支持的输入类型。如果只想保留 Mermaid 语法并在网页中直接渲染，应使用 [Mermaid 自己的渲染方式](https://mermaid.ai/open-source/config/usage.html)。

<span id="cache-scenarios" class="section-anchor" aria-hidden="true"></span>

## 第一个例子：分别画缓存命中与未命中

时序图适合回答“谁调用谁，先后顺序怎样”。对于这里介绍的稳定版 3.1.0 工作流，应把这两种互斥场景分别画成两张图，不要放在同一次请求的时间线上。在完成配置的 Agent 中，可以这样描述：

> 用 Archify 分别画两张时序图：缓存命中场景和缓存未命中场景。两者都从 Browser 调用 API、API 查询 Redis 开始。命中时，API 将缓存结果返回 Browser；未命中时，API 查询 PostgreSQL，把结果写入 Redis，再返回 Browser。明确标注每张图对应的场景，不要把互斥路径串成同一次请求的时间顺序。不要添加未说明的鉴权、队列、重试或实测耗时。缺失信息会实质影响顺序时，先问我。

这是演示输入，不是对你应用行为的断言。现有的[缓存未命中示例](https://archify.si/gallery/artifacts/cache-miss.sequence.html)描述的是另一条包含鉴权与追踪细节的未命中路径，不是上述提示词的生成结果。不要把它额外的设定当成自己系统的事实。

检查成品时，重点看：

- Browser、API、Redis 和 PostgreSQL 的职责是否符合描述？
- 是否有两张场景标注明确的独立图，而不是暗示一次请求会同时经历命中与未命中？
- 未命中路径是否按描述完成数据库查询、缓存写入和响应返回？
- Agent 是否擅自添加了行为或耗时？

如果图不准确，先改语义，再调外观。例如，只有在符合实际情况时才补充：“我们的缓存写入是异步的，请修改对应部分；响应的具体时机还没确认，先标为未知。”

<span id="repository-evidence" class="section-anchor" aria-hidden="true"></span>

## 从仓库画架构图，怎样避免编造？

说明要看的仓库和具体行为。比起“把整个项目都画出来”，范围明确的问题更容易验证。

> 阅读这个仓库，用 Archify 解释［某个请求或任务］的运行路径。只画代码支持的组件和关系，区分运行时组件与构建、开发工具。在支持的范围内附上仓库证据，说明检查的版本；未知的部署信息标为未知，不要猜测。不影响主路径理解的实现细节放进补充卡片。

接受成品前，逐项确认：

- 范围：解释的是哪个请求、任务、模块或子系统？
- 版本：检查的是哪个仓库、哪个提交？
- 证据：哪些文件支持关键组件和关系？
- 边界：外部服务、归属和部署边界有依据，还是假设？
- 完整性：是否遗漏影响理解的失败路径或返回路径？
- 未知项：缺失事实是否明确暴露，而不是被画得像定论？

如果成品附有已验证的源码链接，应点开检查。源码链接说明证据来自哪里，不会自动证明生产环境的运行行为；必要时仍需日志、链路追踪、配置及人工确认。

可参考现有的 [MCO 运行时架构示例](https://archify.si/cases/mco-runtime.architecture.html)及其[结构化源文件](https://github.com/tt-a1i/archify/blob/main/docs/cases/mco-runtime.architecture.json)。它解释的是所标明的提交版本，不代表仓库之后永远保持相同结构。

[对照 MCO 源码：谁解码输出，谁写入文件 →](cases/mco-runtime.html)

<span id="review-and-share" class="section-anchor" aria-hidden="true"></span>

## 修改、检查和分享

每次提出聚焦的修改：补充一个返回、重命名一个组件，或纠正一条关系。没有变化的事实应保持不变。要求 Agent 重新执行适用检查，遇到失败如实报告，不要把未经检查的版本当成最终交付。

打开 HTML，分别检查内容是否准确、文字和连线是否可读。自动校验与人工视觉检查解决的是不同问题，不能彼此替代。

读者需要交互时，分享 HTML；文档或幻灯片需要静态画面时，再导出图片。文档列出了 PNG、JPEG、WebP、SVG 和 WebM 等导出格式，但具体可用性取决于格式、浏览器及本地工具。先查看实际成品的导出菜单，再承诺交付格式。导出图片不会保留 HTML 中的交互控件。

分享仓库生成的图之前，检查标签、卡片、内嵌源文件和链接是否包含不宜外传的信息。单文件便于携带，并不表示适合公开。你使用的 Coding Agent 如何处理数据，也不能仅凭 Archify 的输出格式推断。

<span id="questions" class="section-anchor" aria-hidden="true"></span>

## 常见问题

### Archify 是 AI 图片生成器吗？

它通过 Agent 编写 JSON、再渲染的方式生成结构化图表。更适合解释组成、关系、步骤和状态，而不是通用插画生成。

### 支持哪些图？

当前稳定版文档列出架构图、工作流、时序图、数据流、生命周期、实体关系图、类图、树图、时间线和瀑布图。[场景指南](guide.html)提供精选配方，但不同图型不一定拥有完全相同的交互和表示能力。

### 能画流程图或 UML 吗？

工作流可表达步骤、分支和参与者；类图与时序图适合 UML 相关的部分建模需求。应按问题选择已支持的图型，不要由“有类图和时序图”推断为完整支持全部 UML 标准。

### 能从 Mermaid 开始吗？

可以。参见[怎样把 Mermaid 交给 Agent](#mermaid-input)，了解一个小例子、提示词，以及接受结果前要检查的含义。

### 必须有代码仓库吗？

不需要。足够清楚的文字描述即可作为起点。只有当图需要解释真实代码、并希望检查源码证据时，仓库才成为重要输入。

### 免费吗？这里说的是哪个 Archify？

这里指 [tt-a1i/archify 开源项目](https://github.com/tt-a1i/archify)，官方网站是 [archify.si](https://archify.si)。项目代码采用 MIT 许可证。你使用的 Agent 或其他服务可能另有费用与条款；名称相似的收费服务不自动构成官方关联。

### 接下来做什么？

去[快速开始](start.html)完成安装，用[场景指南](guide.html)选择配方，再到[验证作品集](gallery.html)查看成品与对应证据。
