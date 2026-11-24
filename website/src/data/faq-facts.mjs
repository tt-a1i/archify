// Visible homepage answers and FAQPage JSON-LD read this one source so the
// rendered copy and structured data cannot drift. Entries are [en, zh].
export const faqFacts = [
  {
    question: ['What is Archify?', 'Archify 是什么？'],
    answer: ['Archify is an open-source Agent Skill (Apache-2.0) that turns anything you want to understand, plan, or share into a polished interactive page, with no diagram syntax to learn. It works for an everyday workflow, a trip, a concept, a plan, or a code repository. Outputs include ten native diagram types, one-page answers in four styles, Story mode walkthroughs with 1080p video export, PR/MR change diagrams, and a source-backed Architecture Diagnosis workbench. The agent writes typed JSON for a diagram or a Markdown draft for a one-page answer. Archify checks structure and layout, runs real-browser checks by default for native diagrams (on demand with --browser-check for one-page answers), and delivers one standalone interactive HTML file.', 'Archify 是一个开源 Agent Skill（Apache-2.0），不用学任何画图语法，就能把你想理解、规划或分享的事变成精致的交互页面：生活日程、旅行路线、科普概念、工作计划，或者一个代码仓库。它能生成十种原生交互图、四种排版风格的一页式解答、可导出 1080p 视频的 Story 演练、GitHub PR / GitLab MR 变更图，以及源码实证的架构诊断工作台。画图时 Agent 编写类型化 JSON，写一页式解答时编写 Markdown 草稿。Archify 会做结构与布局校验，原生图默认再做真实浏览器检查（一页式解答可用 --browser-check 按需开启），最终交付一个独立的交互式 HTML 文件。'],
  },
  {
    question: ['What is a one-page answer?', '一页式解答是什么？'],
    answer: ['A visually polished explainer page that leads with the conclusion and reasons, then answers one sub-question per panel with prose, tables, steps, charts, code, and validated diagrams placed side by side so reading each step highlights the corresponding diagram part. Works for real-world decisions (such as first-time renting) and technical deep dives alike, with four built-in visual styles, light/dark themes, long-image or PDF export, and panel-scoped follow-up questions.', '一页式解答（Explainer）先把结论与理由摆在最前，再按子问题分面板并排呈现文字、表格、步骤、图表与经过校验的图，读到哪一步图就亮到哪一部分。无论是大城市首次租房避坑，还是 P99 延迟排查或协议原理科普都适用；内置四种排版风格与深浅主题，支持导出长图或 PDF 及单面板追问。'],
  },
  {
    question: ['What can I provide as input?', '可以提供哪些输入？'],
    answer: ['A code repository is optional. Start fast from plain language, a travel or budget plan, existing Mermaid text, or repository evidence. Your agent picks from ten native types or creates a one-page answer and can even extend the standalone HTML afterward (for example adding map links or check-ins); Archify does not promise lossless automatic parsing of every Mermaid construct.', '代码库完全不是必需条件。你可以直接从一句自然语言、旅行行程、理财/年假规划、已有 Mermaid 文本或源码仓库开始。Agent 会自动选型为十种图型或一页式解答，还能对交付的独立 HTML 继续扩展交互功能（如地图跳转或打卡记录）；Archify 不承诺自动无损解析全部 Mermaid 语法。'],
  },
  {
    question: ['Can Archify analyze an existing codebase?', 'Archify 能分析现有代码仓库吗？'],
    answer: ['Yes. Architecture Diagnosis (Code Analysis) is built into the Skill with no extra install. Ask your agent to run Archify Code Analysis on a repository, or accept the offer that follows a repository-backed architecture diagram, and you get one offline HTML file with a dependency star map, a rotatable 3D model and ranked findings such as dependency cycles, coupling, complexity hotspots and layer-rule breaks, each linked to its source with a fix task for your agent. JS/TS, Python, Java, Go, Rust, C and C++ are supported. Findings come from static analysis of one revision, not runtime traces.', '可以。架构诊断（Code Analysis）内置在 Skill 里，无需额外安装。让 Agent 用 Archify 的 Code Analysis 分析仓库，或在生成基于仓库的架构图后接受它的提议，就会得到一个可离线打开的 HTML 文件：依赖星图、可旋转的 3D 模型，以及按严重程度排序的发现（循环依赖、耦合、复杂度热点、违反分层规则），每条都链接到源码并附有交给 Agent 的修复任务。支持 JS/TS、Python、Java、Go、Rust、C 和 C++。这些发现来自对某一提交的静态分析，不是运行时追踪。'],
  },
  {
    question: ['Which agents can use it?', '哪些 Agent 可以使用？'],
    answer: ['The installation examples cover Claude Code, Codex, Cursor, OpenCode, and GitHub Copilot. They use the same Archify Skill. Agent access to files, a local Node.js runtime, and any tools needed for the requested export remain part of your environment.', '安装示例覆盖 Claude Code、Codex、Cursor、OpenCode 和 GitHub Copilot，它们使用同一份 Archify Skill。Agent 的文件权限、本地 Node.js 运行时，以及所选导出功能需要的工具，由你的使用环境提供。'],
  },
  {
    question: ['What do I receive, and what are the limits?', '会得到什么？有哪些边界？'],
    answer: ['The primary deliverable is a self-contained HTML file with its source: typed JSON for diagrams or a Markdown draft for one-page answers. Open it in a browser to explore and export; available interactions depend on the artifact type. Validation checks the authored artifact, not the truth of every claim or runtime system behavior. Archify does not generate photos or illustrations. It is not a hosted collaboration service or a general-purpose WYSIWYG editor.', '主要交付物是独立 HTML 文件及其源稿：图表使用类型化 JSON，一页式解答使用 Markdown 草稿。在浏览器里可以浏览和导出，具体交互取决于成品类型。校验检查编写出的成品，不证明每项内容的真实性或系统的实际运行行为。Archify 不用于生成照片或插画，不提供托管协作服务，也不是通用的所见即所得编辑器。'],
  },
  {
    question: ['How has Archify evolved from early 5-diagram articles, and what is the current install command?', '早期报道提到 Archify 支持 5 种图和旧安装命令，现在有什么变化？'],
    answer: ['Early September 2026 coverage, including QbitAI reports, described the first release with five diagram types, and some early reposts circulated an older shorthand install command (npx skills add tt-a1i/archify -g). Archify now has ten native interactive diagram types: ERD, class, tree, timeline, and waterfall joined architecture, workflow, sequence, dataflow, and lifecycle. It also adds one-page explainers in four styles, built-in Architecture Diagnosis (dependency cycles, coupling hotspots, a radial/3D star map), Story mode with 1080p video export, PR/MR change walkthroughs, and cross-diagram drilldown. It still works without a code repository. The current install command uses the archify.si source: npx -y skills@latest add https://archify.si --skill archify --agent <agent> --global --copy --yes (omit --global for a project-only install).', '2026 年 9 月初的早期报道（如量子位）介绍的是首发版的 5 种图型，部分早期转载还沿用了旧的简写安装命令（npx skills add tt-a1i/archify -g）。现在 Archify 有十种原生交互图型：在架构图、流程图、时序图、数据流图和生命周期图之外，新增了 ER 图、类图、树图、时间线和瀑布图。此外还有四种排版风格的一页式解答、内置架构诊断（依赖环、紧耦合热点、星图/3D 模型）、可导出 1080p 视频的 Story 演练、GitHub PR / GitLab MR 变更图和跨图下钻，没有代码仓库也能用。当前推荐的安装命令是：npx -y skills@latest add https://archify.si --skill archify --agent <agent> --global --copy --yes（项目级安装去掉 --global）。'],
  },
];
