
  /* ══════════════════════════════════════
     i18n strings
  ══════════════════════════════════════ */
  const LANGS = JSON.parse(document.getElementById('site-copy').textContent);
  const DEFAULT_PROOF_LABELS = JSON.parse(document.getElementById('site-proof-labels').textContent);

  /* The MAP beat clears focus/lens with a fragment that names no element: an
     empty '#' would make the browser scroll the indicated "top of document"
     into view, which in a same-origin frame also scrolls this page. */
  const MAP = '#overview';

  /* Each proof carries four camera beats (focus → upstream → lens → map) that
     the pinned stage applies by replacing the artifact's hash; the viewer
     animates its own camera on hashchange. */
  const PROOFS = {
    signal: {
      artifact: 'gallery/artifacts/agent-tool-call.workflow.html',
      hash: '#focus=planner&reach=downstream',
      beats: [MAP, '#focus=planner&reach=downstream', '#focus=approval&reach=upstream', '#lens=security~database'],
      iframeTitle: { en: 'Agent Tool Call live Archify proof', zh: '智能体工具调用 Archify 实时成品' },
      name: { en: 'Agent Tool Call', zh: '智能体工具调用' },
      meta: DEFAULT_PROOF_LABELS.meta,
      title: DEFAULT_PROOF_LABELS.title
    },
    blueprint: {
      artifact: 'gallery/artifacts/production-deployment.architecture.html',
      hash: '#lens=backend~database',
      beats: [MAP, '#focus=gateway&reach=downstream', '#focus=postgres&reach=upstream', '#lens=backend~database'],
      iframeTitle: { en: 'Production Deployment live Archify proof', zh: '生产部署架构 Archify 实时成品' },
      name: { en: 'Production Deployment', zh: '生产部署' },
      meta: { en: 'Architecture · Blueprint · 12 nodes · 12 edges', zh: '架构图 · Blueprint · 12 节点 · 12 条关系' },
      title: { en: 'Production Deployment — regions, ownership, state, and audit', zh: '生产部署——区域、归属、状态与审计边界' }
    },
    leave: {
      artifact: 'cases/life/leave-plan.workflow.html',
      hash: '#focus=spring&reach=downstream',
      beats: [MAP, '#focus=spring&reach=downstream', '#focus=done&reach=upstream', '#lens=backend~security'],
      iframeTitle: { en: 'Annual leave plan live Archify artifact', zh: '年假规划 Archify 实时成品' },
      name: { en: 'Annual Leave', zh: '年假规划' },
      meta: { en: 'Workflow · Classic · 8 nodes · 7 edges', zh: '工作流 · Classic · 8 节点 · 7 条关系' },
      title: { en: 'Annual leave — four breaks, two rules, zero days wasted', zh: '一年的年假——四次拼假、两条规则、一天不浪费' }
    },
    classic: {
      artifact: 'gallery/artifacts/cache-miss.sequence.html',
      hash: '#route=web~db',
      embedHash: '#focus=web&reach=downstream',
      beats: [MAP, '#focus=web&reach=downstream', '#focus=db&reach=upstream', '#lens=database~security'],
      iframeTitle: { en: 'Cache Miss Request live Archify proof', zh: '缓存未命中请求 Archify 实时成品' },
      name: { en: 'Cache Miss', zh: '缓存未命中' },
      meta: { en: 'Sequence · Classic · 7 participants · 12 messages', zh: '时序图 · Classic · 7 个参与者 · 12 条消息' },
      title: { en: 'Cache Miss — authentication, fallback, return, and trace', zh: '缓存未命中——鉴权、回退、返回与追踪' }
    }
  };

  /* One-page answers: real explainer pages. The scroll walks each through five beats by
     driving the page's own reader (hover, source cards, style, follow-up dialog) — never its
     storage or keyboard focus, so a visitor's saved choices and scrolling stay theirs. */
  const PAGES = {
    tls: {
      page: 'cases/explainer/tls-first-visit.html',
      name: { en: 'First HTTPS Visit', zh: '第一次打开 HTTPS' },
      meta: { en: 'One-page answer · 4 panels · sequence diagram', zh: '一页式解答 · 4 个面板 · 时序图' },
      title: { en: 'What happens when a browser opens an HTTPS site for the first time?', zh: '浏览器第一次打开 HTTPS 网站时发生了什么？' },
      ask: 'Why is one round trip enough?'
    },
    repo: {
      page: 'cases/explainer/finalize-delivery.html',
      name: { en: 'Read a Repo', zh: '读代码仓库' },
      meta: { en: 'One-page answer · 4 panels · code pinned to a commit', zh: '一页式解答 · 4 个面板 · 代码固定到提交' },
      title: { en: 'Which modules does Archify finalize pass through, and how is the last good file kept?', zh: 'Archify finalize 经过哪些模块？失败时旧产物怎么保住？' },
      ask: '提交前为什么要先备份旧文件？'
    }
  };
  /* the style beat leaves the authored style; the middle style also flips light and dark */
  const PAGE_STYLES = ['editorial', 'product', 'swiss'];
  /* The pinned stage tells two chapters in order: four camera beats on a map, then five on a page. */
  const CHAPTERS = { map: 4, page: 5 };
  const TOTAL = CHAPTERS.map + CHAPTERS.page;

  let lang = ArchifySiteLanguage.read();
  let activeProof = 'signal';
  let activePage = lang === 'zh' ? 'repo' : 'tls';
  let mode = 'map';
  let beat = 0;
  let pageBeat = 0;
  const $ = id => document.getElementById(id);
  const btnLang = $('btn-lang');
  const proofStage = $('hero-proof-stage');
  const proofFrame = $('hero-proof-frame');
  const pageFrame = $('hero-page-frame');
  const proofPanel = $('hero-proof-panel');
  const proofOpen = $('proof-open');
  const proofMeta = $('proof-meta');
  const proofTitle = $('proof-title');
  const addressFile = $('address-file');
  const addressHash = $('address-hash');
  const beatCard = document.querySelector('.beat-card');
  const modeButtons = [...document.querySelectorAll('.mode-switch button')];
  const rails = { map: document.querySelector('.beat-rail[data-mode="map"]'), page: document.querySelector('.beat-rail[data-mode="page"]') };
  const ticks = { map: [...rails.map.querySelectorAll('.beat-tick')], page: [...rails.page.querySelectorAll('.beat-tick')] };

  const siteTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  /* both artifacts are same-origin, so their themes follow the site */
  function syncFrameTheme() {
    try { proofFrame.contentDocument.documentElement.setAttribute('data-theme', siteTheme()); } catch (_) {}
    pageDoc()?.querySelector(`[data-theme-choice="${siteTheme()}"]`)?.click();
  }
  window.addEventListener('archify:themechange', syncFrameTheme);

  function proofEmbedUrl(proof) {
    return `${proof.artifact}?embed=1&theme=${siteTheme()}${proof.embedHash || proof.hash}`;
  }

  function replaceFrameHash(hash) {
    try {
      const loc = proofFrame.contentWindow.location;
      if (loc.protocol === 'about:' || loc.hash === hash) return;
      loc.replace(loc.pathname + loc.search + hash);
    } catch (_) {}
  }

  function caption(prefix, index, changed) {
    $('beat-title').textContent = LANGS[lang][`${prefix}-${index}-t`];
    $('beat-body').textContent = LANGS[lang][`${prefix}-${index}-b`];
    if (changed) { beatCard.classList.remove('is-swapping'); void beatCard.offsetWidth; beatCard.classList.add('is-swapping'); }
  }

  function renderBeat(next, { apply = true } = {}) {
    const proof = PROOFS[activeProof];
    const hash = proof.beats[next];
    const changed = next !== beat;
    beat = next;
    ticks.map.forEach((tick, i) => tick.setAttribute('aria-pressed', String(i === next)));
    if (mode === 'map') {
      caption('beat', next, changed);
      addressHash.textContent = hash === MAP ? '' : hash;
      if (changed) { addressHash.classList.remove('is-flash'); void addressHash.offsetWidth; addressHash.classList.add('is-flash'); }
    }
    if (apply && changed) replaceFrameHash(hash);
  }

  function renderPageBeat(next) {
    const changed = next !== pageBeat;
    pageBeat = next;
    ticks.page.forEach((tick, i) => tick.setAttribute('aria-pressed', String(i === next)));
    if (mode === 'page') { caption('pbeat', next, changed); addressHash.textContent = ''; }
  }

  /* The window bar, tabs and caption belong to whichever chapter is showing. */
  function renderChrome({ focus = false } = {}) {
    const current = mode === 'map' ? activeProof : activePage;
    document.querySelectorAll('.spec-card').forEach(tab => {
      const visible = tab.dataset.mode === mode, selected = visible && tab.dataset.proof === current;
      tab.hidden = !visible;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.querySelector('.spec-name').textContent = (tab.dataset.mode === 'page' ? PAGES : PROOFS)[tab.dataset.proof].name[lang];
      if (selected && focus) tab.focus();
    });
    proofPanel.setAttribute('aria-labelledby', `proof-tab-${current}`);
    const entry = mode === 'map' ? PROOFS[activeProof] : PAGES[activePage];
    proofOpen.href = mode === 'map' ? `${entry.artifact}?present=1${entry.hash}` : entry.page;
    proofMeta.textContent = entry.meta[lang];
    proofTitle.textContent = entry.title[lang];
    addressFile.textContent = (entry.artifact || entry.page).split('/').pop();
    pageFrame.title = lang === 'zh' ? `${PAGES[activePage].name.zh} Archify 一页式解答` : `${PAGES[activePage].name.en} live Archify one-page answer`;
    if (mode === 'map') renderBeat(beat, { apply: false }); else renderPageBeat(pageBeat);
  }

  function renderProof(key, { focus = false } = {}) {
    const proof = PROOFS[key];
    if (!proof) return;
    activeProof = key;
    proofFrame.title = proof.iframeTitle[lang];
    if (proofFrame.dataset.proof !== key) {
      proofStage.classList.add('is-loading');
      proofFrame.dataset.proof = key;
      proofFrame.src = proofEmbedUrl(proof);
    }
    renderChrome({ focus });
  }

  function renderPage(key, { focus = false } = {}) {
    if (!PAGES[key]) return;
    activePage = key;
    if (mode === 'page') loadPage();
    renderChrome({ focus });
  }

  function setMode(next) {
    if (next === mode) return;
    if (mode === 'page') pageScene(-1);
    mode = next;
    proofStage.dataset.mode = next;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === next)));
    rails.map.hidden = next !== 'map';
    rails.page.hidden = next !== 'page';
    if (next === 'page') loadPage();
    renderChrome();
    caption(next === 'map' ? 'beat' : 'pbeat', next === 'map' ? beat : pageBeat, true);
  }

  proofFrame.addEventListener('load', () => {
    proofStage.classList.remove('is-loading');
    syncFrameTheme();
    replaceFrameHash(PROOFS[activeProof].beats[beat]);
  });
  document.querySelectorAll('.spec-card').forEach(tab => {
    tab.addEventListener('click', () => (tab.dataset.mode === 'page' ? renderPage : renderProof)(tab.dataset.proof));
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('.spec-card:not([hidden])')];
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      (tabs[next].dataset.mode === 'page' ? renderPage : renderProof)(tabs[next].dataset.proof, { focus: true });
    });
  });

  /* ══ Page chapter — the scene each beat asks of the live explainer ══ */
  let scene = {};
  let sceneArgs = [-1, 0];
  const pageDoc = () => {
    try { const doc = pageFrame.contentDocument; return doc?.documentElement.classList.contains('js') ? doc : null; } catch (_) { return null; }
  };
  function loadPage() {
    if (pageFrame.dataset.page === activePage) return;
    pageFrame.dataset.page = activePage;
    proofStage.classList.add('is-page-loading');
    pageFrame.src = PAGES[activePage].page;
  }
  pageFrame.addEventListener('load', () => {
    proofStage.classList.remove('is-page-loading');
    scene = {};
    syncFrameTheme();
    /* a source card waits for the page to stop scrolling, so it opens beside its citation */
    pageFrame.contentWindow.addEventListener('scroll', () => requestAnimationFrame(() => { if (mode === 'page') pageScene(...sceneArgs); }), { passive: true });
    if (mode === 'page') applyScroll();
  });

  function pageScene(local, progress = 0) {
    sceneArgs = [local, progress];
    const doc = pageDoc();
    if (!doc) return;
    const win = pageFrame.contentWindow, root = doc.documentElement, proof = PAGES[activePage];
    const fire = (element, type) => element?.dispatchEvent(new win.MouseEvent(type));
    const steps = [...doc.querySelectorAll('ol.steps > li')].filter(item => item.querySelector('[data-diagram-link]'));
    const cites = [...doc.querySelectorAll('.cite a[href^="#source-"]')];
    const panel = steps[0]?.closest('.panel');
    const pick = list => list[Math.min(list.length - 1, Math.floor(progress * list.length))] || null;
    scene.authored ??= root.dataset.style;
    scene.words ??= JSON.parse(doc.getElementById('explainer-reader-words')?.textContent || '{}');
    const style = local === 3 ? pick(PAGE_STYLES) : scene.authored;
    const next = {
      top: (local === 1 || local === 4) && panel ? Math.round(panel.getBoundingClientRect().top + win.scrollY - 16) : 0,
      step: local === 1 ? pick(steps) : null,
      cite: local === 2 ? pick(cites) : null,
      style,
      theme: local === 3 && style === PAGE_STYLES[1] ? (siteTheme() === 'dark' ? 'light' : 'dark') : siteTheme(),
      ask: local === 4 ? proof.ask.slice(0, Math.ceil(proof.ask.length * Math.min(1, progress * 1.8))) : null
    };
    if (next.theme !== scene.theme) doc.querySelector(`[data-theme-choice="${next.theme}"]`)?.click();
    if (next.top !== scene.top) win.scrollTo({ top: next.top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    if (next.step !== scene.step) {
      if (scene.step) { scene.step.classList.remove('walk-current'); fire(scene.step, 'mouseleave'); }
      if (next.step) { next.step.classList.add('walk-current'); fire(next.step, 'mouseenter'); }
    }
    /* the card is placed from the citation's position, so it opens once the page has settled */
    if (next.cite && Math.abs(win.scrollY - next.top) > 2) next.cite = scene.cite || null;
    if (next.cite !== scene.cite) {
      if (scene.cite) fire(scene.cite, 'mouseleave');
      if (next.cite) fire(next.cite, 'mouseenter');
    }
    if (next.style && next.style !== root.dataset.style) {
      root.dataset.style = next.style;
      const label = doc.querySelector('[data-style-label]'), swatch = doc.querySelector('[data-style-toggle] .style-swatch');
      if (label) label.textContent = scene.words.styles?.[next.style] || next.style;
      if (swatch) swatch.dataset.swatch = next.style;
      doc.querySelectorAll('[data-style-choice]').forEach(item => item.setAttribute('aria-checked', String(item.dataset.styleChoice === next.style)));
      win.dispatchEvent(new win.Event('resize'));
    }
    /* opened without showModal(), which would move keyboard focus into the frame */
    const dialog = doc.querySelector('.ask-dialog');
    if (dialog && next.ask !== null && panel) {
      if (!dialog.open) {
        const number = panel.querySelector('.panel-id')?.textContent.trim(), title = panel.dataset.title || panel.querySelector('h2')?.textContent.trim();
        dialog.querySelector('.ask-where').textContent = root.lang.startsWith('zh') ? `面板 ${number} · ${title}` : `Panel ${number} · ${title}`;
        dialog.querySelector('blockquote').hidden = true;
        dialog.style.cssText = 'position:fixed;inset:0;margin:auto;height:fit-content;z-index:40;box-shadow:0 30px 90px rgb(0 0 0/.3)';
        dialog.setAttribute('open', '');
      }
      dialog.querySelector('textarea').value = next.ask;
    } else if (dialog?.open) { dialog.removeAttribute('open'); dialog.style.cssText = ''; }
    Object.assign(scene, next);
  }

  function applyLang(l) {
    lang = ArchifySiteLanguage.write(l);
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
    btnLang.textContent = lang === 'zh' ? 'EN' : '中文';
    btnLang.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
    const dict = LANGS[lang];
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = dict[el.dataset.i18n];
      if (v !== undefined) el.innerHTML = v;
    });
    renderProof(activeProof);
  }

  applyLang(lang);

  /* ══ Reveal on enter ══ */
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold:.12, rootMargin:'0px 0px -40px 0px' });
    document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('.fade-up').forEach(el => el.classList.add('visible'));
  }

  /* ══ Stage orchestration — window flattens as it arrives, then the pinned
     scroll distance is split into four camera beats ══ */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stage = $('tour');

  function stageProgress() {
    const rect = stage.getBoundingClientRect();
    const vh = window.innerHeight;
    const enter = Math.min(1, Math.max(0, 1 - rect.top / (vh * 0.9)));
    const travel = Math.max(1, rect.height - vh);
    const pinned = Math.min(1, Math.max(0, -rect.top / travel));
    return { enter, pinned, rect, travel };
  }

  function applyScroll() {
    const { enter, pinned } = stageProgress();
    if (!reducedMotion.matches) stage.style.setProperty('--enter', enter.toFixed(3));
    const span = pinned * TOTAL;
    const fill = (list, offset) => list.forEach((tick, i) => tick.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, span - offset - i)) * 100)}%`));
    fill(ticks.map, 0);
    fill(ticks.page, CHAPTERS.map);
    const global = Math.min(TOTAL - 1, Math.floor(span));
    setMode(global < CHAPTERS.map ? 'map' : 'page');
    if (mode === 'map') { if (global !== beat) renderBeat(global); return; }
    const local = global - CHAPTERS.map;
    if (local !== pageBeat) renderPageBeat(local);
    pageScene(local, Math.min(1, Math.max(0, span - global)));
  }

  function scrollToBeat(global) {
    const { rect, travel } = stageProgress();
    const top = window.scrollY + rect.top + travel * ((global + (global < CHAPTERS.map ? 0.5 : 0.2)) / TOTAL);
    window.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }
  ticks.map.forEach((tick, i) => tick.addEventListener('click', () => scrollToBeat(i)));
  ticks.page.forEach((tick, i) => tick.addEventListener('click', () => scrollToBeat(CHAPTERS.map + i)));
  modeButtons.forEach(button => button.addEventListener('click', () => scrollToBeat(button.dataset.mode === 'map' ? 0 : CHAPTERS.map)));
  /* the page chapter's frame loads once the first fold has settled, not on the critical path */
  window.addEventListener('load', () => setTimeout(loadPage, 1200), { once: true });

  let scrollTick = false;
  const onScroll = () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => { scrollTick = false; applyScroll(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  /* the demo page keeps a desktop layout at least 1180 px wide, scaled into the window */
  const fitPage = () => pageFrame.style.setProperty('--page-scale', Math.min(1, pageFrame.parentElement.clientWidth / 1180).toFixed(4));
  /* the frame also narrows when the page chapter opens its caption rail */
  if ('ResizeObserver' in window) new ResizeObserver(fitPage).observe(pageFrame.parentElement);
  else window.addEventListener('resize', fitPage);
  fitPage();
  applyScroll();

  /* ══ Arrival effects: the finalize replay and the counting stats. Each arms only while its
     section is still below the fold, so nothing a reader already sees is hidden. ══ */
  function onArrival(element, arm, play) {
    if (!element || reducedMotion.matches || !('IntersectionObserver' in window) || element.getBoundingClientRect().top < innerHeight) return;
    arm();
    const seen = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      seen.disconnect();
      play();
    }, { threshold: .3 });
    seen.observe(element);
  }
  const trustRun = $('trust-run');
  onArrival(trustRun, () => trustRun.classList.add('is-armed'), () => trustRun.classList.replace('is-armed', 'is-run'));
  const counters = [...document.querySelectorAll('.receipt b')];
  onArrival(document.querySelector('.receipts'), () => counters.forEach(b => { b.dataset.final = b.textContent; }), () => {
    const start = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - start) / 1100), ease = 1 - Math.pow(1 - t, 3);
      counters.forEach(b => { b.textContent = b.dataset.final.replace(/\d+/g, n => String(Math.round(+n * ease))); });
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  /* ══ Closing prompt — types example requests in turn, maps and pages alike; the first is in the
     HTML, and nothing cycles under reduced motion ══ */
  const PROMPTS = {
    en: ['Use Archify to answer as one page: why did P99 jump while the mean stayed flat?', 'Use Archify to map our checkout services and show where the cache sits.', 'Use Archify to read this repository and show how a request reaches the database.', 'Use Archify to plan my annual leave around two comp days that expire in June.', 'Use Archify to answer as one page: what should I check before signing a lease?', "Use Archify to draw a timeline of last night's incident."],
    zh: ['用 Archify 一页回答：P99 暴涨、平均值几乎没变，为什么？', '用 Archify 画出我们的结账服务，标出缓存在哪一层。', '用 Archify 读一下这个仓库，画出一个请求怎么走到数据库。', '用 Archify 帮我排年假，有两天调休 6 月底过期。', '用 Archify 一页回答：第一次租房，签合同前要确认什么？', '用 Archify 画出昨晚那次事故的时间线。']
  };
  const ctaPrompt = $('cta-prompt');
  if (ctaPrompt && !reducedMotion.matches && 'IntersectionObserver' in window) {
    let index = 0;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function cycle() {
      for (;;) {
        await sleep(2600);
        for (let n = ctaPrompt.textContent.length; n >= 0; n -= 2) { ctaPrompt.textContent = ctaPrompt.textContent.slice(0, n); await sleep(14); }
        index = (index + 1) % PROMPTS[lang].length;
        const next = PROMPTS[lang][index];
        for (let n = 1; n <= next.length; n++) { ctaPrompt.textContent = next.slice(0, n); await sleep(lang === 'zh' ? 70 : 32); }
      }
    }
    let started = false;
    new IntersectionObserver(entries => { if (!started && entries.some(entry => entry.isIntersecting)) { started = true; cycle(); } }).observe(ctaPrompt);
  }

  /* ══ Hero pointer spotlight — fine pointers only, never under reduced motion ══ */
  const hero = document.querySelector('.hero');
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion.matches) {
    let spotTick = false, spotX = 0, spotY = 0;
    hero.addEventListener('pointermove', event => {
      spotX = event.clientX; spotY = event.clientY;
      if (spotTick) return;
      spotTick = true;
      requestAnimationFrame(() => {
        spotTick = false;
        const rect = hero.getBoundingClientRect();
        hero.style.setProperty('--mx', `${spotX - rect.left}px`);
        hero.style.setProperty('--my', `${spotY - rect.top}px`);
        hero.classList.add('is-pointing');
      });
    });
    hero.addEventListener('pointerleave', () => hero.classList.remove('is-pointing'));
  }

  /* ══ Diagram types — index list drives the preview plate ══ */
  const typeItems = [...document.querySelectorAll('.type-item')];
  const typeImgs = [...document.querySelectorAll('.type-plate img')];
  function selectType(key) {
    typeItems.forEach(item => {
      const on = item.dataset.type === key;
      item.classList.toggle('is-active', on);
      item.querySelector('button').setAttribute('aria-pressed', String(on));
    });
    typeImgs.forEach(img => img.classList.toggle('is-active', img.dataset.type === key));
  }
  typeItems.forEach(item => {
    const button = item.querySelector('button');
    button.addEventListener('click', () => selectType(item.dataset.type));
    button.addEventListener('mouseenter', () => { if (window.matchMedia('(hover: hover)').matches) selectType(item.dataset.type); });
  });

  /* ══ Agent command switcher ══ */
  const agentCommand = $('agent-command');
  const agentTabs = [...document.querySelectorAll('.agent-tabs button')];
  function selectAgent(tab, focus) {
    agentTabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    agentCommand.textContent = `npx -y skills@latest add https://archify.si --skill archify --agent ${tab.dataset.agent} --global --copy --yes`;
    if (focus) tab.focus();
  }
  agentTabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectAgent(tab));
    tab.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      selectAgent(agentTabs[(i + step + agentTabs.length) % agentTabs.length], true);
    });
  });

  /* ══ Copy buttons ══ */
  document.querySelectorAll('.cmd-copy').forEach(button => button.addEventListener('click', async () => {
    const text = button.dataset.copyText || $(button.dataset.copyFrom).textContent;
    try { await navigator.clipboard.writeText(text); } catch (_) { return; }
    const label = button.querySelector('.cmd-copy-label');
    button.classList.add('is-copied');
    label.textContent = LANGS[lang].copied;
    setTimeout(() => { button.classList.remove('is-copied'); label.textContent = LANGS[lang].copy; }, 1600);
  }));

  /* ══ Demo lightbox — zero network cost until the trigger is pressed ══ */
  const DEMO_SRC = 'https://github.com/user-attachments/assets/78570807-ba1d-4737-953f-55504a378a87';
  const demoOpen = $('demo-open');
  const demoDialog = $('demo-dialog');
  const demoVideo = $('demo-video');

  demoOpen.addEventListener('click', () => {
    demoVideo.src = DEMO_SRC;
    document.documentElement.classList.add('demo-lock');
    demoDialog.showModal();
    demoVideo.play().catch(() => {});
  });
  $('demo-close').addEventListener('click', () => demoDialog.close());
  demoDialog.addEventListener('click', event => {
    if (event.target === demoDialog) demoDialog.close();
  });
  demoDialog.addEventListener('close', () => {
    demoVideo.pause();
    demoVideo.removeAttribute('src');
    demoVideo.load();
    document.documentElement.classList.remove('demo-lock');
    demoOpen.focus();
  });
