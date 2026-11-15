(function () {
  'use strict';
  var source = document.getElementById('bauify-map-data');
  if (!source) return;
  var data = JSON.parse(source.textContent), analysis = JSON.parse(document.getElementById('bauify-analysis').textContent);
  var root = document.documentElement, standalone = analysis.ui.mode === 'standalone';
  var tr = window.__archifyMakeAnalysisTranslator(analysis.ui.messages || {});
  var modules = data.modules, byId = Object.create(null), findings = Object.create(null);
  modules.forEach(function (m) { byId[m.id] = m; }); data.findings.forEach(function (f) { findings[f.id] = f; });
  var selected = { moduleId: modules.length ? modules[0].id : null, findingId: null }, current = standalone ? (document.getElementById('bauify-atlas-data') ? 'atlas' : 'graph') : 'classic';
  var selectedFile = null, fitted = Object.create(null);
  var drill = null, positions = Object.create(null), nodes = [], edges = [], zoom = 1, pan = { x: 0, y: 0 }, hover = null, frame = 0, drag = null;
  var host = standalone ? document.querySelector('.analysis-stage') : document.body;
  var nav = document.createElement('nav'); nav.id = 'bauify-map-switcher'; nav.setAttribute('aria-label', tr('Map views'));
  var views = (standalone ? [] : ['classic']).concat(['graph', 'layers', 'butterfly'], document.getElementById('bauify-atlas-data') ? ['atlas'] : []);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function label(view) { return tr({ classic: 'Classic view', graph: 'Graph', layers: 'Layers', butterfly: 'Butterfly', atlas: 'Atlas' }[view]); }
  nav.innerHTML = views.map(function (view) { return '<button type="button" data-view="' + view + '" aria-pressed="false">' + esc(label(view)) + '</button>'; }).join('');
  host.prepend(nav);
  var panel = document.createElement('section'); panel.id = 'bauify-map-views'; panel.hidden = true; panel.setAttribute('aria-label', tr('Repository map'));
  panel.innerHTML = '<header class="map-heading"></header><div class="map-body"><div class="map-stage"><canvas role="img" tabindex="0"></canvas><div class="map-cards" hidden></div><p class="map-help"></p></div><aside class="map-side"></aside></div>';
  host.appendChild(panel);
  var heading = panel.querySelector('.map-heading'), stage = panel.querySelector('.map-stage'), canvas = panel.querySelector('canvas'), cards = panel.querySelector('.map-cards'), side = panel.querySelector('.map-side'), help = panel.querySelector('.map-help');
  var tone = { error: '#d95d72', warning: '#bf8a31', info: '#5291bd', clear: '#619b8a' };
  function select(value, notify) {
    if (Object.prototype.hasOwnProperty.call(value, 'moduleId')) selected.moduleId = byId[value.moduleId] ? value.moduleId : null;
    if (Object.prototype.hasOwnProperty.call(value, 'findingId')) selected.findingId = findings[value.findingId] ? value.findingId : null;
    if (selected.findingId && !selected.moduleId) selected.moduleId = findings[selected.findingId].moduleIds[0] || null;
    if (!panel.hidden) render();
    if (notify !== false) document.dispatchEvent(new CustomEvent('archify:map-selection', { detail: { moduleId: selected.moduleId, findingId: selected.findingId, source: 'map' } }));
  }
  document.addEventListener('archify:map-selection', function (event) { if (event.detail && event.detail.source !== 'map') select(event.detail, false); });
  function button(m) { return '<button type="button" class="map-module' + (selected.moduleId === m.id ? ' active' : '') + '" data-module="' + esc(m.id) + '"><strong>' + esc(m.label) + '</strong><span>' + esc(tr('{files} files · {lines} lines', { files: m.files, lines: m.loc })) + '</span><span class="map-health" data-health="' + m.health + '">' + esc(tr(m.health === 'clear' ? 'No open findings in captured checks' : m.health)) + ' · ' + m.findings.length + '</span></button>'; }
  function evidence(e) { return (e.evidence || []).map(function (p) { return '<span class="map-evidence">' + esc(p.file) + ':' + p.line + ' → ' + esc(p.to) + '</span>'; }).join(''); }
  function findingList(m) { return m.findings.map(function (id) { var f = findings[id]; return '<button type="button" class="map-finding' + (selected.findingId === id ? ' active' : '') + '" data-finding="' + esc(id) + '">' + esc(window.__archifyAnalysisFindingTitle ? window.__archifyAnalysisFindingTitle(id) : f.title) + '</button>'; }).join(''); }
  function bind(container) {
    container.querySelectorAll('[data-module]').forEach(function (el) { el.addEventListener('click', function () { select({ moduleId: el.getAttribute('data-module'), findingId: null }); }); });
    container.querySelectorAll('[data-finding]').forEach(function (el) { el.addEventListener('click', function () { select({ findingId: el.getAttribute('data-finding') }); if (window.__archifyShowFinding) window.__archifyShowFinding(el.getAttribute('data-finding')); }); });
  }
  function renderSide() {
    var m = byId[selected.moduleId];
    side.innerHTML = (m ? '<h3>' + esc(m.label) + '</h3><p class="map-path">' + esc(m.path) + '</p>' + button(m) + '<p>' + esc(tr('fan-in')) + ' ' + m.fanIn + ' · ' + esc(tr('fan-out')) + ' ' + m.fanOut + '</p>' + (data.hasFacts ? '<button type="button" class="map-expand">' + esc(tr('Explore module files')) + '</button>' : '<p>' + esc(tr('File details unavailable in this snapshot.')) + '</p>') + '<button type="button" class="map-select-findings">' + esc(tr('Select module findings')) + '</button>' + findingList(m) : '<p>' + esc(tr('Select a module to inspect its evidence.')) + '</p>') + '<h3>' + esc(tr('Modules')) + '</h3>' + modules.map(button).join('');
    if (drill) {
      var relationships = data.internal.filter(function (e) { return data.filesByPath[e.from] === drill && data.filesByPath[e.to] === drill && (!selectedFile || e.from === selectedFile || e.to === selectedFile); });
      side.innerHTML += '<h3>' + esc(tr('Captured file relationships')) + '</h3>' + relationships.slice(0, 80).map(function (e) { return '<p class="map-evidence">' + esc(tr(e.kind)) + ' · ' + esc(e.from) + ':' + e.line + ' → ' + esc(e.to) + (e.targetLine ? ':' + e.targetLine : '') + (e.name ? ' · ' + esc(e.name) : '') + '</p>'; }).join('') + '<p class="map-note">' + esc(tr('Showing {shown} of {total} captured edges.', { shown: Math.min(80, relationships.length), total: relationships.length })) + '</p>';
    }
    bind(side); var selectFindings = side.querySelector('.map-select-findings'); if (selectFindings) selectFindings.addEventListener('click', function () { if (window.__archifySelectModuleFindings) window.__archifySelectModuleFindings(selected.moduleId); });
    var expand = side.querySelector('.map-expand'); if (expand) expand.addEventListener('click', function () { drill = selected.moduleId; selectedFile = null; zoom = 1; pan = { x: 0, y: 0 }; open('graph'); });
  }
  function graphData() {
    var all = drill ? data.files.filter(function (f) { return f.moduleId === drill; }) : modules;
    // File exploration is deliberately bounded; module overview never mixes in files.
    nodes = all.slice(0, drill ? 180 : all.length).map(function (n) { return { id: drill ? n.path : n.id, label: drill ? n.path.split('/').pop() : n.label, weight: drill ? Math.sqrt(n.loc + 1) : n.weight, moduleId: drill || n.id }; });
    var set = Object.create(null); nodes.forEach(function (n) { set[n.id] = true; });
    edges = (drill ? data.internal : data.edges).filter(function (e) { return set[e.from] && set[e.to]; });
    // Keep cycle edges and focused dependencies first when a dense graph exceeds its paint budget.
    edges = edges.slice().sort(function (a, b) { return Number(Boolean(b.cycle)) - Number(Boolean(a.cycle)) || Number(b.from === selected.moduleId || b.to === selected.moduleId) - Number(a.from === selected.moduleId || a.to === selected.moduleId); }).slice(0, 3500);
    var key = drill || '$modules';
    if (!positions[key]) {
      var p = Object.create(null), count = nodes.length, radius = Math.max(110, Math.sqrt(count) * 32);
      nodes.forEach(function (n, i) { var a = i * 2.39996323; var r = radius * Math.sqrt((i + 0.5) / Math.max(1, count)); p[n.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r }; });
      // A fixed relaxation budget avoids a perpetual force simulation while keeping
      // connected modules together. Pair repulsion is bounded for very large maps.
      if (count <= 600) for (var step = 0; step < 24; step++) {
        var movement = Object.create(null); nodes.forEach(function (n) { movement[n.id] = { x: -p[n.id].x * 0.006, y: -p[n.id].y * 0.006 }; });
        for (var i = 0; i < count; i++) for (var j = i + 1; j < count; j++) {
          var a = p[nodes[i].id], b = p[nodes[j].id], dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(30, dx * dx + dy * dy), force = Math.min(2, 240 / d2);
          movement[nodes[i].id].x += dx * force; movement[nodes[i].id].y += dy * force; movement[nodes[j].id].x -= dx * force; movement[nodes[j].id].y -= dy * force;
        }
        edges.forEach(function (e) { var a = p[e.from], b = p[e.to]; movement[e.from].x += (b.x - a.x) * 0.025; movement[e.from].y += (b.y - a.y) * 0.025; movement[e.to].x += (a.x - b.x) * 0.025; movement[e.to].y += (a.y - b.y) * 0.025; });
        nodes.forEach(function (n) { p[n.id].x += Math.max(-14, Math.min(14, movement[n.id].x)); p[n.id].y += Math.max(-14, Math.min(14, movement[n.id].y)); });
      }
      positions[key] = p;
    }
    if (!fitted[key] && nodes.length && stage.clientWidth && stage.clientHeight) {
      var bounds = nodes.reduce(function (b, n) { var point = positions[key][n.id]; b.x = Math.max(b.x, Math.abs(point.x)); b.y = Math.max(b.y, Math.abs(point.y)); return b; }, { x: 0, y: 0 });
      zoom = Math.min(1, (stage.clientWidth - 120) / Math.max(1, bounds.x * 2), (stage.clientHeight - 130) / Math.max(1, bounds.y * 2)); zoom = Math.max(0.15, zoom); pan = { x: 0, y: 0 }; fitted[key] = true;
    }
    help.textContent = (!nodes.length ? tr('No modules in the analyzed scope.') + ' ' : '') + tr('Drag nodes or empty space. Scroll to zoom. Double-click a module to explore files.') + (drill ? ' ' + tr('Showing {shown} of {total} files.', { shown: nodes.length, total: all.length }) : '') + ' ' + tr('Showing {shown} of {total} captured edges.', { shown: edges.length, total: (drill ? data.internal.filter(function (e) { return data.filesByPath[e.from] === drill && data.filesByPath[e.to] === drill; }) : data.edges).length }) + ' ' + tr('Captured static dependencies do not establish runtime impact.');
    canvas.setAttribute('aria-label', tr('Dependency graph. The module list provides keyboard navigation.'));
  }
  function draw() {
    frame = 0; if (panel.hidden || current !== 'graph') return;
    var w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    var ctx = canvas.getContext('2d'), css = getComputedStyle(root), text = css.getPropertyValue('--text').trim() || (root.getAttribute('data-theme') === 'light' ? '#182536' : '#e5eaf0'), muted = css.getPropertyValue('--text-muted').trim() || '#778899';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.translate(w / 2 + pan.x, h / 2 + pan.y); ctx.scale(zoom, zoom);
    var p = positions[drill || '$modules'], pairs = Object.create(null), neighbors = Object.create(null), active = findings[selected.findingId];
    edges.forEach(function (e) { pairs[e.from + '\n' + e.to] = true; if (hover === e.from) neighbors[e.to] = true; if (hover === e.to) neighbors[e.from] = true; });
    edges.forEach(function (e) {
      var a = p[e.from], b = p[e.to], dim = hover && hover !== e.from && hover !== e.to;
      ctx.globalAlpha = dim ? 0.07 : e.cycle ? 0.8 : 0.3; ctx.strokeStyle = e.cycle ? tone.error : muted; ctx.lineWidth = e.cycle ? 1.8 : 1;
      var dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy)), bend = pairs[e.to + '\n' + e.from] ? 20 : 0;
      var cx = (a.x + b.x) / 2 - dy / d * bend, cy = (a.y + b.y) / 2 + dx / d * bend;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
      var angle = Math.atan2(b.y - cy, b.x - cx), ax = b.x - Math.cos(angle) * 12, ay = b.y - Math.sin(angle) * 12;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle - 0.45) * 6, ay - Math.sin(angle - 0.45) * 6); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle + 0.45) * 6, ay - Math.sin(angle + 0.45) * 6); ctx.stroke();
    });
    var occupied = [];
    nodes.forEach(function (n) {
      var point = p[n.id], m = byId[n.moduleId], focused = (!drill && selected.moduleId === n.id) || hover === n.id, relevant = active && active.moduleIds.indexOf(n.moduleId) !== -1;
      ctx.globalAlpha = hover && !focused && !neighbors[n.id] ? 0.15 : 1;
      var radius = Math.min(18, 5 + Math.sqrt(n.weight || 1)); ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fillStyle = tone[m.health]; ctx.fill();
      if (focused || relevant) { ctx.lineWidth = 2; ctx.strokeStyle = text; ctx.beginPath(); ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2); ctx.stroke(); }
      if (zoom < 0.65 && nodes.length > 30 && !focused && !relevant && n.weight < 35) return;
      ctx.font = (12 / zoom) + 'px system-ui, sans-serif'; var name = n.label.length > 30 ? '…' + n.label.slice(-29) : n.label, width = ctx.measureText(name).width;
      var box = { x: point.x - width / 2, y: point.y + radius + 6 / zoom, w: width, h: 15 / zoom };
      if (!focused && occupied.some(function (b) { return box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y; })) return;
      occupied.push(box); ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.fillText(name, point.x, box.y + 12 / zoom);
    }); ctx.globalAlpha = 1;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  function layers() {
    var groups = Object.create(null); modules.forEach(function (m) { (groups[m.layer] = groups[m.layer] || []).push(m); });
    cards.innerHTML = '<p class="map-note">' + esc(tr('Inferred dependency layers, not configured architectural rules. Cyclic modules share a layer.')) + '</p>' + Object.keys(groups).sort(function (a, b) { return a - b; }).map(function (level) { return '<section class="map-layer"><h3>' + esc(tr('Layer {number}', { number: Number(level) + 1 })) + '</h3><div class="map-layer-grid">' + groups[level].map(button).join('') + '</div></section>'; }).join('') + '<details open><summary>' + esc(tr('Cycles and backward dependencies')) + '</summary>' + data.edges.filter(function (e) { return e.cycle || e.backward; }).map(function (e) { return '<div class="map-edge-warning">' + esc(byId[e.from].label) + ' → ' + esc(byId[e.to].label) + ' · ' + e.weight + evidence(e) + '</div>'; }).join('') + '</details>';
    bind(cards);
  }
  function butterfly() {
    var m = byId[selected.moduleId] || modules[0]; if (!m) { cards.innerHTML = '<p>' + esc(tr('No modules in the analyzed scope.')) + '</p>'; return; }
    function neighbors(incoming) { return data.edges.filter(function (e) { return incoming ? e.to === m.id : e.from === m.id; }).sort(function (a, b) { return b.weight - a.weight; }).map(function (e) { return '<div class="map-neighbor">' + button(byId[incoming ? e.from : e.to]) + '<p>' + esc(tr('{count} captured references', { count: e.weight })) + '</p>' + evidence(e) + '</div>'; }).join('') || '<p class="map-note">' + esc(tr('No captured dependencies.')) + '</p>'; }
    var surface = Object.create(null); data.internal.forEach(function (e) { if (e.kind === 'import' && data.filesByPath[e.to] === m.id && data.filesByPath[e.from] !== m.id) surface[e.to] = (surface[e.to] || 0) + 1; });
    cards.innerHTML = '<div class="map-butterfly"><section><h3>' + esc(tr('Upstream · depends on this module')) + '</h3>' + neighbors(true) + '</section><section class="map-current"><h3>' + esc(tr('Current module')) + '</h3>' + button(m) + '<h4>' + esc(tr('Files imported by other modules')) + '</h4>' + (Object.keys(surface).sort(function (a, b) { return surface[b] - surface[a]; }).slice(0, 12).map(function (file) { return '<p class="map-evidence">' + esc(file) + ' · ' + surface[file] + '</p>'; }).join('') || '<p>' + esc(tr(data.hasFacts ? 'No captured dependencies.' : 'File details unavailable in this snapshot.')) + '</p>') + '<h4>' + esc(tr('Findings')) + '</h4>' + findingList(m) + '</section><section><h3>' + esc(tr('Downstream · this module depends on')) + '</h3>' + neighbors(false) + '</section></div><p class="map-note">' + esc(tr('Captured static dependencies do not establish runtime impact.')) + '</p>';
    bind(cards);
  }
  data.filesByPath = Object.create(null); data.files.forEach(function (f) { data.filesByPath[f.path] = f.moduleId; });
  function render() {
    heading.innerHTML = '<h2>' + esc(label(current)) + '</h2>' + (current === 'graph' && drill ? '<button type="button" class="map-back">' + esc(tr('All modules')) + '</button><span> / ' + esc(byId[drill].label) + '</span>' : '');
    var back = heading.querySelector('.map-back'); if (back) back.addEventListener('click', function () { drill = null; zoom = 1; pan = { x: 0, y: 0 }; render(); });
    canvas.hidden = current !== 'graph'; cards.hidden = current === 'graph'; help.hidden = current !== 'graph'; side.hidden = current === 'butterfly';
    if (current === 'graph') { graphData(); renderSide(); schedule(); } else if (current === 'layers') { layers(); renderSide(); } else butterfly();
  }
  function open(view) {
    if (views.indexOf(view) === -1) return;
    current = view; panel.hidden = view === 'classic' || view === 'atlas';
    var atlasPanel = document.getElementById('bauify-atlas');
    if (view === 'atlas' && window.__archifyAtlas) window.__archifyAtlas.open();
    else { if (window.__archifyAtlas) window.__archifyAtlas.close(); if (atlasPanel) atlasPanel.hidden = true; if (view === 'classic') root.removeAttribute('data-bauify-view'); else root.setAttribute('data-bauify-view', view); }
    nav.querySelectorAll('[data-view]').forEach(function (el) { el.setAttribute('aria-pressed', String(el.getAttribute('data-view') === view)); });
    if (!panel.hidden) render();
  }
  nav.addEventListener('click', function (event) { var button = event.target.closest('[data-view]'); if (button) open(button.getAttribute('data-view')); });
  function locationOf(event) { var b = canvas.getBoundingClientRect(); return { x: (event.clientX - b.left - b.width / 2 - pan.x) / zoom, y: (event.clientY - b.top - b.height / 2 - pan.y) / zoom }; }
  function hit(point) { var p = positions[drill || '$modules']; return nodes.find(function (n) { var q = p[n.id]; return Math.hypot(point.x - q.x, point.y - q.y) < Math.min(18, 5 + Math.sqrt(n.weight || 1)) + 7 / zoom; }); }
  canvas.addEventListener('pointerdown', function (event) { if (event.button !== 0) return; var n = hit(locationOf(event)); drag = { id: n && n.id, x: event.clientX, y: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', function (event) {
    if (drag) { var dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; if (drag.id) { var p = positions[drill || '$modules'][drag.id]; p.x += dx / zoom; p.y += dy / zoom; } else { pan.x += dx; pan.y += dy; } drag.x = event.clientX; drag.y = event.clientY; schedule(); }
    else { var n = hit(locationOf(event)), id = n && n.id; if (hover !== id) { hover = id; canvas.title = n ? n.id : ''; schedule(); } }
  });
  canvas.addEventListener('pointerup', function (event) { if (drag && !drag.moved) { var n = hit(locationOf(event)); if (n) { selectedFile = drill ? n.id : null; select({ moduleId: n.moduleId, findingId: null }); } } drag = null; });
  canvas.addEventListener('pointercancel', function () { drag = null; });
  canvas.addEventListener('pointerleave', function () { hover = null; schedule(); });
  canvas.addEventListener('dblclick', function (event) { var n = hit(locationOf(event)); if (n && !drill && data.hasFacts) { drill = n.id; selectedFile = null; zoom = 1; pan = { x: 0, y: 0 }; render(); } });
  canvas.addEventListener('wheel', function (event) { event.preventDefault(); var b = canvas.getBoundingClientRect(), x = event.clientX - b.left - b.width / 2, y = event.clientY - b.top - b.height / 2, ratio = Math.exp(-Math.max(-160, Math.min(160, event.deltaY)) * 0.002), next = Math.max(0.15, Math.min(5, zoom * ratio)); pan.x = x - (x - pan.x) * next / zoom; pan.y = y - (y - pan.y) * next / zoom; zoom = next; schedule(); }, { passive: false });
  canvas.addEventListener('keydown', function (event) { if (event.key === '+' || event.key === '=') zoom = Math.min(5, zoom * 1.2); else if (event.key === '-') zoom = Math.max(0.15, zoom / 1.2); else if (event.key === 'Escape' && drill) { drill = null; render(); } else return; event.preventDefault(); schedule(); });
  window.addEventListener('resize', schedule);
  new MutationObserver(function () { nav.hidden = root.getAttribute('data-bauify') !== 'on'; if (nav.hidden) panel.hidden = true; else if (root.getAttribute('data-bauify-view') === 'atlas' && current !== 'atlas') { current = 'atlas'; panel.hidden = true; nav.querySelectorAll('[data-view]').forEach(function (el) { el.setAttribute('aria-pressed', String(el.getAttribute('data-view') === current)); }); } else if (current !== 'classic' && current !== 'atlas') { panel.hidden = false; render(); } schedule(); }).observe(root, { attributes: true, attributeFilter: ['data-bauify', 'data-theme', 'data-bauify-view'] });
  window.__archifyMapViews = { open: open, close: function () { open(standalone ? 'graph' : 'classic'); }, select: function (value) { select(value); }, selection: function () { return { moduleId: selected.moduleId, findingId: selected.findingId }; } };
  nav.hidden = root.getAttribute('data-bauify') !== 'on'; open(current);
})();
