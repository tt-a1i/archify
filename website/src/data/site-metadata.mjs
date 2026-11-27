import { canonicalUrl, canonicalOrigin } from './site-urls.mjs';
import { faqFacts } from './faq-facts.mjs';
const descriptions = {
  'cases/mco-runtime': {
    en: ['Archify MCO Runtime Case — Source-backed Architecture', 'Follow pinned MCO source to distinguish provider-output decoding, streamed answer writes and retained artifacts. Read the existing Archify diagram with explicit evidence limits.'],
    zh: ['Archify MCO 运行时案例 — 对照源码阅读架构', '沿固定提交的 MCO 源码对照阅读运行时架构，清晰区分输出解码、流式答案写入与产物保留边界；结合 Archify 已校验交互架构图理解职责拆分、持久化条件与源码证据范围，不依赖运行时追踪。'],
  },
  'agent-diagrams': {
    en: ['Archify Agent Diagramming Guide — Explain Ideas, Plans & Code', 'Turn any plain-language idea, everyday plan, Mermaid draft, or repository into 10 interactive diagram types, 4-style explainers, Story 1080p walkthroughs, PR diffs, or built-in Architecture Diagnosis with Claude Code, Codex, Cursor, OpenCode, or GitHub Copilot.'],
    zh: ['Archify Agent 画图指南 — 从想法、生活规划到代码仓', '用 Claude Code、Codex、Cursor、OpenCode 或 GitHub Copilot 把自然语言想法、生活流程、Mermaid 草稿或代码仓库快速变成十种可交互 HTML 图、四风格一页式解答、Story 1080p 演练视频与内置架构诊断。'],
  },
  compare: {
    en: ['Archify vs Mermaid, Excalidraw, PlantUML & D2 — Mermaid Alternatives for AI Coding Agents', 'Looking for a Mermaid or draw.io alternative for interactive architecture diagrams with Claude Code, Cursor, or Codex? Compare Archify with Mermaid, draw.io, Excalidraw (including MCP), PlantUML, D2, LikeC4, and Eraser.io across 10 diagram types, 4-style explainers, Architecture Diagnosis, Story 1080p video, and honest limits.'],
    zh: ['Archify 对比 draw.io、ProcessOn、Mermaid、Excalidraw、PlantUML 与 D2 — AI 画流程图与架构图选型指南', '寻找比 draw.io、ProcessOn、Mermaid 更适合 Claude Code、Cursor、Codex 的 AI 交互式架构图与流程图工具？全面对比 Archify 与 draw.io、ProcessOn、Mermaid、Excalidraw（含 MCP）、PlantUML、D2、LikeC4、Eraser.io：10 种图型、4 风格一页解答、内置架构诊断与 Story 视频导出。'],
  },
  index: {
    en: ['Archify — Interactive Diagrams, Explainers, Diagnosis & Story Video', 'Open-source (Apache-2.0) AI agent skill turning any idea, everyday plan, concept, Mermaid draft, or codebase into 10 interactive HTML diagram types, 4-style explainers, built-in Architecture Diagnosis, PR walkthroughs, and 1080p Story videos.'],
    zh: ['Archify — 把万物变成可互动的可视化图表与一页式解答', '开源免费（Apache-2.0）的 AI Agent 技能，无需画图语法即可把生活规划、复杂知识、旅行攻略或代码仓库变成独立可交互 HTML：覆盖 10 种原生图型、4 套风格一页式解答、内置架构诊断、Story 1080p 演练视频与 PR 变更可视化。'],
  },
  guide: {
    en: ['Archify Scenario Guide — 10 Diagram Types Beyond Code', 'Choose from 10 native interactive diagram types (architecture, workflow, sequence, dataflow, lifecycle, ERD, class, tree, timeline, waterfall) across everyday plans, concepts, and engineering systems.'],
    zh: ['Archify 场景指南 — 十种原生图型，从生活到系统都能画', '围绕你想讲清的问题选择十种原生可交互图型（架构、工作流、时序、数据流、状态、ER、类图、树图、时间线、瀑布图），覆盖生活规划、知识拆解与软件工程系统，附带开箱即用提示词与校验成品示例。'],
  },
  start: {
    en: ['Archify Start — Install & Create Visual HTML in Moments', 'Install Archify once for Claude Code, Codex, Cursor, OpenCode, or GitHub Copilot and turn a plain-English idea, workflow, or repository into interactive HTML diagrams, explainers, Architecture Diagnosis, or Story videos with zero diagram syntax.'],
    zh: ['Archify 快速上手 — 几分钟装好，一句话画出交互网页', '一键安装 Archify 到 Claude Code、Codex、Cursor、OpenCode 与 GitHub Copilot，零画图语法起步，用一句自然语言或仓库路径快速产出十种交互 HTML 图表、一页式解答、架构诊断与 Story 演练视频。'],
  },
  gallery: {
    en: ['Archify Proof Lab — Validated Diagram Gallery', 'Explore validated Archify diagrams across all 10 native types and 4-style one-page answers with interactive HTML, their JSON or Markdown sources, and recorded checks. Automated validation and human visual review appear separately.'],
    zh: ['Archify 验证作品集 — 可探索的图表成品', '探索经过结构与布局自动检查的 Archify 真实验证作品集：覆盖全部 10 种原生图型与 4 套排版风格一页式解答，每件离线可交互 HTML 均附对应 JSON 或 Markdown 源码与检查记录，自动验证与人工视觉评审分列展示。'],
  },
  community: {
    en: ['Archify Community — Packages Built on Archify', 'Explore independent packages built on Archify: skills, recipes, themes, locales, and CLI wrappers, with source, license, compatibility, and evidence.'],
    zh: ['Archify 社区 — 基于 Archify 的独立包', '浏览围绕 Archify 构建的独立社区生态包，涵盖 Agent 技能、场景配方、视觉主题、多语言本地化包与 CLI 封装，逐一标明开源仓库地址、许可证协议、版本兼容性与实测验证证据，方便按需选用。'],
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
      { '@type': 'SoftwareApplication', '@id': softwareId, name: 'Archify', url: `${canonicalOrigin}/`, applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Linux, Windows', isAccessibleForFree: true, license: 'https://www.apache.org/licenses/LICENSE-2.0', softwareVersion: version, description: descriptions.index[lang][1], offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, sameAs: ['https://github.com/tt-a1i/archify', 'https://skills.sh/tt-a1i/archify/archify'], subjectOf: [
        { '@type': 'NewsArticle', name: 'GitHub最热架构图Agent，开发者故事看哭了', url: 'https://www.qbitai.com/2026/09/482469.html', datePublished: '2026-09-01', inLanguage: 'zh-Hans', publisher: { '@type': 'Organization', name: 'QbitAI (量子位)' } },
        { '@type': 'NewsArticle', name: 'GitHub三榜第一背后，一个“专升本”工程师的十年', url: 'https://www.qbitai.com/2026/09/488519.html', datePublished: '2026-09-13', inLanguage: 'zh-Hans', publisher: { '@type': 'Organization', name: 'QbitAI (量子位)' } },
      ] },
      ...(articlePages.includes(page) ? [{ '@type': 'TechArticle', '@id': `${canonical}#article`, url: canonical, headline: title, description, inLanguage: language(lang), isPartOf: { '@id': websiteId }, about: { '@id': softwareId } }] : []),
      ...faq,
    ] },
  };
}
