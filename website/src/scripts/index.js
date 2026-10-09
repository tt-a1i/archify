
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

  let lang = ArchifySiteLanguage.read();
  let activeProof = 'signal';
  let beat = 0;
  const $ = id => document.getElementById(id);
  const btnLang = $('btn-lang');
  const proofStage = $('hero-proof-stage');
  const proofFrame = $('hero-proof-frame');
  const proofPanel = $('hero-proof-panel');
  const proofOpen = $('proof-open');
  const proofMeta = $('proof-meta');
  const proofTitle = $('proof-title');
  const addressFile = $('address-file');
  const addressHash = $('address-hash');
  const beatCard = document.querySelector('.beat-card');
  const beatTicks = [...document.querySelectorAll('.beat-tick')];

  const siteTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  /* the artifact is same-origin, so its own theme attribute follows the site */
  function syncFrameTheme() {
    try { proofFrame.contentDocument.documentElement.setAttribute('data-theme', siteTheme()); } catch (_) {}
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

  function renderBeat(next, { apply = true } = {}) {
    const proof = PROOFS[activeProof];
    const hash = proof.beats[next];
    const changed = next !== beat;
    beat = next;
    beatTicks.forEach((tick, i) => tick.setAttribute('aria-pressed', String(i === next)));
    $('beat-title').textContent = LANGS[lang][`beat-${next}-t`];
    $('beat-body').textContent = LANGS[lang][`beat-${next}-b`];
    addressHash.textContent = hash === MAP ? '' : hash;
    if (changed) {
      beatCard.classList.remove('is-swapping'); void beatCard.offsetWidth; beatCard.classList.add('is-swapping');
      addressHash.classList.remove('is-flash'); void addressHash.offsetWidth; addressHash.classList.add('is-flash');
    }
    if (apply && changed) replaceFrameHash(hash);
  }

  function renderProof(key, { focus = false } = {}) {
    const proof = PROOFS[key];
    if (!proof) return;
    activeProof = key;
    document.querySelectorAll('.spec-card').forEach(tab => {
      const selected = tab.dataset.proof === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.querySelector('.spec-name').textContent = PROOFS[tab.dataset.proof].name[lang];
      if (selected && focus) tab.focus();
    });
    proofPanel.setAttribute('aria-labelledby', `proof-tab-${key}`);
    proofOpen.href = `${proof.artifact}?present=1${proof.hash}`;
    proofMeta.textContent = proof.meta[lang];
    proofTitle.textContent = proof.title[lang];
    proofFrame.title = proof.iframeTitle[lang];
    addressFile.textContent = proof.artifact.split('/').pop();
    if (proofFrame.dataset.proof !== key) {
      proofStage.classList.add('is-loading');
      proofFrame.dataset.proof = key;
      proofFrame.src = proofEmbedUrl(proof);
    }
    renderBeat(beat, { apply: false });
  }

  proofFrame.addEventListener('load', () => {
    proofStage.classList.remove('is-loading');
    syncFrameTheme();
    replaceFrameHash(PROOFS[activeProof].beats[beat]);
  });
  document.querySelectorAll('.spec-card').forEach(tab => {
    tab.addEventListener('click', () => renderProof(tab.dataset.proof));
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
      renderProof(tabs[next].dataset.proof, { focus: true });
    });
  });

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
  const BEATS = beatTicks.length;

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
    const span = pinned * BEATS;
    const next = Math.min(BEATS - 1, Math.floor(span));
    beatTicks.forEach((tick, i) => tick.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, span - i)) * 100)}%`));
    if (next !== beat) renderBeat(next);
  }

  beatTicks.forEach((tick, i) => tick.addEventListener('click', () => {
    const { rect, travel } = stageProgress();
    const top = window.scrollY + rect.top + travel * ((i + 0.5) / BEATS);
    window.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }));

  let scrollTick = false;
  const onScroll = () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => { scrollTick = false; applyScroll(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  applyScroll();

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

  /* ══ Light/dark compare ══ */
  const compareStage = $('compare-stage');
  $('compare-range').addEventListener('input', event => compareStage.style.setProperty('--split', `${event.target.value}%`));

  /* ══ Agent command switcher ══ */
  const agentCommand = $('agent-command');
  const agentTabs = [...document.querySelectorAll('.agent-tabs button')];
  function selectAgent(tab, focus) {
    agentTabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    agentCommand.textContent = `npx -y skills add tt-a1i/archify --skill archify --agent ${tab.dataset.agent} --global --copy --yes`;
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
