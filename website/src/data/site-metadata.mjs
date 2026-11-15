import { canonicalUrl, canonicalOrigin } from './site-urls.mjs';
const descriptions = {
  'cases/mco-runtime': {
    en: ['Archify MCO Runtime Case — Source-backed Architecture', 'Follow pinned MCO source to distinguish provider-output decoding, streamed answer writes and retained artifacts. Read the existing Archify diagram with explicit evidence limits.'],
    zh: ['Archify MCO 运行时案例 — 对照源码阅读架构', '沿固定版本的 MCO 源码区分输出解码、流式答案写入与产物保留，结合已有 Archify 架构图理解职责、持久化条件与证据边界。'],
  },
  'agent-diagrams': {
    en: ['Archify Agent Diagramming Guide — Author, Review, Share', 'Create diagrams with Claude Code, Codex, Cursor and other coding agents. Learn bounded prompts, repository evidence, review checks and safe HTML sharing with Archify.'],
    zh: ['Archify Agent 画图指南 — 编写、检查与分享', '用 Claude Code、Codex、Cursor 等 Coding Agent 画图：从范围明确的提示词和仓库证据开始，检查事实、修改图表，再安全分享 Archify HTML 成品。'],
  },
  index: {
    en: ['Archify — AI Agent Skill for Interactive Diagrams and One-Page Answers', 'Archify is an Apache-2.0-licensed AI agent skill for validated HTML diagrams and conclusion-first one-page answers from descriptions or code, with interactive exploration, cited sources and browser export.'],
    zh: ['Archify — 用自然语言生成交互式图表和一页式解答', 'Archify 是采用 Apache-2.0 许可证的 AI Agent 技能，可从自然语言或源码生成经过验证的独立 HTML 图表和结论在前、标注出处的一页式解答，支持交互探索与浏览器导出。'],
  },
  guide: {
    en: ['Archify Scenario Guide — Choose the Right Diagram', 'Choose an Archify diagram recipe for your question. Browse evidence checklists, use cases, boundaries, and prompts linked to the recipe source.'],
    zh: ['Archify 场景指南 — 选择合适的图表', '从需要解释的问题出发选择图表配方，查看与 Archify 配方源码一致的场景、证据清单、使用边界和可复制提示词。'],
  },
  start: {
    en: ['Archify Start — Create Your First Diagram', 'Install Archify for your AI agent and create a diagram from a description or code. Choose your agent, diagram type, and input to copy a command and prompt.'],
    zh: ['Archify 快速上手 — 创建第一张图', '为你的 AI Agent 安装 Archify 技能，从自然语言或代码仓库创建图表。选择 Agent、图表类型和输入方式，复制对应的命令与提示词。'],
  },
  gallery: {
    en: ['Archify Proof Lab — Validated Diagram Gallery', 'Explore validated Archify diagrams and one-page answers with interactive HTML, their JSON or Markdown sources, and recorded checks. Automated validation and human visual review appear separately.'],
    zh: ['Archify 验证作品集 — 可探索的图表成品', '探索经过验证的 Archify 图表和一页式解答，查看交互式 HTML 成品、对应的 JSON 或 Markdown 源码与检查记录。自动验证与人工视觉评审分别列出。'],
  },
  community: {
    en: ['Archify Community — Packages Built on Archify', 'Explore independent packages built on Archify: skills, recipes, themes, locales, and CLI wrappers, with source, license, compatibility, and evidence.'],
    zh: ['Archify 社区 — 基于 Archify 的独立包', '浏览基于 Archify 的独立社区包，包括技能、配方、主题、语言包与 CLI 封装，并查看源码、许可证、兼容性和验证证据。'],
  },
};
export function pageMetadata(page, lang, version) {
  const [title, description] = descriptions[page][lang];
  const canonical = canonicalUrl(page, lang);
  return { title, description, canonical, image: `${canonicalOrigin}/assets/archify-social-preview.png`,
    schema: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', '@id': `${canonicalOrigin}/#website`, url: `${canonicalOrigin}/`, name: 'Archify', inLanguage: ['en', 'zh-Hans'] },
      { '@type': 'SoftwareSourceCode', '@id': `${canonicalOrigin}/#source`, name: 'Archify', codeRepository: 'https://github.com/tt-a1i/archify', url: 'https://github.com/tt-a1i/archify', license: 'https://github.com/tt-a1i/archify/blob/main/LICENSE', version, programmingLanguage: 'JavaScript', description: descriptions.index[lang][1] },
      ...(['agent-diagrams', 'cases/mco-runtime'].includes(page) ? [{ '@type': 'TechArticle', '@id': `${canonical}#article`, url: canonical, headline: title, description, inLanguage: lang === 'zh' ? 'zh-Hans' : 'en', isPartOf: { '@id': `${canonicalOrigin}/#website` }, about: { '@id': `${canonicalOrigin}/#source` } }] : []),
    ] },
  };
}
