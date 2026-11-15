(function () {
  'use strict';
  var source = document.getElementById('bauify-map-data');
  if (!source) return;
  var data = JSON.parse(source.textContent);
  var analysis = JSON.parse(document.getElementById('bauify-analysis').textContent);
  var root = document.documentElement;
  var standalone = analysis.ui && analysis.ui.mode === 'standalone';
  var tr = window.__archifyMakeAnalysisTranslator((analysis.ui && analysis.ui.messages) || {});

  var modules = data.modules || [];
  var allEdges = data.edges || [];
  var byId = Object.create(null);
  var findings = Object.create(null);
  var filesByPath = Object.create(null);
  modules.forEach(function (m) { byId[m.id] = m; });
  (data.findings || []).forEach(function (f) { findings[f.id] = f; });
  (data.files || []).forEach(function (f) { filesByPath[f.path] = f.moduleId; });

  var DOMAIN_PALETTE = [
    { dark: '#22d3ee', light: '#0891b2' },
    { dark: '#60a5fa', light: '#2563eb' },
    { dark: '#a78bfa', light: '#7c3aed' },
    { dark: '#34d399', light: '#059669' },
    { dark: '#818cf8', light: '#4f46e5' },
    { dark: '#38bdf8', light: '#0284c7' },
    { dark: '#2dd4bf', light: '#0d9488' },
    { dark: '#c084fc', light: '#9333ea' }
  ];

  function domainKey(m) {
    var raw = String((m && (m.path || m.label || m.id)) || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!raw || raw === '.') return 'root';
    var parts = raw.split('/').filter(Boolean);
    var wrappers = { src: true, lib: false, packages: true, apps: true, services: true, modules: true, crates: true };
    if (parts.length > 1 && wrappers[parts[0]]) parts.shift();
    return parts[0] || 'root';
  }

  var domainCounts = Object.create(null);
  var domainOfModule = Object.create(null);
  modules.forEach(function (m) {
    var key = domainKey(m);
    domainOfModule[m.id] = key;
    domainCounts[key] = (domainCounts[key] || 0) + 1;
  });
  var domainOrder = Object.keys(domainCounts).sort(function (a, b) {
    return (domainCounts[b] - domainCounts[a]) || (a < b ? -1 : a > b ? 1 : 0);
  });
  var domainColorMap = Object.create(null);
  domainOrder.forEach(function (key, i) { domainColorMap[key] = DOMAIN_PALETTE[i % DOMAIN_PALETTE.length]; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function domainColor(moduleId, isLight) {
    var pair = domainColorMap[domainOfModule[moduleId]] || DOMAIN_PALETTE[0];
    return isLight ? pair.light : pair.dark;
  }

  function readCss(varName, fallback) {
    var v = getComputedStyle(root).getPropertyValue(varName).trim();
    return v || fallback;
  }

  function palette() {
    var isLight = root.getAttribute('data-theme') === 'light';
    return {
      isLight: isLight,
      bg: readCss('--bg', isLight ? '#f4f5f7' : '#020617'),
      fg: readCss('--text', isLight ? '#111827' : '#f1f5f9'),
      muted: readCss('--text-muted', isLight ? '#596476' : '#94a3b8'),
      border: readCss('--panel-border', isLight ? '#dce1e8' : '#1e293b'),
      card: readCss('--panel', isLight ? '#ffffff' : '#0f172a'),
      dot: isLight ? 'rgba(15, 23, 42, 0.10)' : 'rgba(148, 163, 184, 0.12)',
      edgeBase: isLight ? 'rgba(71, 85, 105, 0.25)' : 'rgba(148, 163, 184, 0.24)',
      edgeDim: isLight ? 'rgba(71, 85, 105, 0.08)' : 'rgba(148, 163, 184, 0.08)',
      inColor: isLight ? '#0891b2' : '#22d3ee',
      outColor: isLight ? '#059669' : '#34d399',
      errorColor: isLight ? '#d95d72' : '#fb7185',
      warnColor: isLight ? '#d97706' : '#f59e0b',
      pillBg: isLight ? 'rgba(255, 255, 255, 0.90)' : 'rgba(9, 14, 26, 0.85)'
    };
  }

  // Pick initial focus module: highest weight/coupling module so initial canvas highlights a rich hub.
  var initialModule = modules.length ? modules.slice().sort(function (a, b) {
    return (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut) || b.weight - a.weight || (a.id < b.id ? -1 : 1);
  })[0].id : null;
  var selected = { moduleId: initialModule, findingId: null };
  var current = standalone ? 'graph' : 'classic';
  var selectedFile = null;
  var drill = null;
  var cardCollapsed = false;

  var positions = Object.create(null);
  var fitted = Object.create(null);
  var userMoved = Object.create(null);
  var nodes = [];
  var edges = [];
  var zoom = 1;
  var pan = { x: 0, y: 0 };
  var hover = null;
  var frame = 0;
  var drag = null;
  var anim = false;
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  var host = standalone ? document.querySelector('.analysis-stage') : document.body;
  var nav = document.createElement('nav');
  nav.id = 'bauify-map-switcher';
  nav.setAttribute('aria-label', tr('Map views'));
  var views = (standalone ? [] : ['classic']).concat(['graph', 'layers', 'butterfly'], document.getElementById('bauify-atlas-data') ? ['atlas'] : []);
  function label(view) {
    return tr({ classic: 'Classic view', graph: 'Graph', layers: 'Layers', butterfly: 'Butterfly', atlas: 'Atlas' }[view]);
  }
  nav.innerHTML = views.map(function (view) {
    return '<button type="button" data-view="' + view + '" aria-pressed="false">' + esc(label(view)) + '</button>';
  }).join('');
  host.prepend(nav);

  var panel = document.createElement('section');
  panel.id = 'bauify-map-views';
  panel.hidden = true;
  panel.setAttribute('aria-label', tr('Repository map'));
  panel.innerHTML =
    '<div class="map-stage">' +
      '<canvas role="img" tabindex="0"></canvas>' +
      '<div class="map-svg-wrap" hidden></div>' +
      '<div class="map-crumb map-glass"></div>' +
      '<p class="map-help map-glass"></p>' +
      '<aside class="map-card map-glass" hidden></aside>' +
      '<button type="button" class="map-card-pill map-glass" hidden></button>' +
    '</div>';
  host.appendChild(panel);

  var stage = panel.querySelector('.map-stage');
  var canvas = panel.querySelector('canvas');
  var svgWrap = panel.querySelector('.map-svg-wrap');
  var crumbEl = panel.querySelector('.map-crumb');
  var helpEl = panel.querySelector('.map-help');
  var cardEl = panel.querySelector('.map-card');
  var cardPillEl = panel.querySelector('.map-card-pill');

  function syncNavPressed() {
    nav.querySelectorAll('[data-view]').forEach(function (el) {
      el.setAttribute('aria-pressed', String(el.getAttribute('data-view') === current));
    });
  }

  function renderCrumb() {
    if (current === 'graph' && drill && byId[drill]) {
      crumbEl.classList.add('drilled');
      crumbEl.innerHTML =
        '<button type="button" class="map-back">← ' + esc(tr('All modules')) + '</button>' +
        '<span class="map-crumb-sep">/</span>' +
        '<span class="map-crumb-text"><strong>' + esc(byId[drill].label) + '</strong></span>';
      crumbEl.querySelector('.map-back').addEventListener('click', function () {
        drill = null;
        selectedFile = null;
        hover = null;
        fitted['$modules'] = false;
        render();
      });
    } else {
      crumbEl.classList.remove('drilled');
      var repoName = (analysis.repository && analysis.repository.name) || tr('Repository');
      crumbEl.innerHTML =
        '<span class="map-crumb-dot"></span>' +
        '<span class="map-crumb-text"><strong>' + esc(repoName) + '</strong> · ' + esc(tr('{modules} modules · {edges} edges', { modules: modules.length, edges: allEdges.length })) + '</span>';
    }
  }

  function renderHelp() {
    if (!modules.length) {
      helpEl.textContent = tr('No modules in the analyzed scope.');
      return;
    }
    if (current === 'graph') {
      helpEl.textContent = drill && byId[drill]
        ? tr('Inspecting {module} internal files · Click All modules to return', { module: byId[drill].label })
        : tr('Drag nodes or empty space. Scroll to zoom. Double-click a module to explore files.');
    } else if (current === 'layers') {
      helpEl.textContent = tr('Hover or click a module to trace upstream & downstream curves · Double-click for Butterfly');
    } else {
      helpEl.textContent = tr('Click any upstream or downstream module to re-center the flow');
    }
  }

  function renderCard() {
    var m = byId[selected.moduleId] || modules[0];
    if (!m) {
      cardEl.hidden = true;
      cardPillEl.hidden = true;
      return;
    }
    var pal = palette();
    var color = domainColor(m.id, pal.isLight);
    var title = (drill && selectedFile) ? selectedFile.split('/').pop() : m.label;
    var showBadge = m.cycle || m.health === 'error' || m.health === 'warning';
    var badgeTone = (m.health === 'error' || m.cycle) ? 'error' : 'warning';
    var badgeLabel = (m.health === 'error' || m.cycle) ? tr('cycle') : tr('hotspot');

    if (cardCollapsed) {
      cardEl.hidden = true;
      cardPillEl.hidden = false;
      cardPillEl.innerHTML = '<span class="map-card-dot" style="background:' + esc(color) + '"></span><span>' + esc(title) + '</span>';
      return;
    }

    cardPillEl.hidden = true;
    cardEl.hidden = false;
    var metrics = tr('{files} files · {lines} lines', { files: m.files, lines: m.loc }) + ' · ' + tr('fan-in {in} / fan-out {out}', { in: m.fanIn, out: m.fanOut });
    var actions = [];
    if (data.hasFacts && !drill) {
      actions.push('<button type="button" class="map-expand">' + esc(tr('Explore module files')) + '</button>');
    }
    if (current !== 'butterfly' && !drill) {
      actions.push('<button type="button" class="map-to-butterfly">' + esc(tr('Butterfly')) + '</button>');
    }
    if (m.findings && m.findings.length) {
      actions.push('<button type="button" class="map-select-findings">' + esc(tr('Select module findings')) + ' (' + m.findings.length + ')</button>');
    }

    cardEl.innerHTML =
      '<div class="map-card-head">' +
        '<div class="map-card-id">' +
          '<span class="map-card-dot" style="background:' + esc(color) + '"></span>' +
          '<span class="map-card-title" title="' + esc(m.path || m.label) + '">' + esc(title) + '</span>' +
          (showBadge ? '<span class="map-card-badge" data-tone="' + badgeTone + '">' + esc(badgeLabel) + '</span>' : '') +
        '</div>' +
        '<button type="button" class="map-card-collapse" aria-label="' + esc(tr('Collapse card')) + '">×</button>' +
      '</div>' +
      '<p class="map-card-metrics">' + esc(metrics) + '</p>' +
      (actions.length ? '<div class="map-card-actions">' + actions.join('') + '</div>' : '');

    cardEl.querySelector('.map-card-collapse').addEventListener('click', function () {
      cardCollapsed = true;
      renderCard();
    });
    var expandBtn = cardEl.querySelector('.map-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', function () {
        drill = m.id;
        selectedFile = null;
        hover = null;
        fitted['drill:' + drill] = false;
        userMoved['drill:' + drill] = false;
        open('graph');
      });
    }
    var bflyBtn = cardEl.querySelector('.map-to-butterfly');
    if (bflyBtn) {
      bflyBtn.addEventListener('click', function () {
        open('butterfly');
      });
    }
    var findingsBtn = cardEl.querySelector('.map-select-findings');
    if (findingsBtn) {
      findingsBtn.addEventListener('click', function () {
        if (window.__archifySelectModuleFindings) window.__archifySelectModuleFindings(m.id);
      });
    }
  }

  cardPillEl.addEventListener('click', function () {
    cardCollapsed = false;
    renderCard();
  });

  function select(value, notify) {
    if (value && Object.prototype.hasOwnProperty.call(value, 'moduleId')) {
      selected.moduleId = byId[value.moduleId] ? value.moduleId : (modules[0] ? modules[0].id : null);
    }
    if (value && Object.prototype.hasOwnProperty.call(value, 'findingId')) {
      selected.findingId = findings[value.findingId] ? value.findingId : null;
    }
    if (selected.findingId && !selected.moduleId && findings[selected.findingId].moduleIds.length) {
      selected.moduleId = findings[selected.findingId].moduleIds[0];
    }
    if (!panel.hidden) {
      renderCard();
      if (current === 'graph') requestPaint();
      else if (current === 'layers') renderLayersSvg();
      else if (current === 'butterfly') renderButterflySvg();
    }
    if (notify !== false) {
      document.dispatchEvent(new CustomEvent('archify:map-selection', {
        detail: { moduleId: selected.moduleId, findingId: selected.findingId, source: 'map' }
      }));
    }
  }

  document.addEventListener('archify:map-selection', function (event) {
    if (event.detail && event.detail.source !== 'map') select(event.detail, false);
  });

  // ---- View 1: Clustered Domain Nebula Graph ----
  function nodeRadius(weight) {
    return Math.max(9, Math.min(22, 6.5 + Math.sqrt(Math.max(1, weight || 1)) * 1.35));
  }

  function graphData() {
    var all = drill ? (data.files || []).filter(function (f) { return f.moduleId === drill; }) : modules;
    nodes = all.slice(0, drill ? 180 : all.length).map(function (n) {
      var id = drill ? n.path : n.id;
      var w = drill ? Math.sqrt((n.loc || 1) + 1) : (n.weight || 4);
      var mod = byId[drill || n.id] || {};
      return {
        id: id,
        label: drill ? n.path.split('/').pop() : n.label,
        weight: w,
        r: nodeRadius(w),
        moduleId: drill || n.id,
        domain: domainOfModule[drill || n.id] || 'root',
        layer: mod.layer || 0,
        health: mod.health || 'clear',
        cycle: Boolean(mod.cycle),
        isHot: !drill && ((mod.health === 'error' || mod.health === 'warning') || (mod.fanIn || 0) + (mod.fanOut || 0) >= 6)
      };
    });
    var set = Object.create(null);
    nodes.forEach(function (n) { set[n.id] = true; });
    edges = (drill ? (data.internal || []) : allEdges).filter(function (e) {
      return set[e.from] && set[e.to] && e.from !== e.to;
    });
    edges = edges.slice().sort(function (a, b) {
      return Number(Boolean(b.cycle)) - Number(Boolean(a.cycle)) ||
        Number(b.from === selected.moduleId || b.to === selected.moduleId) - Number(a.from === selected.moduleId || a.to === selected.moduleId) ||
        (b.weight || 1) - (a.weight || 1);
    }).slice(0, 3500);

    var key = drill ? ('drill:' + drill) : '$modules';
    if (!positions[key]) {
      var p = Object.create(null);
      var count = nodes.length;
      if (!drill && count > 1) {
        // Seed by domain islands ordered roughly by average layer
        var domGroups = Object.create(null);
        nodes.forEach(function (n) { (domGroups[n.domain] = domGroups[n.domain] || []).push(n); });
        var domKeys = Object.keys(domGroups).sort(function (a, b) {
          var avgA = domGroups[a].reduce(function (s, n) { return s + n.layer; }, 0) / domGroups[a].length;
          var avgB = domGroups[b].reduce(function (s, n) { return s + n.layer; }, 0) / domGroups[b].length;
          return avgA - avgB || (a < b ? -1 : a > b ? 1 : 0);
        });
        var domCount = domKeys.length;
        var baseR = Math.max(145, Math.sqrt(count) * 56);
        var domCenters = Object.create(null);
        domKeys.forEach(function (dk, di) {
          if (domCount === 1) {
            domCenters[dk] = { x: 0, y: 0 };
          } else {
            // Spread domains from top-left to lower-right / around wide ellipse
            var angle = -Math.PI * 0.78 + (di / domCount) * Math.PI * 2;
            domCenters[dk] = {
              x: Math.cos(angle) * baseR * 1.42,
              y: Math.sin(angle) * baseR * 0.86
            };
          }
          var members = domGroups[dk];
          members.forEach(function (n, mi) {
            if (members.length === 1) {
              p[n.id] = { x: domCenters[dk].x, y: domCenters[dk].y };
            } else {
              var a = mi * 2.39996323;
              var rr = Math.max(34, Math.sqrt(members.length) * 30) * Math.sqrt((mi + 0.5) / members.length);
              p[n.id] = { x: domCenters[dk].x + Math.cos(a) * rr, y: domCenters[dk].y + Math.sin(a) * rr };
            }
          });
        });

        if (count <= 500) {
          var domById = Object.create(null);
          nodes.forEach(function (n) { domById[n.id] = n.domain; });
          for (var step = 0; step < 36; step++) {
            var mv = Object.create(null);
            nodes.forEach(function (n) {
              var c = domCenters[n.domain];
              mv[n.id] = {
                x: -p[n.id].x * 0.003 + (c.x - p[n.id].x) * 0.032,
                y: -p[n.id].y * 0.003 + (c.y - p[n.id].y) * 0.032
              };
            });
            for (var i = 0; i < count; i++) {
              for (var j = i + 1; j < count; j++) {
                var a = p[nodes[i].id], b = p[nodes[j].id];
                var dx = a.x - b.x, dy = a.y - b.y;
                var d = Math.hypot(dx, dy) || 0.01;
                var minSep = nodes[i].r + nodes[j].r + (nodes[i].domain === nodes[j].domain ? 28 : 54);
                var force = d < minSep ? (minSep - d) * 0.18 : Math.min(2.2, 460 / (d * d));
                var fx = (dx / d) * force, fy = (dy / d) * force;
                mv[nodes[i].id].x += fx; mv[nodes[i].id].y += fy;
                mv[nodes[j].id].x -= fx; mv[nodes[j].id].y -= fy;
              }
            }
            edges.forEach(function (e) {
              var a = p[e.from], b = p[e.to];
              var sameDom = domById[e.from] === domById[e.to];
              var pull = sameDom ? 0.022 : 0.006;
              mv[e.from].x += (b.x - a.x) * pull; mv[e.from].y += (b.y - a.y) * pull;
              mv[e.to].x += (a.x - b.x) * pull; mv[e.to].y += (a.y - b.y) * pull;
            });
            nodes.forEach(function (n) {
              p[n.id].x += Math.max(-14, Math.min(14, mv[n.id].x));
              p[n.id].y += Math.max(-14, Math.min(14, mv[n.id].y));
            });
          }
        }
      } else {
        var radius = Math.max(125, Math.sqrt(Math.max(1, count)) * 44);
        nodes.forEach(function (n, i) {
          if (count === 1) { p[n.id] = { x: 0, y: 0 }; return; }
          var a = i * 2.39996323;
          var r = radius * Math.sqrt((i + 0.5) / count);
          p[n.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
        });
        if (count <= 250) {
          for (var s2 = 0; s2 < 28; s2++) {
            var mv2 = Object.create(null);
            nodes.forEach(function (n) { mv2[n.id] = { x: -p[n.id].x * 0.006, y: -p[n.id].y * 0.006 }; });
            for (var u = 0; u < count; u++) {
              for (var v = u + 1; v < count; v++) {
                var a2 = p[nodes[u].id], b2 = p[nodes[v].id];
                var dx2 = a2.x - b2.x, dy2 = a2.y - b2.y;
                var d2 = Math.hypot(dx2, dy2) || 0.01;
                var minS2 = nodes[u].r + nodes[v].r + 44;
                var f2 = d2 < minS2 ? (minS2 - d2) * 0.14 : Math.min(2, 260 / (d2 * d2));
                mv2[nodes[u].id].x += (dx2 / d2) * f2; mv2[nodes[u].id].y += (dy2 / d2) * f2;
                mv2[nodes[v].id].x -= (dx2 / d2) * f2; mv2[nodes[v].id].y -= (dy2 / d2) * f2;
              }
            }
            edges.forEach(function (e) {
              var a3 = p[e.from], b3 = p[e.to];
              mv2[e.from].x += (b3.x - a3.x) * 0.026; mv2[e.from].y += (b3.y - a3.y) * 0.026;
              mv2[e.to].x += (a3.x - b3.x) * 0.026; mv2[e.to].y += (a3.y - b3.y) * 0.026;
            });
            nodes.forEach(function (n) {
              p[n.id].x += Math.max(-12, Math.min(12, mv2[n.id].x));
              p[n.id].y += Math.max(-12, Math.min(12, mv2[n.id].y));
            });
          }
        }
      }
      positions[key] = p;
    }

    fitCamera(key);
    canvas.setAttribute('aria-label', tr('Dependency graph. The module list provides keyboard navigation.'));
  }

  function fitCamera(key) {
    if (userMoved[key] || !nodes.length || !stage.clientWidth || !stage.clientHeight) return;
    var p = positions[key];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      var pt = p[n.id];
      var pad = n.r + 36;
      if (pt.x - pad < minX) minX = pt.x - pad;
      if (pt.x + pad > maxX) maxX = pt.x + pad;
      if (pt.y - pad < minY) minY = pt.y - pad;
      if (pt.y + pad + 18 > maxY) maxY = pt.y + pad + 18;
    });
    var w = stage.clientWidth, h = stage.clientHeight;
    var topReserve = 62, bottomReserve = w < 640 ? 120 : 62;
    var availW = Math.max(120, w - 64);
    var availH = Math.max(120, h - topReserve - bottomReserve);
    var spanW = Math.max(120, maxX - minX);
    var spanH = Math.max(120, maxY - minY);
    zoom = Math.max(0.2, Math.min(1.45, Math.min(availW / spanW, availH / spanH)));
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    pan = {
      x: -cx * zoom,
      y: ((topReserve - bottomReserve) / 2) - cy * zoom
    };
    fitted[key] = true;
  }

  function hull(points) {
    if (points.length < 3) return points.slice();
    var pts = points.slice().sort(function (a, b) { return a.x === b.x ? a.y - b.y : a.x - b.x; });
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lower = [];
    for (var i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    var upper = [];
    for (var j = pts.length - 1; j >= 0; j--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[j]) <= 0) upper.pop();
      upper.push(pts[j]);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function traceRoundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    var cr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + cr, y);
    ctx.lineTo(x + w - cr, y);
    ctx.arcTo(x + w, y, x + w, y + cr, cr);
    ctx.lineTo(x + w, y + h - cr);
    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr);
    ctx.lineTo(x + cr, y + h);
    ctx.arcTo(x, y + h, x, y + h - cr, cr);
    ctx.lineTo(x, y + cr);
    ctx.arcTo(x, y, x + cr, y, cr);
    ctx.closePath();
  }

  function draw(now) {
    frame = 0;
    if (panel.hidden || current !== 'graph') { anim = false; return; }
    now = now || performance.now();
    var pal = palette();
    var w = Math.max(1, stage.clientWidth);
    var h = Math.max(1, stage.clientHeight);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!nodes.length) {
      ctx.fillStyle = pal.muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tr('No modules in the analyzed scope.'), w / 2, h / 2);
      anim = false;
      return;
    }

    // 1. Blueprint micro-dot background matrix
    var step = 22 * zoom;
    if (step >= 10) {
      var ox = ((w / 2 + pan.x) % step + step) % step;
      var oy = ((h / 2 + pan.y) % step + step) % step;
      ctx.fillStyle = pal.dot;
      for (var gx = ox; gx < w; gx += step) {
        for (var gy = oy; gy < h; gy += step) {
          ctx.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
        }
      }
    }

    ctx.save();
    ctx.translate(w / 2 + pan.x, h / 2 + pan.y);
    ctx.scale(zoom, zoom);

    var key = drill ? ('drill:' + drill) : '$modules';
    var p = positions[key];
    var nodeMap = Object.create(null);
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    var focusId = hover || (!drill ? selected.moduleId : selectedFile);
    var neighborMap = Object.create(null);
    var activeFinding = findings[selected.findingId];
    if (focusId) {
      neighborMap[focusId] = true;
      edges.forEach(function (e) {
        if (e.from === focusId) neighborMap[e.to] = 'out';
        if (e.to === focusId) neighborMap[e.from] = 'in';
      });
    }

    // 2. Domain Nebula Islands OR Drilldown Container
    if (!drill) {
      var clusterNodes = Object.create(null);
      nodes.forEach(function (n) {
        (clusterNodes[n.domain] = clusterNodes[n.domain] || []).push(n);
      });
      Object.keys(clusterNodes).forEach(function (dk) {
        var list = clusterNodes[dk];
        if (list.length < 2) return;
        var pts = list.map(function (n) { return p[n.id]; });
        var color = domainColor(list[0].id, pal.isLight);
        ctx.save();
        if (pts.length === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.lineCap = 'round';
          ctx.lineWidth = 64;
          ctx.globalAlpha = pal.isLight ? 0.08 : 0.09;
          ctx.strokeStyle = color;
          ctx.stroke();
        } else {
          var ch = hull(pts);
          ctx.beginPath();
          ctx.moveTo(ch[0].x, ch[0].y);
          for (var k = 1; k < ch.length; k++) ctx.lineTo(ch[k].x, ch[k].y);
          ctx.closePath();
          ctx.lineJoin = 'round';
          ctx.lineWidth = 62;
          ctx.globalAlpha = pal.isLight ? 0.08 : 0.09;
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fill();
        }
        var cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        list.forEach(function (n) {
          var pt = p[n.id];
          cx += pt.x; cy += pt.y;
          if (pt.x - n.r < minX) minX = pt.x - n.r;
          if (pt.x + n.r > maxX) maxX = pt.x + n.r;
          if (pt.y - n.r < minY) minY = pt.y - n.r;
          if (pt.y + n.r > maxY) maxY = pt.y + n.r;
        });
        cx /= list.length; cy /= list.length;
        var labelAnchor = [
          { x: cx, y: minY - 26, align: 'center' },
          { x: cx, y: maxY + 38, align: 'center' },
          { x: minX - 24, y: cy + 3, align: 'right' },
          { x: maxX + 24, y: cy + 3, align: 'left' }
        ].reduce(function (best, cand) {
          var clear = Infinity;
          nodes.forEach(function (n) {
            var pt = p[n.id];
            var d = Math.hypot(cand.x - pt.x, cand.y - pt.y) - (n.r + 14);
            if (d < clear) clear = d;
          });
          return (!best || clear > best.clear) ? { cand: cand, clear: clear } : best;
        }, null).cand;
        ctx.globalAlpha = pal.isLight ? 0.62 : 0.52;
        ctx.fillStyle = color;
        ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = labelAnchor.align;
        ctx.fillText(dk.toUpperCase(), labelAnchor.x, labelAnchor.y);
        ctx.restore();
      });
    } else if (nodes.length) {
      var minX = Infinity, maxX = -Infinity, minY2 = Infinity, maxY2 = -Infinity;
      nodes.forEach(function (n) {
        var pt = p[n.id];
        minX = Math.min(minX, pt.x - n.r); maxX = Math.max(maxX, pt.x + n.r);
        minY2 = Math.min(minY2, pt.y - n.r); maxY2 = Math.max(maxY2, pt.y + n.r);
      });
      var mColor = domainColor(drill, pal.isLight);
      ctx.save();
      ctx.strokeStyle = mColor;
      ctx.globalAlpha = 0.28;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.4;
      traceRoundRect(ctx, minX - 36, minY2 - 36, (maxX - minX) + 72, (maxY2 - minY2) + 86, 20);
      ctx.stroke();
      ctx.globalAlpha = pal.isLight ? 0.04 : 0.06;
      ctx.fillStyle = mColor;
      ctx.fill();
      ctx.restore();
    }

    // 3. Curved Quadratic Edges + Flow Particles
    var animated = !motion.matches && nodes.length <= 200 && edges.length <= 350;
    var activeLabels = [];
    var hasActiveParticle = false;
    var pairs = Object.create(null);
    edges.forEach(function (e) { pairs[e.from + '\n' + e.to] = true; });

    edges.forEach(function (e, idx) {
      var a = p[e.from], b = p[e.to];
      if (!a || !b) return;
      var isIn = focusId && e.to === focusId;
      var isOut = focusId && e.from === focusId;
      var isActive = isIn || isOut;
      var isCycle = Boolean(e.cycle);
      var dimmed = Boolean(focusId) && !isActive && !(isCycle && !hover);

      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.max(1, Math.hypot(dx, dy));
      var bendDir = pairs[e.to + '\n' + e.from] ? 1 : (idx % 2 === 0 ? 0.7 : -0.65);
      var bend = Math.min(28, dist * 0.14) * bendDir;
      var cx = (a.x + b.x) / 2 - (dy / dist) * bend;
      var cy = (a.y + b.y) / 2 + (dx / dist) * bend;

      var stroke = isCycle ? pal.errorColor : (isIn ? pal.inColor : (isOut ? pal.outColor : (dimmed ? pal.edgeDim : pal.edgeBase)));
      var alpha = isActive ? (hover ? 0.92 : 0.80) : (isCycle ? (hover ? 0.35 : 0.82) : (dimmed ? (hover ? 0.12 : 0.45) : 0.82));
      var lw = (isActive || isCycle) ? (1.5 + Math.min(2.6, Math.log2(1 + (e.weight || 1)) * 0.7)) : (dimmed ? 0.9 : 1.15);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(cx, cy, b.x, b.y);
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      if (isCycle && !isActive) ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (edges.length <= 300 || isActive || isCycle) {
        var target = nodeMap[e.to];
        var trR = (target ? target.r : 12) + 4;
        var ang = Math.atan2(b.y - cy, b.x - cx);
        var ax = b.x - Math.cos(ang) * trR;
        var ay = b.y - Math.sin(ang) * trR;
        ctx.fillStyle = (isActive || isCycle) ? stroke : pal.muted;
        ctx.globalAlpha = (isActive || isCycle) ? 0.92 : (dimmed ? 0.12 : 0.35);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - Math.cos(ang - 0.42) * 6, ay - Math.sin(ang - 0.42) * 6);
        ctx.lineTo(ax - Math.cos(ang + 0.42) * 6, ay - Math.sin(ang + 0.42) * 6);
        ctx.closePath();
        ctx.fill();
      }

      if (animated && (isActive || isCycle)) {
        hasActiveParticle = true;
        var t = ((now * 0.00055) + idx * 0.17) % 1;
        var mt = 1 - t;
        var px = mt * mt * a.x + 2 * mt * t * cx + t * t * b.x;
        var py = mt * mt * a.y + 2 * mt * t * cy + t * t * b.y;
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = isCycle ? pal.errorColor : (isIn ? pal.inColor : pal.outColor);
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isActive && ((e.weight && e.weight >= 2) || hover) && activeLabels.length < 18) {
        activeLabels.push({
          x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x,
          y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y,
          text: e.weight ? ('×' + e.weight) : tr(e.kind || 'import'),
          color: isCycle ? pal.errorColor : (isIn ? pal.inColor : pal.outColor)
        });
      }
      ctx.restore();
    });

    // 4. Nodes
    var pulse = animated ? (0.5 + 0.5 * Math.sin(now * 0.0035)) : 0.5;
    var drawn = [];
    nodes.forEach(function (n) {
      var pt = p[n.id];
      if (!pt) return;
      var color = domainColor(n.moduleId, pal.isLight);
      var isFocused = focusId === n.id;
      var isRel = focusId && Boolean(neighborMap[n.id]);
      var relevant = activeFinding && activeFinding.moduleIds.indexOf(n.moduleId) !== -1;
      var dim = hover && !isRel && !relevant;

      ctx.save();
      ctx.globalAlpha = dim ? 0.22 : 1;

      if ((n.cycle || n.health === 'error') && !dim) {
        hasActiveParticle = animated || hasActiveParticle;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, n.r + 4 + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = pal.errorColor;
        ctx.globalAlpha = 0.55 - pulse * 0.25;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.globalAlpha = dim ? 0.22 : 1;
      } else if (n.isHot && !dim) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, n.r + 4 + pulse * 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.warnColor;
        ctx.globalAlpha = 0.42 - pulse * 0.2;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = dim ? 0.22 : 1;
      }

      if (isFocused || relevant) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, n.r + 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.fg;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = pal.card;
      ctx.fill();
      ctx.lineWidth = 2.3;
      ctx.strokeStyle = color;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(3.8, n.r * 0.44), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.22 : 0.88;
      ctx.fill();
      ctx.restore();

      drawn.push({ n: n, pt: pt, isFocused: isFocused || relevant, isRel: isRel, dim: dim });
    });

    // 5. Weight Pills along active edges
    activeLabels.forEach(function (lb) {
      ctx.save();
      ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      var tw = ctx.measureText(lb.text).width + 8;
      ctx.fillStyle = pal.pillBg;
      ctx.strokeStyle = lb.color;
      ctx.lineWidth = 1;
      traceRoundRect(ctx, lb.x - tw / 2, lb.y - 7.5, tw, 15, 7.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = lb.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lb.text, lb.x, lb.y + 0.5);
      ctx.restore();
    });

    // 6. Collision-free Label Pills
    var placed = [];
    drawn.sort(function (a, b) {
      return Number(b.isFocused) - Number(a.isFocused) || Number(b.isRel) - Number(a.isRel) || Number(b.n.isHot) - Number(a.n.isHot) || b.n.r - a.n.r;
    }).forEach(function (item) {
      var n = item.n, pt = item.pt;
      if (!item.isFocused && !item.isRel && zoom < 0.65 && nodes.length > 28 && n.weight < 30) return;
      ctx.save();
      ctx.globalAlpha = item.dim ? 0.22 : 1;
      var fs = Math.max(9.5, Math.min(13, 11 / Math.sqrt(Math.max(0.55, zoom))));
      ctx.font = (item.isFocused ? '600 ' : '500 ') + fs + 'px system-ui, -apple-system, sans-serif';
      var short = n.label.length > 28 ? '…' + n.label.slice(-27) : n.label;
      var tw = ctx.measureText(short).width;
      var box = { x: pt.x - tw / 2 - 4, y: pt.y + n.r + 4, w: tw + 8, h: fs + 4 };
      var collides = !item.isFocused && placed.some(function (b) {
        return box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y;
      });
      if (!collides) {
        placed.push(box);
        ctx.fillStyle = pal.pillBg;
        traceRoundRect(ctx, box.x, box.y, box.w, box.h, 5);
        ctx.fill();
        ctx.fillStyle = pal.fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(short, pt.x, box.y + 2);
      }
      ctx.restore();
    });

    ctx.restore();
    if (hasActiveParticle && animated) {
      anim = true;
      frame = requestAnimationFrame(draw);
    } else {
      anim = false;
    }
  }

  function requestPaint() {
    if (!frame && !panel.hidden && current === 'graph') frame = requestAnimationFrame(draw);
  }

  function trunc(str, max) {
    return str.length > max ? '…' + str.slice(-(max - 1)) : str;
  }

  function bindSvgInteractions(isLayers) {
    svgWrap.querySelectorAll('[data-module]').forEach(function (el) {
      var modId = el.getAttribute('data-module');
      el.addEventListener('click', function () {
        hover = null;
        select({ moduleId: modId, findingId: null });
      });
      if (isLayers) {
        el.addEventListener('mouseenter', function () {
          hover = modId;
          renderLayersSvg();
        });
        el.addEventListener('mouseleave', function () {
          hover = null;
          renderLayersSvg();
        });
        el.addEventListener('dblclick', function () {
          select({ moduleId: modId, findingId: null });
          open('butterfly');
        });
      } else {
        el.addEventListener('mouseenter', function () {
          if (el.classList.contains('ribbon-path')) el.setAttribute('fill-opacity', '0.56');
        });
        el.addEventListener('mouseleave', function () {
          if (el.classList.contains('ribbon-path')) el.setAttribute('fill-opacity', '0.30');
        });
      }
    });
  }

  // ---- View 2: Interactive SVG Architectural Swimlanes ----
  function renderLayersSvg() {
    if (!modules.length) {
      svgWrap.innerHTML = '<div class="map-empty">' + esc(tr('No modules in the analyzed scope.')) + '</div>';
      return;
    }
    var pal = palette();
    var vbW = Math.max(320, stage.clientWidth || 960);
    var stageH = Math.max(420, stage.clientHeight || 560);
    var activeId = hover || selected.moduleId || modules[0].id;

    // Group modules by layer, condensing > 8 distinct layers into <= 7 swimlanes
    var distinctLayers = [];
    var byLayer = Object.create(null);
    modules.forEach(function (m) {
      if (!byLayer[m.layer]) { byLayer[m.layer] = []; distinctLayers.push(m.layer); }
      byLayer[m.layer].push(m);
    });
    distinctLayers.sort(function (a, b) { return a - b; });
    var MAX_BANDS = 7;
    var bands = [];
    if (distinctLayers.length <= MAX_BANDS) {
      distinctLayers.forEach(function (lv) {
        bands.push({ title: tr('Layer {number}', { number: Number(lv) + 1 }), items: byLayer[lv].slice() });
      });
    } else {
      for (var bi = 0; bi < MAX_BANDS; bi++) {
        var start = Math.floor(bi * distinctLayers.length / MAX_BANDS);
        var end = Math.floor((bi + 1) * distinctLayers.length / MAX_BANDS);
        var slice = distinctLayers.slice(start, end);
        var combined = [];
        slice.forEach(function (lv) { Array.prototype.push.apply(combined, byLayer[lv]); });
        var firstL = Number(slice[0]) + 1, lastL = Number(slice[slice.length - 1]) + 1;
        bands.push({
          title: firstL === lastL ? tr('Layer {number}', { number: firstL }) : (tr('Layer {number}', { number: firstL }) + ' – ' + lastL),
          items: combined
        });
      }
    }

    // Order within each band to reduce crossings and group domains
    var bandOfModule = Object.create(null);
    bands.forEach(function (b, idx) {
      b.items.sort(function (a, c) {
        return (domainOfModule[a.id] < domainOfModule[c.id] ? -1 : domainOfModule[a.id] > domainOfModule[c.id] ? 1 : 0) ||
          (b.items.length > 1 ? ((c.fanIn + c.fanOut) - (a.fanIn + a.fanOut)) : 0) ||
          (a.label < c.label ? -1 : 1);
      });
      b.items.forEach(function (m) { bandOfModule[m.id] = idx; });
    });

    var compact = vbW < 540;
    var padX = compact ? 14 : 24;
    var cardGapX = compact ? 10 : 16;
    var cardGapY = 12;
    var cardH = compact ? 32 : 34;
    var maxCols = compact ? 2 : Math.max(2, Math.min(6, Math.floor((vbW - padX * 2 - 24 + cardGapX) / (138 + cardGapX))));
    var cardW = compact
      ? Math.max(118, Math.floor((vbW - padX * 2 - 20 - cardGapX) / 2))
      : Math.min(156, Math.max(118, Math.floor((vbW - padX * 2 - 28 - (maxCols - 1) * cardGapX) / maxCols)));

    var topMargin = 62;
    var bottomMargin = vbW >= 760 ? 64 : 112;
    var bandGap = 12;
    var totalRowsH = 0;
    bands.forEach(function (b) {
      b.rows = Math.max(1, Math.ceil(b.items.length / maxCols));
      b.baseH = 26 + b.rows * cardH + (b.rows - 1) * cardGapY + 14;
      totalRowsH += b.baseH;
    });
    var naturalH = topMargin + totalRowsH + Math.max(0, bands.length - 1) * bandGap + bottomMargin;
    var extraY = naturalH < stageH ? Math.min(24, Math.floor((stageH - naturalH) / Math.max(1, bands.length))) : 0;

    var layout = Object.create(null);
    var curY = topMargin;
    bands.forEach(function (b) {
      b.y = curY;
      b.h = b.baseH + extraY;
      var innerTop = curY + 26 + Math.floor(extraY / 2);
      for (var r = 0; r < b.rows; r++) {
        var rowItems = b.items.slice(r * maxCols, (r + 1) * maxCols);
        var rowW = rowItems.length * cardW + Math.max(0, rowItems.length - 1) * cardGapX;
        var startX = Math.max(padX + 10, (vbW - rowW) / 2);
        var cy = innerTop + r * (cardH + cardGapY) + cardH / 2;
        rowItems.forEach(function (m, ci) {
          layout[m.id] = { x: startX + ci * (cardW + cardGapX) + cardW / 2, y: cy, w: cardW, h: cardH };
        });
      }
      curY += b.h + bandGap;
    });
    var vbH = Math.max(stageH, curY - bandGap + bottomMargin);

    var neighborSet = Object.create(null);
    neighborSet[activeId] = true;
    allEdges.forEach(function (e) {
      if (e.from === activeId || e.to === activeId) { neighborSet[e.from] = true; neighborSet[e.to] = true; }
    });

    var parts = [];
    // Bands
    bands.forEach(function (b, bi) {
      parts.push(
        '<rect x="' + padX + '" y="' + b.y + '" width="' + (vbW - padX * 2) + '" height="' + b.h + '" rx="10" fill="' + esc(pal.card) + '" fill-opacity="' + (pal.isLight ? (bi % 2 === 0 ? '0.72' : '0.45') : (bi % 2 === 0 ? '0.55' : '0.32')) + '" stroke="' + esc(pal.border) + '" stroke-width="1"/>',
        '<text x="' + (padX + 12) + '" y="' + (b.y + 18) + '" fill="' + esc(pal.muted) + '" font-size="11" font-weight="600">' + esc(b.title) + '</text>'
      );
    });

    // Separate background vs foreground edges
    var bgEdges = [], fgEdges = [];
    allEdges.forEach(function (e) {
      if (!layout[e.from] || !layout[e.to] || e.from === e.to) return;
      if (e.from === activeId || e.to === activeId || e.cycle || e.backward) fgEdges.push(e);
      else bgEdges.push(e);
    });
    bgEdges = bgEdges.slice(0, 420);

    function drawLayerEdge(e, isFg) {
      var A = layout[e.from], B = layout[e.to];
      var sameBand = Math.abs(A.y - B.y) < cardH * 0.7;
      var backward = A.y > B.y + 4 || e.cycle || e.backward;
      var x1, y1, x2, y2, d;
      if (sameBand) {
        var goRight = A.x < B.x;
        x1 = A.x + (goRight ? A.w / 2 : -A.w / 2);
        y1 = A.y;
        x2 = B.x + (goRight ? -B.w / 2 : B.w / 2);
        y2 = B.y;
        var arc = Math.min(48, Math.max(18, Math.abs(x2 - x1) * 0.25));
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Q ' + ((x1 + x2) / 2).toFixed(1) + ' ' + (y1 - arc).toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      } else {
        var goingDown = A.y < B.y;
        x1 = A.x;
        y1 = goingDown ? (A.y + A.h / 2) : (A.y - A.h / 2);
        x2 = B.x;
        y2 = goingDown ? (B.y - B.h / 2) : (B.y + B.h / 2);
        var cyOff = (y2 - y1) * 0.5;
        d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + x1.toFixed(1) + ' ' + (y1 + cyOff).toFixed(1) + ' ' + x2.toFixed(1) + ' ' + (y2 - cyOff).toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      }
      var isTouch = e.from === activeId || e.to === activeId;
      var stroke = backward ? pal.errorColor : (isTouch ? (e.to === activeId ? pal.inColor : pal.outColor) : pal.muted);
      var op = !isFg ? (pal.isLight ? '0.15' : '0.13') : (isTouch ? '0.90' : '0.68');
      var sw = !isFg ? '1.1' : String((backward ? 1.6 : 1.5) + Math.min(2.2, Math.log2(1 + (e.weight || 1)) * 0.6));
      var dash = backward ? ' stroke-dasharray="5 3"' : '';
      var out = ['<path class="svg-edge" d="' + d + '" fill="none" stroke="' + esc(stroke) + '" stroke-opacity="' + op + '" stroke-width="' + sw + '"' + dash + ' stroke-linecap="round"/>'];
      if (isTouch && (e.weight || 1) >= 2) {
        var mx = (x1 + x2) / 2;
        var my = sameBand ? (y1 - Math.min(24, Math.abs(x2 - x1) * 0.12)) : ((y1 + y2) / 2);
        var txt = '×' + e.weight;
        out.push(
          '<g pointer-events="none">',
          '<rect x="' + (mx - 14).toFixed(1) + '" y="' + (my - 8).toFixed(1) + '" width="28" height="16" rx="8" fill="' + esc(pal.card) + '" stroke="' + esc(stroke) + '" stroke-width="1"/>',
          '<text x="' + mx.toFixed(1) + '" y="' + (my + 3.5).toFixed(1) + '" text-anchor="middle" fill="' + esc(stroke) + '" font-size="10" font-weight="700">' + esc(txt) + '</text>',
          '</g>'
        );
      }
      return out.join('');
    }

    bgEdges.forEach(function (e) { parts.push(drawLayerEdge(e, false)); });
    fgEdges.forEach(function (e) { parts.push(drawLayerEdge(e, true)); });

    // Nodes
    var maxChars = compact ? 15 : Math.max(14, Math.floor((cardW - 22) / 7.2));
    modules.forEach(function (m) {
      var box = layout[m.id];
      if (!box) return;
      var color = domainColor(m.id, pal.isLight);
      var isSel = m.id === selected.moduleId;
      var isAct = m.id === activeId;
      var op = neighborSet[m.id] ? '1' : '0.45';
      var x = box.x - box.w / 2, y = box.y - box.h / 2;
      var borderCol = (m.cycle || m.health === 'error') && isAct ? pal.errorColor : ((isAct || isSel) ? color : pal.border);
      parts.push(
        '<g class="svg-node" data-module="' + esc(m.id) + '" opacity="' + op + '">',
        '<title>' + esc(m.label + ' · ' + m.files + ' files · ' + m.loc + ' LOC') + '</title>',
        '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + box.w + '" height="' + box.h + '" rx="8" fill="' + esc(pal.card) + '" stroke="' + esc(borderCol) + '" stroke-width="' + ((isAct || isSel) ? '2' : '1.2') + '"/>',
        '<rect x="' + x.toFixed(1) + '" y="' + (y + 6).toFixed(1) + '" width="3.5" height="' + (box.h - 12) + '" rx="1.75" fill="' + esc(color) + '"/>',
        '<text x="' + (x + 11).toFixed(1) + '" y="' + (box.y + 4).toFixed(1) + '" fill="' + esc(pal.fg) + '" font-size="' + (compact ? '11' : '12') + '" font-weight="' + (isSel ? '700' : '600') + '">' + esc(trunc(m.label, maxChars)) + '</text>',
        '</g>'
      );
    });

    svgWrap.innerHTML = '<svg class="map-layers-svg" role="img" aria-label="' + esc(tr('Layers')) + '" viewBox="0 0 ' + vbW + ' ' + vbH + '" width="' + vbW + '" height="' + vbH + '">' + parts.join('') + '</svg>';
    bindSvgInteractions(true);
  }

  // ---- View 3: Interactive SVG Sankey-Ribbon Butterfly ----
  function renderButterflySvg() {
    if (!modules.length) {
      svgWrap.innerHTML = '<div class="map-empty">' + esc(tr('No modules in the analyzed scope.')) + '</div>';
      return;
    }
    var pal = palette();
    var m = byId[selected.moduleId] || modules[0];
    var mColor = domainColor(m.id, pal.isLight);
    var allIn = allEdges.filter(function (e) { return e.to === m.id && e.from !== m.id; }).sort(function (a, b) { return (b.weight || 1) - (a.weight || 1); });
    var allOut = allEdges.filter(function (e) { return e.from === m.id && e.to !== m.id; }).sort(function (a, b) { return (b.weight || 1) - (a.weight || 1); });
    var vbW = Math.max(320, stage.clientWidth || 960);
    var stageH = Math.max(420, stage.clientHeight || 560);
    var vertical = vbW < 640;

    var defs = [];
    var parts = [];

    if (!vertical) {
      var incoming = allIn.slice(0, 16);
      var outgoing = allOut.slice(0, 16);
      var padX = Math.max(24, Math.round(vbW * 0.045));
      var pillW = Math.min(206, Math.max(148, Math.round(vbW * 0.21)));
      var centerW = Math.min(220, Math.max(176, Math.round(vbW * 0.22)));
      var centerH = 128;
      var maxSide = Math.max(incoming.length, outgoing.length, 1);
      var minWingSpan = maxSide * 38;
      var vbH = Math.max(stageH, 128 + minWingSpan + 96);
      var centerX = Math.round((vbW - centerW) / 2);
      var midY = Math.min(Math.round(vbH * 0.48), Math.round((66 + vbH - 58) / 2));
      var centerY = Math.round(midY - centerH / 2);
      var leftX = padX;
      var rightX = vbW - padX - pillW;

      function renderWingHorizontal(list, totalCount, isLeft) {
        var pillX = isLeft ? leftX : rightX;
        var wingTitle = isLeft
          ? (tr('Upstream · depends on this module') + ' (' + totalCount + ')')
          : (tr('Downstream · this module depends on') + ' (' + totalCount + ')');
        var wingColor = isLeft ? pal.inColor : pal.outColor;
        if (!list.length) {
          var ey = midY - 26;
          var emptyLabel = isLeft ? tr('Entry module · no upstream callers') : tr('Foundation module · no outbound dependencies');
          var emptyParts = emptyLabel.split(' · ');
          var lx1 = isLeft ? (pillX + pillW) : (centerX + centerW);
          var lx2 = isLeft ? centerX : pillX;
          parts.push(
            '<text x="' + (pillX + pillW / 2) + '" y="' + (ey - 14) + '" text-anchor="middle" fill="' + esc(wingColor) + '" font-size="11.5" font-weight="600">' + esc(wingTitle) + '</text>',
            '<line x1="' + lx1 + '" y1="' + midY + '" x2="' + lx2 + '" y2="' + midY + '" stroke="' + esc(pal.border) + '" stroke-dasharray="5 5" stroke-width="1.5"/>',
            '<rect x="' + pillX + '" y="' + ey + '" width="' + pillW + '" height="52" rx="10" fill="none" stroke="' + esc(pal.border) + '" stroke-dasharray="5 4" stroke-width="1.2"/>',
            emptyParts.length === 2
              ? '<text x="' + (pillX + pillW / 2) + '" y="' + (midY - 3) + '" text-anchor="middle" fill="' + esc(pal.muted) + '" font-size="11">' + esc(emptyParts[0]) + '<tspan x="' + (pillX + pillW / 2) + '" dy="15">' + esc(emptyParts[1]) + '</tspan></text>'
              : '<text x="' + (pillX + pillW / 2) + '" y="' + (midY + 4) + '" text-anchor="middle" fill="' + esc(pal.muted) + '" font-size="11">' + esc(emptyLabel) + '</text>'
          );
          return;
        }
        var topY = 78;
        var bottomY = isLeft ? (vbH - 36) : Math.max(topY + 140, vbH - 118);
        var count = list.length;
        var slotGap = Math.max(4, Math.min(10, Math.floor((bottomY - topY - count * 28) / Math.max(1, count - 1))));
        var cardH = Math.min(36, Math.max(24, Math.floor((bottomY - topY - (count - 1) * slotGap) / count)));
        var totalListH = count * cardH + (count - 1) * slotGap;
        var wingMid = isLeft ? midY : Math.min(midY, Math.round((topY + bottomY) / 2));
        var startY = Math.max(topY, Math.round(wingMid - totalListH / 2));
        parts.push('<text x="' + (pillX + pillW / 2) + '" y="' + Math.max(66, startY - 14) + '" text-anchor="middle" fill="' + esc(wingColor) + '" font-size="11.5" font-weight="600">' + esc(wingTitle) + '</text>');
        var totalW = list.reduce(function (s, e) { return s + (e.weight || 1); }, 0) || 1;
        var heroSpan = centerH - 28;
        var heroCursor = centerY + 14;
        var maxLabelChars = Math.max(11, Math.floor((pillW - 52) / 7));

        list.forEach(function (e, i) {
          var neighbor = byId[isLeft ? e.from : e.to];
          if (!neighbor) return;
          var nColor = domainColor(neighbor.id, pal.isLight);
          var ny = startY + i * (cardH + slotGap);
          var nCenterY = ny + cardH / 2;
          var thick = Math.max(4, Math.min(26, ((e.weight || 1) / totalW) * heroSpan));
          var heroY = heroCursor + thick / 2;
          heroCursor += thick;

          var xLeft = isLeft ? (pillX + pillW) : (centerX + centerW);
          var xRight = isLeft ? centerX : pillX;
          var yLeft = isLeft ? nCenterY : heroY;
          var yRight = isLeft ? heroY : nCenterY;
          var mx = (xLeft + xRight) / 2;
          var gradId = 'bf-g-' + (isLeft ? 'in-' : 'out-') + i;

          defs.push(
            '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="0%">',
            '<stop offset="0%" stop-color="' + esc(isLeft ? nColor : mColor) + '"/>',
            '<stop offset="100%" stop-color="' + esc(isLeft ? mColor : nColor) + '"/>',
            '</linearGradient>'
          );

          var hHalf = thick / 2;
          var ribbonD = [
            'M', xLeft, (yLeft - hHalf).toFixed(1),
            'C', mx.toFixed(1), (yLeft - hHalf).toFixed(1), mx.toFixed(1), (yRight - hHalf).toFixed(1), xRight, (yRight - hHalf).toFixed(1),
            'L', xRight, (yRight + hHalf).toFixed(1),
            'C', mx.toFixed(1), (yRight + hHalf).toFixed(1), mx.toFixed(1), (yLeft + hHalf).toFixed(1), xLeft, (yLeft + hHalf).toFixed(1),
            'Z'
          ].join(' ');

          parts.push(
            '<path class="ribbon-path" data-module="' + esc(neighbor.id) + '" d="' + ribbonD + '" fill="url(#' + gradId + ')" fill-opacity="0.30" stroke="url(#' + gradId + ')" stroke-opacity="0.65" stroke-width="1"><title>' + esc(neighbor.label + ' ×' + (e.weight || 1)) + '</title></path>',
            '<g class="svg-node" data-module="' + esc(neighbor.id) + '">',
            '<title>' + esc(neighbor.label + ' · ×' + (e.weight || 1)) + '</title>',
            '<rect x="' + pillX + '" y="' + ny + '" width="' + pillW + '" height="' + cardH + '" rx="8" fill="' + esc(pal.card) + '" stroke="' + esc(pal.border) + '" stroke-width="1.2"/>',
            '<rect x="' + pillX + '" y="' + (ny + 5) + '" width="3.5" height="' + (cardH - 10) + '" rx="1.75" fill="' + esc(nColor) + '"/>',
            '<text x="' + (pillX + 12) + '" y="' + (nCenterY + 4) + '" fill="' + esc(pal.fg) + '" font-size="12" font-weight="600">' + esc(trunc(neighbor.label, maxLabelChars)) + '</text>',
            '<text x="' + (pillX + pillW - 10) + '" y="' + (nCenterY + 4) + '" text-anchor="end" fill="' + esc(nColor) + '" font-size="11" font-weight="700">×' + (e.weight || 1) + '</text>',
            '</g>'
          );
        });

        if (totalCount > list.length) {
          var moreY = startY + totalListH + 16;
          parts.push('<text x="' + (pillX + pillW / 2) + '" y="' + moreY + '" text-anchor="middle" fill="' + esc(pal.muted) + '" font-size="11">' + esc(tr('+{count} more', { count: totalCount - list.length })) + '</text>');
        }
      }

      renderWingHorizontal(incoming, allIn.length, true);
      renderWingHorizontal(outgoing, allOut.length, false);

      parts.push(
        '<g>',
        '<rect x="' + centerX + '" y="' + centerY + '" width="' + centerW + '" height="' + centerH + '" rx="14" fill="' + esc(pal.card) + '" stroke="' + esc(mColor) + '" stroke-width="2"/>',
        '<rect x="' + (centerX + 16) + '" y="' + centerY + '" width="' + (centerW - 32) + '" height="4" rx="2" fill="' + esc(mColor) + '"/>',
        '<text x="' + (vbW / 2) + '" y="' + (centerY + 38) + '" text-anchor="middle" fill="' + esc(pal.fg) + '" font-size="15" font-weight="700">' + esc(trunc(m.label, 20)) + '</text>',
        '<text x="' + (vbW / 2) + '" y="' + (centerY + 59) + '" text-anchor="middle" fill="' + esc(pal.muted) + '" font-size="11">' + esc(tr('{files} files · {lines} lines', { files: m.files, lines: m.loc })) + '</text>',
        '<rect x="' + (centerX + 16) + '" y="' + (centerY + 78) + '" width="' + Math.round((centerW - 42) / 2) + '" height="28" rx="7" fill="' + esc(pal.inColor) + '" fill-opacity="0.14"/>',
        '<text x="' + (centerX + 16 + (centerW - 42) / 4) + '" y="' + (centerY + 96) + '" text-anchor="middle" fill="' + esc(pal.inColor) + '" font-size="11" font-weight="600">' + esc(tr('in ') + m.fanIn) + '</text>',
        '<rect x="' + (centerX + centerW - 16 - Math.round((centerW - 42) / 2)) + '" y="' + (centerY + 78) + '" width="' + Math.round((centerW - 42) / 2) + '" height="28" rx="7" fill="' + esc(pal.outColor) + '" fill-opacity="0.14"/>',
        '<text x="' + (centerX + centerW - 16 - (centerW - 42) / 4) + '" y="' + (centerY + 96) + '" text-anchor="middle" fill="' + esc(pal.outColor) + '" font-size="11" font-weight="600">' + esc(tr('out ') + m.fanOut) + '</text>',
        '</g>'
      );
    } else {
      // Narrow/Mobile vertical Sankey flow
      var incM = allIn.slice(0, 8), outM = allOut.slice(0, 8);
      var padM = 14, gapM = 8, pillHM = 32;
      var colsM = 2;
      var pillWM = Math.floor((vbW - padM * 2 - gapM) / colsM);
      var incRows = Math.max(1, Math.ceil(incM.length / colsM));
      var outRows = Math.max(1, Math.ceil(outM.length / colsM));
      var incY0 = 76;
      var incBlockH = incM.length ? (incRows * pillHM + (incRows - 1) * gapM) : 44;
      var heroW = Math.min(280, vbW - 36);
      var heroH = 92;
      var heroX = Math.round((vbW - heroW) / 2);
      var heroY = incY0 + incBlockH + 48;
      var outY0 = heroY + heroH + 68;
      var outBlockH = outM.length ? (outRows * pillHM + (outRows - 1) * gapM) : 44;
      var vbH = Math.max(stageH, outY0 + outBlockH + 120);

      parts.push(
        '<text x="' + (vbW / 2) + '" y="62" text-anchor="middle" fill="' + esc(pal.inColor) + '" font-size="11" font-weight="600">' + esc(tr('Upstream · depends on this module') + ' (' + allIn.length + ')') + '</text>'
      );

      function renderVerticalWing(list, isTop, baseY) {
        if (!list.length) {
          var boxW = Math.min(280, vbW - 36);
          var boxX = Math.round((vbW - boxW) / 2);
          var ly1 = isTop ? (baseY + 40) : (heroY + heroH);
          var ly2 = isTop ? heroY : baseY;
          var emptyT = isTop ? tr('Entry module · no upstream callers') : tr('Foundation module · no outbound dependencies');
          parts.push(
            '<line x1="' + (vbW / 2) + '" y1="' + ly1 + '" x2="' + (vbW / 2) + '" y2="' + ly2 + '" stroke="' + esc(pal.border) + '" stroke-dasharray="5 4" stroke-width="1.5"/>',
            '<rect x="' + boxX + '" y="' + baseY + '" width="' + boxW + '" height="40" rx="9" fill="none" stroke="' + esc(pal.border) + '" stroke-dasharray="5 4"/>',
            '<text x="' + (vbW / 2) + '" y="' + (baseY + 24) + '" text-anchor="middle" fill="' + esc(pal.muted) + '" font-size="11">' + esc(emptyT) + '</text>'
          );
          return;
        }
        var totalW = list.reduce(function (s, e) { return s + (e.weight || 1); }, 0) || 1;
        var spanX = heroW - 40, curX = heroX + 20;
        list.forEach(function (e, i) {
          var neighbor = byId[isTop ? e.from : e.to];
          if (!neighbor) return;
          var nColor = domainColor(neighbor.id, pal.isLight);
          var col = i % colsM, row = Math.floor(i / colsM);
          var countInRow = Math.min(colsM, list.length - row * colsM);
          var rowStartX = countInRow === 1 ? Math.round((vbW - pillWM) / 2) : padM;
          var px = rowStartX + col * (pillWM + gapM);
          var py = baseY + row * (pillHM + gapM);
          var pCx = px + pillWM / 2;
          var thick = Math.max(4, Math.min(20, ((e.weight || 1) / totalW) * spanX));
          var hCenterX = curX + thick / 2;
          curX += thick;

          var y1 = isTop ? (py + pillHM) : (heroY + heroH);
          var y2 = isTop ? heroY : py;
          var x1 = isTop ? pCx : hCenterX;
          var x2 = isTop ? hCenterX : pCx;
          var my = (y1 + y2) / 2;
          var gradId = 'bf-vm-' + (isTop ? 'in-' : 'out-') + i;
          defs.push(
            '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="0%" y2="100%">',
            '<stop offset="0%" stop-color="' + esc(isTop ? nColor : mColor) + '"/>',
            '<stop offset="100%" stop-color="' + esc(isTop ? mColor : nColor) + '"/>',
            '</linearGradient>'
          );
          var hH = thick / 2;
          var rd = [
            'M', (x1 - hH).toFixed(1), y1,
            'C', (x1 - hH).toFixed(1), my.toFixed(1), (x2 - hH).toFixed(1), my.toFixed(1), (x2 - hH).toFixed(1), y2,
            'L', (x2 + hH).toFixed(1), y2,
            'C', (x2 + hH).toFixed(1), my.toFixed(1), (x1 + hH).toFixed(1), my.toFixed(1), (x1 + hH).toFixed(1), y1,
            'Z'
          ].join(' ');
          parts.push(
            '<path class="ribbon-path" data-module="' + esc(neighbor.id) + '" d="' + rd + '" fill="url(#' + gradId + ')" fill-opacity="0.30" stroke="url(#' + gradId + ')" stroke-opacity="0.65" stroke-width="1"/>',
            '<g class="svg-node" data-module="' + esc(neighbor.id) + '">',
            '<rect x="' + px + '" y="' + py + '" width="' + pillWM + '" height="' + pillHM + '" rx="8" fill="' + esc(pal.card) + '" stroke="' + esc(pal.border) + '" stroke-width="1.2"/>',
            '<rect x="' + px + '" y="' + (py + 5) + '" width="3.5" height="' + (pillHM - 10) + '" rx="1.75" fill="' + esc(nColor) + '"/>',
            '<text x="' + (px + 10) + '" y="' + (py + 20) + '" fill="' + esc(pal.fg) + '" font-size="11" font-weight="600">' + esc(trunc(neighbor.label, 14)) + '</text>',
            '<text x="' + (px + pillWM - 8) + '" y="' + (py + 20) + '" text-anchor="end" fill="' + esc(nColor) + '" font-size="10" font-weight="700">×' + (e.weight || 1) + '</text>',
            '</g>'
          );
        });
      }

      renderVerticalWing(incM, true, incY0);
      renderVerticalWing(outM, false, outY0);

      var dsLabel = tr('Downstream · this module depends on') + ' (' + allOut.length + ')';
      var dsPillW = Math.min(vbW - 32, Math.max(128, dsLabel.length * 10 + 28));
      var dsPillY = heroY + heroH + 22;
      parts.push(
        '<g>',
        '<rect x="' + Math.round((vbW - dsPillW) / 2) + '" y="' + dsPillY + '" width="' + dsPillW + '" height="22" rx="11" fill="' + esc(pal.card) + '" stroke="' + esc(pal.border) + '" stroke-width="1"/>',
        '<text x="' + (vbW / 2) + '" y="' + (dsPillY + 14.5) + '" text-anchor="middle" fill="' + esc(pal.outColor) + '" font-size="11" font-weight="600">' + esc(dsLabel) + '</text>',
        '</g>',
        '<g>',
        '<rect x="' + heroX + '" y="' + heroY + '" width="' + heroW + '" height="' + heroH + '" rx="12" fill="' + esc(pal.card) + '" stroke="' + esc(mColor) + '" stroke-width="2"/>',
        '<rect x="' + (heroX + 16) + '" y="' + heroY + '" width="' + (heroW - 32) + '" height="4" rx="2" fill="' + esc(mColor) + '"/>',
        '<text x="' + (vbW / 2) + '" y="' + (heroY + 32) + '" text-anchor="middle" fill="' + esc(pal.fg) + '" font-size="14" font-weight="700">' + esc(trunc(m.label, 24)) + '</text>',
        '<text x="' + (vbW / 2) + '" y="' + (heroY + 51) + '" text-anchor="middle" fill="' + esc(pal.muted) + '" font-size="11">' + esc(tr('{files} files · {lines} lines', { files: m.files, lines: m.loc })) + '</text>',
        '<text x="' + (vbW / 2) + '" y="' + (heroY + 72) + '" text-anchor="middle" fill="' + esc(pal.inColor) + '" font-size="11" font-weight="600">' + esc(tr('fan-in {in} / fan-out {out}', { in: m.fanIn, out: m.fanOut })) + '</text>',
        '</g>'
      );
    }

    svgWrap.innerHTML = '<svg class="map-butterfly-svg" role="img" aria-label="' + esc(tr('Butterfly')) + '" viewBox="0 0 ' + vbW + ' ' + vbH + '" width="' + vbW + '" height="' + vbH + '"><defs>' + defs.join('') + '</defs>' + parts.join('') + '</svg>';
    bindSvgInteractions(false);
  }

  function renderVisualOnly() {
    if (panel.hidden) return;
    renderCard();
    if (current === 'graph') requestPaint();
    else if (current === 'layers') renderLayersSvg();
    else if (current === 'butterfly') renderButterflySvg();
  }

  function render() {
    var isGraph = current === 'graph';
    canvas.hidden = !isGraph;
    svgWrap.hidden = isGraph;
    renderCrumb();
    renderHelp();
    renderCard();
    if (isGraph) {
      graphData();
      requestPaint();
    } else {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      anim = false;
      if (current === 'layers') renderLayersSvg();
      else renderButterflySvg();
    }
  }

  function open(view) {
    if (views.indexOf(view) === -1) return;
    current = view;
    panel.hidden = view === 'classic' || view === 'atlas';
    var atlasPanel = document.getElementById('bauify-atlas');
    if (view === 'atlas' && window.__archifyAtlas) {
      window.__archifyAtlas.open();
    } else {
      if (window.__archifyAtlas) window.__archifyAtlas.close();
      if (atlasPanel) atlasPanel.hidden = true;
      if (view === 'classic') root.removeAttribute('data-bauify-view');
      else root.setAttribute('data-bauify-view', view);
    }
    syncNavPressed();
    if (!panel.hidden) render();
  }

  nav.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-view]');
    if (btn) open(btn.getAttribute('data-view'));
  });

  // Graph canvas pointer & keyboard events
  function locationOf(event) {
    var b = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - b.left - b.width / 2 - pan.x) / zoom,
      y: (event.clientY - b.top - b.height / 2 - pan.y) / zoom
    };
  }

  function hit(point) {
    var key = drill ? ('drill:' + drill) : '$modules';
    var p = positions[key];
    if (!p) return null;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i], q = p[n.id];
      if (!q) continue;
      if (Math.hypot(point.x - q.x, point.y - q.y) < n.r + 7 / zoom) return n;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    var n = hit(locationOf(event));
    drag = { id: n && n.id, x: event.clientX, y: event.clientY, moved: false };
    canvas.classList.add('dragging');
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', function (event) {
    if (drag) {
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      var key = drill ? ('drill:' + drill) : '$modules';
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.id) {
        var pt = positions[key] && positions[key][drag.id];
        if (pt) { pt.x += dx / zoom; pt.y += dy / zoom; }
      } else {
        pan.x += dx; pan.y += dy; userMoved[key] = true;
      }
      drag.x = event.clientX; drag.y = event.clientY;
      requestPaint();
    } else {
      var n = hit(locationOf(event)), id = n && n.id;
      if (hover !== id) {
        hover = id;
        canvas.title = n ? n.id : '';
        canvas.style.cursor = id ? 'pointer' : 'grab';
        requestPaint();
      }
    }
  });

  canvas.addEventListener('pointerup', function (event) {
    if (drag && !drag.moved) {
      var n = hit(locationOf(event));
      if (n) {
        selectedFile = drill ? n.id : null;
        select({ moduleId: n.moduleId, findingId: null });
      }
    }
    drag = null;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('pointercancel', function () {
    drag = null;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('pointerleave', function () {
    hover = null;
    canvas.style.cursor = 'grab';
    requestPaint();
  });

  canvas.addEventListener('dblclick', function (event) {
    var n = hit(locationOf(event));
    if (n && !drill && data.hasFacts) {
      drill = n.id;
      selectedFile = null;
      hover = null;
      fitted['drill:' + drill] = false;
      userMoved['drill:' + drill] = false;
      render();
    } else if (!n && drill) {
      drill = null;
      selectedFile = null;
      hover = null;
      fitted['$modules'] = false;
      render();
    }
  });

  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    var key = drill ? ('drill:' + drill) : '$modules';
    userMoved[key] = true;
    var b = canvas.getBoundingClientRect();
    var x = event.clientX - b.left - b.width / 2;
    var y = event.clientY - b.top - b.height / 2;
    var ratio = Math.exp(-Math.max(-160, Math.min(160, event.deltaY)) * 0.002);
    var next = Math.max(0.15, Math.min(5, zoom * ratio));
    pan.x = x - (x - pan.x) * next / zoom;
    pan.y = y - (y - pan.y) * next / zoom;
    zoom = next;
    requestPaint();
  }, { passive: false });

  canvas.addEventListener('keydown', function (event) {
    var key = drill ? ('drill:' + drill) : '$modules';
    if (event.key === '+' || event.key === '=') { userMoved[key] = true; zoom = Math.min(5, zoom * 1.2); }
    else if (event.key === '-') { userMoved[key] = true; zoom = Math.max(0.15, zoom / 1.2); }
    else if (event.key === 'Escape' && drill) { drill = null; selectedFile = null; fitted['$modules'] = false; render(); return; }
    else return;
    event.preventDefault();
    requestPaint();
  });

  window.addEventListener('resize', function () {
    if (panel.hidden) return;
    if (current === 'graph') { fitCamera(drill ? ('drill:' + drill) : '$modules'); requestPaint(); }
    else if (current === 'layers') renderLayersSvg();
    else if (current === 'butterfly') renderButterflySvg();
  });

  if (motion.addEventListener) {
    motion.addEventListener('change', function () {
      if (!panel.hidden && current === 'graph') requestPaint();
    });
  }

  var lastBauify = root.getAttribute('data-bauify');
  var lastTheme = root.getAttribute('data-theme');
  var lastViewAttr = root.getAttribute('data-bauify-view');
  new MutationObserver(function () {
    var onAttr = root.getAttribute('data-bauify');
    var themeAttr = root.getAttribute('data-theme');
    var viewAttr = root.getAttribute('data-bauify-view');
    var on = onAttr === 'on';
    nav.hidden = !on;
    if (!on) {
      panel.hidden = true;
      lastBauify = onAttr;
      lastTheme = themeAttr;
      lastViewAttr = viewAttr;
      return;
    }
    var becameOn = lastBauify !== 'on';
    var themeChanged = lastTheme !== themeAttr;
    var viewAttrChanged = lastViewAttr !== viewAttr;
    lastBauify = onAttr;
    lastTheme = themeAttr;
    lastViewAttr = viewAttr;

    if (becameOn) {
      open(current);
      return;
    }
    if (viewAttrChanged) {
      if (viewAttr === 'atlas' && current !== 'atlas') {
        current = 'atlas';
        panel.hidden = true;
        syncNavPressed();
      } else if (!viewAttr && current !== 'classic' && !standalone) {
        current = 'classic';
        panel.hidden = true;
        syncNavPressed();
      } else if (viewAttr && viewAttr !== current && views.indexOf(viewAttr) !== -1) {
        open(viewAttr);
        return;
      }
    }
    if (themeChanged && !panel.hidden) {
      renderVisualOnly();
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-bauify', 'data-theme', 'data-bauify-view'] });

  window.__archifyMapViews = {
    open: open,
    close: function () { open(standalone ? 'graph' : 'classic'); },
    select: function (value) { select(value); },
    selection: function () { return { moduleId: selected.moduleId, findingId: selected.findingId }; }
  };

  nav.hidden = root.getAttribute('data-bauify') !== 'on';
  open(current);
})();
