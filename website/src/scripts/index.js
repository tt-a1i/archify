
  /* ══════════════════════════════════════
     i18n strings
  ══════════════════════════════════════ */
  const LANGS = {
    en: {
      'nav-guide':'Guide','nav-gallery':'Proof Lab','nav-start':'Start','nav-install':'Install Skill',
      'hero-badge':'Agent Skill &nbsp;·&nbsp; development &nbsp;·&nbsp; v[[ARCHIFY_VERSION]]',
      'hero-h1':'From plain English<br>to architecture <em>you can trust.</em>',
      'hero-sub':'Describe your system in chat. Archify generates a polished, explorable HTML diagram — with progressive MAP → READ → FULL detail, a semantic camera, path-aware stories, motion, and ultra-crisp export built in.',
      'hero-cta':'Choose the right diagram','hero-gallery':'Explore proof gallery',
      'proof-live':'Live proof','proof-status':'Generated, checked, interactive','proof-receipt':'Real gallery artifact · 9/9 validation checks','proof-open':'Open artifact','proof-hint':'Play a story that follows the current authored moment, then pin and share that exact node.',
      'rail-label':'Live specimens — select to load',
      'stat-types':'Diagram types','stat-presets':'Visual presets','stat-themes':'Coordinated themes','stat-export':'Native export scale','stat-deps':'Dependencies',
      'label-types':'Diagram Types',
      'types-h2':'Five ways to see your system.',
      'types-body':'Architecture, workflows, sequences, data flows, or state machines — describe what you need and Archify picks the right visual language.',
      'label-gallery':'Index',
      'types-more':'Browse the full proof gallery','types-more-sub':'Live artifacts · every preset · every type',
      'arch-h':'Architecture',
      'arch-p':'System components, cloud resources, databases, caches, services, security groups, and the connections between them.',
      'arch-li1':'AWS / GCP / Azure infra','arch-li2':'Microservices topology','arch-li3':'Security boundaries','arch-li4':'Network layout',
      'wf-h':'Workflow',
      'wf-p':'Swim-lane processes with semantic nodes and anchored edges — approval gates, async branches, and observability paths, lane by lane.',
      'seq-h':'Sequence',
      'seq-p':'API call chains, request lifecycles, cache fallback paths, auth checks, async traces — who calls whom, in what order, and what returns.',
      'flow-h':'Data Flow',
      'flow-p':'Data pipelines, ETL/ELT, analytics events, PII isolation, warehouse sync, lineage, and downstream consumers — with governance boundaries.',
      'life-h':'Lifecycle',
      'life-p':'State machines, object lifecycles, run/order/deployment status transitions — with wait states, retries, cancellation, and terminal outcomes.',
      'label-features':'Features',
      'features-h2':'Production-ready output,<br>zero configuration.',
      'f1-h':'Four visual identities','f1-p':'Classic, Signal Flow, Blueprint, and Editorial share one geometry contract. Every preset includes coordinated dark/light themes and exports cleanly.','f1-tag':'4 PRESETS · 2 THEMES',
      'f2-h':'Ultra-crisp 4× export','f2-p':'PNG, JPEG, WebP — all rasterized natively at up to 4× source resolution by the browser. No upsampling blur. Sharp on retina displays, slides, and print.','f2-tag':'PNG · JPEG · WEBP',
      'f3-h':'Dual-theme SVG','f3-p':"The SVG export ships with both variable sets plus a @media prefers-color-scheme rule. Drop one file into a GitHub README — it follows the reader's theme.",'f3-tag':'VECTOR · SELF-THEMED',
      'f4-h':'Copy to clipboard','f4-p':'One button puts a PNG straight on your clipboard. Paste directly into Slack, Notion, GitHub, or Figma — no intermediate save step.','f4-tag':'INSTANT SHARE',
      'f5-h':'Self-contained HTML','f5-p':'One HTML file. Zero dependencies, no server, no runtime. Open it in any browser and it works. Share by attaching it to an email or PR comment.','f5-tag':'ZERO DEPS',
      'f6-h':'Iterate by chat','f6-p':'"Add Redis", "move auth to the left", "use emerald for the API" — refine in natural language. No diagram editor to learn.','f6-tag':'CONVERSATIONAL',
      'f7-h':'Inspect and play real routes','f7-p':'Route Journey keeps the complete authored path visible while you inspect any stop or play one finite, reader-controlled pass over each exact incoming relationship.','f7-tag':'INSPECT · PLAY · PAUSE',
      'f8-h':'Anticipate and share the exact story moment','f8-p':'Story Horizon distinguishes the exact next stop, while Semantic Story Carrier shows whether its one authored relationship is a call, data, event, security, or state transition. Pin any beat or share the same stable moment.','f8-tag':'FOLLOW · ANTICIPATE · SHARE',
      'export-label':'Export formats',
      'exp-png':'Transparent · 4× native','exp-jpg':'Theme bg · 4× native','exp-webp':'Small · 4× native','exp-svg':'Vector · dual-theme','exp-webm':'Motion · browser-native','exp-clip-fmt':'Clipboard','exp-clip':'Copy PNG · instant paste',
      'label-palette':'Design System',
      'palette-h2':'A semantic color language for infrastructure.',
      'palette-body':'Seven component types. Each with coordinated dark and light variants that switch together via the theme toggle.',
      'chip-frontend':'Frontend','chip-frontend-use':'Client apps, browsers, mobile, UI',
      'chip-backend':'Backend','chip-backend-use':'Services, APIs, workers, daemons',
      'chip-database':'Database','chip-database-use':'DBs, caches, stores, AI/ML',
      'chip-cloud':'Cloud','chip-cloud-use':'Managed services, infra',
      'chip-security':'Security','chip-security-use':'Auth, secrets, guards',
      'chip-bus':'Message Bus','chip-bus-use':'Kafka, RabbitMQ, SNS',
      'chip-external':'External','chip-external-use':'Users, 3rd parties, generic',
      'label-qs':'Quick Start',
      'qs-h2':'Up and running<br>in three steps.',
      'qs-body':'One checked Skill for Cursor, Claude Code, Codex, and OpenCode. Their switcher generates exact commands.',
      'step1-h':'Install in one command','step1-p':'Run <code>npx skills add tt-a1i/archify -g</code>, or open the <a href="start.html?agent=cursor&amp;type=architecture">agent-aware quick start</a> for an exact Cursor, Codex, Claude Code, or OpenCode command.',
      'step2-h':'Describe your system','step2-p':'Describe components, connections, and cloud services — or ask your agent to analyze the repository first.',
      'step3-h':'Ask your agent to draw it','step3-p':'Tell your agent to use Archify. It generates a self-contained HTML file you can open in any browser and refine in chat.',
      'kbd-label':'Keyboard shortcuts','kbd-guide':'Diagram guide','kbd-theme':'Toggle theme','kbd-find':'Find node / route endpoint','kbd-route':'Trace, inspect, and play a route','kbd-radar':'Semantic radar','kbd-lens':'Compare semantic kinds','kbd-present':'Presentation stage','kbd-export':'Open export menu','kbd-focus':'Focus node','kbd-views':'Guided views','kbd-play':'Play story','kbd-zoom':'Reading depth / reset','kbd-nav':'Navigate menu','kbd-close':'Close menu',
      'footer-meta':'development &nbsp;·&nbsp; v[[ARCHIFY_VERSION]] &nbsp;·&nbsp; MIT License<br>Based on Cocoon-AI/architecture-diagram-generator',
      'cta-h':'Describe it once.<br><em>Share the map.</em>',
      'cta-sub':'One command installs the checked skill for Cursor, Claude Code, Codex, or OpenCode — and your next diagram is a chat message away.',
      'cta-install':'Install the skill',
      'footer-changelog':'Changelog','footer-license':'License'
    },
    zh: {
      'nav-guide':'场景指南','nav-gallery':'验证作品集','nav-start':'快速上手','nav-install':'安装技能',
      'hero-badge':'Agent 技能 &nbsp;·&nbsp; 开发版 &nbsp;·&nbsp; v[[ARCHIFY_VERSION]]',
      'hero-h1':'用自然语言，<br>生成<em>可信的架构图。</em>',
      'hero-sub':'在对话中描述你的系统，Archify 生成精美、可探索的 HTML 技术图——信息会按 MAP → READ → FULL 渐进展开，并内置语义镜头、路径故事、动态效果和超清导出。',
      'hero-cta':'选择合适的图','hero-gallery':'查看验证作品集',
      'proof-live':'实时成品','proof-status':'自动生成 · 检查通过 · 可交互','proof-receipt':'真实作品集成品 · 9/9 项验证通过','proof-open':'打开完整成品','proof-hint':'播放会跟随当前作者时刻的故事，再钉住并分享这个精确节点。',
      'rail-label':'实时标本 · 点击加载',
      'stat-types':'图表类型','stat-presets':'视觉预设','stat-themes':'深浅主题','stat-export':'原生导出倍率','stat-deps':'外部依赖',
      'label-types':'图表类型',
      'types-h2':'五种方式，读懂你的系统。',
      'types-body':'架构图、工作流、时序图、数据流图、状态机——描述需求，Archify 自动选择最合适的可视化语言。',
      'label-gallery':'索引',
      'types-more':'浏览完整作品集','types-more-sub':'实时成品 · 全部预设 · 全部图型',
      'arch-h':'架构图',
      'arch-p':'系统组件、云资源、数据库、缓存、服务、安全组及其连接关系，一图清晰呈现。',
      'arch-li1':'AWS / GCP / Azure 基础设施','arch-li2':'微服务拓扑','arch-li3':'安全边界','arch-li4':'网络布局',
      'wf-h':'工作流图',
      'wf-p':'泳道式流程：语义化节点与锚定连线——审批门、异步分支、观测路径，逐泳道清晰铺开。',
      'seq-h':'时序图',
      'seq-p':'API 调用链、请求生命周期、缓存回退路径、鉴权检查、异步追踪——谁调用谁、顺序如何、返回什么。',
      'flow-h':'数据流图',
      'flow-p':'数据管道、ETL/ELT、分析事件、PII 隔离、数仓同步、数据血缘及下游消费者——附治理边界。',
      'life-h':'生命周期图',
      'life-p':'状态机、对象生命周期、运行/订单/部署状态流转——含等待态、重试、取消和终态。',
      'label-features':'功能特性',
      'features-h2':'生产级输出，<br>零配置。',
      'f1-h':'四套视觉身份','f1-p':'Classic、Signal Flow、Blueprint 和 Editorial 共用同一套几何契约；每套都提供协调的深浅主题并保持干净导出。','f1-tag':'4 套预设 · 2 套主题',
      'f2-h':'超清 4× 导出','f2-p':'PNG、JPEG、WebP——由浏览器以最高 4 倍分辨率原生栅格化，无上采样模糊。视网膜屏、幻灯片、印刷均清晰。','f2-tag':'PNG · JPEG · WEBP',
      'f3-h':'双主题 SVG','f3-p':'SVG 导出同时内置深色和浅色变量集，并附 @media prefers-color-scheme 规则。放入 GitHub README，自动跟随读者主题。','f3-tag':'矢量 · 自适应主题',
      'f4-h':'复制到剪贴板','f4-p':'一键将 PNG 写入剪贴板，直接粘贴到 Slack、Notion、GitHub 或 Figma，无需手动保存。','f4-tag':'即时分享',
      'f5-h':'独立 HTML 文件','f5-p':'单个 HTML 文件，零依赖、无需服务器或构建工具，任意浏览器打开即用。作为附件发邮件或贴 PR 评论均可。','f5-tag':'零依赖',
      'f6-h':'对话式迭代','f6-p':'「加一个 Redis」「把鉴权移到左边」「API 用绿色」——用自然语言精调，无需学习任何图形编辑器。','f6-tag':'对话驱动',
      'f7-h':'检查并播放真实路径','f7-p':'Route Journey 始终保留完整作者路径，可逐站检查，也可沿每条精确入向关系播放一次由读者控制的有限旅程。','f7-tag':'检查 · 播放 · 暂停',
      'f8-h':'跟随并分享精确故事时刻','f8-p':'Story Horizon 指出唯一下一站，Semantic Story Carrier 则说明这条真实关系传递的是调用、数据、事件、安全还是状态变化；任意 beat 都可钉住或稳定分享。','f8-tag':'跟随 · 钉住 · 分享',
      'export-label':'导出格式',
      'exp-png':'透明底 · 4× 分辨率','exp-jpg':'主题背景 · 4× 分辨率','exp-webp':'体积小 · 4× 分辨率','exp-svg':'矢量 · 双主题','exp-webm':'动态 · 浏览器原生','exp-clip-fmt':'剪贴板','exp-clip':'复制 PNG · 即时粘贴',
      'label-palette':'设计系统',
      'palette-h2':'为基础设施而生的语义色彩系统。',
      'palette-body':'七种组件类型，各有深色与浅色协调变体，随主题切换同步变换。',
      'chip-frontend':'前端','chip-frontend-use':'客户端、浏览器、移动端、UI',
      'chip-backend':'后端','chip-backend-use':'服务、API、Worker、守护进程',
      'chip-database':'数据库','chip-database-use':'数据库、缓存、存储、AI/ML',
      'chip-cloud':'云服务','chip-cloud-use':'托管服务、基础设施',
      'chip-security':'安全','chip-security-use':'鉴权、密钥、安全网关',
      'chip-bus':'消息总线','chip-bus-use':'Kafka、RabbitMQ、SNS',
      'chip-external':'外部系统','chip-external-use':'用户、第三方、通用外部',
      'label-qs':'快速开始',
      'qs-h2':'三步上手，<br>即刻运行。',
      'qs-body':'同一份经过检查的 Skill 可用于 Cursor、Claude Code、Codex 和 OpenCode，切换器会生成准确命令。',
      'step1-h':'一条命令安装','step1-p':'运行 <code>npx skills add tt-a1i/archify -g</code>，或打开<a href="start.html?agent=cursor&amp;type=architecture">可切换 Agent 的快速开始页</a>，获取准确的 Cursor、Codex、Claude Code 或 OpenCode 命令。',
      'step2-h':'描述你的系统','step2-p':'描述组件、连接关系和云服务，也可以先让 agent 分析代码仓库。',
      'step3-h':'让 agent 绘制','step3-p':'告诉 agent 使用 Archify，它会生成可在任意浏览器打开的单文件 HTML，并可继续在对话中迭代。',
      'kbd-label':'键盘快捷键','kbd-guide':'图表指南','kbd-theme':'切换主题','kbd-find':'查找节点 / 路径端点','kbd-route':'探查、检查并播放路径','kbd-radar':'语义雷达','kbd-lens':'对比语义类型','kbd-present':'演示舞台','kbd-export':'打开导出菜单','kbd-focus':'聚焦节点','kbd-views':'引导视图','kbd-play':'播放故事','kbd-zoom':'阅读层级 / 复位','kbd-nav':'菜单导航','kbd-close':'关闭菜单',
      'footer-meta':'开发版 &nbsp;·&nbsp; v[[ARCHIFY_VERSION]] &nbsp;·&nbsp; MIT 许可证<br>基于 Cocoon-AI/architecture-diagram-generator',
      'cta-h':'描述一次，<br><em>分享这张图。</em>',
      'cta-sub':'一条命令即可为 Cursor、Claude Code、Codex 或 OpenCode 安装经过检查的技能——你的下一张架构图，只差一句对话。',
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

  btnLang.addEventListener('click', () => applyLang(lang === 'en' ? 'zh' : 'en'));
  applyLang(lang);

  /* ══ Intersection observer ══ */
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold:.12, rootMargin:'0px 0px -40px 0px' });
    document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('.fade-up').forEach(el => el.classList.add('visible'));
  }
