// Visible homepage answers and FAQPage JSON-LD read this one source so the
// rendered copy and structured data cannot drift. Entries are [en, zh].
export const faqFacts = [
  {
    question: ['What is Archify?', 'Archify 是什么？'],
    answer: ['Archify is an open-source Agent Skill (Apache-2.0) that turns anything you want to understand, plan, or share — an everyday workflow, travel itinerary, complex concept, plan, or repository — into a polished interactive diagram across ten diagram types or a four-style one-page answer with zero syntax to memorize. The agent authors typed JSON or a Markdown draft; Archify runs layout and browser checks and outputs one standalone interactive HTML artifact.', 'Archify 是一个开源 Agent Skill（Apache-2.0），无需手写画图语法，即可把任何你想理解、规划或分享的事（生活日程、旅行路线、科普概念、工作流或代码仓库）快速变成十种原生图型的交互图表或四套排版风格的一页式解答。画图时 Agent 编写类型化 JSON，写一页答案时编写 Markdown 草稿，经防重叠布局与浏览器检查后交付独立可交互 HTML 成品。'],
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
    question: ['Which agents can use it?', '哪些 Agent 可以使用？'],
    answer: ['The installation examples cover Claude Code, Codex, Cursor, OpenCode, and GitHub Copilot. They use the same Archify Skill. Agent access to files, a local Node.js runtime, and any tools needed for the requested export remain part of your environment.', '安装示例覆盖 Claude Code、Codex、Cursor、OpenCode 和 GitHub Copilot，它们使用同一份 Archify Skill。Agent 的文件权限、本地 Node.js 运行时，以及所选导出功能需要的工具，由你的使用环境提供。'],
  },
  {
    question: ['What do I receive, and what are the limits?', '会得到什么？有哪些边界？'],
    answer: ['The primary deliverable is a self-contained HTML file with its source: typed JSON for diagrams or a Markdown draft for one-page answers. Open it in a browser to explore and export; available interactions depend on the artifact type. Validation checks the authored artifact, not the truth of every claim or runtime system behavior. Archify is not a hosted collaboration service or a general-purpose WYSIWYG editor.', '主要交付物是独立 HTML 文件及其源稿：图表使用类型化 JSON，一页式解答使用 Markdown 草稿。在浏览器里可以浏览和导出，具体交互取决于成品类型。校验检查编写出的成品，不证明每项内容的真实性或系统的实际运行行为。Archify 不提供托管协作服务，也不是通用的所见即所得编辑器。'],
  },
];
