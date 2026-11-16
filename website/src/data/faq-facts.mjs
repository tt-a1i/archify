// Visible homepage answers and FAQPage JSON-LD read this one source so the
// rendered copy and structured data cannot drift. Entries are [en, zh].
export const faqFacts = [
  {
    question: ['What is Archify?', 'Archify 是什么？'],
    answer: ['Archify is an open-source Agent Skill for turning a system, process, or plan into a diagram, or a question into a one-page answer. For a diagram the agent authors typed JSON; for a page, a Markdown draft. Archify renders and validates a self-contained interactive HTML artifact. The Skill and renderers are licensed under Apache-2.0.', 'Archify 是一个开源 Agent Skill，把系统、流程或计划变成图表，也能把一个问题变成一页式解答。画图时 Agent 编写类型化 JSON，写一页答案时编写 Markdown 草稿，再由 Archify 渲染、校验并交付独立的交互 HTML 成品。Skill 和渲染器采用 Apache-2.0 许可证。'],
  },
  {
    question: ['What is a one-page answer?', '一页式解答是什么？'],
    answer: ['A page that leads with the conclusion and its reasons, then answers one question per panel with prose, tables, steps, charts, code and validated diagrams. Claims cite numbered sources, repository excerpts are read from a pinned commit, and blank chart data is rejected rather than drawn as zero. Readers can switch between four styles, export a long image or PDF, and ask about a single panel.', '一页先给结论和理由，再按问题分成几个面板，用文字、表格、步骤、图表、代码和经过校验的图讲清楚。结论标注编号来源，仓库代码从固定的提交读取，图表数据留空会报错而不是画成零。读者可以在四种样式间切换、导出长图或 PDF，也可以只追问其中一个面板。'],
  },
  {
    question: ['What can I provide as input?', '可以提供哪些输入？'],
    answer: ['Start with a plain-language description, a plan, existing Mermaid text, or repository evidence. A repository is optional. Your agent interprets the input and creates typed JSON for a diagram or a Markdown draft for a one-page answer; Archify does not promise automatic parsing of every Mermaid construct. Missing facts should be marked or clarified.', '可以从自然语言描述、计划、已有 Mermaid 文本或代码库证据开始，代码库并非必需。Agent 理解输入后，为图表创建类型化 JSON，为一页式解答编写 Markdown 草稿；Archify 不承诺自动解析全部 Mermaid 语法。缺失的事实应标明或进一步确认。'],
  },
  {
    question: ['Which agents can use it?', '哪些 Agent 可以使用？'],
    answer: ['The installation examples cover Claude Code, Codex, Cursor, OpenCode, and GitHub Copilot. They use the same Archify Skill. Agent access to files, a local Node.js runtime, and any tools needed for the requested export remain part of your environment.', '安装示例覆盖 Claude Code、Codex、Cursor、OpenCode 和 GitHub Copilot，它们使用同一份 Archify Skill。Agent 的文件权限、本地 Node.js 运行时，以及所选导出功能需要的工具，由你的使用环境提供。'],
  },
  {
    question: ['What do I receive, and what are the limits?', '会得到什么？有哪些边界？'],
    answer: ['The primary deliverable is a self-contained HTML file with its source: typed JSON for diagrams or a Markdown draft for one-page answers. Open it in a browser to explore and export; available interactions depend on the artifact type. Validation checks the authored artifact, not the truth of every claim or runtime system behavior. Archify is not a hosted collaboration service or a general-purpose WYSIWYG editor.', '主要交付物是独立 HTML 文件及其源稿：图表使用类型化 JSON，一页式解答使用 Markdown 草稿。在浏览器里可以浏览和导出，具体交互取决于成品类型。校验检查编写出的成品，不证明每项内容的真实性或系统的实际运行行为。Archify 不提供托管协作服务，也不是通用的所见即所得编辑器。'],
  },
];
