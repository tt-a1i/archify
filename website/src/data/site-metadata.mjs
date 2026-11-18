import { canonicalUrl, canonicalOrigin } from './site-urls.mjs';
import { faqFacts } from './faq-facts.mjs';
const descriptions = {
  'cases/mco-runtime': {
    en: ['Archify MCO Runtime Case — Source-backed Architecture', 'Follow pinned MCO source to distinguish provider-output decoding, streamed answer writes and retained artifacts. Read the existing Archify diagram with explicit evidence limits.'],
    zh: ['Archify MCO 运行时案例 — 对照源码阅读架构', '沿固定版本的 MCO 源码区分输出解码、流式答案写入与产物保留，结合已有 Archify 架构图理解职责、持久化条件与证据边界。'],
  },
  'agent-diagrams': {
    en: ['Archify Agent Diagramming Guide — Explain Ideas, Plans & Code', 'Turn any plain-language idea, everyday plan, Mermaid draft, or repository into 10 interactive diagram types or a 4-style one-page explainer with Claude Code, Codex, Cursor, OpenCode, or GitHub Copilot.'],
    zh: ['Archify Agent 画图指南 — 从想法、生活规划到代码仓', '用 Claude Code、Codex、Cursor 等 Agent 把自然语言想法、生活流程、Mermaid 草稿或代码仓库快速变成十种可交互 HTML 图或四套风格的一页式解答。'],
  },
  compare: {
    en: ['Archify vs Mermaid, Excalidraw and PlantUML — How to Choose', 'Compare Archify with Mermaid, Excalidraw, PlantUML and D2: speed, zero syntax barrier, 10 diagram types, 4-style synced one-page explainers, visual polish, everyday or codebase scope, and honest limits.'],
    zh: ['Archify、Mermaid、Excalidraw、PlantUML 怎么选？', '全面对比 Archify 与 Mermaid、Excalidraw、PlantUML、D2：创作门槛与速度、生活/科普/代码全场景覆盖、10 种图型、4 风格图文联动一页式解答、防重叠颜值与适用边界。'],
  },
  index: {
    en: ['Archify — Interactive Diagrams & One-Page Explainers for Anything', 'Open-source (Apache-2.0) AI agent skill turning any idea, everyday plan, concept, Mermaid draft, or codebase into 10 polished interactive HTML diagram types or 4-style conclusion-first explainers — no syntax to memorize.'],
    zh: ['Archify — 把万物变成可互动的可视化图表与一页式解答', '开源免费（Apache-2.0）的 AI Agent 技能，无需画图语法即可将生活规划、复杂知识、旅行攻略或代码仓库快速生成高颜值单文件交互 HTML（10 种图型与 4 套排版风格 Explainer）。'],
  },
  guide: {
    en: ['Archify Scenario Guide — 10 Diagram Types Beyond Code', 'Choose from 10 native interactive diagram types (architecture, workflow, sequence, dataflow, lifecycle, ERD, class, tree, timeline, waterfall) across everyday plans, concepts, and engineering systems.'],
    zh: ['Archify 场景指南 — 十种原生图型，从生活到系统都能画', '围绕你想讲清的问题选择十种原生图型（架构、工作流、时序、数据流、状态、ER、类图、树图、时间线、瀑布图），涵盖生活规划、知识拆解与工程系统。'],
  },
  start: {
    en: ['Archify Start — Install & Create Visual HTML in Moments', 'Install Archify once for Claude Code, Codex, Cursor, OpenCode, or GitHub Copilot and turn a plain-English idea, workflow, or repository into interactive HTML with zero diagram syntax.'],
    zh: ['Archify 快速上手 — 几分钟装好，一句话画出交互网页', '一键安装 Archify 到 Claude Code、Codex、Cursor 等 Agent，不用学画图语法，用自然语言快速生成可交互 HTML 图表或一页式解答。'],
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
const websiteId = `${canonicalOrigin}/#website`;
const softwareId = `${canonicalOrigin}/#software`;
const sourceId = `${canonicalOrigin}/#source`;
const articlePages = ['agent-diagrams', 'cases/mco-runtime', 'compare'];
const language = lang => (lang === 'zh' ? 'zh-Hans' : 'en');
function answerFact(fact, lang) {
  const index = lang === 'zh' ? 1 : 0;
  return { question: fact.question[index], answer: fact.answer[index] };
}
export function pageMetadata(page, lang, version) {
  const [title, description] = descriptions[page][lang];
  const canonical = canonicalUrl(page, lang);
  const faq = page === 'index' ? [{
    '@type': 'FAQPage',
    '@id': `${canonicalOrigin}/#faq-${language(lang)}`,
    url: canonical,
    inLanguage: language(lang),
    isPartOf: { '@id': websiteId },
    about: { '@id': softwareId },
    mainEntity: faqFacts.map(fact => {
      const { question, answer } = answerFact(fact, lang);
      return { '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } };
    }),
  }] : [];
  return { title, description, canonical, image: `${canonicalOrigin}/assets/archify-social-preview.png`,
    schema: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', '@id': websiteId, url: `${canonicalOrigin}/`, name: 'Archify', inLanguage: ['en', 'zh-Hans'] },
      { '@type': 'SoftwareSourceCode', '@id': sourceId, name: 'Archify', codeRepository: 'https://github.com/tt-a1i/archify', url: 'https://github.com/tt-a1i/archify', license: 'https://github.com/tt-a1i/archify/blob/main/LICENSE', version, programmingLanguage: 'JavaScript', description: descriptions.index[lang][1], targetProduct: { '@id': softwareId } },
      { '@type': 'SoftwareApplication', '@id': softwareId, name: 'Archify', url: `${canonicalOrigin}/`, applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Linux, Windows', isAccessibleForFree: true, license: 'https://www.apache.org/licenses/LICENSE-2.0', softwareVersion: version, description: descriptions.index[lang][1], offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, sameAs: ['https://github.com/tt-a1i/archify', 'https://skills.sh/tt-a1i/archify/archify'] },
      ...(articlePages.includes(page) ? [{ '@type': 'TechArticle', '@id': `${canonical}#article`, url: canonical, headline: title, description, inLanguage: language(lang), isPartOf: { '@id': websiteId }, about: { '@id': softwareId } }] : []),
      ...faq,
    ] },
  };
}
