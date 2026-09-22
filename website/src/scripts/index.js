
  /* ══════════════════════════════════════
     i18n strings
  ══════════════════════════════════════ */
  const LANGS = {
    en: {
      'nav-guide':'Guide','nav-gallery':'Proof Lab','nav-start':'Start','nav-install':'Install Skill',
      'hero-badge':'Agent Skill &nbsp;·&nbsp; development &nbsp;·&nbsp; v[[ARCHIFY_VERSION]]',
      'hero-h1':'From plain English<br>to architecture <em>you can trust.</em>',
      'hero-sub':'Describe your system in chat. Archify generates a polished, explorable HTML diagram — semantic camera, path-aware stories, 4× export built in.',
      'hero-cta':'Choose the right diagram','hero-gallery':'Explore proof gallery',
      'proof-live':'Live proof','proof-status':'Generated, checked, interactive','proof-receipt':'Real gallery artifact · 9/9 validation checks','proof-open':'Open artifact','proof-hint':'Play the story from the current moment, then pin and share that node.',
      'rail-label':'Live specimens — select to load',
      'stat-types':'Diagram types','stat-presets':'Visual presets','stat-themes':'Coordinated themes','stat-export':'Native export scale','stat-deps':'Dependencies',
      'label-types':'Diagram Types',
      'types-h2':'Five ways to see your system.',
      'types-body':'Describe what you need — Archify picks the right visual language.',
      'label-gallery':'Index',
      'types-more':'Browse the full proof gallery','types-more-sub':'Live artifacts · every preset · every type',
      'arch-h':'Architecture',
      'arch-p':'Components, services, databases, security groups — and every connection between them.',
      'arch-li1':'AWS / GCP / Azure infra','arch-li2':'Microservices topology','arch-li3':'Security boundaries','arch-li4':'Network layout',
      'wf-h':'Workflow',
      'wf-p':'Swim-lane processes with semantic nodes — approval gates, async branches, observability paths.',
      'seq-h':'Sequence',
      'seq-p':'API calls, request lifecycles, cache fallbacks, auth checks — who calls whom, in what order.',
      'flow-h':'Data Flow',
      'flow-p':'Pipelines, ETL, PII isolation, lineage — with governance boundaries.',
      'life-h':'Lifecycle',
      'life-p':'State machines and status transitions — waits, retries, cancellation, terminal states.',
      'label-features':'Features',
      'features-h2':'Production-ready output,<br>zero configuration.',
      'f1-h':'Four visual identities','f1-p':'Classic, Signal Flow, Blueprint, Editorial — one geometry contract, coordinated dark/light themes.','f1-tag':'4 PRESETS · 2 THEMES',
      'f2-h':'Ultra-crisp 4× export','f2-p':'PNG, JPEG, WebP rasterized natively at 4×. Sharp on retina, slides, and print.','f2-tag':'PNG · JPEG · WEBP',
      'f3-h':'Dual-theme SVG','f3-p':"One SVG ships both theme variable sets plus prefers-color-scheme — drop it in a README and it follows the reader.",'f3-tag':'VECTOR · SELF-THEMED',
      'f4-h':'Copy to clipboard','f4-p':'One button puts a PNG on your clipboard. Paste into Slack, Notion, GitHub, or Figma.','f4-tag':'INSTANT SHARE',
      'f5-h':'Self-contained HTML','f5-p':'One HTML file. Zero dependencies, no server — opens in any browser, attaches to any PR.','f5-tag':'ZERO DEPS',
      'f6-h':'Iterate by chat','f6-p':'"Add Redis", "move auth left", "emerald for the API" — refine in plain language.','f6-tag':'CONVERSATIONAL',
      'f7-h':'Inspect and play real routes','f7-p':'Route Journey keeps the authored path visible — inspect any stop or play one reader-controlled pass.','f7-tag':'INSPECT · PLAY · PAUSE',
      'f8-h':'Anticipate and share the exact story moment','f8-p':'Story Horizon marks the next stop; Semantic Story Carrier names the relationship kind. Pin or share any beat.','f8-tag':'FOLLOW · ANTICIPATE · SHARE',
      'export-label':'Export formats',
      'exp-png':'Transparent · 4× native','exp-jpg':'Theme bg · 4× native','exp-webp':'Small · 4× native','exp-svg':'Vector · dual-theme','exp-webm':'Motion · browser-native','exp-clip-fmt':'Clipboard','exp-clip':'Copy PNG · instant paste',
      'label-cinema':'Live Document',
      'cinema-h':'Not a picture.<br><em>A living document.</em>',
      'cinema-sub':'Generated from versioned IR, passed nine checks — and alive: scrub the story, switch theme, export 4×.',
      'label-palette':'Design System',
      'palette-h2':'A semantic color language for infrastructure.',
      'palette-body':'Seven component types, each with coordinated dark and light variants.',
      'chip-frontend':'Frontend','chip-frontend-use':'Client apps, browsers, mobile, UI',
      'chip-backend':'Backend','chip-backend-use':'Services, APIs, workers, daemons',
      'chip-database':'Database','chip-database-use':'DBs, caches, stores, AI/ML',
      'chip-cloud':'Cloud','chip-cloud-use':'Managed services, infra',
      'chip-security':'Security','chip-security-use':'Auth, secrets, guards',
      'chip-bus':'Message Bus','chip-bus-use':'Kafka, RabbitMQ, SNS',
      'chip-external':'External','chip-external-use':'Users, 3rd parties, generic',
      'label-qs':'Quick Start',
      'qs-h2':'Up and running<br>in three steps.',
      'qs-body':'One checked Skill for Cursor, Claude Code, Codex, and OpenCode — the switcher generates exact commands.',
      'step1-h':'Install in one command','step1-p':'Run <code>npx skills add tt-a1i/archify -g</code>, or use the <a href="start.html?agent=cursor&amp;type=architecture">agent-aware quick start</a>. Raven uses a manual ZIP install outside the switcher: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify.',
      'step2-h':'Describe your system','step2-p':'Describe components, connections, and services — or let the agent inspect the repo first.',
      'step3-h':'Ask your agent to draw it','step3-p':'Tell your agent to use Archify — a self-contained HTML you can open anywhere and refine in chat.',
      'kbd-label':'Keyboard shortcuts','kbd-guide':'Diagram guide','kbd-theme':'Toggle theme','kbd-find':'Find node / route endpoint','kbd-route':'Trace, inspect, and play a route','kbd-radar':'Semantic radar','kbd-lens':'Compare semantic kinds','kbd-present':'Presentation stage','kbd-export':'Open export menu','kbd-focus':'Focus node','kbd-views':'Guided views','kbd-play':'Play story','kbd-zoom':'Reading depth / reset','kbd-nav':'Navigate menu','kbd-close':'Close menu',
      'footer-meta':'development &nbsp;·&nbsp; v[[ARCHIFY_VERSION]] &nbsp;·&nbsp; MIT License<br>Based on Cocoon-AI/architecture-diagram-generator',
      'cta-h':'Describe it once.<br><em>Share the map.</em>',
      'cta-sub':'One command for Cursor, Claude Code, Codex, or OpenCode — your next diagram is a chat away.',
      'cta-install':'Install the skill',
      'footer-changelog':'Changelog','footer-license':'License'
    },
    zh: {
      'nav-guide':'场景指南','nav-gallery':'验证作品集','nav-start':'快速上手','nav-install':'安装技能',
      'hero-badge':'Agent 技能 &nbsp;·&nbsp; 开发版 &nbsp;·&nbsp; v[[ARCHIFY_VERSION]]',
      'hero-h1':'用自然语言，<br>生成<em>可信的架构图。</em>',
      'hero-sub':'在对话中描述你的系统，Archify 生成精美、可探索的 HTML 技术图——内置语义镜头、路径故事与 4× 导出。',
      'hero-cta':'选择合适的图','hero-gallery':'查看验证作品集',
      'proof-live':'实时成品','proof-status':'自动生成 · 检查通过 · 可交互','proof-receipt':'真实作品集成品 · 9/9 项验证通过','proof-open':'打开完整成品','proof-hint':'从当前时刻播放故事，再钉住并分享这个节点。',
      'rail-label':'实时标本 · 点击加载',
      'stat-types':'图表类型','stat-presets':'视觉预设','stat-themes':'深浅主题','stat-export':'原生导出倍率','stat-deps':'外部依赖',
      'label-types':'图表类型',
      'types-h2':'五种方式，读懂你的系统。',
      'types-body':'描述需求，Archify 选择最合适的可视化语言。',
      'label-gallery':'索引',
      'types-more':'浏览完整作品集','types-more-sub':'实时成品 · 全部预设 · 全部图型',
      'arch-h':'架构图',
      'arch-p':'组件、服务、数据库、安全组及其全部连接关系。',
      'arch-li1':'AWS / GCP / Azure 基础设施','arch-li2':'微服务拓扑','arch-li3':'安全边界','arch-li4':'网络布局',
      'wf-h':'工作流图',
      'wf-p':'泳道流程——审批门、异步分支、观测路径，逐道铺开。',
      'seq-h':'时序图',
      'seq-p':'API 调用链、缓存回退、鉴权检查——谁调用谁、按什么顺序。',
      'flow-h':'数据流图',
      'flow-p':'管道、ETL、PII 隔离、血缘——附治理边界。',
      'life-h':'生命周期图',
      'life-p':'状态机与状态流转——等待、重试、取消、终态。',
      'label-features':'功能特性',
      'features-h2':'生产级输出，<br>零配置。',
      'f1-h':'四套视觉身份','f1-p':'Classic、Signal Flow、Blueprint、Editorial——同一几何契约，深浅主题协调。','f1-tag':'4 套预设 · 2 套主题',
      'f2-h':'超清 4× 导出','f2-p':'PNG、JPEG、WebP 以 4 倍原生栅格化。视网膜屏、幻灯片、印刷均清晰。','f2-tag':'PNG · JPEG · WEBP',
      'f3-h':'双主题 SVG','f3-p':'单个 SVG 内置双主题变量与 prefers-color-scheme——放进 README 即跟随读者主题。','f3-tag':'矢量 · 自适应主题',
      'f4-h':'复制到剪贴板','f4-p':'一键把 PNG 写入剪贴板，直接粘贴到 Slack、Notion、GitHub 或 Figma。','f4-tag':'即时分享',
      'f5-h':'独立 HTML 文件','f5-p':'单个 HTML 文件，零依赖、无服务器——任意浏览器打开，可直接贴进 PR。','f5-tag':'零依赖',
      'f6-h':'对话式迭代','f6-p':'「加一个 Redis」「鉴权移到左边」——用自然语言精调。','f6-tag':'对话驱动',
      'f7-h':'检查并播放真实路径','f7-p':'Route Journey 保留完整作者路径——可逐站检查，或播放一次读者控制的旅程。','f7-tag':'检查 · 播放 · 暂停',
      'f8-h':'跟随并分享精确故事时刻','f8-p':'Story Horizon 指出下一站，Semantic Story Carrier 标明关系类型——任意节拍可钉住或分享。','f8-tag':'跟随 · 钉住 · 分享',
      'export-label':'导出格式',
      'exp-png':'透明底 · 4× 分辨率','exp-jpg':'主题背景 · 4× 分辨率','exp-webp':'体积小 · 4× 分辨率','exp-svg':'矢量 · 双主题','exp-webm':'动态 · 浏览器原生','exp-clip-fmt':'剪贴板','exp-clip':'复制 PNG · 即时粘贴',
      'label-cinema':'活文档',
      'cinema-h':'不是一张图。<br><em>是一份活的文档。</em>',
      'cinema-sub':'由版本化 IR 生成并通过九项检查——而且是活的：拖故事线、切主题、4× 导出。',
      'label-palette':'设计系统',
      'palette-h2':'为基础设施而生的语义色彩系统。',
      'palette-body':'七种组件类型，各带协调的深浅变体。',
      'chip-frontend':'前端','chip-frontend-use':'客户端、浏览器、移动端、UI',
      'chip-backend':'后端','chip-backend-use':'服务、API、Worker、守护进程',
      'chip-database':'数据库','chip-database-use':'数据库、缓存、存储、AI/ML',
      'chip-cloud':'云服务','chip-cloud-use':'托管服务、基础设施',
      'chip-security':'安全','chip-security-use':'鉴权、密钥、安全网关',
      'chip-bus':'消息总线','chip-bus-use':'Kafka、RabbitMQ、SNS',
      'chip-external':'外部系统','chip-external-use':'用户、第三方、通用外部',
      'label-qs':'快速开始',
      'qs-h2':'三步上手，<br>即刻运行。',
      'qs-body':'同一份 Skill 适用于 Cursor、Claude Code、Codex 与 OpenCode，切换器生成准确命令。',
      'step1-h':'一条命令安装','step1-p':'运行 <code>npx skills add tt-a1i/archify -g</code>，或使用<a href="start.html?agent=cursor&amp;type=architecture">可切换 Agent 的快速开始页</a>。Raven 不使用切换器，采用 ZIP 手动安装：将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify。',
      'step2-h':'描述你的系统','step2-p':'描述组件、连接与服务——或先让 agent 检查仓库。',
      'step3-h':'让 agent 绘制','step3-p':'让 agent 使用 Archify——生成单文件 HTML，任意浏览器打开，可继续对话迭代。',
      'kbd-label':'键盘快捷键','kbd-guide':'图表指南','kbd-theme':'切换主题','kbd-find':'查找节点 / 路径端点','kbd-route':'探查、检查并播放路径','kbd-radar':'语义雷达','kbd-lens':'对比语义类型','kbd-present':'演示舞台','kbd-export':'打开导出菜单','kbd-focus':'聚焦节点','kbd-views':'引导视图','kbd-play':'播放故事','kbd-zoom':'阅读层级 / 复位','kbd-nav':'菜单导航','kbd-close':'关闭菜单',
      'footer-meta':'开发版 &nbsp;·&nbsp; v[[ARCHIFY_VERSION]] &nbsp;·&nbsp; MIT 许可证<br>基于 Cocoon-AI/architecture-diagram-generator',
      'cta-h':'描述一次，<br><em>分享这张图。</em>',
      'cta-sub':'一条命令为 Cursor、Claude Code、Codex 或 OpenCode 安装——下一张图只差一句对话。',
      'cta-install':'安装技能',
      'footer-changelog':'更新日志','footer-license':'许可证'
    }
  };

  const PROOFS = {
    signal: {
      artifact: 'gallery/artifacts/agent-tool-call.workflow.html',
      view: 'happy-path',
      iframeTitle: { en: 'Agent Tool Call live Archify proof', zh: '智能体工具调用 Archify 实时成品' },
      name: { en: 'Agent Tool Call', zh: '智能体工具调用' },
      meta: { en: 'Workflow · Signal Flow · 12 nodes · 11 edges', zh: '工作流 · Signal Flow · 12 节点 · 11 条关系' },
      title: { en: 'Agent Tool Call — policy, execution, recovery, and evidence', zh: '智能体工具调用——策略、执行、恢复与证据闭环' }
    },
    blueprint: {
      artifact: 'gallery/artifacts/production-deployment.architecture.html',
      view: 'request-boundary',
      iframeTitle: { en: 'Production Deployment live Archify proof', zh: '生产部署架构 Archify 实时成品' },
      name: { en: 'Production Deployment', zh: '生产部署' },
      meta: { en: 'Architecture · Blueprint · 12 nodes · 12 edges', zh: '架构图 · Blueprint · 12 节点 · 12 条关系' },
      title: { en: 'Production Deployment — regions, ownership, state, and audit', zh: '生产部署——区域、归属、状态与审计边界' }
    },
    classic: {
      artifact: 'gallery/artifacts/cache-miss.sequence.html',
      view: 'cache-fallback',
      iframeTitle: { en: 'Cache Miss Request live Archify proof', zh: '缓存未命中请求 Archify 实时成品' },
      name: { en: 'Cache Miss', zh: '缓存未命中' },
      meta: { en: 'Sequence · Classic · 7 participants · 12 messages', zh: '时序图 · Classic · 7 个参与者 · 12 条消息' },
      title: { en: 'Cache Miss — authentication, fallback, return, and trace', zh: '缓存未命中——鉴权、回退、返回与追踪' }
    }
  };

  let lang = ArchifySiteLanguage.read();
  let activeProof = 'signal';
  const btnLang = document.getElementById('btn-lang');
  const proofStage = document.getElementById('hero-proof-stage');
  const proofFrame = document.getElementById('hero-proof-frame');
  const proofPanel = document.getElementById('hero-proof-panel');
  const proofOpen = document.getElementById('proof-open');
  const proofMeta = document.getElementById('proof-meta');
  const proofTitle = document.getElementById('proof-title');

  function proofEmbedUrl(proof, { play = false } = {}) {
    const playback = play ? '&play=1' : '';
    return `${proof.artifact}?embed=1${playback}&theme=dark#view=${encodeURIComponent(proof.view)}`;
  }

  function fillRail() {
    document.querySelectorAll('.spec-card').forEach(card => {
      const proof = PROOFS[card.dataset.proof];
      if (!proof) return;
      card.querySelector('.spec-name').textContent = proof.name[lang];
      card.querySelector('.spec-meta').textContent = proof.meta[lang];
    });
  }

  function renderProof(key, { focus = false, deliberate = false } = {}) {
    const proof = PROOFS[key];
    if (!proof) return;
    activeProof = key;
    document.querySelectorAll('.spec-card').forEach(tab => {
      const selected = tab.dataset.proof === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    const selectedTab = document.querySelector(`.spec-card[data-proof="${key}"]`);
    proofPanel.setAttribute('aria-labelledby', selectedTab.id);
    proofOpen.href = `${proof.artifact}?present=1&play=1#view=${encodeURIComponent(proof.view)}`;
    proofMeta.textContent = proof.meta[lang];
    proofTitle.textContent = proof.title[lang];
    proofFrame.title = proof.iframeTitle[lang];
    if (proofFrame.dataset.proof !== key) {
      if (deliberate) proofStage.dataset.proofPlayback = 'deliberate';
      proofStage.classList.add('is-loading');
      proofFrame.dataset.proof = key;
      proofFrame.src = proofEmbedUrl(proof, { play: deliberate });
    }
  }

  proofFrame.addEventListener('load', () => {
    proofStage.classList.remove('is-loading');
  });
  document.querySelectorAll('.spec-card').forEach(tab => {
    tab.addEventListener('click', () => renderProof(tab.dataset.proof, { deliberate: true }));
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('.spec-card')];
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      renderProof(tabs[next].dataset.proof, { focus: true, deliberate: true });
    });
  });

  function applyLang(l) {
    lang = ArchifySiteLanguage.write(l);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    btnLang.textContent = lang === 'zh' ? 'EN' : '中文';
    btnLang.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
    const dict = LANGS[lang];
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = dict[el.dataset.i18n];
      if (v !== undefined) el.innerHTML = v;
    });
    fillRail();
    renderProof(activeProof);
    document.getElementById('code-en').style.display = lang === 'en' ? '' : 'none';
    document.getElementById('code-zh').style.display = lang === 'zh' ? '' : 'none';
  }

  /* ══ Pinned types showcase — chapter in the middle band drives the frame ══ */
  const typeChapters = [...document.querySelectorAll('.type-chapter')];
  const typeShots = [...document.querySelectorAll('.types-shot')];
  const typesCurrent = document.getElementById('types-current');
  const typesTag = document.getElementById('types-tag');
  let activeType = 'arch';
  function updateTypesTag() {
    const ch = typeChapters.find(c => c.dataset.type === activeType);
    if (ch && typesTag) typesTag.textContent = lang === 'zh' ? ch.dataset.tagZh : ch.dataset.tag;
  }
  function setActiveType(key) {
    if (key === activeType) return;
    activeType = key;
    typeChapters.forEach(c => c.classList.toggle('active', c.dataset.type === key));
    typeShots.forEach(sh => sh.classList.toggle('active', sh.dataset.shot === key));
    const ch = typeChapters.find(c => c.dataset.type === key);
    if (ch && typesCurrent) typesCurrent.textContent = ch.dataset.num;
    updateTypesTag();
  }
  if ('IntersectionObserver' in window && typeChapters.length) {
    const tObs = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) setActiveType(en.target.dataset.type); });
    }, { rootMargin: '-42% 0px -42% 0px' });
    typeChapters.forEach(c => tObs.observe(c));
  }

  const _applyLang = applyLang;
  applyLang = function (l) { _applyLang(l); updateTypesTag(); };

  btnLang.addEventListener('click', () => applyLang(lang === 'en' ? 'zh' : 'en'));
  applyLang(lang);


