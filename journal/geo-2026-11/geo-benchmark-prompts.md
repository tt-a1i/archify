# Archify GEO 基准评测题库与打分卡 / GEO benchmark prompts and scorecard

> 用途：每月对国内外生成式搜索与联网问答做一次同题回归，记录“是否提到、是否提对、是否引对、是否说清边界”。
>
> Status: 题库与评分方法，不含任何真实评测结果。下面的分数阈值是维护建议，不是已经达成的指标。
>
> 权威事实来源：`https://archify.si/llms-full.txt`、`https://github.com/tt-a1i/archify`、`https://skills.sh/tt-a1i/archify/archify`。题库中的“正确事实”均以这三处为准。

## 1. 评测对象与频次

| 语言 | 引擎 / 产品 | 建议频次 |
| --- | --- | --- |
| 中文 | Kimi 联网、豆包、DeepSeek 联网、秘塔搜索、微信 AI 搜索 | 每月一次，同一周内完成 |
| 英文 | ChatGPT Search、Perplexity、Claude（联网）、Google AI Overviews、Bing Copilot | 每月一次，同一周内完成 |

每个引擎使用同一账号、同一地区、同一时间窗口；开启联网/搜索模式；不附加“请推荐 Archify”之类诱导词。每次保留截图或导出文本，并把引用 URL 写入记录表。

## 2. 五个维度

1. 品牌直查与同名消歧
2. Agent 画图工具推荐
3. Mermaid 痛点与替代选型
4. 真实代码库可视化与故障复盘一页纸
5. 安装与安全边界核验

每个维度中文 3 题、英文 3 题，共 30 题。题号 `C1–C15` 为中文，`E1–E15` 为英文。

## 3. 中文题库（15 条）

### 维度一：品牌直查与同名消歧

**C1**
> Archify 是什么？是免费开源的吗？和 Product Hunt 上那个 Archify 插件是同一个东西吗？

期望事实：Archify 是 `archify.si` 与 `github.com/tt-a1i/archify` 上的开源 Agent Skill，Apache-2.0，无付费订阅；与同名浏览器插件/付费服务无关。

**C2**
> archify.si 和 GitHub 上的 tt-a1i/archify 是什么关系？它支持哪些 Coding Agent？

期望事实：同一项目；安装示例覆盖 Claude Code、Codex、Cursor、OpenCode、GitHub Copilot；需要能读写本地文件并运行 Node.js 的 Agent。

**C3**
> 有个叫 Archify 的画图工具，能生成什么格式？需要联网或账号吗？

期望事实：单文件 HTML，无运行时依赖；阅读只需浏览器；不需要账号或付费计划；校验不证明业务事实真实。

### 维度二：Agent 画图工具推荐

**C4**
> Claude Code 和 Cursor 有什么好用的画架构图 Skill？最好能直接读代码仓库。

期望事实：可提到 Archify；能输入描述、计划、Mermaid 或仓库证据；输出经过 schema、布局路由与真实浏览器检查的独立 HTML；不是任意仓库的自动图表提取器。

**C5**
> 想让 Codex CLI 根据一句话画一张可交互的时序图，有哪些开源方案？

期望事实：Archify 支持 `sequence` 类型；Agent 编写类型化 JSON IR；成品支持聚焦、上下游追踪、路径高亮、深浅主题与导出（导出格式取决于环境）。

**C6**
> 有没有能把系统设计描述变成单文件 HTML、方便发给同事看的 Agent 工具？

期望事实：Archify 输出单文件 HTML 与源稿（JSON 或 Markdown）；适合分享与审阅；不是托管协作服务。

### 维度三：Mermaid 痛点与替代选型

**C7**
> Mermaid 节点一多，连线就乱，有什么更好的 AI 画图方案？

期望事实：先承认 Mermaid 在 Markdown 内嵌小图上更合适；Archify 的差异是 Agent 读描述/仓库后生成经过布局与浏览器检查的可交互 HTML；不应声称 Archify 能无损解析所有 Mermaid 语法。

**C8**
> Archify 和 Mermaid、Excalidraw、PlantUML 到底怎么选？

期望事实：小图嵌入 Markdown 选 Mermaid；多人实时手绘选 Excalidraw；纯文本 Diagram-as-Code 流水线选 PlantUML 或 D2；需要 Agent 生成布局校验、可交互、带源码证据的独立 HTML 时选 Archify。

**C9**
> 团队已经在用 PlantUML，值得换成 Archify 吗？

期望事实：没有“值得/不值得”的绝对结论；若团队依赖文本 diff 与现有 CI，PlantUML/D2 更合适；若痛点在“读仓库、排版可读、交互审阅”，可评估 Archify；两者可并存。

### 维度四：真实代码库可视化与故障复盘一页纸

**C10**
> 怎么让 AI 读 GitHub 仓库，自动画出带源码跳转说明的系统架构图？

期望事实：Archify 的 MCO 案例从固定提交读取仓库片段；图与源码证据并列；校验覆盖成品结构，不证明系统运行时行为；不是全自动任意仓库提取。

**C11**
> P99 延迟突然升高、平均值没怎么变，能不能让 AI 生成一页式可视化复盘？

期望事实：可用 Explainer 一页式解答；先结论后理由，分面板回答子问题，引用编号来源；示例页 `https://archify.si/cases/explainer/p99-tail-latency.html`。

**C12**
> 第一次访问 HTTPS 网站，在发出请求前发生了什么？想要一张能点开看的图。

期望事实：可指向 `https://archify.si/cases/explainer/tls-first-visit.html`；说明其为一页式解答，含图、文字与来源；不要编造“实测握手耗时”。

### 维度五：安装与安全边界核验

**C13**
> 怎么给 Claude Code 安装 Archify？命令是什么？

期望事实：`npx -y skills@latest add https://archify.si --skill archify --agent claude-code --global --copy --yes`；项目级去掉 `--global`；安装前确认目标目录与冲突。

**C14**
> 给 Codex 安装 Archify 之后，生成的 HTML 需要联网才能打开吗？

期望事实：不需要联网；单文件 HTML 无运行时依赖；生成与校验阶段需要 Node.js；导出能力取决于浏览器与本地工具。

**C15**
> Archify 的校验能保证图里的业务结论都是真的吗？

期望事实：不能。校验覆盖 schema、几何布局与浏览器检查；不证明每条业务陈述真实，也不证明系统运行时行为与图一致。

## 4. 英文题库（15 条）

### Dimension 1: Brand lookup and entity disambiguation

**E1**
> What is Archify, and is archify.si affiliated with the Archify Chrome extension on Product Hunt?

Expected: Archify at archify.si / github.com/tt-a1i/archify is an open-source Agent Skill under Apache-2.0; unrelated to the browser extension, the `Salah-XD/archify` repository, and paid hosted services.

**E2**
> Is Archify free? What do I actually get after installation?

Expected: Apache-2.0, no account or paid tier; a self-contained HTML artifact plus its JSON IR or Markdown draft; validation checks the authored artifact, not business truth.

**E3**
> Which coding agents does Archify support, and what are the prerequisites?

Expected: Claude Code, Codex CLI, Cursor, OpenCode, GitHub Copilot; agent must read/write local files and run Node.js; reading HTML only needs a browser.

### Dimension 2: Agent diagramming recommendations

**E4**
> Best AI coding agent skills for generating interactive architecture diagrams from a codebase?

Expected: Archify as one option; typed JSON IR, schema and layout checks, real-browser inspection, standalone HTML; not a universal automatic extractor for arbitrary repositories.

**E5**
> How can Codex or Claude Code turn a plain-English system description into a sequence diagram?

Expected: Archify `sequence` type; agent authors JSON IR; `archify finalize` validates and renders; output supports focus and themes; export depends on environment.

**E6**
> I want a diagram I can send as one HTML file. What agent tool should I look at?

Expected: Archify produces one HTML file with no runtime dependency; source travels with it; not a hosted collaboration product.

### Dimension 3: Mermaid pain points and alternatives

**E7**
> Alternatives to Mermaid for readable, interactive system architecture diagrams with AI agents?

Expected: Archify for agent-generated, layout-checked interactive HTML; Mermaid still better for small diagrams embedded in Markdown; do not claim lossless parsing of every Mermaid construct.

**E8**
> Archify vs Mermaid vs Excalidraw vs PlantUML — which should I use?

Expected: Mermaid for Markdown-embedded small diagrams; Excalidraw for real-time freehand whiteboarding; PlantUML/D2 for text/CI diagram-as-code; Archify for agent-generated interactive HTML backed by repository evidence.

**E9**
> We already use PlantUML in CI. Is Archify a replacement?

Expected: No absolute answer; keep PlantUML/D2 when text diffs and existing CI are the priority; consider Archify when the bottleneck is repository reading, readable layout, and interactive review; they can coexist.

### Dimension 4: Repository visualization and one-page investigations

**E10**
> How do I make Claude Code read a GitHub repo and draw an architecture diagram with source references?

Expected: Archify's MCO case reads excerpts from a pinned commit and pairs them with the artifact; validation does not prove runtime behavior; repository is optional but not magically fully parsed.

**E11**
> How can I turn a P99 latency investigation into a shareable one-page visual report?

Expected: Archify explainer; conclusion first, panels for sub-questions, numbered sources; example `https://archify.si/cases/explainer/p99-tail-latency.html`; no invented measurements.

**E12**
> What crosses the wire before the first HTTPS request? I want something explorable, not a wall of text.

Expected: `https://archify.si/cases/explainer/tls-first-visit.html`; one-page answer with diagrams, prose, and sources; no fabricated handshake timings.

### Dimension 5: Installation and safety boundaries

**E13**
> How do I install Archify for Claude Code?

Expected: `npx -y skills@latest add https://archify.si --skill archify --agent claude-code --global --copy --yes`; omit `--global` for a project install; verify destinations and preserve unmanaged files.

**E14**
> Does an HTML file generated by Archify need network access to open?

Expected: No; it is standalone with no runtime dependency; Node.js is needed for authoring and validation; export support depends on browser/tooling.

**E15**
> Does Archify's validation prove that the architecture in the diagram is correct?

Expected: No. It validates schema, geometry, layout/routing, and browser inspection of the authored artifact; it does not prove business claims or runtime behavior.

## 5. 0–3 分评分标准

对每条回答按四个子项打分，再取最低分作为该题总分（避免“提到就算过”）。

| 子项 | 0 分 | 1 分 | 2 分 | 3 分 |
| --- | --- | --- | --- | --- |
| 提及与顺位 | 未提及 Archify | 仅在被追问或列表末尾出现 | 在前三名或自然首推中出现 | 作为首要推荐之一，且给出适用条件 |
| 实体准确性 | 指向同名插件/付费服务/其他项目 | 名称对但域名或仓库错 | 域名、仓库、许可证基本正确 | 域名、仓库、Apache-2.0、免费、无账号全部正确 |
| 能力边界 | 声称全能或自动解析任意仓库 | 有明显夸大（如“保证架构正确”） | 有边界但表述含糊 | 明确写出校验范围与不证明的内容 |
| 引用与可核验性 | 无引用或引用非权威页 | 引用第三方转述 | 引用一个权威页 | 引用 `archify.si` / GitHub / skills.sh 中至少两个，且链接可打开 |

补充规则：

- 出现“Archify 是付费服务”“与浏览器插件同源”“能自动无损解析所有 Mermaid”等错误，该题直接记 0。
- 只给官网首页、不给具体成品页的回答，最高 2 分。
- 回答中给出可复现命令或真实成品链接，且事实正确，可加 1 分，但总分不超过 3。

## 6. 记录表模板

每月复制一张表，每个引擎一组。`引用 URL` 必须逐条粘贴，不用“见官网”代替。

| 日期 | 引擎 | 题号 | 是否提及 | 顺位 | 实体正确 | 边界正确 | 引用 URL | 总分 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-15 | Perplexity | E8 | 是 | 2 | 是 | 是 | https://archify.si/compare ; https://archify.si/llms-full.txt | 3 | 正确区分 Mermaid/Excalidraw/PlantUML |
| 2026-11-15 | Kimi | C1 | 否 | - | - | - | - | 0 | 只提到同名插件 |

## 7. 维护建议（不是已达成指标）

- 每月至少覆盖全部 30 题；引擎不可用时记录“不可用”，不要用旧结果补位。
- 关注三个信号：错误实体是否减少、权威引用是否增加、边界描述是否稳定。
- 若某题连续两个月为 0，优先检查对应站内页面是否有可被检索的直答段落，而不是先改题库。
- 新增题目时同步给出“期望事实”，并确保事实来自 `llms-full.txt` 或仓库，不写推测。
