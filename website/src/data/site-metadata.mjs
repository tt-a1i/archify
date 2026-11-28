import { canonicalUrl, canonicalOrigin } from './site-urls.mjs';
import { faqFacts } from './faq-facts.mjs';
const descriptions = {
  'cases/mco-runtime': {
    en: ['Archify MCO Runtime Case — Source-backed Architecture', 'Follow output decoding, streamed answer writes, and artifact retention in the Archify diagram and pinned MCO source at 9f1a1cf. Evidence is static only.'],
    zh: ['Archify MCO 运行时案例 — 对照源码阅读架构', '想知道 MCO 怎样解码输出、流式写入答案，以及何时保留产物？打开 Archify 交互架构图，对照固定提交 9f1a1cf 的源码，查看调用运行时与报告写入器各自负责什么，并追踪关闭持久化后临时目录如何清理。文中给出源码链接和复核步骤，结论仅限该版本的静态证据。'],
  },
  'agent-diagrams': {
    en: ['Archify Agent Diagramming Guide — Explain Ideas, Plans & Code', 'Use Archify with Claude Code, Codex, or Cursor. Learn when to use each of 10 diagram types, explainers, Architecture Diagnosis, and PR walkthroughs.'],
    zh: ['Archify Agent 画图指南 — 从想法、生活规划到代码仓', '用 Claude Code、Codex、Cursor、OpenCode 或 GitHub Copilot 把自然语言想法、生活流程、Mermaid 草稿或代码仓库快速变成十种可交互 HTML 图、四风格一页式解答、Story 1080p 演练视频与内置架构诊断。'],
  },
  compare: {
    en: ['Archify | Mermaid Alternatives for AI Coding Agents', 'Compare Archify with Mermaid, draw.io, Excalidraw, PlantUML, D2, LikeC4, and Eraser.io. See its 10 diagram types and where each tool is a better fit.'],
    zh: ['Archify 对比 draw.io、ProcessOn、Mermaid：AI 流程图怎么选', '流程图和架构图该用什么工具？对照 Archify 与 draw.io、ProcessOn、Mermaid、Excalidraw、PlantUML、D2、LikeC4、Eraser.io，了解 10 种图型和架构诊断的用途，查看实际成品，判断何时选择手动画图、文本绘图或 Agent 工作流。'],
  },
  index: {
    en: ['Archify — Interactive Diagrams, Explainers, Diagnosis & Story Video', 'An open-source Agent Skill (Apache-2.0) with offline HTML, 10 diagram types, explainers, Architecture Diagnosis, Story video export, and PR walkthroughs.'],
    zh: ['Archify — 把万物变成可互动的可视化图表与一页式解答', '开源免费（Apache-2.0）的 AI Agent 技能，无需画图语法即可把生活规划、复杂知识、旅行攻略或代码仓库变成独立可交互 HTML：覆盖 10 种原生图型、4 套风格一页式解答、内置架构诊断、Story 1080p 演练视频与 PR 变更可视化。'],
  },
  guide: {
    en: ['Archify Scenario Guide — 10 Diagram Types Beyond Code', 'Choose among 10 interactive diagram types for everyday plans, concepts, and software systems. Copy a starter prompt and inspect a validated example.'],
    zh: ['Archify 场景指南 — 十种原生图型，从生活到系统都能画', '不知道该用哪种图来解释手头的问题？按生活规划、知识拆解和软件工程场景选择图型，了解架构、工作流、时序、数据流、状态、ER、类图、树图、时间线和瀑布图各自适合表达什么。复制入门提示词交给 Agent，再对照已校验的交互成品，判断它能否讲清你关心的步骤、关系或时间顺序。'],
  },
  start: {
    en: ['Archify Start — Install & Create Visual HTML in Moments', 'Install Archify for Claude Code, Codex, Cursor, OpenCode, or GitHub Copilot. Copy a starter prompt to turn an idea or repository into interactive HTML.'],
    zh: ['Archify 快速上手 — 几分钟装好，一句话画出交互网页', '想把一句话或一个仓库变成交互网页？先确认 Agent 能读写文件并运行 Node.js，再选 Claude Code、Codex、Cursor、OpenCode 或 GitHub Copilot，复制对应安装命令。按你的问题选一个图型和入门示例，直接用自然语言或仓库路径开始制作。'],
  },
  gallery: {
    en: ['Archify Proof Lab — Validated Diagram Gallery', 'Explore 10 diagram types and one-page explainers in interactive HTML. Inspect their sources, automated validation, and separate human visual review status.'],
    zh: ['Archify 验证作品集 — 可探索的图表成品', '想先看成品再决定用哪种图？在 Archify 作品集按用途浏览 10 种原生图型和四种风格的一页式解答，打开离线可交互 HTML，再查看对应的 JSON 或 Markdown 源文件。每件作品分别标明结构与布局的自动验证结果和人工视觉评审状态，方便核对已经完成哪些检查。'],
  },
  community: {
    en: ['Archify Community — Packages Built on Archify', 'Explore independent packages built on Archify: skills, recipes, themes, locales, and CLI wrappers, with source, license, compatibility, and evidence.'],
    zh: ['Archify 社区 — 基于 Archify 的独立包', '想为 Archify 找到适合自己场景的扩展？浏览社区独立维护的 Agent 技能、场景配方、视觉主题、本地化包和 CLI 封装，查看各项目的源码仓库、许可证、兼容版本和验证证据。先按包类型筛选，再打开条目中的证据链接核对使用条件和示例，判断它能否用于你现有的工作流。'],
  },
};
const websiteId = `${canonicalOrigin}/#website`;
const softwareId = `${canonicalOrigin}/#software`;
const sourceId = `${canonicalOrigin}/#source`;
const articlePages = ['agent-diagrams', 'cases/mco-runtime', 'compare'];
const breadcrumbNames = {
  index: { en: 'Home', zh: '首页' },
  'cases/mco-runtime': { en: 'MCO Case', zh: 'MCO 案例' },
  'agent-diagrams': { en: 'Agent Diagrams', zh: 'Agent 画图' },
  compare: { en: 'Compare', zh: '工具对比' },
  gallery: { en: 'Proof Lab', zh: '验证作品集' },
  guide: { en: 'Guide', zh: '场景指南' },
  start: { en: 'Get started', zh: '开始使用' },
  community: { en: 'Community', zh: '社区包' },
};
const featureLists = {
  en: [
    '10 native diagram types in offline interactive HTML',
    'One-page explainers in four presentation styles',
    'Architecture Diagnosis for repository dependencies, cycles, and hotspots',
    '1080p Story video export',
    'PR walkthroughs for GitHub and change diagrams for GitLab merge requests',
  ],
  zh: [
    '10 种可离线交互的原生 HTML 图型',
    '四种排版风格的一页式解答',
    '通过架构诊断检查仓库依赖、循环和热点',
    '导出 1080p Story 演练视频',
    'GitHub PR 变更讲解与 GitLab MR 变更图',
  ],
};
const language = lang => (lang === 'zh' ? 'zh-Hans' : 'en');
function answerFact(fact, lang) {
  const index = lang === 'zh' ? 1 : 0;
  return { question: fact.question[index], answer: fact.answer[index] };
}
export function pageMetadata(page, lang, version) {
  const [title, description] = descriptions[page][lang];
  const canonical = canonicalUrl(page, lang);
  const isArticle = articlePages.includes(page);
  const breadcrumbs = page === 'index' ? [] : [{
    '@type': 'BreadcrumbList',
    itemListElement: ['index', page].map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: breadcrumbNames[crumb][lang],
      item: canonicalUrl(crumb, lang),
    })),
  }];
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
  return { title, description, canonical, ogType: isArticle ? 'article' : 'website', image: `${canonicalOrigin}/assets/archify-social-preview.png`,
    schema: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', '@id': websiteId, url: `${canonicalOrigin}/`, name: 'Archify', inLanguage: ['en', 'zh-Hans'] },
      { '@type': 'SoftwareSourceCode', '@id': sourceId, name: 'Archify', codeRepository: 'https://github.com/tt-a1i/archify', url: 'https://github.com/tt-a1i/archify', license: 'https://github.com/tt-a1i/archify/blob/main/LICENSE', version, programmingLanguage: 'JavaScript', description: descriptions.index[lang][1], targetProduct: { '@id': softwareId } },
      { '@type': 'SoftwareApplication', '@id': softwareId, name: 'Archify', url: `${canonicalOrigin}/`, applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Linux, Windows', isAccessibleForFree: true, license: 'https://www.apache.org/licenses/LICENSE-2.0', softwareVersion: version, description: descriptions.index[lang][1], featureList: featureLists[lang], offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, sameAs: ['https://github.com/tt-a1i/archify', 'https://skills.sh/tt-a1i/archify/archify'], subjectOf: [
        { '@type': 'NewsArticle', name: 'GitHub最热架构图Agent，开发者故事看哭了', url: 'https://www.qbitai.com/2026/09/482469.html', datePublished: '2026-09-01', inLanguage: 'zh-Hans', publisher: { '@type': 'Organization', name: 'QbitAI (量子位)' } },
        { '@type': 'NewsArticle', name: 'GitHub三榜第一背后，一个“专升本”工程师的十年', url: 'https://www.qbitai.com/2026/09/488519.html', datePublished: '2026-09-13', inLanguage: 'zh-Hans', publisher: { '@type': 'Organization', name: 'QbitAI (量子位)' } },
      ] },
      ...(isArticle ? [{ '@type': 'TechArticle', '@id': `${canonical}#article`, url: canonical, headline: title, description, inLanguage: language(lang), isPartOf: { '@id': websiteId }, about: { '@id': softwareId } }] : []),
      ...breadcrumbs,
      ...faq,
    ] },
  };
}
