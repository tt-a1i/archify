(function () {
  var source = document.getElementById('bauify-atlas-data');
  if (!source) return;
  var atlas = JSON.parse(source.textContent);
  var ui = JSON.parse(document.getElementById('bauify-analysis').textContent).ui || {};
  var tr = window.__archifyMakeAnalysisTranslator(ui.messages || {});
  var root = document.documentElement;
  var standalone = ui.mode === 'standalone';
  var TONE = { error: '#FB7185', warning: '#FBBF24', info: '#60A5FA' };
  var NAMES = { 'complexity/function': tr("Complex functions"), 'coupling/import-cycle': tr("Import cycles"), 'coupling/cycle': tr("Module cycles"), 'coupling/hub': tr("Hub modules"), 'coupling/concentration': tr("Concentration"), 'coupling/internal-leak': tr("Internal imports"), 'architecture/boundary': tr("Boundary violations"), 'redundancy/duplicate-block': tr("Duplicate code") };
  var M = atlas.modules, F = atlas.files, E = atlas.edges, FN = atlas.functions, FD = atlas.findings;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function icon(name) {
    var paths = {
      expand: '<path d="M8 3H3v5M3 3l6 6M16 21h5v-5M21 21l-6-6M21 8V3h-5M21 3l-6 6M3 16v5h5M3 21l6-6"></path>',
      clear: '<circle cx="12" cy="12" r="8"></circle><path d="m9 9 6 6M15 9l-6 6"></path>',
      classic: '<path d="M4 5h16v12H4zM8 21h8M12 17v4M8 9l3 3-3 3M14 15h3"></path>',
      evidence: '<path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h4"></path>',
      files: '<path d="M5 3h9l4 4v14H5zM14 3v5h5M8 13h7M8 17h5"></path>',
      dependencies: '<circle cx="6" cy="7" r="2.5"></circle><circle cx="18" cy="17" r="2.5"></circle><path d="M7.9 9.4 15.6 14.6M6 9.5V13a3 3 0 0 0 3 3h6.5"></path>',
      functions: '<path d="M5 3h14v18H5zM9 8l-2 4 2 4M15 8l2 4-2 4M13 7l-2 10"></path>',
      modules: '<rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="13" width="8" height="8" rx="2"></rect><path d="M11 7h5a2 2 0 0 1 2 2v4M13 17H8a2 2 0 0 1-2-2v-4"></path>'
    };
    return '<svg class="atlas-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths[name] + '</svg>';
  }
  function iconButton(kind, label, extraClass, attributes) {
    return '<button type="button" class="atlas-icon-button atlas-' + kind + (extraClass || '') + '" aria-label="' + esc(label) + '" data-analysis-tip="' + esc(label) + '"' + (attributes || '') + '>' + icon(kind) + '</button>';
  }
  function plural(n, one, many) {
    if (ui.locale === 'zh-CN') return fmt(n) + ({ file: ' 个文件', module: ' 个模块', function: ' 个函数', import: ' 条导入', 'file dependency': ' 条文件依赖', dependency: ' 条依赖', line: ' 行', 'internal file': ' 个内部文件', more: ' 项其他文件' }[one] || ' ' + tr(one));
    return fmt(n) + ' ' + (n === 1 ? one : many || one + 's');
  }
  var fnsByFile = F.map(function () { return []; }), fnSlot = [];
  FN.forEach(function (fn, i) { fnSlot[i] = fnsByFile[fn[0]].length; fnsByFile[fn[0]].push(i); });
  var edgesByModule = M.map(function () { return { out: 0, in: 0 }; });
  E.forEach(function (e) { var a = F[e[0]][1], b = F[e[1]][1]; if (a !== b) { edgesByModule[a].out++; edgesByModule[b].in++; } });
  var hubOf = {}; FD.forEach(function (f, i) { if (f.kind === 'module') hubOf[f.module] = i; });
  // A module's public surface as the code uses it: its files that other modules
  // import, with how many modules import each. A fact, not a finding.
  var surface = M.map(function () { return { files: {}, consumers: {} }; });
  E.forEach(function (e) {
    var a = F[e[0]][1], b = F[e[1]][1]; if (a === b) return;
    var s = surface[b]; (s.files[e[1]] = s.files[e[1]] || {})[a] = true; s.consumers[a] = true;
  });

  var panel = document.createElement('section');
  panel.lang = ui.locale || 'en';
  panel.id = 'bauify-atlas'; panel.hidden = true; panel.setAttribute('aria-label', tr("Code analysis atlas"));
  var totals = [[F.length, 'files', 'file'], [E.length, 'dependencies', 'file dependency'], [FN.length, 'functions', 'function'], [M.length, 'modules', 'module']];
  panel.innerHTML = '<nav class="atlas-nav" aria-label="' + esc(tr('Atlas navigation')) + '"><div class="atlas-title">' + esc(tr('Atlas')) + '</div>' +
    '<div class="atlas-controls">' + iconButton('expand', tr('Disable sector zoom'), '', ' aria-pressed="true"') + iconButton('clear', tr('Clear selection')) + (standalone ? '' : iconButton('classic', tr('Classic view'))) + '</div></nav>' +
    '<div class="atlas-tabs" role="tablist" aria-label="' + esc(tr('Atlas view')) + '"><button type="button" class="atlas-tab" id="atlas-tab-map" role="tab" aria-selected="true" tabindex="0" aria-controls="atlas-map-panel" data-analysis-tip="' + esc(tr('Relationships and findings')) + '">' + esc(tr('Map')) + '</button><button type="button" class="atlas-tab" id="atlas-tab-files" role="tab" aria-selected="false" tabindex="-1" aria-controls="atlas-files-panel" data-analysis-tip="' + esc(tr('Search captured files')) + '">' + esc(tr('Files')) + '</button></div>' +
    '<div class="atlas-body"><nav class="atlas-files-pane" id="atlas-files-panel" role="tabpanel" aria-labelledby="atlas-tab-files" hidden><input class="atlas-file-query" type="search" aria-label="' + esc(tr('Find a captured file')) + '"><div class="atlas-file-list"></div></nav><div class="atlas-stage" id="atlas-map-panel" role="tabpanel" aria-labelledby="atlas-tab-map"><canvas role="img"></canvas><div class="atlas-tip" hidden></div></div><aside class="atlas-side"><section class="atlas-selection" hidden></section><section class="atlas-stats"><h3 class="k">' + esc(tr('Totals')) + '</h3><div class="stats">' + totals.map(function (stat) {
      var label = plural(stat[0], stat[2], stat[2] === 'file dependency' ? 'file dependencies' : null);
      return '<div class="stat" tabindex="0" role="img" aria-label="' + esc(label) + '" data-analysis-tip="' + esc(tr(stat[2] === 'file dependency' ? 'file dependencies' : stat[1])) + '">' + icon(stat[1]) + '<b>' + fmt(stat[0]) + '</b></div>';
    }).join('') + '</div></section><div class="atlas-side-content"></div></aside></div>';
  (standalone ? document.querySelector('.analysis-stage') : document.body).appendChild(panel);
  var stage = panel.querySelector('.atlas-stage'), canvas = panel.querySelector('canvas'), tip = panel.querySelector('.atlas-tip'), side = panel.querySelector('.atlas-side');
  var filePane = panel.querySelector('.atlas-files-pane'), fileQuery = panel.querySelector('.atlas-file-query'), fileList = panel.querySelector('.atlas-file-list');
  function renderFiles() {
    var wanted = fileQuery.value.trim().toLowerCase();
    fileList.innerHTML = F.map(function (file, index) {
      if (wanted && file[0].toLowerCase().indexOf(wanted) < 0) return '';
      return '<button type="button" data-file="' + index + '"' + (index === state.file ? ' aria-current="true"' : '') + '>' + esc(file[0]) + '</button>';
    }).join('') || '<p role="status">' + esc(tr('No captured files match.')) + '</p>';
  }
  function fileMarkdown(index) {
    var file = F[index];
    var names = fnsByFile[index].map(function (i) { return tr('{name} (line {line})', { name: FN[i][1], line: FN[i][2] }); });
    return '# ' + file[0] + '\n\n' + tr('Module: ') + M[file[1]].label + '\n\n' + tr('Captured functions:') + '\n' + (names.length ? names.map(function (name) { return '- ' + name; }).join('\n') : tr('none')) + '\n\n' + tr('This is navigation context from the saved analysis, not fresh source or tool verification.') + '\n' + tr('Source content and complete diagnostic/task evidence are not included.');
  }
  function showTab(files, focusSearch) {
    filePane.hidden = !files;
    stage.hidden = files;
    panel.querySelector('#atlas-tab-map').setAttribute('aria-selected', files ? 'false' : 'true');
    panel.querySelector('#atlas-tab-files').setAttribute('aria-selected', files ? 'true' : 'false');
    panel.querySelector('#atlas-tab-map').tabIndex = files ? -1 : 0;
    panel.querySelector('#atlas-tab-files').tabIndex = files ? 0 : -1;
    if (files) { renderFiles(); if (focusSearch) fileQuery.focus(); }
    else draw('fade');
  }
  panel.querySelector('#atlas-tab-map').addEventListener('click', function () { showTab(false); });
  panel.querySelector('#atlas-tab-files').addEventListener('click', function () { showTab(true, true); });
  panel.querySelector('.atlas-tabs').addEventListener('keydown', function (event) {
    var tabs = Array.from(panel.querySelectorAll('.atlas-tab')), index = tabs.indexOf(event.target), next;
    if (index < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); showTab(next === 1); tabs[next].focus();
  });
  fileQuery.addEventListener('input', renderFiles);
  fileList.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-file]');
    if (!button) return;
    var index = Number(button.dataset.file);
    select(F[index][1], -1, undefined, index);
    fileList.querySelector('[data-file="' + index + '"]').focus({ preventScroll: true });
  });
  canvas.setAttribute('aria-label', tr("Dependency atlas: ") + plural(M.length, 'module') + tr(" around a circle, ") + plural(F.length, 'file') + tr(" grouped by module, ") + plural(E.length, 'file dependency', tr("file dependencies")) + tr(" drawn between them, and ") + plural(FN.length, 'function') + tr(" as spikes whose length is their complexity. The side panel lists the same findings and modules."));

  // ---- state ----
  var state = { focusModule: -1, finding: -1, file: -1, hover: null };
  var expansionEnabled = true, focusZoom = 1;
  var geometryKey = '', geometryTarget = null, geometryFrom = null, geometryPending = false;
  var LABEL_FONT = '11px ui-monospace, Menlo, Consolas, monospace';
  // Long module names are cut on the circle (the tooltip and side panel keep them whole).
  function shortLabel(label) { return label.length > 20 ? '…' + label.slice(-19) : label; }
  // Many curves add up: fainter strokes for denser graphs keep strands readable.
  function density(n, most) { return Math.max(0.05, Math.min(most, 8 / Math.sqrt(Math.max(n, 1)))); }
  var geo = null, marks = [];

  // ---- colours: module hues spaced around the wheel, lightness by theme ----
  function cssVar(name, fallback) { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback; }
  function theme() {
    var dark = (root.getAttribute('data-theme') || '') !== 'light';
    return { dark: dark, bg: cssVar('--bg', dark ? '#0b1220' : '#ffffff'), text: cssVar('--text', dark ? '#f8fafc' : '#0f172a'), muted: cssVar('--text-muted', dark ? '#94a3b8' : '#475569'), grid: cssVar('--panel-border', dark ? '#1e293b' : '#e2e8f0') };
  }
  function hue(i, t, alpha) {
    var h = Math.round(((i / Math.max(M.length, 1)) * 330 + 200) % 360);
    return 'hsla(' + h + ', ' + (t.dark ? 62 : 55) + '%, ' + (t.dark ? 64 : 42) + '%, ' + (alpha == null ? 1 : alpha) + ')';
  }

  // ---- geometry: angles for files, module spans, radii ----
  function layout(w, h, dpr) {
    var selected = expansionEnabled ? state.focusModule : -1;
    var key = w + ':' + h + ':' + dpr + ':' + selected + ':' + focusZoom;
    if (key === geometryKey && geometryTarget) { if (!anim.focus) geo = geometryTarget; return; }
    var old = geo, size = Math.max(200, Math.min(w, h));
    var measure = canvas.getContext('2d'); measure.font = LABEL_FONT;
    var longest = M.reduce(function (n, m) { return Math.max(n, measure.measureText(shortLabel(m.label)).width); }, 0);
    var R = Math.max(40, Math.min(size * 0.34, (size / 2 - Math.min(longest, size * 0.22) - 12) / 1.53));
    // Reuse the PR prototype's partition: selected files gain angular space;
    // all other sectors compress within the same circle, without overlap.
    var weights = F.map(function (f, i) { return selected < 0 ? 1 : f[1] === selected ? (2 + Math.min(fnsByFile[i].length, 45) / 12) * focusZoom : 0.55; });
    var gap = 2.2, slots = Math.max(1, weights.reduce(function (n, value) { return n + value; }, 0) + gap * M.length);
    var ang = new Float64Array(F.length), span = [], fileSpan = [], k = 0, fi = 0;
    M.forEach(function (m, mi) {
      var start = k;
      while (fi < F.length && F[fi][1] === mi) {
        ang[fi] = -Math.PI / 2 + 2 * Math.PI * (k + weights[fi] / 2) / slots;
        fileSpan[fi] = 2 * Math.PI * weights[fi] / slots;
        k += weights[fi]; fi += 1;
      }
      span.push([-Math.PI / 2 + 2 * Math.PI * start / slots, -Math.PI / 2 + 2 * Math.PI * k / slots]);
      k += gap;
    });
    geometryTarget = { w: w, h: h, dpr: dpr, cx: w / 2, cy: h / 2, R: R, slot: 2 * Math.PI / slots, ang: ang, span: span, fileSpan: fileSpan,
      tick: R * 0.04, spike0: R * 1.06, spikeMax: R * 0.36, arc: R * 1.48, label: R * 1.53 };
    geometryKey = key;
    if (old && old.w === w && old.h === h && old.dpr === dpr && !motion.matches) {
      geometryFrom = old; anim.focus = performance.now();
    } else { geometryFrom = null; geo = geometryTarget; anim.focus = 0; }
  }
  function updateGeometry(now, snap) {
    if (!geometryTarget) return;
    if (!anim.focus || !geometryFrom || snap) { geo = geometryTarget; anim.focus = 0; return; }
    var p = Math.min(1, Math.max(0, (now - anim.focus) / FADE_MS)), ease = p * p * (3 - 2 * p), from = geometryFrom, to = geometryTarget;
    geo = Object.assign({}, to, {
      ang: Float64Array.from(to.ang, function (value, i) { return from.ang[i] + (value - from.ang[i]) * ease; }),
      span: to.span.map(function (value, i) { return value.map(function (angle, j) { return from.span[i][j] + (angle - from.span[i][j]) * ease; }); }),
      fileSpan: to.fileSpan.map(function (value, i) { return from.fileSpan[i] + (value - from.fileSpan[i]) * ease; })
    });
    if (p === 1) { geo = to; geometryFrom = null; anim.focus = 0; }
  }
  function pt(a, r) { return [geo.cx + r * Math.cos(a), geo.cy + r * Math.sin(a)]; }

  function mid(mi) { return (geo.span[mi][0] + geo.span[mi][1]) / 2; }
  function spikeLen(cx) { return geo.spikeMax * (0.06 + 0.94 * Math.min(cx, 26) / 26); }
  function fnAngle(i) {
    var fn = FN[i], n = fnsByFile[fn[0]].length;
    return geo.ang[fn[0]] + (n > 1 ? (fnSlot[i] / (n - 1) - 0.5) * geo.fileSpan[fn[0]] * 0.8 : 0);
  }
  // A dependency is a cubic curve bundled through both modules' mid-angles near the
  // centre; one inside a module stays near the rim.
  function curvePoints(a, b) {
    var ma = F[a][1], mb = F[b][1], R = geo.R * 0.985;
    var p0 = pt(geo.ang[a], R), p3 = pt(geo.ang[b], R);
    if (ma === mb) return [p0, pt(geo.ang[a], geo.R * 0.8), pt(geo.ang[b], geo.R * 0.8), p3];
    return [p0, pt(mid(ma), geo.R * 0.42), pt(mid(mb), geo.R * 0.42), p3];
  }
  function curve(ctx, a, b) {
    var c = curvePoints(a, b);
    ctx.moveTo(c[0][0], c[0][1]); ctx.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]);
  }
  function along(c, u) {
    var v = 1 - u, a = v * v * v, b = 3 * v * v * u, d = 3 * v * u * u, e = u * u * u;
    return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
  }

  // ---- what the current selection lights up ----
  function selection(finding) {
    if (finding == null) finding = state.finding;
    var sel = { modules: {}, files: {}, edges: null, fns: {}, tone: null, any: false, arcs: {}, entries: {} };
    if (state.focusModule !== -1 && finding === -1) { sel.modules[state.focusModule] = true; sel.any = true; }
    if (state.file !== -1 && finding === -1) { sel.files[state.file] = true; sel.anchor = state.file; sel.any = true; sel.tone = TONE.info; fnsByFile[state.file].forEach(function (i) { sel.fns[i] = true; }); }
    var f = FD[finding];
    if (f) {
      sel.any = true; sel.tone = TONE[f.severity] || TONE.info;
      if (f.kind === 'function' && f.fn != null) { sel.fns[f.fn] = true; sel.files[FN[f.fn][0]] = true; sel.anchor = FN[f.fn][0]; }
      if (f.kind === 'cycle') { f.files.forEach(function (x) { sel.files[x] = true; }); sel.edges = f.path.map(function (x, i) { return [x, f.path[(i + 1) % f.path.length]]; }); }
      if (f.kind === 'module' || f.kind === 'area') sel.modules[f.module] = true;
      if (f.kind === 'file') { (f.files || [f.file]).forEach(function (file) { sel.files[file] = true; }); sel.anchor = f.file; }
      if (f.kind === 'modules') f.modules.forEach(function (x) { sel.modules[x] = true; });
      if (f.kind === 'edges') { sel.edges = f.edges; f.edges.forEach(function (e) { sel.files[e[0]] = true; sel.files[e[1]] = true; }); }
      if (f.kind === 'edges' && f.module != null) { sel.arcs[f.module] = true; (f.entries || []).forEach(function (x) { sel.entries[x] = true; }); }
    }
    return sel;
  }
  function inSel(sel, file) { return sel.files[file] || sel.modules[F[file][1]]; }

  // ---- drawing ----
  // The whole picture is painted into an off-screen frame; the visible canvas
  // composites it with the motion layer (opening reveal, cross-fade between
  // selections, a light travelling around a selected import cycle) and the hover
  // mark. Motion only shows what changed or where a cycle goes, and is skipped
  // when the reader asks for reduced motion.
  var frame = document.createElement('canvas'), previous = document.createElement('canvas');
  var REVEAL_MS = 700, FADE_MS = 300, HOP_MS = 900;
  var anim = { focus: 0, reveal: 0, fade: 0, flow: 0, flowFor: -1, raf: 0, timer: 0 };
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function draw(how, bounds) {
    if (panel.hidden || stage.hidden) return;
    bounds = bounds || stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    var still = motion.matches, old = geo;
    layout(bounds.width, bounds.height, window.devicePixelRatio || 1);
    geometryPending = false; updateGeometry(performance.now(), still);
    var resized = !old || old.w !== geo.w || old.h !== geo.h || old.dpr !== geo.dpr;
    var fade = how === 'fade' && !resized && !anim.focus && !still && frame.width > 0;
    if (fade) { previous.width = frame.width; previous.height = frame.height; previous.getContext('2d').drawImage(frame, 0, 0); }
    var W = Math.round(geo.w * geo.dpr), H = Math.round(geo.h * geo.dpr);
    if (resized) {
      canvas.style.width = W / geo.dpr + 'px'; canvas.style.height = H / geo.dpr + 'px';
      canvas.width = W; canvas.height = H;
      state.hover = null; tip.hidden = true;
    }
    frame.width = W; frame.height = H;
    paint(frame.getContext('2d'));
    root.setAttribute('data-bauify-atlas-drawn', String(E.length));
    var now = performance.now(), f = FD[state.finding];
    anim.reveal = how === 'reveal' && !still ? now : 0;
    anim.fade = fade && previous.width === W && previous.height === H ? now : 0;
    var flowing = f && f.kind === 'cycle' && f.path.length > 1 && !still;
    if (!flowing) { anim.flow = 0; anim.flowFor = -1; }
    else if (anim.flowFor !== state.finding) { anim.flow = now; anim.flowFor = state.finding; }
    var busy = !resized || present(now);
    markMotion();
    if (busy) schedule();
  }
  // Motion state on <html>, set as soon as it changes, for tests and styling.
  function markMotion() {
    if (anim.reveal || anim.fade || anim.focus || geometryPending) root.setAttribute('data-bauify-atlas-animating', 'true'); else root.removeAttribute('data-bauify-atlas-animating');
    root.setAttribute('data-bauify-atlas-flow', anim.flow ? 'on' : 'off');
  }
  // Frames come from requestAnimationFrame; a timer backs it up where frames are
  // throttled (a page not in view), so time-based motion still reaches its end.
  function schedule() {
    if (anim.raf || panel.hidden || stage.hidden) return;
    anim.raf = requestAnimationFrame(tick);
    anim.timer = setTimeout(tick, 40);
  }
  function tick() {
    // One clock for every start time: a frame's own timestamp can precede them.
    var now = performance.now();
    cancelAnimationFrame(anim.raf); clearTimeout(anim.timer);
    anim.raf = 0; anim.timer = 0;
    if (panel.hidden || stage.hidden) return;
    var busy = present(now);
    markMotion();
    if (busy) schedule();
  }
  function present(now) {
    var ctx = canvas.getContext('2d'), busy = false;
    var repaint = geometryPending;
    if (geometryPending) { geometryPending = false; layout(geo.w, geo.h, geo.dpr); }
    if (anim.focus) { updateGeometry(now, motion.matches); repaint = true; busy = !!anim.focus; }
    if (repaint) paint(frame.getContext('2d'));
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (anim.reveal) {
      // Opening: the picture grows out from the centre, curves first, then rim and labels.
      var p = Math.min(1, (now - anim.reveal) / REVEAL_MS), e = 1 - Math.pow(1 - p, 3);
      ctx.save(); ctx.beginPath(); ctx.arc(geo.cx * geo.dpr, geo.cy * geo.dpr, Math.max(1, e * Math.hypot(geo.w, geo.h) / 2 * geo.dpr), 0, 2 * Math.PI); ctx.clip();
      ctx.globalAlpha = 0.25 + 0.75 * e; ctx.drawImage(frame, 0, 0); ctx.restore();
      if (p < 1) busy = true; else anim.reveal = 0;
    } else if (anim.fade) {
      // A new focus or finding cross-fades in, so it is clear what changed.
      var q = Math.min(1, (now - anim.fade) / FADE_MS), s = q * q * (3 - 2 * q);
      ctx.globalAlpha = 1 - s; ctx.drawImage(previous, 0, 0); ctx.globalAlpha = s; ctx.drawImage(frame, 0, 0); ctx.globalAlpha = 1;
      if (q < 1) busy = true; else anim.fade = 0;
    } else ctx.drawImage(frame, 0, 0);
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    if (anim.flow) { drawFlow(ctx, now); busy = true; }
    drawHover(ctx, theme());
    return busy;
  }
  // A light runs along the selected import cycle, hop by hop, and back to its start.
  function drawFlow(ctx, now) {
    var f = FD[state.finding]; if (!f || f.kind !== 'cycle') return;
    var path = f.path, n = path.length, phase = (Math.max(0, now - anim.flow) % (n * HOP_MS)) / HOP_MS;
    var hop = Math.floor(phase), u = phase - hop, c = curvePoints(path[hop], path[(hop + 1) % n]), tone = TONE[f.severity] || TONE.info;
    ctx.save(); ctx.fillStyle = tone; ctx.shadowColor = tone; ctx.shadowBlur = 14;
    for (var j = 5; j >= 0; j--) {
      var w = u - j * 0.045; if (w < 0) continue;
      var q = along(c, w); ctx.globalAlpha = 1 - j * 0.16;
      ctx.beginPath(); ctx.arc(q[0], q[1], 4.5 - j * 0.6, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
  }
  function paint(ctx) {
    marks = [];
    var t = theme(), dpr = geo.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);
    var sel = selection(), dimmed = sel.any;
    // guide rings
    ctx.lineWidth = 1; ctx.strokeStyle = t.grid;
    [0.42, 0.8, 1.0, 1.42].forEach(function (f) { ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.R * f, 0, 2 * Math.PI); ctx.stroke(); });
    // dependencies, one path per source module
    var focusM = state.finding === -1 ? state.focusModule : -1;
    var byModule = M.map(function () { return []; });
    E.forEach(function (e) { byModule[F[e[0]][1]].push(e); });
    ctx.lineCap = 'round';
    var litCount = 0, inCount = 0;
    if (dimmed) E.forEach(function (e) {
      var mi = F[e[0]][1];
      if (focusM !== -1 && F[e[1]][1] === focusM && mi !== focusM) inCount++;
      else if ((focusM !== -1 && mi === focusM) || (state.finding !== -1 && inSel(sel, e[0]) && inSel(sel, e[1])) || (sel.anchor != null && (e[0] === sel.anchor || e[1] === sel.anchor))) litCount++;
    });
    var baseAlpha = density(E.length, t.dark ? 0.26 : 0.22), litAlpha = density(litCount, 0.85) * 2.2, inAlpha = density(inCount, 0.7) * 1.8;
    byModule.forEach(function (list, mi) {
      var faint = [], lit = [], inbound = [];
      list.forEach(function (e) {
        if (!dimmed) { faint.push(e); return; }
        if (focusM !== -1 && F[e[1]][1] === focusM && mi !== focusM) inbound.push(e);
        else if ((focusM !== -1 && mi === focusM) || (state.finding !== -1 && inSel(sel, e[0]) && inSel(sel, e[1])) || (sel.anchor != null && (e[0] === sel.anchor || e[1] === sel.anchor))) lit.push(e);
        else faint.push(e);
      });
      ctx.beginPath(); faint.forEach(function (e) { curve(ctx, e[0], e[1]); });
      ctx.strokeStyle = hue(mi, t, dimmed ? Math.min(0.05, baseAlpha) : baseAlpha); ctx.lineWidth = 0.6; ctx.stroke();
      if (lit.length) { ctx.beginPath(); lit.forEach(function (e) { curve(ctx, e[0], e[1]); }); ctx.strokeStyle = hue(mi, t, Math.min(0.85, litAlpha)); ctx.lineWidth = 1.1; ctx.stroke(); }
      if (inbound.length) { ctx.beginPath(); inbound.forEach(function (e) { curve(ctx, e[0], e[1]); }); ctx.strokeStyle = t.text; ctx.globalAlpha = Math.min(0.7, inAlpha); ctx.lineWidth = 1.1; ctx.stroke(); ctx.globalAlpha = 1; }
    });
    // the selected finding's own edges, drawn last and thick
    if (sel.edges && sel.edges.length) {
      ctx.save(); ctx.shadowColor = sel.tone; ctx.shadowBlur = 8;
      ctx.beginPath(); sel.edges.forEach(function (e) { curve(ctx, e[0], e[1]); });
      ctx.strokeStyle = sel.tone; ctx.lineWidth = 2.6; ctx.stroke(); ctx.restore();
    }
    // files
    F.forEach(function (f, i) {
      var a = geo.ang[i], p0 = pt(a, geo.R), p1 = pt(a, geo.R + geo.tick), on = !dimmed || inSel(sel, i);
      marks.push({ type: 'file', index: i, p0: p0, p1: p1 });
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
      ctx.strokeStyle = sel.files[i] ? sel.tone : hue(f[1], t, on ? 0.95 : 0.2); ctx.lineWidth = sel.files[i] ? 2.4 : 1.3; ctx.stroke();
    });
    // A focused module's surface: a mark inside the rim on each file other modules import,
    // longer for more importing modules.
    if (focusM !== -1) Object.keys(surface[focusM].files).forEach(function (k) {
      var i = Number(k), n = Object.keys(surface[focusM].files[k]).length, a = geo.ang[i];
      var q0 = pt(a, geo.R * 0.985), q1 = pt(a, geo.R * (0.985 - Math.min(0.12, 0.025 + 0.012 * n)));
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.strokeStyle = t.text; ctx.lineWidth = 2.6; ctx.stroke();
    });
    // Entry files of a selected internal-imports finding: a ring on the tick.
    Object.keys(sel.entries).forEach(function (k) {
      var p = pt(geo.ang[Number(k)], geo.R + geo.tick + 5);
      ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI); ctx.strokeStyle = t.text; ctx.lineWidth = 1.6; ctx.stroke();
    });
    // functions as spikes; reported ones carry a dot in their severity colour
    var dots = [];
    FN.forEach(function (fn, i) {
      var a = fnAngle(i), len = spikeLen(fn[3]), hit = fn[6] !== -1 ? FD[fn[6]] : null;
      var on = !dimmed || inSel(sel, fn[0]) || sel.fns[i];
      var p0 = pt(a, geo.spike0), p1 = pt(a, geo.spike0 + len);
      marks.push({ type: 'function', index: i, p0: p0, p1: p1 });
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
      ctx.strokeStyle = hit ? TONE[hit.severity] || TONE.info : t.muted;
      ctx.globalAlpha = (hit ? 1 : fn[3] >= 8 ? 0.85 : 0.45) * (on ? 1 : 0.15);
      ctx.lineWidth = hit ? 1.6 : 0.8; ctx.stroke(); ctx.globalAlpha = 1;
      if (hit && (!hit.accepted || hit.severity === 'error')) dots.push([p1, TONE[hit.severity] || TONE.info, on, sel.fns[i]]);
    });
    dots.forEach(function (d) {
      ctx.globalAlpha = d[2] ? 1 : 0.2; ctx.beginPath(); ctx.arc(d[0][0], d[0][1], d[3] ? 5 : 3, 0, 2 * Math.PI); ctx.fillStyle = d[1]; ctx.fill();
      if (d[3]) { ctx.lineWidth = 2; ctx.strokeStyle = t.text; ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
    // module arcs and labels
    ctx.font = LABEL_FONT; ctx.textBaseline = 'middle';
    M.forEach(function (m, mi) {
      var on = !dimmed || sel.modules[mi] || sel.arcs[mi] || F.some(function (f, i) { return f[1] === mi && sel.files[i]; });
      var hub = hubOf[mi] != null || sel.arcs[mi];
      ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.arc, geo.span[mi][0], Math.max(geo.span[mi][1], geo.span[mi][0] + 0.004));
      ctx.strokeStyle = hue(mi, t, on ? 1 : 0.25); ctx.lineWidth = hub ? 5 : 2; ctx.lineCap = 'butt'; ctx.stroke();
      var a = mid(mi), deg = (a * 180 / Math.PI + 360) % 360, flip = deg > 90 && deg < 270, p = pt(a, geo.label);
      // A module too narrow for its own label is named only when selected or hovered.
      var named = (geo.span[mi][1] - geo.span[mi][0]) * geo.arc >= 12 || sel.modules[mi] || state.focusModule === mi;
      if (!named) return;
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(flip ? a + Math.PI : a);
      ctx.textAlign = flip ? 'right' : 'left'; ctx.fillStyle = hue(mi, t, on ? 1 : 0.35);
      ctx.fillText(shortLabel(m.label), 0, 0); ctx.restore();
    });
    ctx.lineCap = 'round';
  }
  function drawHover(ctx, t) {
    var h = state.hover; if (!h) return;
    ctx.save(); ctx.strokeStyle = t.text; ctx.lineWidth = 2;
    if (h.type === 'function') { var a = fnAngle(h.index), p0 = pt(a, geo.spike0), p1 = pt(a, geo.spike0 + spikeLen(FN[h.index][3])); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
    if (h.type === 'file') { var q0 = pt(geo.ang[h.index], geo.R - 2), q1 = pt(geo.ang[h.index], geo.R + geo.tick + 2); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke(); }
    if (h.type === 'module') {
      ctx.lineWidth = 7; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.arc, geo.span[h.index][0], geo.span[h.index][1]); ctx.stroke();
      var a = mid(h.index), deg = (a * 180 / Math.PI + 360) % 360, flip = deg > 90 && deg < 270, p = pt(a, geo.label);
      ctx.globalAlpha = 1; ctx.font = LABEL_FONT; ctx.textBaseline = 'middle'; ctx.fillStyle = t.text;
      ctx.translate(p[0], p[1]); ctx.rotate(flip ? a + Math.PI : a); ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText(shortLabel(M[h.index].label), 0, 0);
    }
    ctx.restore();
  }

  // Hit the rendered segments first. This covers tips and bodies (including
  // unreported functions), and stays aligned during animation and resizing.
  function hit(x, y) {
    if (!geo) return null;
    var best = null, bestDistance = 4;
    marks.forEach(function (mark) {
      var dx = mark.p1[0] - mark.p0[0], dy = mark.p1[1] - mark.p0[1];
      var length2 = dx * dx + dy * dy;
      var t = length2 ? Math.max(0, Math.min(1, ((x - mark.p0[0]) * dx + (y - mark.p0[1]) * dy) / length2)) : 0;
      var distance = Math.hypot(x - mark.p0[0] - t * dx, y - mark.p0[1] - t * dy);
      if (distance < bestDistance) { best = mark; bestDistance = distance; }
    });
    if (best) return { type: best.type, index: best.index };
    var dx = x - geo.cx, dy = y - geo.cy, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
    var measure = canvas.getContext('2d'); measure.font = LABEL_FONT;
    var selected = selection();
    for (var mi = 0; mi < M.length; mi++) {
      var delta = Math.atan2(Math.sin(a - mid(mi)), Math.cos(a - mid(mi)));
      var half = (geo.span[mi][1] - geo.span[mi][0]) / 2;
      if (Math.abs(r - geo.arc) <= 5 && Math.abs(delta) <= half + 0.01) return { type: 'module', index: mi };
      // Labels extend radially outwards on both halves of the circle. Do not
      // treat the empty area outside an entire sector as a clickable label.
      var along = dx * Math.cos(mid(mi)) + dy * Math.sin(mid(mi));
      var across = -dx * Math.sin(mid(mi)) + dy * Math.cos(mid(mi));
      var labelStart = geo.label;
      var named = (geo.span[mi][1] - geo.span[mi][0]) * geo.arc >= 12 || state.focusModule === mi || selected.modules[mi];
      if (named && Math.abs(across) <= 7 && along >= labelStart - 4 && along <= labelStart + measure.measureText(shortLabel(M[mi].label)).width + 4) return { type: 'module', index: mi };
    }
    return null;
  }
  function tipText(h) {
    if (h.type === 'module') { var m = M[h.index], c = F.filter(function (f) { return f[1] === h.index; }).length; return '<b>' + esc(m.label) + '</b>' + (m.path && m.path !== m.label ? esc(m.path) + '<br>' : '') + plural(c, 'file') + tr(" · fan-in ") + m.fanIn + tr(" · fan-out ") + m.fanOut + (hubOf[h.index] != null ? tr(" · reported hub") : '') + ("<br>" + tr("Click to focus its dependencies.")); }
    if (h.type === 'file') { var f = F[h.index]; return '<b>' + esc(f[0]) + '</b>' + esc(M[f[1]].label) + ' · ' + plural(f[2], 'line') + ' · ' + plural(fnsByFile[h.index].length, 'function'); }
    var fn = FN[h.index], fd = fn[6] !== -1 ? FD[fn[6]] : null;
    return '<b>' + esc(fn[1]) + '</b>' + esc(F[fn[0]][0]) + ':' + fn[2] + ("<br>" + tr("complexity ")) + fn[3] + tr(" · nesting ") + fn[4] + ' · ' + plural(fn[5], 'line') + (fd ? ("<br>" + tr("Reported (")) + esc(fd.severity) + tr("). Click to select.") : '');
  }
  canvas.addEventListener('mousemove', function (e) {
    var b = canvas.getBoundingClientRect(), h = hit(e.clientX - b.left, e.clientY - b.top);
    var same = h && state.hover && h.type === state.hover.type && h.index === state.hover.index;
    if (!same) { state.hover = h; schedule(); }
    if (!h) { tip.hidden = true; return; }
    if (!same || tip.hidden) tip.innerHTML = tipText(h);
    tip.hidden = false;
    var x = e.clientX - b.left + 14, y = e.clientY - b.top + 14;
    tip.style.left = Math.max(8, Math.min(x, b.width - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(y, b.height - tip.offsetHeight - 8)) + 'px';
  });
  canvas.addEventListener('mouseleave', function () { tip.hidden = true; if (state.hover) { state.hover = null; schedule(); } });
  canvas.addEventListener('click', function (e) {
    var b = canvas.getBoundingClientRect(), h = hit(e.clientX - b.left, e.clientY - b.top);
    if (!h) { select(-1, -1); return; }
    if (h.type === 'module') select(state.focusModule === h.index ? -1 : h.index, -1);
    else if (h.type === 'function' && FN[h.index][6] !== -1) selectFinding(FN[h.index][6]);
    else select(F[h.type === 'function' ? FN[h.index][0] : h.index][1], -1);
  });
  canvas.addEventListener('wheel', function (e) {
    if (panel.hidden || !expansionEnabled || state.focusModule === -1 || e.ctrlKey || !e.deltaY) return;
    var delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1);
    var zoom = Math.max(0.65, Math.min(3.8, focusZoom * Math.exp(-Math.max(-180, Math.min(180, delta)) * 0.002)));
    e.preventDefault();
    if (zoom === focusZoom) return;
    var now = performance.now(); updateGeometry(now, motion.matches); focusZoom = zoom;
    state.hover = null; tip.hidden = true;
    geometryPending = true;
    // Reuse the focus clock and paint once per frame, including a burst of wheel events.
    if (motion.matches) draw('focus'); else { markMotion(); schedule(); }
  }, { passive: false });

  // ---- side panel ----
  function selectFinding(index) {
    if (index === -1) { select(state.focusModule, -1); return; }
    // Reuse the current finding projection, including C7 locations and
    // boundary/internal-import edges; do not maintain another kind registry.
    var selected = selection(index);
    var modules = Object.keys(selected.modules).concat(Object.keys(selected.arcs)).map(Number);
    Object.keys(selected.files).forEach(function (file) { modules.push(F[file][1]); });
    var owner = modules.length && modules.every(function (mi) { return mi === modules[0]; }) ? modules[0] : -1;
    select(owner, index);
  }
  function select(module, finding, saved, file) {
    updateGeometry(performance.now(), motion.matches);
    var view = saved ? saved.view : sideView();
    if (saved) focusZoom = saved.zoom;
    else if (module !== state.focusModule) focusZoom = 1;
    if (!saved && (module !== state.focusModule || finding !== state.finding)) view.moduleDetails = false;
    state.file = Number.isInteger(file) && file >= 0 && file < F.length ? file : -1;
    if (state.file !== -1) { module = F[state.file][1]; finding = -1; }
    state.focusModule = module; state.finding = finding;
    state.hover = null; tip.hidden = true;
    root.setAttribute('data-bauify-atlas-focus', module === -1 ? '' : M[module].id);
    root.setAttribute('data-bauify-atlas-finding', finding === -1 ? '' : FD[finding].id);
    panel.querySelector('.atlas-clear').disabled = module === -1 && finding === -1;
    if (!filePane.hidden) renderFiles();
    renderSide(view, !saved); if (!stage.hidden) draw('fade');
  }
  function sideView() {
    var modules = side.querySelector('.module-list');
    return {
      scroll: side.scrollTop,
      modules: modules ? modules.scrollTop : 0,
      groups: new Set(Array.from(side.querySelectorAll('details[data-group][open]'), function (group) { return group.dataset.group; })),
      coverage: !!side.querySelector('.atlas-metrics[open]'),
      moduleDetails: !!side.querySelector('.selected-details[open]')
    };
  }
  function findingTitle(f) { return window.__archifyAnalysisFindingTitle ? window.__archifyAnalysisFindingTitle(f.id) : f.title; }
  function selectedCard() {
    var f = FD[state.finding];
    if (f) {
      var what = '';
      if (f.kind === 'function' && f.fn != null) { var fn = FN[f.fn]; what = F[fn[0]][0] + ':' + fn[2] + tr(" · complexity ") + fn[3] + tr(" · nesting ") + fn[4] + ' · ' + plural(fn[5], 'line') + tr(". Curves: dependencies of its file."); }
      if (f.kind === 'cycle') what = tr("Path: ") + f.path.map(function (x) { return F[x][0].split('/').pop(); }).join(' → ') + tr(" → back");
      if (f.kind === 'modules') what = f.modules.map(function (x) { return M[x].label; }).join(', ');
      if (f.kind === 'module' || f.kind === 'area') what = tr("fan-in") + " " + M[f.module].fanIn + tr(" · fan-out ") + M[f.module].fanOut;
      if (f.kind === 'file') what = (f.files || [f.file]).map(function (file) { return F[file][0]; }).join(' · ');
      if (f.kind === 'edges') what = plural(f.edges.length, 'import') + tr(" cross the rule.");
      if (f.kind === 'edges' && f.module != null) {
        var reachedIn = {}; f.edges.forEach(function (e) { reachedIn[e[1]] = true; });
        what = plural(f.edges.length, 'import') + tr(" from other modules reach ") + plural(Object.keys(reachedIn).length, 'internal file') + tr(" of ") + M[f.module].label + (f.entries && f.entries.length ? tr("; ringed: its entry point ") + f.entries.map(function (x) { return F[x][0].split('/').pop(); }).join(', ') : tr("; it has no entry file")) + '.';
      }
      return '<div class="selected"><div class="selected-heading"><i style="background:' + (TONE[f.severity] || TONE.info) + '"></i><h4>' + esc(findingTitle(f)) + '</h4>' + iconButton('evidence', tr(standalone ? 'Open source evidence' : 'Open evidence in Classic view'), ' atlas-evidence', ' data-id="' + esc(f.id) + '"') + '</div><p>' + esc(what) + (f.accepted ? tr(" · accepted in baseline") : '') + '</p></div>';
    }
    if (state.file !== -1) {
      var picked = F[state.file];
      var markdown = fileMarkdown(state.file);
      return '<div class="selected"><h4>' + esc(picked[0]) + '</h4><p>' + esc(tr("Module ")) + esc(M[picked[1]].label) + '</p><textarea class="atlas-file-markdown" readonly aria-label="' + esc(tr("Captured file Markdown")) + '">' + esc(markdown) + '</textarea><button type="button" class="atlas-file-download">' + esc(tr("Download .md")) + '</button></div>';
    }
    if (state.focusModule !== -1) {
      var m = M[state.focusModule], files = F.filter(function (x) { return x[1] === state.focusModule; }).length;
      var fns = FN.filter(function (fn) { return F[fn[0]][1] === state.focusModule; });
      var sf = surface[state.focusModule], used = Object.keys(sf.files).sort(function (a, b) { return Object.keys(sf.files[b]).length - Object.keys(sf.files[a]).length || (F[a][0] < F[b][0] ? -1 : 1); });
      var surfaceText = used.length
        ? tr("Imported from outside through ") + fmt(used.length) + tr(" of its ") + plural(files, 'file') + tr(", by ") + plural(Object.keys(sf.consumers).length, 'module') + tr(" (marked inside the rim): ") + used.slice(0, 4).map(function (k) { return F[k][0].split('/').pop() + ' ' + Object.keys(sf.files[k]).length; }).join(', ') + (used.length > 4 ? tr(" and ") + plural(used.length - 4, 'more', 'more') : '') + '.'
        : tr("No other module imports it.");
      return '<div class="selected"><h4>' + esc(m.label) + '</h4><p>' + plural(files, 'file') + ' · ' + plural(fns.length, 'function') + tr(" · fan-in ") + m.fanIn + tr(" · fan-out ") + m.fanOut + '</p><details class="selected-details"><summary>' + tr('Module details') + '</summary><p>' + tr("Coloured curves: dependencies inside it and its ") + plural(edgesByModule[state.focusModule].out, 'dependency', 'dependencies') + tr(" on other modules. Neutral curves: ") + plural(edgesByModule[state.focusModule].in, 'dependency', 'dependencies') + (tr(" of other modules on it.") + "<br>") + esc(surfaceText) + '</p></details></div>';
    }
    return '';
  }
  side.addEventListener('click', function (event) {
    if (!event.target.classList.contains('atlas-file-download') || state.file === -1) return;
    var markdown = fileMarkdown(state.file);
    var blob = new Blob([markdown], { type: 'text/markdown' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = F[state.file][0].split('/').pop().replace(/\.[^.]+$/, '') + '.md';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  function renderSide(view, openSelected) {
    view = view || sideView();
    var focus = document.activeElement, row = side.contains(focus) && ['data-finding', 'data-module'].find(function (name) { return focus.hasAttribute(name); });
    var selected = side.querySelector('.atlas-selection'), card = selectedCard();
    selected.hidden = !card;
    selected.innerHTML = card ? '<h3 class="k">' + esc(tr('Selection')) + '</h3>' + card : '';
    var moduleDetails = selected.querySelector('.selected-details');
    if (moduleDetails) moduleDetails.open = view.moduleDetails;
    var h = '';
    var groups = {};
    FD.forEach(function (f, i) { (groups[f.code] = groups[f.code] || []).push(i); });
    var codes = Object.keys(groups).sort();
    h += ("<div class=\"k\">" + tr("Findings · ")) + FD.length + '</div>';
    if (!FD.length) h += ("<div class=\"note\">" + tr("No rule fired within the checks that ran.") + "</div>");
    codes.forEach(function (code) {
      var list = groups[code].slice().sort(function (a, b) { var r = { error: 0, warning: 1, info: 2 }; return (r[FD[a].severity] - r[FD[b].severity]) || (FD[a].title < FD[b].title ? -1 : 1); });
      h += '<details data-group="' + esc(code) + '"' + (view.groups.has(code) || (openSelected && list.indexOf(state.finding) !== -1) ? ' open' : '') + '><summary>' + esc(NAMES[code] || code) + ' · ' + list.length + '</summary>' + list.map(function (i) {
        var f = FD[i];
        return '<button type="button" class="row' + (i === state.finding ? ' active' : '') + (f.accepted ? ' accepted' : '') + '" data-finding="' + i + '"><i style="background:' + (TONE[f.severity] || TONE.info) + '"></i><span class="t" title="' + esc(findingTitle(f)) + '">' + esc(findingTitle(f)) + '</span><span class="n">' + esc(tr(f.severity)) + '</span></button>';
      }).join('') + '</details>';
    });
    if (atlas.measured && FN.length) {
      var counts = []; for (var c = 0; c < 20; c++) counts.push(0);
      FN.forEach(function (fn) { counts[Math.max(1, Math.min(fn[3], 20)) - 1]++; });
      var max = Math.max.apply(Math, counts);
      var scale = tr('Cyclomatic complexity · square-root scale');
      h += '<section class="atlas-metric"><h3 class="k"><span tabindex="0" data-analysis-tip="' + esc(scale) + '" aria-label="' + esc(scale) + '">' + tr('Function complexity') + '</span></h3><div class="hist" role="img" aria-label="' + esc(tr('Function counts by complexity 1 to 20 or more: ') + counts.join(', ')) + '">' + counts.map(function (n, i) {
        return '<div class="' + (i >= 14 ? 'hot' : '') + '" data-analysis-tip="' + esc((i === 19 ? '20+' : i + 1) + ': ' + plural(n, 'function')) + '" style="height:' + (n ? Math.max(2, Math.round(100 * Math.sqrt(n / max))) : 0) + '%"></div>';
      }).join('') + '</div><div class="axis"><span>1</span><span>15</span><span>20+</span></div></section>';
    }
    var order = M.map(function (m, i) { return i; }).sort(function (a, b) { return (M[b].fanIn + M[b].fanOut) - (M[a].fanIn + M[a].fanOut) || (M[a].label < M[b].label ? -1 : 1); });
    var moduleRow = function (i) {
      return '<button type="button" class="row' + (i === state.focusModule ? ' active' : '') + '" data-module="' + i + '"><i style="background:' + hue(i, theme()) + '"></i><span class="t">' + esc(M[i].label) + (hubOf[i] != null ? tr(" · hub") : '') + '</span><span class="n">' + M[i].fanIn + ' / ' + M[i].fanOut + '</span></button>';
    };
    h += '<section class="atlas-metric"><h3 class="k" id="atlas-module-heading">' + tr('Module coupling · in / out') + '</h3><div class="module-list" role="region" aria-labelledby="atlas-module-heading" tabindex="0">' + order.map(moduleRow).join('') + '</div></section>';
    h += '<details class="atlas-metrics"' + (view.coverage ? ' open' : '') + '><summary>' + tr('Coverage and reading guide') + '</summary>';
    var cov = atlas.coverage, total = Math.max(cov.records, 1);
    var breakdown = fmt(cov.resolved) + tr(' resolved · ') + fmt(cov.external) + tr(' external · ') + fmt(cov.unknown) + tr(' unresolved') + (cov.outside ? ' · ' + fmt(cov.outside) + tr(' outside the analyzed scope') : '') + (cov.parseErrors ? ' · ' + plural(cov.parseErrors, 'file') + tr(' failed to parse') : '') + (cov.notCompiled ? ' · ' + plural(cov.notCompiled, 'source file') + tr(' without a command') : '');
    h += '<div class="k">' + tr('Dependency records · ') + fmt(cov.records) + '</div><div class="bar" tabindex="0" role="img" aria-label="' + esc(breakdown) + '" data-analysis-tip="' + esc(breakdown + tr('. Unresolved records draw no curve, so a missing curve does not prove there is no dependency.')) + '">' +
      [[cov.resolved, '#34D399'], [cov.external, '#64748B'], [cov.unknown, '#FBBF24'], [cov.outside, '#94A3B8']].map(function (part) { return '<span style="width:' + (100 * (part[0] || 0) / total) + '%;background:' + part[1] + '"></span>'; }).join('') + '</div>';
    h += ("<div class=\"k\">" + tr("Reading the atlas") + "</div>" + "<div class=\"legend\">" + "<span>" + "<i style=\"background:") + hue(0, theme()) + ("\">" + "</i>" + tr("outer arc: module (thick: reported hub)") + "</span>" + "<span>" + "<i style=\"background:") + theme().muted + ("\">" + "</i>" + tr("tick: file · spike: function, length = complexity") + "</span>" + "<span>" + "<i style=\"background:#FBBF24;height:8px;width:8px;border-radius:50%\">" + "</i>" + tr("dot: reported function, severity colour") + "</span>" + "<span>" + "<i style=\"background:") + hue(3, theme(), 0.6) + ("\">" + "</i>" + tr("curve: file dependency, coloured by the importing module") + "</span>" + "<span>" + "<i style=\"background:") + theme().text + ("\">" + "</i>" + tr("mark inside the rim: a focused module's file that other modules import") + "</span>" + "</div>") + '</details>';
    side.querySelector('.atlas-side-content').innerHTML = h;
    side.querySelector('.module-list').scrollTop = view.modules;
    side.scrollTop = view.scroll;
    if (row) side.querySelector('[' + row + '="' + focus.getAttribute(row) + '"]').focus({ preventScroll: true });
    side.querySelectorAll('[data-finding]').forEach(function (el) { el.addEventListener('click', function () { var i = Number(el.getAttribute('data-finding')); selectFinding(state.finding === i ? -1 : i); }); });
    side.querySelectorAll('[data-module]').forEach(function (el) { el.addEventListener('click', function () { var i = Number(el.getAttribute('data-module')); select(state.focusModule === i ? -1 : i, -1); }); });
    var ev = side.querySelector('.atlas-evidence');
    if (ev) ev.addEventListener('click', function () { var id = ev.getAttribute('data-id'); if (!standalone) close(); if (window.__archifyShowFinding) window.__archifyShowFinding(id); });
  }

  // ---- open / close ----
  function open() {
    if (root.getAttribute('data-bauify') !== 'on') return;
    panel.hidden = false; root.setAttribute('data-bauify-view', 'atlas');
    renderSide(); draw(state.finding !== -1 || state.focusModule !== -1 ? 'fade' : 'reveal');
    if (!standalone) panel.querySelector('.atlas-classic').focus({ preventScroll: true });
  }
  function close() {
    if (standalone) return;
    panel.hidden = true; root.removeAttribute('data-bauify-view'); tip.hidden = true;
    if (anim.raf) { cancelAnimationFrame(anim.raf); clearTimeout(anim.timer); }
    geometryPending = false; updateGeometry(performance.now(), true);
    anim.raf = 0; anim.timer = 0; anim.reveal = 0; anim.fade = 0; anim.flow = 0; anim.flowFor = -1;
    markMotion();
  }
  if (!standalone) panel.querySelector('.atlas-classic').addEventListener('click', close);
  panel.querySelector('.atlas-clear').addEventListener('click', function () { select(-1, -1); });
  document.addEventListener('keydown', function (e) { if (!panel.hidden && e.key === 'Escape') { e.preventDefault(); select(-1, -1); } });
  function updateExpansionControl() {
    var button = panel.querySelector('.atlas-expand'), label = tr(expansionEnabled ? 'Disable sector zoom' : 'Enable sector zoom');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(expansionEnabled));
    button.dataset.analysisTip = label + ' · ' + tr(expansionEnabled ? 'Highlight without zooming; keep the current selection.' : 'Zoom the selected module with the mouse wheel.');
    root.setAttribute('data-bauify-atlas-expansion', expansionEnabled ? 'on' : 'off');
  }
  panel.querySelector('.atlas-expand').addEventListener('click', function () {
    updateGeometry(performance.now(), motion.matches);
    expansionEnabled = !expansionEnabled; state.hover = null; tip.hidden = true;
    geometryPending = true;
    updateExpansionControl(); draw('focus');
  });
  updateExpansionControl();
  panel.querySelector('.atlas-clear').disabled = true;
  window.__archifyAtlas = {
    open: open,
    close: close,
    focusFinding: function (id) {
      var index = FD.findIndex(function (f) { return f.id === id; });
      if (index < 0) select(-1, -1); else selectFinding(index);
    },
    saveSelection: function () { return { module: state.focusModule, finding: state.finding, file: state.file, tab: filePane.hidden ? 'map' : 'files', query: fileQuery.value, zoom: focusZoom, view: sideView() }; },
    restoreSelection: function (saved) { fileQuery.value = saved.query || ''; select(saved.module, saved.finding, saved, saved.file); showTab(saved.tab === 'files'); }
  };
  if (standalone) open();
  new MutationObserver(function () { if (root.getAttribute('data-bauify') !== 'on' && !panel.hidden) close(); else if (!panel.hidden) { renderSide(); draw(); } }).observe(root, { attributes: true, attributeFilter: ['data-bauify', 'data-theme'] });
  function redrawIfResized() {
    if (panel.hidden || stage.hidden) return;
    var bounds = stage.getBoundingClientRect();
    if (!geo || bounds.width !== geo.w || bounds.height !== geo.h || (window.devicePixelRatio || 1) !== geo.dpr) draw();
  }
  if (window.ResizeObserver) new ResizeObserver(redrawIfResized).observe(stage);
  window.addEventListener('resize', redrawIfResized);
  if (motion.addEventListener) motion.addEventListener('change', function () { if (!panel.hidden) draw(); });
})();
