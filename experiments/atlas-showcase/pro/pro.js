// Atlas Pro shell and helpers, shared by the ten architecture-health views.
// Reads window.ATLAS_DATA (../data.js), window.Atlas (../lib.js) and
// window.ATLAS_SIGNALS (signals.js).
(function () {
  const D = window.ATLAS_DATA, S = window.ATLAS_SIGNALS, A = window.Atlas;
  const VIEWS = [
    ['p01-overview', 'Overview'], ['p02-heatmap', 'Health matrix'], ['p03-priority', 'Core vs risk'],
    ['p04-layers', 'Layers & roles'], ['p05-interfaces', 'Interfaces'], ['p06-duplication', 'Duplication'],
    ['p07-concurrency', 'Locks & concurrency'], ['p08-organization', 'Organization'], ['p09-scorecards', 'Scorecards'],
    ['p10-plan', 'Remediation plan'],
  ];
  const DIMS = [
    { key: 'complexity', label: 'Complexity', ask: 'Functions too branched to read and test' },
    { key: 'coupling', label: 'Coupling', ask: 'Imports too many modules or breaks a boundary rule' },
    { key: 'separation', label: 'Separation of concerns', ask: 'CLI or I/O code mixed into views, models or logic (no MVC split)' },
    { key: 'abstraction', label: 'Interfaces', ask: 'Consumers reach inside instead of one entry point' },
    { key: 'concurrency', label: 'Locks & concurrency', ask: 'Locks, child processes, parallel work' },
    { key: 'duplication', label: 'Duplication', ask: 'Repeated blocks of code' },
    { key: 'organization', label: 'Organization', ask: 'Oversized files, generic names, mixed roles' },
  ];
  const TIERS = { core: 'Core', supporting: 'Supporting', entry: 'Entry point', leaf: 'Leaf', isolated: 'Isolated', vendor: 'Vendored' };
  const TIER_ORDER = ['core', 'supporting', 'entry', 'leaf', 'isolated', 'vendor'];
  const LEVEL = ['Healthy', 'Watch', 'Problem'];
  const ROLE = { entry: 'Entry / controller', view: 'View', domain: 'Domain logic', model: 'Model / contract', io: 'I/O service', shared: 'Shared helper' };
  const esc = A.esc, fmt = A.fmt;

  const mods = D.modules.map((m, i) => ({ ...m, i, s: S.modules[i], a: A.modules[i] }));
  const ordered = mods.slice().sort((x, y) => TIER_ORDER.indexOf(x.s.tier) - TIER_ORDER.indexOf(y.s.tier) || y.s.reach - x.s.reach || y.s.loc - x.s.loc);
  const fileOf = (p) => S.files.find((f) => f.path === p);
  const levelSum = (m) => (m.s.dims ? Object.values(m.s.dims).reduce((t, d) => t + d.level, 0) : 0);
  const problems = (m) => (m.s.dims ? DIMS.filter((d) => m.s.dims[d.key].level === 2) : []);

  function shell(current) {
    const bar = document.createElement('header');
    bar.className = 'topbar';
    bar.innerHTML = `<div class="brand"><b>Architecture health</b><span>${esc(D.repository.name)} @ ${esc((D.repository.revision || 'working tree').slice(0, 8))}</span></div>
      <nav class="views" aria-label="Views">${VIEWS.map(([id, name]) => `<a href="${id}.html"${id === current ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>
      <button class="method-btn" type="button" id="methodBtn">How it is measured</button>`;
    document.body.prepend(bar);
    const dlg = document.createElement('dialog');
    dlg.className = 'method';
    dlg.innerHTML = `<header><b>How each signal is measured</b><button class="btn ghost" type="button">Close</button></header>
      <dl>${Object.entries({ Core: S.method.core, 'Roles (MVC)': Object.values(S.method.roles).join(' · '), 'Mixed roles': S.method.mixed, Interfaces: S.method.abstraction, 'Locks & concurrency': S.method.concurrency, Duplication: S.method.duplication, Organization: S.method.organization,
        'Complexity & coupling': 'From Archify code-analysis findings (cyclomatic complexity, module fan-out, configured boundary rules).', Levels: 'Each dimension is Healthy, Watch or Problem by the thresholds in signals.js. There is no single overall score.' })
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    document.body.append(dlg);
    document.getElementById('methodBtn').addEventListener('click', () => dlg.showModal());
    dlg.querySelector('button').addEventListener('click', () => dlg.close());
  }

  const tierBadge = (t) => `<span class="tier ${t}">${TIERS[t]}</span>`;
  const lvlBadge = (l, text) => `<span class="lvl l${l}">${esc(text ?? LEVEL[l])}</span>`;

  // Evidence lines for one module and dimension: [{file, line, text}] plus a summary.
  function evidence(mi, key) {
    const m = mods[mi];
    const files = S.files.filter((f) => f.module === mi && !f.vendor);
    const out = [];
    if (key === 'complexity') {
      D.functions.map((fn, i) => ({ fn, i })).filter(({ fn }) => files.some((f) => f.path === D.files[fn[0]][0]) && fn[6] !== -1 && D.findings[fn[6]].severity !== 'info')
        .sort((a, b) => b.fn[3] - a.fn[3]).slice(0, 6).forEach(({ fn }) => out.push({ file: D.files[fn[0]][0], line: fn[2], text: `${fn[1]}: complexity ${fn[3]}, ${fn[5]} lines` }));
    } else if (key === 'coupling') {
      (D.moduleEdges || []).filter(([a, b]) => a === mi && a !== b).forEach(([, b, w]) => out.push({ file: m.path, line: null, text: `imports ${D.modules[b].label} (${w} imports)` }));
      A.boundary.filter((b) => (b.edges || []).some(([x]) => A.files[x].module === mi)).forEach((b) => (b.imports || []).forEach((im) => out.push({ file: im.file, line: im.line, text: `forbidden: imports ${im.to}` })));
    } else if (key === 'separation') {
      files.filter((f) => f.mixed || f.blended).forEach((f) => {
        const ls = [...(f.evidence.entry || []).slice(0, 2), ...(f.evidence.io || []).slice(0, 2), ...(f.evidence.view || []).slice(0, 1)];
        ls.forEach((n) => out.push({ file: f.path, line: n, text: (f.lines[n] || '').trim() }));
        if (!ls.length) out.push({ file: f.path, line: null, text: `roles: ${f.strong.map((r) => ROLE[r]).join(' + ')}` });
      });
    } else if (key === 'abstraction') {
      S.surfaceEdges.filter(([, b]) => b === mi).forEach(([a, , fs]) => out.push({ file: D.modules[a].label, line: null, text: `reaches ${fs.length} file${fs.length > 1 ? 's' : ''}: ${fs.map((x) => D.files[x][0].split('/').pop()).join(', ')}` }));
    } else if (key === 'concurrency') {
      m.s.lockCalls.forEach((c) => out.push({ file: c.file, line: c.line, text: `${c.lock}() in ${c.in} (complexity ${c.inComplexity}), held ${c.holdLines} lines, ${c.guarded ? 'released in finally' : 'no finally release'}` }));
      files.forEach((f) => {
        const c = f.concurrency;
        c.spawn.lines.slice(0, 2).forEach((n) => out.push({ file: f.path, line: n, text: 'child process' }));
        c.parallel.lines.slice(0, 2).forEach((n) => out.push({ file: f.path, line: n, text: 'parallel promises' }));
        c.exclusiveCreate.lines.slice(0, 2).forEach((n) => out.push({ file: f.path, line: n, text: "exclusive create ('wx')" }));
      });
    } else if (key === 'duplication') {
      S.clones.filter((c) => files.some((f) => f.path === c.a.file || f.path === c.b.file)).slice(0, 6)
        .forEach((c) => out.push({ file: c.a.file, line: c.a.start, text: `${c.lines} lines repeated at ${c.b.file}:${c.b.start}` }));
    } else if (key === 'organization') {
      files.filter((f) => f.loc > S.thresholds.organization.bigFile).forEach((f) => out.push({ file: f.path, line: null, text: `${fmt(f.loc)} lines in one file` }));
      files.filter((f) => f.generic).forEach((f) => out.push({ file: f.path, line: null, text: 'generic file name' }));
      if (m.s.roleKinds >= 3) out.push({ file: m.path, line: null, text: `files serve ${m.s.roleKinds} roles: ${Object.entries(m.s.roles).filter(([, n]) => n).map(([r, n]) => `${ROLE[r]} ${n}`).join(', ')}` });
    }
    return out;
  }

  function promptFor(mi, key) {
    const m = mods[mi], d = DIMS.find((x) => x.key === key), dim = m.s.dims?.[key];
    const ev = evidence(mi, key).slice(0, 10);
    const goal = {
      complexity: 'Split the most complex functions into named helpers with tests; keep behaviour identical.',
      coupling: 'Reduce the module\'s imports and remove any import a boundary rule forbids, routing it through an allowed layer.',
      separation: 'Separate the CLI/controller and I/O code from the view, model and domain logic: move argument parsing and process exits into one entry module, keep the rest pure and importable.',
      abstraction: 'Give the module one public entry point (index.mjs) that re-exports what consumers use, and point consumers at it instead of internal files.',
      concurrency: 'Keep each lock\'s critical section small: acquire as late and release as early as possible in a try/finally, and move the work between them into named functions.',
      duplication: 'Extract each repeated block into one shared function and call it from both places.',
      organization: 'Split oversized files by responsibility and rename generic files after what they contain.',
    }[key];
    return [`Module ${m.path || m.label} (${TIERS[m.s.tier]}, depended on by ${m.s.reach} module${m.s.reach === 1 ? "" : "s"}) in ${D.repository.name}.`,
      `Problem area: ${d.label}: ${dim ? `${LEVEL[dim.level]}, ${dim.value} ${dim.unit}${dim.note ? ` (${dim.note})` : ''}` : ''}.`,
      'Evidence:', ...ev.map((e) => `- ${e.file}${e.line ? `:${e.line}` : ''} ${e.text}`),
      `Goal: ${goal}`, 'Do not change behaviour. Re-run Archify code analysis afterwards and report what changed.'].join('\n');
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ } ta.remove();
    }
    if (btn) { const t = btn.textContent; btn.textContent = 'Copied for AI'; btn.disabled = true; setTimeout(() => { btn.textContent = t; btn.disabled = false; }, 1400); }
  }

  function evidenceHtml(list, limit = 8) {
    if (!list.length) return '<div class="muted">No evidence lines for this signal.</div>';
    const one = list.every((e) => e.file === list[0].file);
    return `${one ? `<div class="mono muted" style="margin-bottom:4px;overflow-wrap:anywhere">${esc(list[0].file)}</div>` : ''}<div class="evidence">${list.slice(0, limit).map((e) => `<span class="ln">${e.line ?? ''}</span>${one ? '' : `${esc(e.file)}  `}${esc(e.text)}`).join('\n')}</div>${list.length > limit ? `<div class="muted" style="margin-top:6px">and ${list.length - limit} more</div>` : ''}`;
  }

  window.Pro = { D, S, A, VIEWS, DIMS, TIERS, TIER_ORDER, LEVEL, ROLE, mods, ordered, fileOf, levelSum, problems, shell, tierBadge, lvlBadge, evidence, evidenceHtml, promptFor, copy, esc, fmt };
})();
