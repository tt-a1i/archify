(function () {
  var data = JSON.parse(document.getElementById('bauify-analysis').textContent);
  var tr = window.__archifyMakeAnalysisTranslator(data.ui && data.ui.messages || {});
  var locale = data.ui && data.ui.locale || 'en';
  var root = document.documentElement;
  if (data.pullRequest) root.setAttribute('data-bauify-context', 'pr'); else root.removeAttribute('data-bauify-context');
  var standalone = data.ui && data.ui.mode === 'standalone';
  var toolbar = document.querySelector('.toolbar');
  var svg = document.querySelector('svg');
  if (!toolbar || (!svg && !standalone)) return;
  var byId = {}; data.components.forEach(function (c) { byId[c.id] = c; });

  var externalToggle = document.getElementById('analysis-view-toggle');
  var btn = externalToggle || document.createElement('button');
  if (!externalToggle) btn.id = 'btn-bauify'; btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
  btn.title = tr("Show or hide the code analysis layer (C)"); btn.textContent = tr("Code Analysis");
  if (!externalToggle) toolbar.appendChild(btn);

  var reader = document.createElement('aside');
  reader.lang = locale;
  reader.id = 'bauify-reader'; reader.hidden = true; reader.setAttribute('aria-label', tr("Code analysis reader"));
  reader.innerHTML = ("<nav class=\"reader-nav\" aria-label=\"" + tr("Analysis navigation") + "\">" + "<span class=\"reader-path\">" + tr("Analysis / Overview") + "</span>" + "<span class=\"reader-actions\">") +
    (!standalone && document.getElementById('bauify-atlas-data') ? ("<button type=\"button\" class=\"reader-atlas\" title=\"" + tr("Whole-repository view of files, dependencies and functions") + "\">" + tr("Atlas") + "</button>" + " ") : '') +
    ("<button type=\"button\" class=\"reader-toggle\" aria-expanded=\"true\">" + (standalone ? tr("View Atlas") : tr("View diagram")) + "</button>" + "</span>" + "</nav>");
  var diagramContainer = document.querySelector(standalone ? '.analysis-stage' : '.diagram-container');
  if (diagramContainer) diagramContainer.before(reader); else document.body.appendChild(reader);
  var readerCollapsed = false;
  function setReaderCollapsed(collapsed) {
    var changed = readerCollapsed !== collapsed;
    readerCollapsed = collapsed;
    reader.classList.toggle('collapsed', collapsed);
    if (collapsed) root.setAttribute('data-bauify-reader-collapsed', 'true'); else root.removeAttribute('data-bauify-reader-collapsed');
    reader.querySelector('.reader-toggle').textContent = collapsed ? tr("Show analysis") : standalone ? tr("View Atlas") : tr("View diagram");
    reader.querySelector('.reader-toggle').setAttribute('aria-expanded', String(!collapsed));
    if (changed) requestAnimationFrame(function () { if (window.Archify && Archify.view && Archify.view.centerAt && focused.length) locateComponents(focused); });
  }
  reader.querySelector('.reader-toggle').addEventListener('click', function () { setReaderCollapsed(!readerCollapsed); if (readerCollapsed && window.innerWidth <= 1000 && diagramContainer) diagramContainer.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  var atlasButton = reader.querySelector('.reader-atlas');
  if (atlasButton) atlasButton.addEventListener('click', function () { if (window.__archifyAtlas) window.__archifyAtlas.open(); });
  function readerPage(name) {
    reader.hidden = false;
    reader.querySelector('.reader-path').textContent = tr("Analysis / ") + name;
    setReaderCollapsed(false);
  }
  function positionReader() {
    var bar = toolbar.getBoundingClientRect();
    var header = document.querySelector('.header');
    root.style.setProperty('--bauify-reader-top', Math.max(76, Math.ceil(Math.max(bar.bottom, header ? header.getBoundingClientRect().bottom : 0) + 12)) + 'px');
  }

  var panel = document.createElement('section');
  panel.id = 'bauify-panel'; panel.hidden = true; panel.setAttribute('aria-label', tr("Bauify code analysis"));
  reader.appendChild(panel);

  var layer = null;
  // The left column's home: the project overview. A component panel replaces it; "Overview" brings it back.
  var overview = document.createElement('section');
  overview.id = 'bauify-overview'; overview.hidden = true; overview.setAttribute('aria-label', tr("Code analysis overview"));
  reader.appendChild(overview);
  var findingById = {}; (data.findings || []).forEach(function (f) { findingById[f.id] = f; });
  var overviewMode = 'summary', listScroll = 0;
  var filters = { source: 'all', category: 'all', severity: 'all', status: 'open', search: '', unverified: false, page: 0 };
  var filterKey = 'archify-findings:' + (data.repository.root || '') + ':' + location.pathname;
  try { var restored = JSON.parse(sessionStorage.getItem(filterKey)); if (restored) Object.keys(filters).forEach(function (key) { if (typeof restored[key] === typeof filters[key]) filters[key] = restored[key]; }); } catch (error) { /* Storage is optional for offline reports. */ }
  var entryById = {}; ((data.overview && data.overview.findings) || []).forEach(function (e) { entryById[e.id] = e; });
  var moduleInfo = {};
  data.components.forEach(function (c) { c.modules.forEach(function (m) { moduleInfo[m.id] = m; }); });
  (data.unmapped || []).forEach(function (m) { if (!moduleInfo[m.id]) moduleInfo[m.id] = { id: m.id, label: m.label, path: m.label, files: m.files, loc: m.loc, fanIn: m.fanIn, fanOut: m.fanOut, fileList: m.fileList || [] }; });
  var detail = document.createElement('section');
  detail.id = 'bauify-detail'; detail.hidden = true; detail.setAttribute('aria-label', tr("Bauify finding details"));
  reader.appendChild(detail);
  var codePane = document.createElement('section');
  codePane.id = 'bauify-code'; codePane.hidden = true; codePane.setAttribute('aria-label', tr("Bauify source excerpt"));
  reader.appendChild(codePane);
  // Danger levels behind the colours. Same wording everywhere: legend, badge, detail header.
  var LEVELS = {
    red: { name: 'error', text: tr("an error reported by a rule or external tool. Inspect the original rule and evidence; severity alone does not establish a runtime failure") },
    amber: { name: 'warning', text: tr("a maintenance signal or an external convention/review claim to inspect; not a confirmed defect") },
    blue: { name: 'info', text: tr("a signal to read; no change is required") },
    green: { name: 'clean', text: tr("no rule fired") },
    grey: { name: 'unmapped', text: tr("no source code maps to this component") },
    neutral: { name: 'metric', text: tr("a number, not a verdict") }
  };
  function legend() {
    return '<div id="bauify-legend">' + ['red', 'amber', 'blue', 'green', 'grey'].map(function (t) {
      return '<span title="' + tr(LEVELS[t].text) + '"><i class="bauify-' + t + '"></i><b>' + tr(LEVELS[t].name) + '</b>' + tr(LEVELS[t].text) + '</span>';
    }).join('') + '</div>';
  }
  function nodeBox(id) {
    if (!svg) return null;
    var g = svg.querySelector('g[data-node-id="' + id + '"]');
    if (!g) return null;
    var b = g.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  }
  // Open findings of a component at its own level (errors for red, warnings for
  // amber, info for blue). Accepted findings are not open, except errors.
  var LEVEL_OF = { red: 'error', amber: 'warning', blue: 'info' };
  function levelCount(c) {
    var level = LEVEL_OF[c.indicators.status]; if (!level) return 0;
    var seen = {}, n = 0;
    c.indicators.items.forEach(function (i) { (i.findings || []).forEach(function (id) {
      var f = findingById[id]; if (!f || seen[id] || f.severity !== level) return;
      seen[id] = true;
      if (f.review && f.review.status === 'accepted' && level !== 'error') return;
      n += 1;
    }); });
    return n;
  }
  function drawLayer() {
    if (!svg) return;
    if (layer) layer.remove();
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.id = 'bauify-layer';
    var counts = {}, most = { amber: 0, blue: 0 };
    data.components.forEach(function (c) { counts[c.id] = levelCount(c); if (c.indicators.status in most) most[c.indicators.status] = Math.max(most[c.indicators.status], counts[c.id]); });
    data.components.forEach(function (c) {
      var b = nodeBox(c.id); if (!b) return;
      // Status ring: a rounded outline just outside the node box. Red pulses, amber glows softly, green/grey stay quiet.
      var pad = 10;
      var ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      ring.setAttribute('x', b.x - pad); ring.setAttribute('y', b.y - pad);
      ring.setAttribute('width', b.w + pad * 2); ring.setAttribute('height', b.h + pad * 2);
      ring.setAttribute('rx', 14); ring.setAttribute('ry', 14);
      // When every component warns, a glow on all of them says nothing: only the
      // components with at least half of the highest count keep it.
      var status = c.indicators.status, isFocus = focused.indexOf(c.id) !== -1;
      var quiet = status in most && counts[c.id] * 2 < most[status];
      ring.setAttribute('class', status + (quiet ? ' quiet' : '') + (isFocus ? ' focus' : ''));
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = c.label + ': ' + c.indicators.items.map(function (i) { return tr(i.label) + ' — ' + indicatorValue(c, i); }).join('; ');
      ring.appendChild(title);
      layer.appendChild(ring);
    });
    // Count badges sit above every ring, at the top-right corner of the node.
    data.components.forEach(function (c) {
      var b = nodeBox(c.id), n = counts[c.id]; if (!b || !n) return;
      var label = String(n), w = 14 + label.length * 6.5, h = 16;
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'count ' + c.indicators.status + (focused.indexOf(c.id) !== -1 ? ' focus' : ''));
      g.setAttribute('transform', 'translate(' + (b.x + b.w - w + 6) + ' ' + (b.y - h / 2 - 2) + ')');
      var pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      pill.setAttribute('width', w); pill.setAttribute('height', h); pill.setAttribute('rx', h / 2); pill.setAttribute('ry', h / 2);
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', w / 2); text.setAttribute('y', h / 2); text.textContent = label;
      g.appendChild(pill); g.appendChild(text);
      layer.appendChild(g);
    });
    svg.appendChild(layer);
  }
  var focused = [];
  function setFocus(ids) {
    focused = ids || [];
    if (!svg) return;
    svg.querySelectorAll('g[data-node-id]').forEach(function (g) { g.classList.toggle('bauify-focus', focused.indexOf(g.getAttribute('data-node-id')) !== -1); });
    if (focused.length) root.setAttribute('data-bauify-focus', 'on'); else root.removeAttribute('data-bauify-focus');
    if (layer) drawLayer();
    if (focused.length) requestAnimationFrame(function () { locateComponents(focused); });
  }
  function locateComponents(ids, showCanvas) {
    var boxes = (ids || []).map(nodeBox).filter(Boolean);
    var camera = window.Archify && Archify.view;
    if (!boxes.length || !camera || !camera.centerAt) return false;
    if (window.innerWidth <= 1000) {
      if (!showCanvas) return false;
      setReaderCollapsed(true);
    }
    var x = (Math.min.apply(Math, boxes.map(function (b) { return b.x; })) + Math.max.apply(Math, boxes.map(function (b) { return b.x + b.w; }))) / 2;
    var y = (Math.min.apply(Math, boxes.map(function (b) { return b.y; })) + Math.max.apply(Math, boxes.map(function (b) { return b.y + b.h; }))) / 2;
    return camera.centerAt(x, y, { scale: camera.state ? camera.state().scale : 1, instant: true });
  }
  function showOverview() {
    overviewMode = 'summary';
    readerPage(tr("Overview"));
    root.removeAttribute('data-bauify-source');
    panel.hidden = true; detail.hidden = true; codePane.hidden = true; setFocus([]);
    overview.querySelectorAll('.bauify-item.active').forEach(function (x) { x.classList.remove('active'); });
    overview.hidden = false;
    renderOverview();
    var heading = overview.querySelector('h3'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  // One line about this component: how many of its checks reported something, by level.
  function indicatorSummary(indicators) {
    if (indicators.status === 'grey') return LEVELS.grey.text;
    var checks = indicators.items.filter(function (i) { return i.status !== 'neutral'; });
    var count = function (status) { return checks.filter(function (i) { return i.status === status; }).length; };
    var parts = [[count('red'), 'critical'], [count('amber'), 'warning'], [count('blue'), 'info']].filter(function (p) { return p[0]; }).map(function (p) { return p[0] + ' ' + tr(p[1]); });
    if (!parts.length) return tr("No rule fired in ") + plural(checks.length, 'check') + '.';
    return parts.join(' · ') + tr(" across ") + plural(checks.length, 'check') + tr(". Open one for its findings.");
  }
  function indicatorValue(c, indicator) {
    if (locale !== 'zh-CN') return indicator.value;
    var findings = (indicator.findings || []).map(function (id) { return findingById[id]; }).filter(Boolean);
    if (indicator.key === 'cycle') return findings.length ? tr('{count} recorded cycles; inspect source evidence. Runtime failure is unverified.', { count: findings.length }) : tr('No recorded cycle; runtime behavior is unverified.');
    if (indicator.key === 'instability') return indicator.instability == null ? tr('No edges') : tr('{value} · fan-in {incoming} / fan-out {outgoing}', { value: indicator.instability, incoming: indicator.fanIn, outgoing: indicator.fanOut });
    if (indicator.key === 'conventions' || indicator.key === 'external-review') return tr('{count} findings from {tools}', { count: findings.length, tools: [...new Set(findings.map(function (f) { return f.external.tool; }))].join(', ') });
    return findings.length ? findings.map(findingWhat).join('；') : tr(indicator.value);
  }
  function show(id) {
    readerPage(tr("Component"));
    root.removeAttribute('data-bauify-source');
    var c = byId[id]; if (!c) return;
    overview.hidden = true; setFocus([]);
    var h = ("<button class=\"close\" aria-label=\"" + tr("Close") + "\">" + "×" + "</button>" + "<button type=\"button\" class=\"back\">" + tr("← Overview") + "</button>");
    h += ("<div class=\"k\">" + tr("Bauify · code analysis") + "</div>" + "<h3>") + esc(c.label) + '<span class="badge ' + c.indicators.status + '">' + tr(LEVELS[c.indicators.status].name) + '</span></h3>';
    h += '<div class="ev">' + esc(indicatorSummary(c.indicators)) + '</div>';
    if (c.indicators.items.length) {
      h += ("<div class=\"k\">" + tr("Indicators · click one for its findings and a diagram") + "</div>");
      c.indicators.items.forEach(function (i) {
        var n = (i.findings || []).length;
        h += '<div class="ind link' + (i.status === 'green' ? ' quiet' : '') + '" data-ind="' + i.key + '" role="button" tabindex="0"><i class="' + i.status + '"></i><div><b>' + esc(tr(i.label)) + ' <span class="more">' + (n ? n + tr(" finding") + (n === 1 ? '' : 's') + ' ›' : tr("details ›")) + '</span></b><span class="v">' + esc(indicatorValue(c, i)) + '</span>' +
          (i.detail.length ? ("<div class=\"detail\">" + tr("with: ")) + i.detail.map(function (d) { var m = d.split(':'); return m[0] === 'component' && byId[m[1]] ? esc(byId[m[1]].label) : esc(m[1]) + tr(" (not on diagram)"); }).join(', ') + '</div>' : '') + '</div></div>';
      });
    }
    if (!c.modules.length) {
      h += ("<p class=\"warn\">" + tr("No source module is mapped to this component (external system, or no sources in the IR).") + "</p>");
    } else {
      h += '<div>' + c.modules.map(function (m) { return esc(m.label); }).join(' · ') + '</div>';
      if ((c.ambiguousModules || []).length) h += ("<p class=\"warn\">" + tr("Shared module mapping: ")) + c.ambiguousModules.map(esc).join(', ') + (tr(". Component import attribution remains unresolved; inspect the module files below.") + "</p>");
      h += '<span class="stat">' + c.files + (tr(" files") + "</span>" + "<span class=\"stat\">") + c.loc + (tr(" LOC") + "</span>");
      var fi = c.incoming.reduce(function (n, e) { return n + e.weight; }, 0), fo = c.outgoing.reduce(function (n, e) { return n + e.weight; }, 0);
      h += ("<span class=\"stat\">" + tr("in ")) + fi + ("</span>" + "<span class=\"stat\">" + tr("out ")) + fo + '</span>';
      if (c.internalImports) h += ("<span class=\"stat\">" + tr("internal ")) + c.internalImports + '</span>';
      var section = function (title, list, arrow) {
        if (!list.length) return '';
        var s = '<details><summary>' + title + ' · ' + list.length + '</summary>';
        list.forEach(function (e) {
          var target = e.component ? (byId[e.component] ? byId[e.component].label : e.component) : (e.module + (e.ambiguous ? tr(" (component mapping unresolved)") : tr(" (not on diagram)")));
          s += '<div class="edge"><b>' + arrow + '</b> ' + esc(target) + ' <span class="ev">' + e.weight + tr(" import") + (e.weight === 1 ? '' : 's') + '</span><div class="ev">' +
            e.evidence.map(function (v) { return '<div>' + fileLink(v.file, v.line) + ' → ' + esc(v.to) + '</div>'; }).join('') + '</div></div>';
        });
        return s + '</details>';
      };
      h += section(tr("Imports from here"), c.outgoing, tr("OUT →"));
      h += section(tr("Imported by"), c.incoming, tr("← IN"));
      if (c.fileList && c.fileList.length) {
        h += ("<details>" + "<summary>" + tr("Files · ")) + c.fileList.length + '</summary><table>';
        c.fileList.forEach(function (f) {
          h += '<tr><td class="p" title="' + esc(f.path) + '">' + esc(f.path) + (f.findings.length ? ' <b>!' + f.findings.length + '</b>' : '') + '</td><td class="n">' + f.loc + (tr(" LOC") + "</td>" + "<td class=\"n\">" + tr("out ")) + f.importsOut + ("</td>" + "<td class=\"n\">" + tr("in ")) + f.importedBy + '</td></tr>';
        });
        h += '</table></details>';
      }
    }
    h += ("<div class=\"k\">" + tr("Repository") + "</div>" + "<div class=\"ev\">") + esc(data.repository.url || tr("no origin")) + (data.repository.sourceKind === 'working-tree' ? tr(" · Working tree") + (data.repository.baseRevision ? tr(" (base ") + esc(data.repository.baseRevision.slice(0, 7)) + ')' : '') : (data.repository.revision ? ' @ ' + esc(data.repository.revision.slice(0, 7)) : '')) +
      '<br>' + data.totals.modules + tr(" modules · ") + data.totals.edges + tr(" module edges · ") + data.unmapped.length + (tr(" not on this diagram") + "</div>");
    panel.innerHTML = h;
    panel.hidden = false;
    detail.hidden = true; codePane.hidden = true;
    panel.querySelector('.close').addEventListener('click', showOverview);
    panel.querySelector('.back').addEventListener('click', showOverview);
    panel.querySelectorAll('.ind.link').forEach(function (el) {
      var open = function () { panel.querySelectorAll('.ind.active').forEach(function (x) { x.classList.remove('active'); }); el.classList.add('active'); showDetail(c, el.getAttribute('data-ind')); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }
  function allFindings(c) {
    var fl = (c.findings || []).concat((c.fileList || []).flatMap(function (f) { return f.findings; }));
    var seen = {}; return fl.filter(function (f) { var k = f.id || f.code + JSON.stringify(f.subject); if (seen[k]) return false; seen[k] = true; return true; }).map(function (f) { return findingById[f.id] || f; });
  }
  function ref(file, line, rest, why, tone, rangeStart, rangeEnd, match) {
    return '<button type="button" class="ref" data-file="' + esc(file) + '" data-line="' + line + '" data-range-start="' + (rangeStart || '') + '" data-range-end="' + (rangeEnd || '') + '" data-match="' + (match ? esc(JSON.stringify(match)) : '') + '" data-why="' + esc(why || '') + '" data-tone="' + (tone || '') + '"><b>' + esc(match ? file : short(file)) + '</b> <em>(' + (match ? tr("lines") + " " + rangeStart + '–' + rangeEnd : tr("line ") + line) + ')</em>' + (rest ? ' ' + rest : '') + '</button>';
  }
  function nextStepHtml(f) {
    var text = f.code === 'coupling/hub' ? tr("Check whether dependencies cluster by responsibility before splitting this module.")
      : f.code === 'coupling/concentration' ? tr("Decide whether this concentration is intended. A small shared kernel or one cohesive responsibility can be accepted with that reason; otherwise look for parts that change for different reasons or are used by only a few modules.")
      : f.code === 'coupling/import-cycle' ? tr("Inspect the cited imports and initialization behavior before changing this dependency.")
      : f.code === 'coupling/cycle' ? tr("Check which shared responsibility links these modules. A module cycle does not establish a file-level failure.")
      : f.code === 'architecture/boundary' ? tr("Check what the cited imports need from the other layer: move it behind an interface in an allowed layer, or update the rule if this dependency is intended.")
      : f.code === 'coupling/internal-leak' ? tr("List what the cited imports use, export it from one entry file of the module, and point the imports there. If deep imports are the convention here, declare the entry files in the analysis config instead.")
      : f.code === 'complexity/function' ? tr("Start at the deepest nested block: extract it into a named helper, or return early for edge cases. Make sure the current behavior is covered by tests before restructuring.")
      : f.code === 'redundancy/duplicate-block' ? tr("Compare both uses and their callers. Share the code only when their behavior should change together.")
      : tr("Review the evidence and assumptions before changing code.");
    return ("<div class=\"next-step\">" + "<b>" + tr("Suggested next step") + "</b>" + "<p>") + esc(text) + '</p></div>';
  }
  function findingCard(f, compact) {
    var ev = '';
    var tone = f.severity === 'error' ? 'red' : f.severity === 'warning' ? 'amber' : 'blue';
    if (f.evidence && f.evidence.risk) ev += ("<div class=\"ev\">" + "<div>" + tr("import risk: ") + "<b>") + esc(f.evidence.risk.loading) + '</b> — ' + esc(f.evidence.risk.loadingNote) + '</div></div>';
    if (f.evidence && (f.evidence.partialInitCandidate || f.evidence.proof)) {
      var pr = f.evidence.partialInitCandidate || f.evidence.proof;
      ev += ("<div class=\"ev\" style=\"margin-top:4px\">" + tr("Potential partial initialization when ") + "<b>") + esc(pr.entry) + ("</b>" + tr(" is imported first (chain ")) + esc(pr.chain.join(' → ')) + '):</div>';
      ev += ref(pr.entry, pr.viaLine, ("<span>" + tr("→ leaves for ")) + esc(short(pr.chain[1] || pr.importer)) + (tr(" before ") + "<b>") + esc(pr.name) + ("</b>" + tr(" exists") + "</span>"), tr("This module-scope import runs before ") + pr.name + tr(" is bound (line ") + pr.boundAt + tr("); static line order alone does not prove the execution sequence."), tone);
      ev += ref(pr.importer, pr.line, ("<span>" + tr("→ asks the half-built ")) + esc(short(pr.entry)) + (tr(" for ") + "<b>") + esc(pr.name) + '</b></span>', tr("May read ") + pr.name + tr(" before its binding; execution timing and failure are not proven."), tone);
      ev += ref(pr.entry, pr.boundAt, '<span>→ <b>' + esc(pr.name) + ("</b>" + tr(" has its recorded binding here") + "</span>"), tr("The binding the other side needed; it only exists once the file has run this far."), 'amber');
    }
    if (f.code === 'complexity/function' && f.subject && f.subject.file) {
      ev += ("<div class=\"ev\" style=\"margin-top:4px\">" + tr("Where to look — click to see the code:") + "</div>");
      ev += ref(f.subject.file, f.subject.line, '<span>' + esc(f.subject.function) + (tr("() starts") + "</span>" + " " + "<em>" + "· ") + plural(f.evidence.length, 'line') + '</em>', tr("The function this finding measures (lines ") + f.subject.line + '–' + f.subject.endLine + ').', tone, f.subject.line, f.subject.endLine);
      if (f.evidence.deepestLine && f.evidence.deepestLine !== f.subject.line) ev += ref(f.subject.file, f.evidence.deepestLine, ("<span>" + tr("deepest nesting (")) + f.evidence.nesting + (tr(" levels)") + "</span>"), tr("The most deeply nested block; usually the best place to start simplifying."), tone, f.subject.line, f.subject.endLine);
    }
    if (f.evidence && f.evidence.imports && f.evidence.imports.length) {
      var isCycle = f.code === 'coupling/import-cycle' || f.code === 'coupling/cycle';
      var crossing = f.code === 'architecture/boundary' && f.subject && f.subject.boundary;
      var leak = f.code === 'coupling/internal-leak';
      ev += '<div class="ev" style="margin-top:4px">' + (isCycle ? tr("Imports on the cycle — click one to see the code:") : crossing ? tr("Imports that cross the boundary — click one to see the code:") : leak ? tr("Imports that reach inside the module — click one to see the code:") : tr("Evidence — click to see the code:")) + '</div>';
      f.evidence.imports.slice(0, 8).forEach(function (v) {
        if (crossing) {
          var kind = data.repository.language === 'java' ? tr("Java source dependency") : v.typeOnly ? tr("type-only import") : (v.lazy || v.conditional) ? tr("deferred or conditional import") : tr("module-scope import");
          ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· ' + kind + '</em>',
            tr("This import makes ") + crossing.from + tr(" depend on ") + crossing.to + tr(", which the configured rule forbids.") + (v.typeOnly ? tr(" It is type-only: nothing is loaded at runtime, but the layer still depends on code in the other layer.") : ''), tone);
          return;
        }
        if (leak) {
          ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + ("</span>" + " " + "<em>" + tr("· internal file") + "</em>"),
            tr("This import reaches a file inside ") + modLabel(f.subject.module) + (f.evidence.entries.length ? tr(" instead of its entry point (") + f.evidence.entries.map(short).join(', ') + ').' : tr(", which has no entry file.")), tone);
          return;
        }
        var deferred = v.lazy || v.conditional || v.deferred || v.typeOnly;
        var structural = f.evidence.kind === 'structural';
        var kindText = structural ? tr("Java source dependency · solid") : deferred ? tr("deferred / conditional / type-only import · dashed") : tr("recorded module-scope import · solid");
        ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· ' + kindText + '</em>',
          structural ? tr("A recorded Java import or type reference; class initialization behavior was not assessed.") : deferred ? tr("Execution timing is not proven; deferred functions may be called during initialization. Type-only imports are not runtime dependencies.") : tr("Recorded at module scope; execution order and runtime behavior are not verified."), tone);
      });
      if (f.evidence.imports.length > 8) ev += '<div class="ev">… ' + (f.evidence.imports.length - 8) + (tr(" more in findings.json") + "</div>");
    }
    var fixes = (f.supportedFixes || []).length ? '<div class="ev fixes">' + f.supportedFixes.map(function (x) { return '<div>· ' + esc(x) + '</div>'; }).join('') + '</div>' : '';
    return (compact ? '' : nextStepHtml(f)) + '<div class="finding ' + esc(f.severity) + '">' + ev + ("<details class=\"technical\">" + "<summary>" + tr("Rule details and alternatives") + "</summary>" + "<b>") + esc(f.code) + '</b> · ' + esc(tr(f.severity)) + (f.id ? ' · ' + esc(f.id) : '') + '<p>' + esc(f.message) + '</p>' + fixes + '</details></div>';
  }
  // Source excerpt for one file:line, from the windows embedded at overlay time.
  function showCode(file, line, why, tone, full, rangeStart, rangeEnd, match, snapshot) {
    readerPage(tr("Source"));
    var snip = snapshot === 'base' ? (data.pullRequest.beforeSources || {})[file] : (data.snippets || {})[file];
    line = Number.isInteger(line) && line > 0 ? line : null;
    var sourceParent = detail.hidden ? tr("Component") : tr("Problem");
    var h = ("<div class=\"grip\">" + "<button class=\"close\" aria-label=\"" + tr("Close") + "\">" + "×" + "</button>" + "<button type=\"button\" class=\"source-back back\">" + "← ") + sourceParent + ("</button>" + "<div class=\"k\">" + tr("Source · ")) + (line ? tr("line ") + line : (full ? tr("full file") : tr("file preview")) + tr(" · no specific finding line")) + '</div><h3>' + esc(file) + '</h3></div>';
    if (data.pullRequest) h += '<div class="pr-source-sides"><button type="button" data-pr-side="base"' + (!data.pullRequest.beforeSources[file] ? ' disabled' : '') + '>' + esc(tr('Merge-base')) + ' ' + esc(data.pullRequest.baseSHA.slice(0,8)) + '</button><button type="button" data-pr-side="head"' + (!data.snippets[file] ? ' disabled' : '') + '>' + esc(tr('PR head')) + ' ' + esc(data.pullRequest.headSHA.slice(0,8)) + '</button><span>' + esc(tr(snapshot === 'base' ? 'Showing merge-base source' : 'Showing PR head source')) + '</span></div>';
    if (why) h += '<div class="why">' + esc(why) + '</div>';
    if (!snip) {
      h += ("<div class=\"why\" style=\"margin-top:10px\">" + tr("Source is unavailable in this report. Re-analyze with the local service, or read this file in your editor.") + "</div>");
    } else {
      var changes = snip.changes;
      var added = new Set(changes ? changes.added : []), modified = new Set(changes ? changes.modified : []);
      var deleted = new Map((changes ? changes.deleted : []).map(function (item) { return [item.after, item.count]; }));
      if (changes && changes.status !== 'unavailable') {
        h += '<div class="diff-legend">' + (data.pullRequest ? esc(tr('Captured PR changes vs merge-base {sha}', { sha: data.pullRequest.baseSHA.slice(0,8) })) : tr('Captured changes vs base commit ') + esc((data.repository && data.repository.baseRevision || '').slice(0,7)) + tr(' (staged + unstaged)'));
        if (changes.status === 'unchanged') h += tr(" · No changes");
        else h += (" · " + "<span class=\"added\">" + tr("+ Added") + "</span>" + " · " + "<span class=\"modified\">" + tr("~ Modified") + "</span>" + " · " + "<span class=\"deleted\">" + tr("− Deleted") + "</span>");
        if (changes.status === 'added') h += tr(" · New file");
        h += '</div>';
      } else if (changes) h += ("<div class=\"diff-legend\">" + tr("Change markers unavailable: no readable base commit.") + "</div>");
      var deletion = function (after) { return deleted.has(after) ? ("<span class=\"diff-deleted\" title=\"" + tr("Deleted from the base commit") + "\">" + "− ") + deleted.get(after) + (tr(" deleted line(s)") + "</span>") : ''; };
      var start = full ? 0 : line ? Math.max(0, Math.min(line - 5, snip.lines.length - 9)) : 0;
      var end = full ? snip.lines.length : Math.min(snip.lines.length, start + (line ? 9 : 12));
      h += ("<div class=\"why\">" + tr("Lines ")) + (start + 1) + '–' + end + tr(" of ") + snip.lines.length + (line || full ? '' : tr(" · opening lines, not finding evidence")) + '</div>';
      if (match) h += '<div class="why duplicate-legend"><mark class="duplicate-match">' + (match.kind === 'external' ? tr("Reported range") : tr("Matched code")) + ("</mark>" + tr(" · lines ")) + rangeStart + '–' + rangeEnd + (match.column ? tr(" · column ") + match.column + (match.endColumn ? '–' + match.endColumn + tr(" (end exclusive)") : '') : '') + (full ? '' : tr(" · expand for the complete range")) + '</div>';
      else if (rangeStart && rangeEnd) h += ("<div class=\"why\">" + tr("Highlighted function: lines ")) + rangeStart + '–' + rangeEnd + (full ? '' : tr(" · excerpt only; expand for the complete function")) + '</div>';
      if (snip.lines.length > (line ? 9 : 12)) h += '<button type="button" class="source-file source-toggle">' + (full ? tr("Show excerpt") : tr("Show full file")) + '</button>';
      h += '<pre class="' + (full ? '' : 'excerpt') + (match && match.kind !== 'external' ? ' duplicate-source' : '') + '">';
      if (!start) h += deletion(0);
      snip.lines.forEach(function (text, i) {
        if (i < start || i >= end) return;
        var n = i + 1;
        var kind = added.has(n) ? 'added' : modified.has(n) ? 'modified' : '';
        h += '<span class="ln' + (!match && rangeStart && n >= rangeStart && n <= rangeEnd ? ' range-hit' : '') + (n === line ? ' hit ' + (tone || '') : '') + (kind ? ' diff-' + kind : '') + '"' + (kind ? ' title="' + (kind === 'added' ? tr("Added") : tr("Modified")) + tr(' since base commit') + '"' : '') + '><i>' + n + '</i>' + (match ? duplicateText(text, n, match) : esc(text)) + '</span>';
        h += deletion(n);
      });
      h += '</pre>';
    }
    codePane.innerHTML = h;
    codePane.hidden = false;
    document.documentElement.setAttribute('data-bauify-source', 'on');
    codePane.querySelectorAll('[data-pr-side]').forEach(function(button) { button.addEventListener('click', function() { showCode(file, null, why, tone, full, null, null, null, button.getAttribute('data-pr-side')); }); });
    var sourceToggle = codePane.querySelector('.source-toggle');
    if (sourceToggle) sourceToggle.addEventListener('click', function () { showCode(file, line, why, tone, !full, rangeStart, rangeEnd, match, snapshot); });
    var backToSourceParent = function () { codePane.hidden = true; document.documentElement.removeAttribute('data-bauify-source'); readerPage(sourceParent); var active = detail.querySelector('.ref.active'); if (active) active.focus({ preventScroll: true }); detail.querySelectorAll('.ref.active').forEach(function (x) { x.classList.remove('active'); }); };
    codePane.querySelector('.close').addEventListener('click', backToSourceParent);
    codePane.querySelector('.source-back').addEventListener('click', backToSourceParent);
    var hit = codePane.querySelector('.ln.hit');
    if (hit) codePane.scrollTop = Math.max(0, hit.offsetTop - codePane.offsetTop - codePane.clientHeight / 2);
  }
  function showDetail(c, key) {
    readerPage(tr("Problem"));
    root.removeAttribute('data-bauify-source');
    panel.hidden = true;
    var ind = c.indicators.items.filter(function (i) { return i.key === key; })[0]; if (!ind) return;
    var ids = ind.findings || [];
    var fl = allFindings(c).filter(function (f) { return ids.indexOf(f.id) !== -1; });
    var lvl = LEVELS[ind.status] || LEVELS.neutral;
    var h = ("<button class=\"close\" aria-label=\"" + tr("Close") + "\">" + "×" + "</button>" + "<button class=\"back\" type=\"button\">" + tr("← Component") + "</button>");
    h += '<div class="k">' + esc(c.label) + '</div><h3><i class="bauify-' + ind.status + '"></i>' + esc(tr(ind.label)) + '</h3>';
    var externalGroup = fl.length && fl.every(function (f) { return f.external; });
    h += '<div class="level"><b>' + esc(tr(lvl.name)) + '</b> — ' + esc(indicatorValue(c, ind)) + (ind.status === 'neutral' || externalGroup ? '' : '<br>' + esc(lvl.text)) + '</div>';
    if (!externalGroup) h += ("<details class=\"relationship\">" + "<summary>" + tr("Relationships and metrics") + "</summary>") + diagram(c, key, fl) + '</details>';
    h += ("<div class=\"k\">" + tr("Findings · ")) + fl.length + '</div>';
    if (!fl.length) h += '<div class="ev">' + (key === 'instability' ? tr("Instability measures dependency direction: out / (in + out). 0 = no outgoing dependencies, 1 = no incoming dependents. It is not a failure probability or a quality verdict.") : tr("No finding for this indicator; this is not a safety guarantee.")) + '</div>';
    fl.forEach(function (f) { h += f.external ? findingListRow(f) : quickHandoff(f) + evidencePreview(f) + findingCard(f) + taskHtml(f); });
    detail.innerHTML = h;
    detail.hidden = false;
    codePane.hidden = true;
    var backToComponent = function () { readerPage(tr("Component")); detail.hidden = true; codePane.hidden = true; panel.hidden = false; panel.querySelectorAll('.ind.active').forEach(function (x) { x.classList.remove('active'); }); };
    detail.querySelector('.close').addEventListener('click', backToComponent);
    detail.querySelector('.back').addEventListener('click', backToComponent);
    wireRefs();
    wireTasks();
    detail.querySelectorAll('[data-finding]').forEach(function (button) { button.addEventListener('click', function () { showFinding(button.getAttribute('data-finding')); }); });
  }
  function wireRefs() {
    detail.querySelectorAll('.ref').forEach(function (el) {
      el.addEventListener('click', function () {
        detail.querySelectorAll('.ref.active').forEach(function (x) { x.classList.remove('active'); }); el.classList.add('active');
        var match = el.getAttribute('data-match');
        showCode(el.getAttribute('data-file'), parseInt(el.getAttribute('data-line'), 10), el.getAttribute('data-why'), el.getAttribute('data-tone'), false, Number(el.getAttribute('data-range-start')), Number(el.getAttribute('data-range-end')), match ? JSON.parse(match) : null);
      });
    });
  }
  // --- overview: project-level reading, built from data.overview ------------
  var GROUPS = { 'coupling/import-cycle': tr("Import cycles"), 'coupling/cycle': tr("Module cycles"), 'coupling/hub': tr("Hub modules"), 'coupling/concentration': tr("Concentration"), 'coupling/internal-leak': tr("Internal imports"), 'architecture/boundary': tr("Boundary violations"), 'complexity/function': tr("Complex functions"), 'redundancy/duplicate-block': tr("Duplicate code") };
  var LANGS = { py: 'Python', ts: 'JS/TS', java: 'Java', go: 'Go', rust: 'Rust' };
  function plural(n, word) {
    if (locale === 'zh-CN') {
      var units = { file: ' 个文件', module: ' 个模块', function: ' 个函数', finding: ' 条发现', import: ' 条导入', line: ' 行', check: ' 项检查', source: ' 个来源', layer: ' 个层', rule: ' 条规则', entry: ' 个条目', 'other module': ' 个其他模块', 'internal file': ' 个内部文件', 'matching token': ' 个匹配词元', 'dependency record': ' 条依赖记录', 'error-level finding': ' 条错误级发现' };
      return n + (units[word] || ' ' + tr(word));
    }
    return n + ' ' + word + (n === 1 ? '' : 's');
  }
  function toneOf(severity) { return severity === 'error' ? 'red' : severity === 'warning' ? 'amber' : 'blue'; }
  function modLabel(id) { return moduleInfo[id] ? moduleInfo[id].label : id; }
  function findingTitle(f) {
    if (f.external) { var title = f.message.split(/\r?\n/).find(function (line) { return line.trim(); }) || f.external.ruleId || f.code; return title.length > 160 ? title.slice(0, 157) + '…' : title; }
    var s = f.subject || {};
    if (f.code === 'redundancy/duplicate-block') return tr("Duplicate code");
    if (f.code === 'coupling/import-cycle' && s.files) return tr("Import cycle · ") + plural(s.files.length, 'file');
    if (f.code === 'coupling/cycle' && s.modules) return tr("Module cycle · ") + plural(s.modules.length, 'module');
    if (f.code === 'coupling/hub' && s.module) return modLabel(s.module) + tr(" connects many modules");
    if (f.code === 'coupling/concentration') return s.file ? short(s.file) + tr(" is a very large file") : modLabel(s.module) + tr(" concentrates the project");
    if (f.code === 'coupling/internal-leak' && s.module) return modLabel(s.module) + tr(" is imported through its internals");
    if (f.code === 'architecture/boundary' && s.boundary) return s.boundary.from + tr(" depends on ") + s.boundary.to;
    // Java names carry their parameter types to tell overloads apart.
    if (f.code === 'complexity/function' && s.function) return s.function + (s.function.endsWith(')') ? '' : '()') + tr(" is complex");
    return f.code;
  }
  function concentrationWhat(ev) {
    var pct = function (share) { return Math.round(share * 100) + '%'; };
    var parts = [];
    if (ev.reach) parts.push(ev.reach.dependents + tr(" of ") + plural(ev.reach.modules, 'other module') + tr(" depend on it (") + pct(ev.reach.share) + ')');
    if (ev.size) parts.push(pct(ev.size.share) + tr(" of the analyzed lines (") + ev.size.loc + tr(" of ") + ev.size.totalLoc + ')');
    if (ev.loc) parts.push(plural(ev.loc, 'line') + tr(" · threshold ") + ev.threshold.fileLines);
    return parts.join(' · ');
  }
  function findingWhat(f) {
    if (f.external) return f.external.tool + ' · ' + (f.external.ruleId || tr("review comment"));
    var s = f.subject || {};
    if (f.code === 'redundancy/duplicate-block' && f.evidence) return plural(f.evidence.tokens, 'matching token') + ' · ' + plural(f.evidence.lines, 'line') + (f.evidence.kind === 'renamed' ? tr(" · renamed identifiers") : tr(" · exact tokens"));
    if (f.code === 'coupling/concentration' && f.evidence) return concentrationWhat(f.evidence);
    if (s.files) return tr("Files: ") + s.files.slice(0, 3).map(short).join(', ') + (s.files.length > 3 ? ' …' : '');
    if (s.modules) return tr("Modules: ") + s.modules.slice(0, 4).map(modLabel).join(', ') + (s.modules.length > 4 ? ' …' : '');
    if (f.code === 'coupling/hub' && f.evidence) return f.evidence.fanIn + tr(" modules depend on it; it depends on ") + f.evidence.fanOut + '.';
    if (f.code === 'coupling/internal-leak' && f.evidence) return plural(f.evidence.totalImports, 'import') + tr(" from ") + plural(f.evidence.consumers.length, 'module') + tr(" reach ") + plural(f.evidence.internalFiles.length, 'internal file') + tr(" of ") + f.evidence.moduleFiles + (f.evidence.entries.length ? tr(" · entry point: ") + f.evidence.entries.map(short).join(', ') : tr(" · no entry file"));
    if (f.code === 'complexity/function' && f.evidence) return tr("complexity ") + f.evidence.complexity + tr(" · nesting ") + f.evidence.nesting + ' · ' + plural(f.evidence.length, 'line') + ' · ' + short(s.file);
    if (f.code === 'architecture/boundary' && f.evidence) return plural(f.evidence.totalImports, 'import') + tr(" in ") + plural(f.evidence.files.length, 'file') + tr(" · rule: ") + (f.evidence.rule.reason || s.boundary.from + tr(" must not depend on ") + s.boundary.to);
    return f.message;
  }
  // The primary source location needs its owner, not every participant in a cycle.
  // Full participants remain in the evidence and Atlas selection.
  function sourceModuleLabel(f) {
    var ids = f.moduleIds || [], subject = f.subject || {}, first = (f.evidence && f.evidence.imports || [])[0];
    var file = subject.file || first && first.file;
    var owner = file && ids.find(function(id) { return moduleInfo[id] && (moduleInfo[id].fileList || []).some(function(item) { return item.path === file; }); });
    var chosen = owner ? [owner] : ids.slice(0, 2);
    return chosen.map(function(id) { return moduleInfo[id] ? moduleInfo[id].label : id; }).join(', ') + (!owner && ids.length > 2 ? tr(' and {count} more modules', {count: ids.length - 2}) : '') || tr('Repository');
  }
  function findingWhere(f) {
    var ids = f.componentIds || [];
    var where = ids.length ? ids.map(function (id) { return byId[id] ? byId[id].label : id; }).join(', ') : standalone ? sourceModuleLabel(f) : tr("not on this diagram");
    var e = entryById[f.id];
    var s = f.subject || {}, first = (f.evidence && f.evidence.imports || [])[0];
    if (f.code === 'redundancy/duplicate-block' && s.locations) return s.locations.map(function (loc) { return loc.file + ':' + loc.line; }).join(' ↔ ');
    var path = s.file ? s.file + (s.line ? ':' + s.line : '') : first ? first.file + ':' + first.line : '';
    return (path ? path + ' · ' : '') + where + (e && e.relatedIds.length ? ' · +' + e.relatedIds.length + tr(" related") : '');
  }
  function findingRow(id, n) {
    var f = findingById[id]; if (!f) return '';
    var r = f.review || {};
    var badges = (r.since === 'new' ? ("<span class=\"badge-new\">" + tr("new") + "</span>") : '') +
      (r.status === 'accepted' ? '<span class="badge-accepted">' + (f.severity === 'error' ? tr("accepted · still to fix") : tr('accepted')) + '</span>' : r.status === 'accepted-changed' ? ("<span class=\"badge-accepted\">" + tr("accepted · evidence changed") + "</span>") : '');
    return '<button type="button" class="bauify-item ' + toneOf(f.severity) + (r.status === 'accepted' ? (f.severity === 'error' ? ' accepted-error' : ' accepted') : '') + '" data-finding="' + esc(id) + '"' + (r.reason ? ' title="' + tr('Accepted: ') + esc(r.reason) + '"' : '') + '>' + (n ? '<span class="n">' + n + '</span>' : '') +
      '<b>' + esc(findingTitle(f)) + '</b> <em>' + esc(tr(f.severity)) + '</em>' + badges + '<span class="what">' + esc(findingWhat(f)) + '</span><span class="where">' + esc(findingWhere(f)) + '</span>' + '</button>';
  }
  var CATEGORIES = { coupling: tr("Dependencies"), complexity: tr("Complexity"), redundancy: tr("Duplicate code"), architecture: tr("Architecture"), conventions: tr("Coding conventions"), 'external-review': tr("AI review") };
  function externalSources() { return (data.overview && data.overview.coverage && data.overview.coverage.external) || []; }
  externalSources().forEach(function (source) { GROUPS[source.code] = source.tool + tr(" diagnostics"); });
  function sourceLabel(source) { var version = source.toolVersion || ''; if (version.toLowerCase().startsWith(source.tool.toLowerCase() + ' ')) version = version.slice(source.tool.length + 1); return source.tool + (version ? ' ' + version : '') + ' · ' + source.id; }
  function bindingLabel(binding) { return binding === 'verified' ? tr("File content hashes match") : binding === 'changed' ? tr("Source changed") : tr("Not verified"); }
  function findingListRow(f) {
    var external = f.external, review = f.review || {};
    return '<button type="button" class="finding-row ' + toneOf(f.severity) + '" data-finding="' + esc(f.id) + '"><span class="finding-row-meta"><span>' + esc(external ? external.tool : 'Archify') + '</span><code>' + esc(external ? external.ruleId || tr("review comment") : f.code) + '</code><span class="finding-level">' + esc(tr(f.severity)) + '</span></span><b>' + esc(findingTitle(f)) + '</b><span class="finding-row-path">' + esc(findingWhere(f)) + '</span>' +
      (review.status === 'accepted' ? ("<span class=\"finding-row-state\">" + tr("Accepted")) + (f.severity === 'error' ? tr(" · still present") : '') + '</span>' : review.status === 'accepted-changed' ? ("<span class=\"finding-row-state attention\">" + tr("Accepted evidence changed · review again") + "</span>") : external && external.binding !== 'verified' ? ("<span class=\"finding-row-state attention\">" + tr("Report binding: ")) + esc(bindingLabel(external.binding).toLowerCase()) + '</span>' : '') + '</button>';
  }
  function showFindings(source) {
    if (typeof source === 'string') { filters.source = source; filters.category = 'all'; filters.severity = 'all'; filters.status = 'open'; filters.unverified = false; filters.search = ''; filters.page = 0; listScroll = 0; }
    overviewMode = 'findings'; readerPage(tr("Findings")); root.removeAttribute('data-bauify-source');
    panel.hidden = detail.hidden = codePane.hidden = true; overview.hidden = false; setFocus([]);
    renderFindingList(); overview.scrollTop = listScroll;
  }
  function renderFindingList() {
    var sources = externalSources(), dimensions = [...new Set(data.findings.map(function (f) { return f.dimension; }))].sort();
    var option = function (value, label) { return '<option value="' + esc(value) + '">' + esc(label) + '</option>'; };
    overview.innerHTML = ("<button type=\"button\" class=\"back findings-back\">" + tr("← Overview") + "</button>" + "<div class=\"findings-heading\">" + "<h3>" + tr("Findings") + "</h3>") + (sources.length ? ("<button type=\"button\" class=\"text-action view-sources\">" + tr("Sources · ")) + sources.length + '</button>' : '') + '</div>' +
      ("<label class=\"sr-only\" for=\"finding-search\">" + tr("Search findings") + "</label>" + "<input id=\"finding-search\" class=\"finding-search\" type=\"search\" placeholder=\"" + tr("Search rule, message or file…") + "\" value=\"") + esc(filters.search) + '">' +
      '<div class="finding-filters' + (dimensions.length < 2 ? ' compact' : '') + ("\">" + "<select aria-label=\"" + tr("Finding source") + "\">") + option('all', tr("All sources")) + option('internal', 'Archify') + (sources.length ? option('external', tr("External tools")) + sources.map(function (s) { return option('source:' + s.id, sourceLabel(s)); }).join('') : '') + '</select>' +
      (dimensions.length > 1 ? ("<select aria-label=\"" + tr("Finding category") + "\">") + option('all', tr("All categories")) + dimensions.map(function (d) { return option(d, CATEGORIES[d] || d); }).join('') + '</select>' : '') +
      ("<select aria-label=\"" + tr("Finding severity") + "\">") + option('all', tr("All levels")) + option('error', tr("Error")) + option('warning', tr("Warning")) + option('info', tr("Info")) + '</select>' +
      ("<select aria-label=\"" + tr("Finding review status") + "\">") + option('open', tr("Open")) + option('accepted', tr("Accepted")) + option('changed', tr("Needs re-review")) + option('all', tr("All statuses")) + '</select></div>' +
      '<div class="finding-list-count"><span role="status" aria-live="polite"></span>' + (sources.length ? '<label><input type="checkbox" class="unverified-filter"' + (filters.unverified ? ' checked' : '') + (">" + " " + tr("Unverified reports only") + "</label>") : '') + '</div><div class="finding-list"></div><div class="finding-pagination"></div>';
    overview.querySelector('.findings-back').addEventListener('click', showOverview);
    var sourcesButton = overview.querySelector('.view-sources'); if (sourcesButton) sourcesButton.addEventListener('click', showSources);
    var controls = [[tr("Finding source"), 'source'], [tr("Finding category"), 'category'], [tr("Finding severity"), 'severity'], [tr("Finding review status"), 'status']];
    controls.forEach(function (pair) { var control = overview.querySelector('[aria-label="' + pair[0] + '"]'); if (!control) { filters[pair[1]] = 'all'; return; } control.value = filters[pair[1]]; if (!control.value) filters[pair[1]] = control.value = pair[1] === 'status' ? 'open' : 'all'; control.addEventListener('change', function () { filters[pair[1]] = control.value; filters.page = 0; renderFindingRows(); }); });
    overview.querySelector('#finding-search').addEventListener('input', function (event) { filters.search = event.target.value; filters.page = 0; renderFindingRows(); });
    var checkbox = overview.querySelector('.unverified-filter'); if (checkbox) checkbox.addEventListener('change', function () { filters.unverified = checkbox.checked; filters.page = 0; renderFindingRows(); });
    renderFindingRows();
  }
  function renderFindingRows() {
    var query = filters.search.trim().toLowerCase();
    var matches = ((data.overview && data.overview.findings) || data.findings).map(function (entry) { return findingById[entry.id]; }).filter(function (f) {
      var accepted = f.review && f.review.status === 'accepted', changed = f.review && f.review.status === 'accepted-changed';
      return (filters.source === 'all' || filters.source === 'internal' && !f.external || filters.source === 'external' && f.external || f.external && filters.source === 'source:' + f.external.sourceId) &&
        (filters.category === 'all' || filters.category === f.dimension) && (filters.severity === 'all' || filters.severity === f.severity) &&
        (filters.status === 'all' || filters.status === 'open' && !accepted || filters.status === 'accepted' && accepted || filters.status === 'changed' && changed) &&
        (!filters.unverified || f.external && f.external.binding !== 'verified') &&
        (!query || [f.code, f.message, findingTitle(f), findingWhat(f), findingWhere(f), f.external && f.external.ruleId, f.external && f.external.tool].join(' ').toLowerCase().includes(query));
    });
    filters.page = Math.max(0, Math.min(filters.page, Math.ceil(matches.length / 40) - 1));
    var start = filters.page * 40, end = Math.min(start + 40, matches.length);
    overview.querySelector('.finding-list-count > span').textContent = plural(matches.length, 'finding') + (matches.length > 40 ? ' · ' + (start + 1) + '–' + end : '');
    var selectedSources = externalSources().filter(function (source) { return filters.source === 'external' || filters.source === 'source:' + source.id; });
    var emptyReports = !query && selectedSources.length && selectedSources.every(function (source) { return !data.findings.some(function (f) { return f.external && f.external.sourceId === source.id; }); });
    overview.querySelector('.finding-list').innerHTML = matches.length ? matches.slice(start, end).map(findingListRow).join('') : '<div class="finding-empty"><b>' + (emptyReports ? tr("No diagnostics in this report") : data.findings.length ? tr("No matching findings") : tr("No diagnostics in this analysis")) + '</b><p>' + (emptyReports || !data.findings.length ? tr("See Sources and Coverage for what was checked.") : tr("Change a filter or search term to see more.")) + ("</p>" + "<button type=\"button\" class=\"text-action reset-filters\">" + tr("Reset filters") + "</button>" + "</div>");
    overview.querySelectorAll('[data-finding]').forEach(function (button) { button.addEventListener('click', function () { listScroll = overview.scrollTop; showFinding(button.getAttribute('data-finding'), 'findings'); }); });
    var reset = overview.querySelector('.reset-filters'); if (reset) reset.addEventListener('click', function () { filters.source = filters.category = filters.severity = 'all'; filters.status = 'all'; filters.search = ''; filters.unverified = false; filters.page = 0; renderFindingList(); });
    var pagination = overview.querySelector('.finding-pagination');
    pagination.innerHTML = matches.length > 40 ? '<button type="button" data-page="-1"' + (!filters.page ? ' disabled' : '') + (">" + tr("Previous") + "</button>" + "<span>" + tr("Page ")) + (filters.page + 1) + tr(" of ") + Math.ceil(matches.length / 40) + '</span><button type="button" data-page="1"' + (end === matches.length ? ' disabled' : '') + (">" + tr("Next") + "</button>") : '';
    pagination.querySelectorAll('button').forEach(function (button) { button.addEventListener('click', function () { filters.page += Number(button.getAttribute('data-page')); renderFindingRows(); overview.scrollTop = 0; }); });
  }
  function showSources() {
    var parent = overviewMode; overviewMode = 'sources'; readerPage(tr("Sources")); root.removeAttribute('data-bauify-source');
    panel.hidden = detail.hidden = codePane.hidden = true; overview.hidden = false; setFocus([]);
    overview.innerHTML = '<button type="button" class="back sources-back">← ' + (parent === 'findings' ? tr("Findings") : tr("Overview")) + ("</button>" + "<h3>" + tr("Sources & coverage") + "</h3>" + "<p class=\"ev\">" + tr("Report import, source binding and scan scope are separate facts.") + "</p>") + externalSources().map(function (source) {
      var count = data.findings.filter(function (f) { return f.external && f.external.sourceId === source.id; }).length;
      var coverage = source.coverage || {}, complete = coverage.complete === true ? 'complete' : coverage.complete === false ? 'incomplete' : tr("not declared");
      return '<section class="external-source"><div class="findings-heading"><h4>' + esc(source.tool + ' · ' + source.id) + '</h4><span class="ev">' + esc(source.toolVersion || tr("Version not supplied")) + '</span></div><div class="ev">' + plural(count, 'diagnostic') + ' · ' + esc(source.format) + ("</div>" + "<dl class=\"external-facts\">" + "<div>" + "<dt>" + tr("Import") + "</dt>" + "<dd>") + (source.status === 'partial' ? tr("Partial · review import notices") : tr("Imported")) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Report binding") + "</dt>" + "<dd>") + esc(bindingLabel(source.binding)) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Declared scope") + "</dt>" + "<dd>") + (coverage.files && coverage.files.length ? plural(coverage.files.length, 'file') + ' · ' : '') + esc(complete) + '</dd></div></dl>' +
        (count === 0 ? ("<p class=\"ev\">" + tr("This report contains no diagnostics. Coverage is limited to its declared scope.") + "</p>") : '') +
        ("<details>" + "<summary>" + tr("Import details") + "</summary>" + "<dl class=\"external-facts\">" + "<div>" + "<dt>" + tr("Source ID") + "</dt>" + "<dd>") + esc(source.id) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Report") + "</dt>" + "<dd>") + esc(source.reportFile || tr("Not recorded")) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Suppressed") + "</dt>" + "<dd>") + (source.suppressed || 0) + '</dd></div></dl>' + (source.notices || []).map(function (n) { return '<p class="ev">' + esc(n.message) + '</p>'; }).join('') + '</details><button type="button" class="text-action source-findings" data-source="' + esc(source.id) + ("\">" + tr("View findings") + "</button>" + "</section>");
    }).join('') + ("<p class=\"ev\">" + tr("Run the source tool to update its report, then re-analyze. Importing a report does not rerun its rules.") + "</p>");
    overview.querySelector('.sources-back').addEventListener('click', function () { if (parent === 'findings') showFindings(); else showOverview(); });
    overview.querySelectorAll('.source-findings').forEach(function (button) { button.addEventListener('click', function () { showFindings('source:' + button.getAttribute('data-source')); }); });
    overview.scrollTop = 0;
  }
  function coverageHtml(c) {
    if (!c) return '';
    var lines = [];
    var files = c.files || {};
    lines.push((LANGS[c.language] || c.language || tr("Unknown language")) + (files.analyzed !== null && files.analyzed !== undefined ? ' · ' + plural(files.analyzed, 'file') + tr(" analyzed") : '') +
      (files.excludedByRole ? ' · ' + files.excludedByRole + ' ' + (files.excludedRoles || []).map(function (role) { return locale === 'zh-CN' ? tr(role) : role; }).join('/') + tr(" files left out") : ''));
    (c.otherLanguages || []).forEach(function (x) { lines.push(tr("Not analyzed: ") + plural(x.files, (LANGS[x.adapter] || x.adapter) + tr(" file")) + tr(" (one language per run)")); });
    var pe = files.parseErrors || [];
    if (pe.length) lines.push(plural(pe.length, 'file') + tr(" could not be parsed: ") + pe.slice(0, 3).join(', ') + (pe.length > 3 ? ' …' : ''));
    var u = c.unresolved || {}, unresolved = (u.unknown || 0) + (u.opaque || 0);
    // Java counts each unresolved type reference as well as imports.
    if (unresolved) lines.push(plural(unresolved, c.language === 'java' ? 'dependency record' : 'import') + tr(" could not be resolved"));
    if (!standalone && (c.unmappedModules || []).length) lines.push(plural(c.unmappedModules.length, 'module') + tr(" not on this diagram"));
    if ((c.ambiguousModules || []).length) lines.push(plural(c.ambiguousModules.length, 'module') + tr(" mapped to several components; related imports remain at module level"));
    var run = (c.rules && c.rules.run) || [], off = (c.rules && c.rules.suppressed) || [];
    lines.push(tr("Checked: ") + (run.length ? run.map(function (r) { return (GROUPS[r] || r).toLowerCase(); }).join(', ') : 'nothing') + (off.length ? tr(" · switched off: ") + off.join(', ') : ''));
    var dup = duplicateCoverageLine(c);
    if (dup) lines.push(dup.text);
    var b = c.boundaries;
    if (b) {
      lines.push(tr("Boundaries: ") + plural(b.layers.length, 'layer') + ', ' + plural(b.rules, 'rule') + tr(" from the analysis config"));
      b.layers.filter(function (l) { return !l.files; }).forEach(function (l) { lines.push(tr("Layer \"") + l.name + tr("\" matches no analyzed file; check its globs")); });
    }
    var missing = [['complexity/', 'complexity'], ['redundancy/', 'duplication'], ['architecture/', tr("architecture boundaries (none configured)")]].filter(function (d) { return !run.some(function (r) { return r.indexOf(d[0]) === 0; }); }).map(function (d) { return d[1]; });
    if (missing.length) lines.push(tr("Not checked: ") + missing.join(', '));
    var incomplete = (c.otherLanguages || []).length || pe.length || unresolved || off.length || (c.ambiguousModules || []).length || (dup && !dup.complete);
    return ("<details class=\"coverage\">" + "<summary>" + tr("Coverage · ")) + esc(LANGS[c.language] || c.language || tr("Unknown")) + ' · ' + (files.analyzed == null ? tr("file count unavailable") : plural(files.analyzed, 'file')) + (incomplete ? tr(" · incomplete") : '') + '</summary><div class="ev cov">' + lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div></details>';
  }
  // Duplicate detection reports its own file coverage: files it skipped (vendored,
  // below the token/line limits, unsupported) are not checked even with zero findings.
  function duplicateCoverageLine(c) {
    var run = (c && c.rules && c.rules.run) || [];
    if (run.indexOf('redundancy/duplicate-block') === -1) return null;
    var d = c.duplicates;
    if (!d) return { complete: false, text: tr("Duplicate code: file coverage unavailable · incomplete") };
    return { complete: d.complete === true, text: tr("Duplicate code: ") + d.analyzed + '/' + plural(d.selected, 'file') + tr(" analyzed") + (d.complete === true ? '' : tr(" · incomplete")) };
  }
  // Since the previous run, and against the baseline. Fixed findings are no longer
  // in this result, so they are listed from the comparison itself.
  function reviewHtml(r) {
    if (!r) return '';
    var h = '';
    var c = r.comparison;
    if (c) {
      var gone = c.notDetected || c.fixed || [];
      var comparable = c.comparable === true;
      var title = comparable ? gone.length || c.new.length ? tr('{gone} no longer detected · {added} new', { gone: gone.length, added: c.new.length }) : tr('No detected changes') : tr('Not directly comparable');
      h += '<section class="comparison-banner ' + (comparable && !c.new.length && gone.length ? 'positive' : '') + '" role="status" aria-live="polite"><span>' + esc(tr(data.pullRequest ? 'Compared with PR merge-base' : 'Compared with previous analysis')) + '</span><b>' + esc(title) + '</b>';
      if (c.evidenceChanged.length) h += '<span>' + esc(tr('{changed} with changed evidence', { changed: c.evidenceChanged.length })) + '</span>';
      h += '<p>' + esc(comparable ? tr('No longer detected does not prove a fix; verify source changes and project tests.') : c.comparable === false ? tr('Configuration, grouping, model or coverage changed. Missing findings do not establish a fix.') : tr('Comparison context is unavailable. Missing findings do not establish a fix.')) + '</p>';
      if(data.pullRequest) h += '<p>' + esc(tr('This compares rule reports. Changed evidence is not a finding of increased risk; PR-attributed effects are below.')) + '</p>';
      if (!comparable && (c.reasons || []).length) h += '<details><summary>' + esc(tr('Comparison details')) + '</summary><p class="ev">' + esc(c.reasons.map(function (r) { return typeof r === 'string' ? tr(r) : tr(r && (r.message || r.code) || ''); }).join(' ')) + '</p></details>';
      h += '</section>';
      if (gone.length) h += ("<details>" + "<summary>" + tr("No longer detected · ")) + gone.length + '</summary><div class="ev">' + gone.map(function (f) { return '<div>' + esc(GROUPS[f.code] || f.code) + ': ' + esc(f.message) + (f.likelyCause ? ' · ' + esc(f.likelyCause) : '') + '</div>'; }).join('') + '</div></details>';
    }
    var b = r.baseline;
    if (b) {
      h += ("<div class=\"ev review-line\">" + tr("Baseline: ")) + b.accepted + " " + tr("accepted") + (b.changed.length ? ' · ' + b.changed.length + tr(" changed since accepted and shown again") : '') + (b.stale.length ? ' · ' + plural(b.stale.length, 'entry') .replace('entrys', 'entries') + tr(" no longer found") : '') + '</div>';
      if (b.stale.length) h += ("<details>" + "<summary>" + tr("Baseline entries no longer found · ")) + b.stale.length + '</summary><div class="ev">' + b.stale.map(function (e) { return '<div>' + esc(e.id) + ' (' + esc(e.code) + ') · ' + esc(e.reason) + '</div>'; }).join('') + ("<div>" + tr("Fixed or moved; remove them from the baseline file.") + "</div>" + "</div>" + "</details>");
    }
    return h;
  }
  function prReviewPriorities() {
    var impact = data.pullRequest.impact;
    var sections = [
      { key: 'architecture', title: 'Architecture assessment', scope: 'Changed dependencies and existing users reached from the changed code.' },
      { key: 'complexity', title: 'Complexity assessment', scope: 'Before/after function measurements and changed source; text changes alone do not prove behavior changes.' }
    ];
    var h = '<div class="pr-review">';
    sections.forEach(function(section) {
      var list = impact ? impact.records.filter(function(r) { return r.category===section.key; }) : [];
      var count = impact ? impact.categories[section.key].total : 0;
      var summary = !impact ? tr('Change-attributed impact is unavailable in this saved report') : count ? tr('{count} PR-related changes', { count: count }) : tr('No impact established within the captured scope');
      h += '<section class="pr-assessment" data-assessment="' + section.key + '" aria-label="' + esc(tr(section.title)) + '"><header><h5>' + esc(tr(section.title)) + '</h5><span class="pr-origin">' + esc(tr('Automatic detection')) + '</span></header><p class="pr-assessment-summary">' + esc(summary) + '</p><p class="pr-assessment-scope">' + esc(tr(section.scope)) + '</p>';
      list.slice(0,3).forEach(function(record) { h += prImpactCard(record,impact.records.indexOf(record)); });
      if(list.length>3) {
        h += '<details class="pr-impact-more"><summary>' + esc(tr('More PR-related changes · {count}',{count:list.length-3})) + '</summary>';
        list.slice(3).forEach(function(record) { h += prImpactCard(record,impact.records.indexOf(record)); });h += '</details>';
      }
      h += '</section>';
    });
    if(impact) {
      h += '<p class="pr-assessment-scope pr-impact-coverage">' + esc(tr('Read {count} changed files; reused saved facts and direct references.',{count:impact.coverage.work.parsedFiles})) + ' ' + esc(tr('Known static references are not runtime or complete transitive impact.')) + '</p>';
      if(impact.status==='partial') h += '<p class="pr-assessment-scope">' + esc(tr('Some changed regions were outside the language, parsing or reading budget; unobserved impact remains unknown.')) + '</p>';
      if(impact.comparison.comparable!==true) h += '<p class="pr-assessment-scope">' + esc(tr('Analysis contexts differ; observed measurement or binding differences are not fully attributable to source changes.')) + '</p>';
    }
    return h + '</div>';
  }
  function prImpactCard(record,index) {
    var labels={'dependency-added':'Dependency added','dependency-removed':'Dependency removed','dependency-changed':'Dependency form changed','structural-measures':'Existing structural measurements changed','module-coupling':'Existing module coupling changed','module-added':'Module added','module-removed':'Module removed','known-users':'Existing users of changed code','known-importers':'Existing importers of changed source','file-source':'File source changed · behavior to review','function-metrics':'Function measurements changed','definition-text':'Function source changed · behavior to review','definition-added':'Definition added','definition-removed':'Definition removed','structural-finding-added':'New structural finding observed in this PR'};
    var finding=record.findingId&&findingById[record.findingId];
    var subject=record.kind==='structural-finding-added'&&finding?findingTitle(finding):record.module||record.kind==='structural-measures'&&record.path||record.name&&record.name+'()'||record.path||record.from+' → '+record.to;
    var h='<article class="priority-card pr-impact-record" data-impact-record="'+index+'"><h6>'+esc(tr(labels[record.kind]||record.kind))+'</h6><p class="pr-impact-subject">'+esc(subject)+'</p>';
    if(record.kind==='structural-measures') {
      var fields={'reach.dependents':'Transitively dependent modules','reach.direct':'Directly dependent modules','reach.dependencies':'Outgoing dependency modules','reach.modules':'Other modules in scope','reach.share':'Dependency reach share','size.lines':'Module source lines','size.total':'Total source lines','size.share':'Source size share',lines:'Source lines',fileLines:'File lines',loc:'Source lines'};
      h+='<p class="pr-impact-measures">'+record.changes.slice(0,3).map(function(change){return esc(tr(fields[change.field]||change.field))+' '+esc(change.before==null?'?':change.before)+' → '+esc(change.after==null?'?':change.after);}).join(' · ')+'</p>';
    }
    if(record.kind==='function-metrics') h+='<p class="pr-impact-measures">'+esc(tr('Complexity {before} → {after}',{before:record.before.complexity,after:record.after.complexity}))+' · '+esc(tr('Nesting {before} → {after}',{before:record.before.nesting,after:record.after.nesting}))+' · '+esc(tr('Lines {before} → {after}',{before:record.before.length,after:record.after.length}))+'</p>';
    if(record.kind==='module-coupling') h+='<p class="pr-impact-measures">'+esc(tr('Fan-in {before} → {after}',{before:record.before.fanIn,after:record.after.fanIn}))+' · '+esc(tr('Fan-out {before} → {after}',{before:record.before.fanOut,after:record.after.fanOut}))+'</p>';
    if(record.kind==='known-users') h+='<p class="pr-impact-measures">'+esc(record.callers.coverage==='available'?tr('{count} known static callsites',{count:record.callers.total}):tr('Callsite coverage unavailable'))+' · '+esc(tr('{count} file import sites',{count:record.importers}))+(record.unchangedCallers?' · '+esc(tr('{count} callsites in unchanged files',{count:record.unchangedCallers})):'')+'</p>';
    if(record.kind==='known-importers') h+='<p class="pr-impact-measures">'+esc(tr('{count} file import sites',{count:record.importers}))+'</p>';
    if(record.kind!=='known-users'&&record.callers&&record.callers.coverage!=='available') h+='<p class="pr-assessment-scope">'+esc(tr('Callsite coverage unavailable'))+'</p>';
    var primary=record.locations.findIndex(function(loc){return loc.side==='head';});if(primary<0)primary=0;
    var at=record.locations[primary];
    if(at)h+='<button type="button" class="text-action pr-impact-path" data-impact-location="'+index+':'+primary+'">'+esc(at.file+':'+at.line)+' · '+esc(tr(at.side==='base'?'Merge-base':'PR head'))+'</button>';
    h+='<details class="pr-impact-evidence"><summary>'+esc(tr('Change evidence and affected references'))+'</summary>';
    if(record.kind==='dependency-changed') h+='<pre class="pr-impact-forms">'+esc(JSON.stringify({base:record.before.forms,head:record.after.forms},null,2))+'</pre>';
    if(record.kind==='structural-measures') h+='<p class="pr-assessment-scope">'+esc(tr('These are existing rule measurements from both snapshots; the cause of an individual edge is not established.'))+'</p>';
    record.locations.forEach(function(loc,i){h+='<button type="button" class="text-action" data-impact-location="'+index+':'+i+'">'+esc(tr(loc.side==='base'?'Merge-base':'PR head'))+' · '+esc(loc.file+':'+loc.line)+(loc.relation?' · '+esc(tr(loc.relation==='bound-call'?'Bound source call':'File import')):'')+(loc.unchanged?' · '+esc(tr('unchanged file')):'')+'</button>';});
    (record.contexts||[]).forEach(function(context){h+='<p class="pr-assessment-scope">'+esc(tr('Related existing constraint'))+' · <button type="button" class="text-action" data-finding="'+esc(context.id)+'">'+esc(GROUPS[context.code]||context.code)+'</button></p>';});
    h+='</details>';
    if(finding)h+=quickHandoff(finding,true)+taskHtml(finding);
    return h+'</article>';
  }
  function renderOverview() {
    var o = data.overview;
    if (!o) { overview.innerHTML = '<h3>' + esc(tr('Architecture check')) + '</h3>' + legend(); return; }
    var errors = o.counts.error + (o.counts.acceptedErrors || 0);
    var live = typeof window.__archifyReanalyze === 'function';
    var h = '<div class="workbench-header"><h3>' + (errors ? '<i class="bauify-red"></i>' : '') + esc(tr('Architecture check')) + '</h3>' +
      (live ? '<button type="button" class="bauify-reanalyze" title="' + esc(tr('Read the repository again and compare with this result')) + '">' + esc(tr('Re-analyze')) + '</button>' : '<span class="snapshot-label">' + esc(tr('Offline snapshot')) + '</span>') + '</div>';
    h += '<ol class="workbench-steps" aria-label="' + esc(tr('Read the diagram and source evidence, copy a task to your coding AI, then re-analyze after edits.')) + '">' +
      [tr("Read the signals"), tr("Copy a task for AI"), tr("Re-analyze after edits")].map(function (label, i) { return '<li><b>' + (i + 1) + '</b><span>' + esc(tr(label)) + '</span></li>'; }).join('') + '</ol>';
    if (data.pullRequest) {
      var pr = data.pullRequest;
      h += '<p class="pr-context"><b>' + esc(pr.simulation ? tr('PR analysis · local simulation') : tr('PR #{number}', { number: pr.number })) + '</b> · ' + esc(pr.title) + '</p><p class="ev">' + esc(pr.scope) + ' · <code>' + esc(pr.baseSHA.slice(0,8)) + ' → ' + esc(pr.headSHA.slice(0,8)) + '</code></p><p class="ev">' + esc(tr('The atlas shows PR head. Existing findings are not automatically caused by this PR.')) + '</p>';
    }
    h += reviewHtml(o.review);
    var rules = o.coverage && o.coverage.rules && o.coverage.rules.run || [];
    var fileCycles = data.findings.filter(function (f) { return f.code === 'coupling/import-cycle'; }).length;
    var moduleCycles = data.findings.filter(function (f) { return f.code === 'coupling/cycle'; }).length;
    var boundaryViolations = data.findings.filter(function (f) { return f.code === 'architecture/boundary'; }).length;
    if (data.pullRequest) h += '<details class="pr-head-checks"><summary>' + esc(tr('PR head checks · {errors} error-level findings', { errors: errors })) + '</summary>';
    h += '<section class="health-summary" aria-label="' + esc(tr('Structural signals')) + '"><p class="health-signal ' + (errors ? 'attention' : 'positive') + '">' + esc(!rules.length ? tr('No checks ran; no all-clear is available') : errors ? tr('{count} error-level diagnostics still present', { count: errors }) : tr('No error-level diagnostics in this scope')) + '</p>';
    if (o.counts.acceptedErrors) h += '<p class="scope-line">' + esc(tr('{open} open · {accepted} accepted error-level findings', { open: o.counts.error, accepted: o.counts.acceptedErrors })) + '</p>';
    h += '<p class="health-signal">' + esc(rules.indexOf('coupling/import-cycle') !== -1 ? fileCycles ? tr('File import cycles: {count}', { count: fileCycles }) : tr('No file import cycles detected') : tr('Cycle checks did not run')) + '</p>';
    if (moduleCycles) h += '<p class="health-signal">' + esc(tr('Module dependency loops: {count}', { count: moduleCycles })) + '</p>';
    h += '<p class="scope-line">' + esc(o.coverage.boundaries && o.coverage.boundaries.rules > 0 ? rules.indexOf('architecture/boundary') === -1 ? tr('Configured layer checks did not run') : boundaryViolations ? tr('Configured layer violations: {count}', { count: boundaryViolations }) : tr('No configured layer violations detected') : tr('Layer rules not configured')) + '</p><p class="scope-line">' + esc((LANGS[o.coverage.language] || o.coverage.language || tr('Unknown language')) + ' · ' + (o.coverage.files.analyzed == null ? tr('file count unavailable') : plural(o.coverage.files.analyzed, 'file')) + ' · ' + plural(data.totals.modules, 'module')) + '</p></section>';
    if (data.pullRequest) h += '</details>';
    h += '<p class="brief-status ev" role="status" aria-live="polite"></p>';
    h += '<details class="architecture-brief-preview" hidden><summary>' + esc(tr('Copy manually')) + '</summary><textarea readonly spellcheck="false" aria-label="' + esc(tr('Architecture brief')) + '"></textarea></details>';
    var offline = '';
    if (!live) {
      offline += '<details class="offline-recheck"><summary>' + esc(tr('Recheck after edits')) + '</summary><p class="ev">' + esc(tr('Offline report: captured tasks can be copied now. Current source has not been rechecked.')) + '</p>';
      if (data.ui && data.ui.resume && data.ui.resume.command) offline += '<p class="ev">' + esc(tr(standalone ? 'Run this command on the generating machine and open the printed URL to compare with this report. Later edits use Re-analyze. The command never runs automatically.' : 'Run this command on the generating machine, open the printed URL and choose Code Analysis to compare with this report. Later edits use Re-analyze. The command never runs automatically.')) + '</p><textarea readonly class="start-command" aria-label="' + esc(tr('Recheck after edits')) + '">' + esc(data.ui.resume.command) + '</textarea><button type="button" class="start-copy">' + esc(tr('Copy start command')) + '</button><p class="start-status ev" role="status" aria-live="polite"></p>';
      else offline += '<p class="ev">' + esc(tr('This report has no saved start command. Ask your AI to prepare a fresh analysis from the original repository and architecture JSON.')) + '</p>';
      offline += '</details>';
    }
    h += '<div class="section-heading' + (data.pullRequest ? ' pr-review-heading' : '') + '"><h4>' + esc(tr(data.pullRequest ? 'PR review priorities' : o.priorities.length ? 'Look at first' : 'Architecture brief')) + '</h4><button type="button" class="brief-copy">' + esc(tr(data.pullRequest?'Copy PR impact brief':'Copy architecture brief')) + '</button></div>';
    if (data.pullRequest) h += prReviewPriorities();
    else if (o.priorities.length) {
      o.priorities.forEach(function (id, i) { var f = findingById[id]; if (f) h += '<article class="priority-card">' + findingRow(id, i + 1) + quickHandoff(f, true) + taskHtml(f) + '</article>'; });
    } else h += '<p class="ev">' + esc(tr(data.pullRequest && o.review.comparison.comparable === true ? 'No new or changed open findings against the PR merge-base. Existing head findings remain in the full list.' : 'No open findings within the checks that ran. Accepted findings and coverage remain below.')) + '</p>';
    h += offline;
    var architecture = o.investigation && o.investigation.architecture;
    if (!data.pullRequest && architecture && architecture.structuralSignals.length) {
      h += '<details class="structural-signals"><summary>' + esc(tr('Additional structural signals')) + ' · ' + architecture.structuralSignals.length + '</summary>';
      architecture.structuralSignals.forEach(function (signal) { h += findingRow(signal.id); });
      h += '</details>';
    }
    var sources = externalSources();
    if (sources.length) {
      var externalCount = data.findings.filter(function (f) { return f.external; }).length;
      h += '<div class="external-entry"><button type="button" class="external-findings"><b>' + esc(tr('External diagnostics')) + ' · ' + externalCount + '</b><span>' + plural(sources.length, 'source') + '</span></button><button type="button" class="text-action overview-sources">' + esc(tr('Sources & coverage')) + '</button></div>';
    }
    h += '<div class="overview-secondary">' + (data.pullRequest?'<p class="ev">'+esc(tr('Whole-head background, including existing findings'))+'</p>':'') + '<button type="button" class="browse-findings">' + esc(tr('Browse findings')) + '</button><p class="ev counts">' + esc(tr('{warnings} warnings · {info} reference signals · {accepted} accepted', { warnings: o.counts.warning, info: o.counts.info, accepted: o.counts.accepted || 0 })) + '</p>';
    if (o.groups.length) {
      h += '<details class="all-finding-groups"><summary>' + esc(tr('All findings')) + ' · ' + o.counts.findings + '</summary>';
      o.groups.forEach(function (g) { h += '<details><summary><i class="bauify-' + toneOf(g.severity) + '"></i>' + esc(GROUPS[g.code] || g.code) + ' · ' + g.count + '</summary>' + g.ids.map(function (id) { return findingRow(id); }).join('') + '</details>'; });
      h += '</details>';
    }
    var unchecked = [['redundancy/', tr("duplicate code")], ['conventions/', tr("project coding conventions")]].filter(function (x) { return !rules.some(function (r) { return r.indexOf(x[0]) === 0; }); }).map(function (x) { return tr(x[1]); });
    if (unchecked.length) h += '<div class="coverage-notice">' + esc(tr('Not checked: ') + unchecked.join(', ') + tr('. See Coverage for the full scope.')) + '</div>';
    var dupLine = duplicateCoverageLine(o.coverage);
    if (dupLine && !dupLine.complete) h += '<div class="coverage-notice">' + esc(dupLine.text + tr('. Files it did not analyze were not checked for duplicates. See Coverage for the full scope.')) + '</div>';
    h += coverageHtml(o.coverage) + '<p class="ev scope-note">' + esc(tr('These are static checks of the analyzed scope, not a runtime or overall quality guarantee.')) + '</p>';
    if (!standalone) h += '<details><summary>' + esc(tr('Colour key')) + '</summary>' + legend() + '</details>';
    h += '</div>';
    overview.innerHTML = h;
    overview.querySelectorAll('[data-impact-location]').forEach(function(button){button.addEventListener('click',function(){var indices=button.getAttribute('data-impact-location').split(':').map(Number),loc=data.pullRequest.impact.records[indices[0]].locations[indices[1]];showCode(loc.file,loc.line,tr('Captured PR source; inspect changes against the merge-base.'),'info',false,null,null,null,loc.side);});});
    overview.querySelector('.browse-findings').addEventListener('click', function () { showFindings('all'); });
    var externalButton = overview.querySelector('.external-findings'); if (externalButton) externalButton.addEventListener('click', function () { showFindings('external'); });
    var sourceButton = overview.querySelector('.overview-sources'); if (sourceButton) sourceButton.addEventListener('click', showSources);
    var brief = overview.querySelector('.architecture-brief-preview');
    overview.querySelector('.brief-copy').addEventListener('click', function () {
      var content=data.architectureBrief||'',message='Copied architecture brief. Ask your coding AI to verify the cited source before editing.';
      if(data.pullRequest){
        var p=data.pullRequest,i=p.impact,ids=i?i.categories.architecture.priorities.concat(i.categories.complexity.priorities):[];
        content=JSON.stringify({repository:p.repository,scope:p.scope,base:p.baseSHA,head:p.headSHA,impact:i?{basis:i.basis,total:i.total,comparison:i.comparison,records:i.records.filter(function(r){return ids.indexOf(r.id)!==-1;}),coverage:i.coverage}:null},null,2);
        message='Copied PR impact evidence. Verify the cited source and coverage before review.';
      }
      copyText(content,overview.querySelector('.brief-status'),brief.querySelector('textarea'),tr(message),brief);
    });
    var startCopy = overview.querySelector('.start-copy');
    if (startCopy) startCopy.addEventListener('click', function () { copyText(data.ui.resume.command, overview.querySelector('.start-status'), overview.querySelector('.start-command'), tr('Copied start command.')); });
    var again = overview.querySelector('.bauify-reanalyze');
    if (again) again.addEventListener('click', function () {
      again.disabled = true; again.textContent = tr('Analyzing…'); again.setAttribute('aria-busy', 'true');
      var note = overview.querySelector('.brief-status'); note.classList.remove('reanalyze-error'); note.textContent = tr('Reading the repository — imports, modules, rules.');
      window.__archifyReanalyze().catch(function (error) { again.disabled = false; again.textContent = tr('Re-analyze'); again.removeAttribute('aria-busy'); note.classList.add('reanalyze-error'); note.textContent = tr('Re-analysis failed: ') + error.message + tr(' The result shown is from the last successful run.'); });
    });
    overview.querySelectorAll('[data-finding]').forEach(function (el) { el.addEventListener('click', function () { showFinding(el.getAttribute('data-finding')); }); });
    wireTasks(overview);
  }
  async function copyText(text, status, preview, success, box) {
    preview.value = text;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error(tr("Clipboard unavailable"));
      await navigator.clipboard.writeText(text); status.textContent = success;
    } catch (error) {
      if (box) { box.hidden = false; box.open = true; }
      preview.focus(); preview.select(); status.textContent = tr('Automatic copy unavailable. Select the text below to copy it manually.');
    }
  }
  // One finding opened from the overview. It may span several components or none,
  // so the diagram helpers get a stand-in component holding everything it touches.
  function findingScope(f) {
    var comps = (f.componentIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
    var mods = comps.flatMap(function (c) { return c.modules; });
    (f.moduleIds || []).forEach(function (id) { if (moduleInfo[id] && !mods.some(function (m) { return m.id === id; })) mods.push(moduleInfo[id]); });
    var files = comps.flatMap(function (c) { return c.fileList || []; });
    (f.moduleIds || []).forEach(function (id) { ((moduleInfo[id] || {}).fileList || []).forEach(function (file) { if (!files.some(function (v) { return v.path === file.path; })) files.push(file); }); });
    return { label: comps.map(function (c) { return c.label; }).join(', ') || (standalone ? sourceModuleLabel(f) : tr("not on this diagram")), modules: mods, fileList: files, incoming: [], outgoing: [], findings: [f] };
  }
  // Columns are one-based UTF-16 positions, with an exclusive end. Escape
  // each piece separately so captured source can never become page markup.
  function duplicateText(text, line, match) {
    if (line < match.line || line > match.endLine || !Number.isInteger(match.column) || match.column < 1 || !Number.isInteger(match.endColumn) || match.endColumn < 1) return esc(text);
    var start = line === match.line ? Math.min(text.length, match.column - 1) : 0;
    var end = line === match.endLine ? Math.min(text.length, match.endColumn - 1) : text.length;
    if (end <= start) return esc(text);
    return esc(text.slice(0, start)) + '<mark class="duplicate-match">' + esc(text.slice(start, end)) + '</mark>' + esc(text.slice(end));
  }
  function duplicateEvidence(f) {
    var h = ("<section class=\"duplicate-evidence\" aria-label=\"" + tr("Duplicate code locations") + "\">" + "<p class=\"duplicate-legend\">" + "<mark class=\"duplicate-match\">" + tr("Matched code") + "</mark>" + tr(" is highlighted and underlined. Other text is context.") + "</p>");
    (f.subject.locations || []).slice(0, 2).forEach(function (loc) {
      var match = { line: loc.line, endLine: loc.endLine, column: loc.column, endColumn: loc.endColumn };
      var snip = (data.snippets || {})[loc.file];
      h += '<div class="inline-evidence duplicate-location">' + ref(loc.file, loc.line, '', tr("Read both matched ranges and their callers before changing code."), toneOf(f.severity), loc.line, loc.endLine, match);
      if (!snip) { h += ("<div class=\"ev\">" + tr("Source unavailable in this report. Open the file in your editor or re-analyze.") + "</div>" + "</div>"); return; }
      if (!Number.isInteger(loc.column) || !Number.isInteger(loc.endColumn)) h += ("<div class=\"ev\">" + tr("Exact highlight unavailable: this result has no column coordinates.") + "</div>");
      var start = Math.max(0, loc.line - 1), end = Math.min(snip.lines.length, loc.endLine);
      h += ("<pre aria-label=\"" + tr("Matched code in ") + "") + esc(loc.file) + '">';
      for (var i = start; i < end; i++) {
        if (end - start > 24 && i === start + 8) { h += '<span class="duplicate-omitted">… ' + (end - start - 16) + (tr(" matching lines omitted. Open the file above for the complete range.") + "</span>"); i = end - 9; continue; }
        h += '<span class="evidence-line"><span class="line-number">' + (i + 1) + '  </span>' + duplicateText(snip.lines[i], i + 1, match) + '</span>';
      }
      h += '</pre></div>';
    });
    return h + '</section>';
  }
  function evidencePreview(f) {
    if (f.external) return externalEvidence(f);
    if (f.code === 'redundancy/duplicate-block') return duplicateEvidence(f);
    var captured = (data.tasks || {})[f.id];
    var locations = captured ? captured.task.locations.filter(function (l) { return l.startLine; }).slice(0, 2) : [];
    if (!locations.length && f.subject && f.subject.file && f.subject.line) locations = [{ file: f.subject.file, startLine: f.subject.line, endLine: f.subject.endLine }];
    if (!locations.length) locations = (f.evidence && f.evidence.imports || []).slice(0, 2).map(function (v) { return { file: v.file, startLine: v.line, endLine: v.line }; });
    return locations.map(function (loc) {
      var snip = (data.snippets || {})[loc.file], focus = f.code === 'complexity/function' ? f.evidence.deepestLine || loc.startLine : loc.startLine;
      var h = '<div class="inline-evidence">' + ref(loc.file, focus, '', tr("Captured source evidence. Read the complete context before editing."), toneOf(f.severity), loc.startLine, loc.endLine);
      if (!snip) return h + ("<div class=\"ev\">" + tr("Source unavailable in this report. Open the file in your editor or re-analyze.") + "</div>" + "</div>");
      var start = Math.max(0, focus - 5), end = Math.min(snip.lines.length, start + 9);
      h += ("<pre aria-label=\"" + tr("Code excerpt from ") + "") + esc(loc.file) + '">';
      snip.lines.slice(start, end).forEach(function (text, i) { var n = start + i + 1; h += '<span class="evidence-line' + (n === focus ? ' focus-line' : '') + '"><span class="line-number">' + n + '  </span>' + esc(text) + '</span>'; });
      h += ("</pre>" + "<div class=\"ev\">" + tr("Captured lines ")) + (start + 1) + '–' + end + tr(" of ") + snip.lines.length + (tr(" · excerpt only; click the path to expand.") + "</div>" + "</div>");
      return h;
    }).join('');
  }
  function taskHtml(f) {
    return '<details class="ai-task" data-task-id="' + esc(f.id) + ("\">" + "<summary>" + tr("Task preview and download") + "</summary>" + "<p class=\"ev\">" + tr("Review the brief, then give it to your coding AI. Exporting does not modify code.") + "</p>" + "<p class=\"task-status ev\" role=\"status\" aria-live=\"polite\">" + tr("Open to prepare the task.") + "</p>" + "<div class=\"task-actions\">" + "<button type=\"button\" class=\"task-copy\" disabled>" + tr("Copy AI task") + "</button>" + "<button type=\"button\" class=\"task-download\" disabled>" + tr("Download .md") + "</button>" + "<button type=\"button\" class=\"task-refresh\">" + tr("Check again") + "</button>" + "</div>" + "<label class=\"ev\">" + tr("Task preview · select text to copy manually") + "<textarea class=\"task-preview\" readonly spellcheck=\"false\" aria-label=\"" + tr("AI task preview") + "\">" + "</textarea>" + "</label>" + "</details>");
  }
  function externalEvidence(f) {
    var locations = f.external.locations || [];
    return (locations.length && locations.every(function (loc) { return loc.role === 'related'; }) ? ("<p class=\"ev\">" + tr("The primary source location is unavailable. Related locations below are context.") + "</p>") : '') + (locations.map(function (loc, index) {
      var snip = (data.snippets || {})[loc.file];
      var match = { kind: 'external', line: loc.line, endLine: loc.endLine || loc.line, column: loc.column, endColumn: loc.endColumn };
      var position = loc.file + (loc.line ? ':' + loc.line + (loc.column ? ':' + loc.column : '') : tr(" · position not verified"));
      var h = '<div class="inline-evidence external-evidence">' + (loc.line ? ref(loc.file, loc.line, '', tr("Location reported by ") + f.external.tool + tr(". Read the current code before editing."), toneOf(f.severity), loc.line, loc.endLine || loc.line, match) : fileLink(loc.file)) + '<div class="ev external-position">' + esc(position) + '</div>';
      if (!snip) h += ("<p class=\"ev\">" + tr("Source is unavailable in this report. Read this file in your editor.") + "</p>");
      else {
        var start = loc.line ? Math.max(0, loc.line - 3) : 0, end = Math.min(snip.lines.length, start + 5);
        h += ("<pre aria-label=\"" + tr("Code excerpt from ") + "") + esc(loc.file) + '">';
        snip.lines.slice(start, end).forEach(function (text, i) { var n = start + i + 1; h += '<span class="evidence-line' + (n === loc.line ? ' focus-line' : '') + '"><span class="line-number">' + n + '  </span>' + duplicateText(text, n, match) + '</span>'; });
        h += '</pre><p class="ev">' + (!loc.line ? tr("Opening lines only; this report has no verified location in the current source.") : tr("Captured excerpt · open the path for full context.")) + '</p>';
      }
      h += '</div>';
      var related = loc.role ? loc.role === 'related' : index > 0;
      return related ? ("<details class=\"external-related\">" + "<summary>" + tr("Related location · ")) + esc(position) + '</summary>' + h + '</details>' : h;
    }).join('') || ("<p class=\"ev\">" + tr("No source location was supplied. Review the original claim before editing.") + "</p>"));
  }
  function externalProvenance(f) {
    var e = f.external;
    var link = function (url, label) { try { var parsed = new URL(url); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return '<a href="' + esc(parsed.href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'; } catch (error) { /* An invalid source URL is data, not a link. */ } return ''; };
    return ("<details class=\"external-provenance\">" + "<summary>" + tr("Source, rule and import details") + "</summary>" + "<dl class=\"external-facts\">" + "<div>" + "<dt>" + tr("Source") + "</dt>" + "<dd>") + esc(e.sourceId) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Original rule") + "</dt>" + "<dd>") + esc(e.ruleId || tr("Not supplied")) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Original level") + "</dt>" + "<dd>") + esc(e.originalSeverity == null ? tr("Not supplied · defaulted to warning") : e.originalSeverity) + ("</dd>" + "</div>" + "<div>" + "<dt>" + tr("Report item") + "</dt>" + "<dd>") + esc(e.reportPointer) + '</dd></div></dl><p>' + link(e.helpUri, tr("Rule documentation")) + ("</p>" + "<p class=\"ev\">" + tr("This claim comes from the external source. Archify imported its result and has not rerun the rule.") + "</p>" + "</details>");
  }
  function reviewHtmlForFinding(f) {
    var accepted = f.review && f.review.status === 'accepted', changed = f.review && f.review.status === 'accepted-changed';
    var available = typeof window.__archifySaveReview === 'function' && f.reviewTarget;
    return ("<section class=\"finding-review\" aria-label=\"" + tr("Review decision") + "\">") + (f.review && f.review.reason ? '<p class="review-reason"><b>' + (changed ? tr("Accepted evidence changed · review again") : tr("Accepted in baseline")) + '</b><span>' + esc(f.review.reason) + '</span>' + (f.severity === 'error' ? ("<span>" + tr("This diagnostic is still present at error severity.") + "</span>") : '') + '</p>' : '') +
      '<div class="review-primary-actions">' + (f.external ? ("<button type=\"button\" class=\"preview-external-task\">" + tr("Preview AI task") + "</button>") : '') + '<button type="button" class="review-action"' + (!available || !accepted && f.external && f.external.binding === 'changed' ? ' disabled' : '') + '>' + (accepted ? tr("Revoke acceptance") : changed ? tr("Accept updated finding…") : tr("Accept…")) + '</button>' + (changed ? '<button type="button" class="review-revoke"' + (typeof window.__archifySaveReview !== 'function' ? ' disabled' : '') + (">" + tr("Revoke acceptance") + "</button>") : '') + '</div>' +
      (!available ? ("<p class=\"ev\">" + tr("Open with the local analysis service to save baseline decisions.") + "</p>") : '') +
      ("<form class=\"review-form\" hidden>" + "<label>" + tr("Reason for accepting ") + "<span>" + tr("(required)") + "</span>" + "<textarea name=\"reason\" required rows=\"3\" placeholder=\"" + tr("Why is this acceptable in this project?") + "\">") + esc(changed && f.review.reason || '') + ("</textarea>" + "</label>" + "<p class=\"ev\">" + tr("Records a baseline decision. The original diagnostic and severity stay visible.") + "</p>" + "<div class=\"review-actions\">" + "<button type=\"submit\" class=\"review-confirm\" disabled>" + tr("Confirm acceptance") + "</button>" + "<button type=\"button\" class=\"review-cancel\">" + tr("Cancel") + "</button>" + "</div>" + "</form>" + "<p class=\"review-status ev\" role=\"status\" aria-live=\"polite\">" + "</p>" + "</section>");
  }
  function wireReview(f, parent) {
    var box = detail.querySelector('.finding-review'); if (!box) return;
    var action = box.querySelector('.review-action'), form = box.querySelector('form'), reason = box.querySelector('textarea'), confirm = box.querySelector('.review-confirm'), cancel = box.querySelector('.review-cancel'), status = box.querySelector('.review-status');
    var accepted = f.review && f.review.status === 'accepted';
    var revoke = box.querySelector('.review-revoke'), actionInitiallyDisabled = action.disabled;
    var previewTask = box.querySelector('.preview-external-task'); if (previewTask) previewTask.addEventListener('click', function () { var task = detail.querySelector('.ai-task'); task.open = true; task.scrollIntoView({ block: 'nearest' }); });
    var update = function () { confirm.disabled = !reason.value.trim(); };
    reason.addEventListener('input', update);
    var save = async function (kind) {
      action.disabled = confirm.disabled = cancel.disabled = reason.readOnly = true; form.setAttribute('aria-busy', 'true'); status.textContent = tr("Saving review decision…");
      if (revoke) revoke.disabled = true;
      try {
        var response = await window.__archifySaveReview({ action: kind, id: f.id, reason: reason.value, expected: f.reviewTarget });
        if (!response.saved) throw new Error(tr("The service did not confirm a saved decision."));
        try { sessionStorage.setItem(filterKey, JSON.stringify(filters)); if (response.artifactsSaved === false) sessionStorage.setItem(filterKey + ':notice', tr("The baseline was saved. The downloadable report could not be updated; check the output directory before exporting.")); } catch (error) { /* Navigation still works without storage. */ }
        location.replace(location.pathname + '?analysis=open&finding=' + encodeURIComponent(f.id) + '&from=' + parent);
      } catch (error) { status.textContent = tr("Could not confirm the review decision: ") + error.message + tr(" Your reason is kept. Refresh the analysis if its evidence changed, then retry."); cancel.disabled = reason.readOnly = false; action.disabled = actionInitiallyDisabled; if (revoke) revoke.disabled = false; form.removeAttribute('aria-busy'); update(); }
    };
    action.addEventListener('click', function () { if (accepted) { save('revoke'); return; } form.hidden = false; action.hidden = true; detail.classList.add('reviewing'); update(); reason.focus({ preventScroll: true }); detail.scrollTop = 0; });
    if (revoke) revoke.addEventListener('click', function () { save('revoke'); });
    cancel.addEventListener('click', function () { form.hidden = true; action.hidden = false; detail.classList.remove('reviewing'); status.textContent = ''; action.focus(); });
    form.addEventListener('submit', function (event) { event.preventDefault(); if (reason.value.trim()) save('accept'); });
    try { var notice = sessionStorage.getItem(filterKey + ':notice'); if (notice) { status.textContent = notice; sessionStorage.removeItem(filterKey + ':notice'); } } catch (error) { /* No storage. */ }
  }
  function quickHandoff(f, compact) {
    return '<div class="quick-handoff" data-handoff-id="' + esc(f.id) + ("\">" + "<div class=\"task-actions\">" + "<button type=\"button\" class=\"quick-copy\">" + tr("Copy task for AI") + "</button>" + "</div>" + "<p class=\"ev handoff-status\" role=\"status\" aria-live=\"polite\">") + (compact ? '' : tr('Includes evidence, suggestions and allowed files. Paste it into your coding AI.')) + '</p></div>';
  }
  function wireTasks(container) {
    container = container || detail;
    container.querySelectorAll('.ai-task').forEach(function (box) {
      var id = box.getAttribute('data-task-id'), payload = null, busy = false;
      var status = box.querySelector('.task-status'), preview = box.querySelector('.task-preview');
      var copy = box.querySelector('.task-copy'), download = box.querySelector('.task-download'), refresh = box.querySelector('.task-refresh');
      var quick = container.querySelector('[data-handoff-id="' + id + '"]');
      var quickCopy = quick && quick.querySelector('.quick-copy');
      var say = function (text) { status.textContent = text; if (quick) quick.querySelector('.handoff-status').textContent = text; };
      var describe = function (p) {
        var e = p.task.evidence;
        var labels = { valid: tr("Evidence matches the current working tree."), captured: tr("Snapshot only; current source has not been checked. Ask your coding AI to verify it before editing."), changed: tr("Evidence changed. Re-analyze and review the current code before editing."), missing: tr("A cited file is missing. Re-analyze before editing."), unverifiable: tr("Evidence could not be verified. Read the cited files before editing.") };
        return (labels[e.status] || tr("Evidence status unknown.")) + (e.reason ? ' ' + tr(e.reason) : '') + (e.checkedAt ? tr(" Checked ") + e.checkedAt + '.' : '');
      };
      var prepare = async function () {
        if (busy) return null;
        busy = true; copy.disabled = download.disabled = refresh.disabled = true;
        if (quickCopy) quickCopy.disabled = true;
        say(tr("Preparing task and checking available evidence…"));
        try {
          var note = '';
          if (typeof window.__archifyBuildTask === 'function') {
            try { payload = await window.__archifyBuildTask(id, findingById[id].reviewTarget); }
            catch (error) {
              if (error.status) throw error;
              payload = (data.tasks || {})[id];
              note = tr("Local service unavailable. ");
            }
          } else { payload = (data.tasks || {})[id]; note = tr("Offline report. "); }
          if (!payload) throw new Error(tr("Task source is unavailable. Re-analyze with the local service to create this task."));
          if (data.repository.snapshotId && payload.task.source.snapshotId && data.repository.snapshotId !== payload.task.source.snapshotId) throw new Error(tr("The service has a newer analysis snapshot than this page. Re-analyze to refresh the displayed evidence."));
          preview.value = payload.markdown;
          say(note + describe(payload));
          return payload;
        } catch (error) {
          payload = null; preview.value = '';
          say(tr("Could not prepare task: ") + error.message + tr(" Re-analyze if this page shows an older result, then retry."));
          return null;
        } finally { busy = false; copy.disabled = download.disabled = !payload; refresh.disabled = false; if (quickCopy) quickCopy.disabled = false; }
      };
      box.addEventListener('toggle', function () { if (box.open && !payload && !busy) prepare(); });
      refresh.addEventListener('click', prepare);
      var copyTask = async function () {
        var p = await prepare(); if (!p || !box.isConnected) return;
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error(tr("Clipboard unavailable"));
          await navigator.clipboard.writeText(p.markdown);
          say(tr("Copied AI task. Paste it into your coding AI. ") + describe(p));
        } catch (error) { box.open = true; preview.focus(); preview.select(); say(tr("Automatic copy unavailable. The task text is selected; press Ctrl+C or copy it manually. ") + describe(p)); }
      };
      copy.addEventListener('click', copyTask);
      if (quickCopy) quickCopy.addEventListener('click', copyTask);
      download.addEventListener('click', async function () {
        var p = await prepare(); if (!p || !box.isConnected) return;
        var url = URL.createObjectURL(new Blob([p.markdown], { type: 'text/markdown;charset=utf-8' }));
        var link = document.createElement('a'); link.href = url; link.download = p.task.taskId + '.md'; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        say(tr("Download requested. ") + describe(p));
      });
    });
  }
  function showFinding(id, parent) {
    var f = findingById[id]; if (!f) return;
    parent = parent || (!overview.hidden && overviewMode === 'findings' ? 'findings' : 'summary');
    readerPage(tr("Finding")); detail.classList.remove('reviewing');
    root.removeAttribute('data-bauify-source');
    overview.hidden = true; panel.hidden = true;
    var e = entryById[id];
    var tone = toneOf(f.severity), lvl = LEVELS[tone];
    var scope = findingScope(f);
    setFocus(f.componentIds || []);
    if (standalone && window.__archifyAtlas) window.__archifyAtlas.focusFinding(id);
    var h = ("<button class=\"close\" aria-label=\"" + tr("Close") + "\">" + "×" + "</button>" + "<button class=\"back\" type=\"button\">" + "← ") + (parent === 'findings' ? tr("Findings") : tr("Overview")) + '</button>';
    if (f.external) {
      h += '<div class="external-origin"><span>' + esc(f.external.tool) + '</span><code>' + esc(f.external.ruleId || tr("review comment")) + '</code><span class="finding-level ' + tone + '">' + esc(tr(f.severity)) + '</span></div><h3>' + esc(findingTitle(f)) + '</h3>';
      if (f.message !== findingTitle(f)) h += '<div class="external-message">' + esc(f.message) + '</div>';
      h += ("<dl class=\"external-facts evidence-state\">" + "<div>" + "<dt>" + tr("Source snapshot") + "</dt>" + "<dd>" + tr("Captured at analysis time") + "</dd>" + "</div>" + "<div>" + "<dt>" + tr("Report binding") + "</dt>" + "<dd>") + esc(bindingLabel(f.external.binding)) + '</dd></div></dl>';
      if (f.external.binding !== 'verified') h += '<p class="external-notice">' + (f.external.binding === 'changed' ? tr("The report describes an older source version. Regenerate the source report before accepting this finding.") : tr("The report is not bound to a verified source version. Check the claim against current code; this limitation is included in the task.")) + '</p>';
      h += evidencePreview(f) + reviewHtmlForFinding(f) + taskHtml(f) + externalProvenance(f);
      if (!standalone && !(f.componentIds || []).length) h += ("<p class=\"ev\">" + tr("Not mapped to this diagram. The source location and task remain available.") + "</p>");
    } else {
    if (f.code !== 'redundancy/duplicate-block') h += '<div class="k">' + esc(GROUPS[f.code] || f.code) + ' · ' + esc(scope.label) + '</div>';
    h += '<h3><i class="bauify-' + tone + '"></i>' + esc(findingTitle(f)) + '</h3>';
    var explanation = f.code === 'coupling/hub' ? tr("High incoming and outgoing coupling; inspect responsibilities before deciding to split.")
      : f.code === 'coupling/concentration' ? tr("Much of the project depends on, or lives in, this one place. These are static counts with their thresholds, not proof that it must be split.")
      : f.code === 'architecture/boundary' ? tr("These imports break a boundary declared in the analysis config. The rule comes from the config, not from the diagram.")
      : f.code === 'coupling/internal-leak' ? (f.evidence && f.evidence.entrySource === 'config' ? tr("These imports bypass the entry files declared in the analysis config.") : tr("Other modules depend on this module's internal files, so moving or renaming any of them breaks importers. Deep imports can be a deliberate convention; this is a signal, not a defect."))
      : f.code === 'complexity/function' ? tr("Cyclomatic complexity counts independent paths through the function. A high count is a maintenance signal, not a defect.") : lvl.text;
    h += '<div class="level"><b>' + esc(tr(lvl.name)) + '</b> — ' + esc(findingWhat(f)) + (f.code === 'redundancy/duplicate-block' ? '' : '<br>' + esc(explanation)) + '</div>';
    h += (f.code === 'redundancy/duplicate-block' ? '' : quickHandoff(f)) + ("<div class=\"k evidence-label\">" + tr("Code evidence") + "</div>") + evidencePreview(f) + reviewHtmlForFinding(f);
    if (f.code === 'redundancy/duplicate-block') h += quickHandoff(f);
    h += nextStepHtml(f) + taskHtml(f);
    if ((f.componentIds || []).length) h += ("<button type=\"button\" class=\"locate\">" + tr("Locate related components") + "</button>");
    else if (!standalone) h += ("<p class=\"ev\">" + tr("Not mapped to this diagram. Use the code evidence above.") + "</p>");
    var pic = f.code === 'coupling/import-cycle' || f.code === 'coupling/cycle' ? cycleDiagram(scope, [f]) : f.code === 'coupling/hub' ? hubDiagram(scope, [f]) : f.code === 'architecture/boundary' ? boundaryDiagram([f]) : f.code === 'complexity/function' ? complexityDiagram([f]) : '';
    if (pic) h += ("<details class=\"relationship\">" + "<summary>" + tr("Relationships and metrics") + "</summary>") + pic + '</details>';
    h += ("<details class=\"more-evidence\">" + "<summary>" + tr("All evidence and rule details") + "</summary>") + findingCard(f, true) + '</details>';
    if (e && e.relatedIds.length) h += ("<div class=\"k\">" + tr("Same structure, also reported as") + "</div>") + e.relatedIds.map(function (r) { return findingRow(r); }).join('');
    }
    detail.innerHTML = h;
    detail.hidden = false;
    codePane.hidden = true;
    detail.scrollTop = 0;
    detail.querySelector('.close').addEventListener('click', showOverview);
    detail.querySelector('.back').addEventListener('click', function () { if (parent === 'findings') showFindings(); else showOverview(); });
    var locate = detail.querySelector('.locate');
    if (locate) locate.addEventListener('click', function () { locateComponents(f.componentIds, true); });
    detail.querySelectorAll('[data-finding]').forEach(function (el) { el.addEventListener('click', function () { showFinding(el.getAttribute('data-finding')); }); });
    wireRefs();
    wireTasks();
    wireReview(f, parent);
    var heading = detail.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
  }
  window.__archifyAnalysisFindingTitle = function (id) { return findingById[id] ? findingTitle(findingById[id]) : id; };
  // Source links: GitHub-style blob/tree URLs from the origin + revision the facts were taken at.
  function repoBase() {
    var r = data.repository || {}; if (r.sourceKind === 'working-tree' || !r.url || !r.revision) return null;
    var u = String(r.url).replace(/^git@([^:]+):/, 'https://$1/').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1').replace(/\.git$/, '');
    if (!/^https?:\/\//.test(u)) return null;
    var root = r.root && r.root !== '.' ? r.root.replace(/\/$/, '') + '/' : '';
    return { blob: u + '/blob/' + r.revision + '/' + root, tree: u + '/tree/' + r.revision + '/' + root };
  }
  function fileLink(path, line) {
    return '<button type="button" class="source-file" data-file="' + esc(path) + '" data-line="' + (line || '') + '">' + esc(path) + (line ? ':' + line : '') + '</button>';
  }
  document.body.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('.source-file');
    if (!link || (!panel.contains(link) && !detail.contains(link))) return;
    event.preventDefault();
    showCode(link.getAttribute('data-file'), Number(link.getAttribute('data-line')) || null, '', '');
  });
  function sourceLinks(c, file) {
    var lines = [];
    function add(record) {
      if (record && record.file === file && Number.isInteger(record.line) && record.line > 0) lines.push(record.line);
    }
    allFindings(c).forEach(function (finding) {
      add(finding.subject);
      var ev = finding.evidence || {};
      (ev.imports || []).forEach(add);
      (ev.pathImports || []).forEach(add);
      var pr = ev.partialInitCandidate || ev.proof;
      if (pr) {
        add({file:pr.entry,line:pr.viaLine}); add({file:pr.entry,line:pr.boundAt});
        add({file:pr.importer,line:pr.line});
      }
    });
    // Hub findings describe module coupling; their supporting import lines
    // live on graph edges rather than on the module-level finding itself.
    if (!lines.length) (c.incoming || []).concat(c.outgoing || []).forEach(function (edge) { (edge.evidence || []).forEach(add); });
    lines = Array.from(new Set(lines)).sort(function (a, b) { return a - b; });
    return lines.length ? lines.map(function (line) { return fileLink(file, line); }).join('<br>') : fileLink(file);
  }
  function hubSources(c, f) {
    var m = c.modules.filter(function (x) { return f ? x.id === f.subject.module : true; })[0]; if (!m) return '';
    var files = (c.fileList || []).filter(function (x) { return x.module === m.id; });
    var b = repoBase();
    var h = ("<div class=\"k\">" + tr("Hub module source") + "</div>" + "<div class=\"ev\">") + esc(m.path || tr("(repository root)")) +
      ' · ' + m.files + tr(" files · ") + m.loc + (tr(" LOC") + "</div>");
    if (files.length) {
      h += '<table>' + files.slice(0, 40).map(function (x) { return '<tr><td class="p">' + sourceLinks(c, x.path) + '</td><td class="n">' + x.loc + (tr(" LOC") + "</td>" + "<td class=\"n\">" + tr("out ")) + x.importsOut + ("</td>" + "<td class=\"n\">" + tr("in ")) + x.importedBy + '</td></tr>'; }).join('') + '</table>';
      if (files.length > 40) h += '<div class="ev">… ' + (files.length - 40) + (tr(" more") + "</div>");
    }
    return h;
  }
  // --- small diagrams drawn by Bauify to explain one indicator -------------
  function short(p) { var parts = String(p).split('/'); return parts.length > 2 ? parts.slice(-2).join('/') : p; }
  function nodeRect(x, y, w, hgt, label, cls) {
    return '<rect class="node' + (cls ? ' ' + cls : '') + '" x="' + (x - w / 2) + '" y="' + (y - hgt / 2) + '" width="' + w + '" height="' + hgt + '" rx="6"/>' +
      '<text x="' + x + '" y="' + (y + 3.5) + '" text-anchor="middle">' + esc(label.length > 22 ? label.slice(0, 21) + '…' : label) + '</text>';
  }
  // Straight arrow between two box centres, clipped to the box edges.
  function arrow(a, b, w, hgt, cls, label) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var ka = Math.min(Math.abs((w / 2) / (ux || 1e-6)), Math.abs((hgt / 2) / (uy || 1e-6))) + 2;
    var x1 = a.x + ux * ka, y1 = a.y + uy * ka, x2 = b.x - ux * (ka + 2), y2 = b.y - uy * (ka + 2);
    var out = '<path class="e e ' + cls + '" marker-end="url(#bauify-arrow)" d="M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2 + '"/>';
    if (label) out += '<text class="muted" x="' + ((x1 + x2) / 2 + uy * 7) + '" y="' + ((y1 + y2) / 2 - ux * 7 + 3) + '" text-anchor="middle">' + esc(label) + '</text>';
    return out;
  }
  function svgOpen(w, hgt) {
    return '<svg class="diagram" viewBox="0 0 ' + w + ' ' + hgt + '" role="img"><defs><marker id="bauify-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#94a3b8"/></marker></defs>';
  }
  function diagram(c, key, fl) {
    if (key === 'cycle') return cycleDiagram(c, fl);
    if (key === 'hub') return hubDiagram(c, fl);
    if (key === 'boundary') return boundaryDiagram(fl);
    if (key === 'complexity') return complexityDiagram(fl);
    return instabilityDiagram(c);
  }
  // One row per function: complexity and nesting as bars against their warning thresholds.
  function complexityDiagram(fl) {
    var rows = fl.filter(function (f) { return f.code === 'complexity/function'; }).slice(0, 8);
    if (!rows.length) return ("<div class=\"ev\">" + tr("No measured function reaches a threshold here.") + "</div>");
    // Per row: the function name, then one labelled bar for complexity and one for nesting.
    var W = 400, rowH = 58, H = rows.length * rowH + 8, x0 = 112, span = 270;
    var svg = svgOpen(W, H);
    rows.forEach(function (f, i) {
      var y = 6 + i * rowH, t = f.evidence.threshold || {};
      var cMax = Math.max(f.evidence.complexity, t.complexity || 1) * 1.15, nMax = Math.max(f.evidence.nesting, t.nesting || 1) * 1.15;
      var name = f.subject.function.length > 56 ? f.subject.function.slice(0, 55) + '…' : f.subject.function;
      svg += '<text x="8" y="' + (y + 11) + '">' + esc(name) + '()</text>';
      svg += '<text class="muted" x="8" y="' + (y + 29) + ("\">" + tr("complexity ")) + f.evidence.complexity + '</text>';
      svg += '<rect class="bar" x="' + x0 + '" y="' + (y + 20) + '" width="' + (span * f.evidence.complexity / cMax) + '" height="11"/>';
      svg += '<text class="muted" x="8" y="' + (y + 47) + ("\">" + tr("nesting ")) + f.evidence.nesting + '</text>';
      svg += '<rect class="bar" x="' + x0 + '" y="' + (y + 38) + '" width="' + Math.max(2, span * f.evidence.nesting / nMax) + '" height="11" opacity=".6"/>';
      if (t.complexity) svg += '<path class="e amber" d="M' + (x0 + span * t.complexity / cMax) + ',' + (y + 17) + ' L' + (x0 + span * t.complexity / cMax) + ',' + (y + 34) + '"/>';
      if (t.nesting) svg += '<path class="e amber" d="M' + (x0 + span * t.nesting / nMax) + ',' + (y + 35) + ' L' + (x0 + span * t.nesting / nMax) + ',' + (y + 52) + '"/>';
    });
    svg += '</svg>';
    return svg + ("<div class=\"caption\">" + tr("Upper bar: cyclomatic complexity; lower bar: nesting depth. Amber ticks mark the thresholds of the level this finding reached; reaching either one is enough. Thresholds are configurable; function length is context only.") + "</div>");
  }
  // One row per crossed boundary: the layer that imports, a crossed-out arrow, the layer it must not reach.
  function boundaryDiagram(fl) {
    var rows = fl.filter(function (f) { return f.subject && f.subject.boundary; });
    if (!rows.length) return ("<div class=\"ev\">" + tr("No configured boundary is crossed here.") + "</div>");
    var W = 400, rowH = 44, H = rows.length * rowH + 16, bw = 120, bh = 24;
    var svg = svgOpen(W, H);
    rows.forEach(function (f, i) {
      var y = 8 + i * rowH + rowH / 2, a = { x: 80, y: y }, b = { x: W - 80, y: y };
      var tone = f.severity === 'error' ? 'red' : 'amber';
      svg += arrow(a, b, bw, bh, tone);
      var mx = W / 2, my = y;
      svg += '<text class="muted" x="' + mx + '" y="' + (my - 12) + '" text-anchor="middle">' + esc(plural(f.evidence.totalImports, 'import')) + '</text>';
      svg += '<path class="e ' + tone + '" d="M' + (mx - 7) + ',' + (my - 7) + ' L' + (mx + 7) + ',' + (my + 7) + ' M' + (mx + 7) + ',' + (my - 7) + ' L' + (mx - 7) + ',' + (my + 7) + '"/>';
      svg += nodeRect(a.x, a.y, bw, bh, f.subject.boundary.from, 'focus') + nodeRect(b.x, b.y, bw, bh, f.subject.boundary.to);
    });
    svg += '</svg>';
    return svg + ("<div class=\"caption\">" + tr("Layers and rules come from the analysis config. Each arrow is a dependency the rule forbids; the cited imports are listed below. Imports between files in no declared layer are not checked.") + "</div>");
  }
  // Ring of the files (or modules) on the shortest cycle; lazy edges dashed.
  function cycleDiagram(c, fl) {
    var f = fl.filter(function (x) { return x.code === 'coupling/import-cycle'; })[0] || fl.filter(function (x) { return x.code === 'coupling/cycle'; })[0];
    if (!f) return ("<div class=\"ev\">" + tr("No cycle was found in the recorded dependencies for this component. Unresolved or unmodeled execution may add dependencies.") + "</div>");
    var isFile = f.code === 'coupling/import-cycle';
    var nodes = (f.evidence.path || []).slice(0, 8);
    if (nodes.length === 0) return ("<div class=\"ev\">" + tr("Cycle path not recorded.") + "</div>");
    var W = 400, H = 240, cx = W / 2, cy = H / 2, rx = 140, ry = 80, bw = 118, bh = 24;
    var pos = {}; nodes.forEach(function (n, i) { var t = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length; pos[n] = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }; });
    if (nodes.length === 1) pos[nodes[0]] = { x: cx, y: cy };
    var mine = {}; (c.fileList || []).forEach(function (x) { mine[x.path] = true; }); (c.modules || []).forEach(function (m) { mine[m.id] = true; });
    var color = f.severity === 'error' ? 'red' : f.severity === 'warning' ? 'amber' : 'blue';
    var edges = [];
    var imports = f.evidence.imports || [];
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i], b = nodes[(i + 1) % nodes.length];
      if (isFile) {
        var hit = (f.evidence.pathImports || imports).filter(function (v) { return v.file === a && v.to === b; })[0];
        edges.push({ a: a, b: b, lazy: !!(hit && (hit.deferred || hit.lazy || hit.conditional)) });
      } else {
        var me = (f.evidence.edges || []).filter(function (v) { return v.from === a && v.to === b; })[0];
        edges.push({ a: a, b: b, lazy: !!(me && (me.deferred || (me.lazy && me.lazy === me.weight))) });
      }
    }
    var svg = svgOpen(W, H);
    edges.forEach(function (e) {
      if (e.a === e.b) {
        var p = pos[e.a];
        svg += '<path class="e ' + color + (e.lazy ? ' lazy' : '') + '" d="M ' + (p.x + bw / 2) + ' ' + p.y + ' C ' + (p.x + 110) + ' ' + (p.y - 65) + ', ' + (p.x - 110) + ' ' + (p.y - 65) + ', ' + (p.x - bw / 2) + ' ' + p.y + '" fill="none" stroke="currentColor"/>';
        svg += '<text x="' + (p.x - bw / 2 - 5) + '" y="' + (p.y + 4) + '" fill="currentColor">▶</text>';
      } else svg += arrow(pos[e.a], pos[e.b], bw, bh, color + (e.lazy ? ' lazy' : ''));
    });
    nodes.forEach(function (n) { svg += nodeRect(pos[n].x, pos[n].y, bw, bh, short(n), mine[n] ? 'focus' : ''); });
    svg += '</svg>';
    return svg + '<div class="caption">' + (isFile ? tr("Representative file cycle.") : tr("Representative package-level cycle.")) + (tr(" Runtime failure is not proven.") + "</div>" + "<details>" + "<summary>" + tr("How to read this diagram") + "</summary>" + "<div class=\"caption\">" + tr("Solid = recorded module-scope dependency; dashed = deferred, conditional, type-only or asynchronous dependency. Green box = belongs to this component. Line numbers are in the findings below. ")) +
      (f.evidence.kind === 'structural' ? tr("Structural Java source dependencies. Class initialization order and runtime failure were not assessed.") : f.evidence.kind !== 'eager' ? tr("This dependency component contains deferred, conditional, or type-only edges. The drawing does not prove import-time safety.") : tr("Module-scope dependency cycle. Inspect execution order and binding access; a graph alone does not prove failure.")) + '</div></details>';
  }
  // Star: dependents on the left, dependencies on the right.
  function hubDiagram(c, fl) {
    var f = fl[0];
    var left, right, centre;
    if (f) { left = f.evidence.dependents || []; right = f.evidence.dependencies || []; centre = f.subject.module; }
    else {
      centre = c.modules.map(function (m) { return m.label; }).join(' · ') || c.label;
      left = c.incoming.map(function (e) { return e.component ? (byId[e.component] ? byId[e.component].label : e.component) : e.module; });
      right = c.outgoing.map(function (e) { return e.component ? (byId[e.component] ? byId[e.component].label : e.component) : e.module; });
    }
    var n = Math.max(left.length, right.length, 1), rowH = 26, W = 400, H = Math.max(120, n * rowH + 30), bw = 110, bh = 22;
    var svg = svgOpen(W, H), mid = { x: W / 2, y: H / 2 };
    // All arrow segments stay in the open gutters, outside every node column.
    function gutterArrow(x1, y1, x2, y2) {
      var bend = (x1 + x2) / 2;
      return '<path class="e" marker-end="url(#bauify-arrow)" d="M' + x1 + ',' + y1 + ' C' + bend + ',' + y1 + ' ' + bend + ',' + y2 + ' ' + x2 + ',' + y2 + '"/>';
    }
    var boxes = '';
    left.slice(0, 12).forEach(function (m, i) { var p = { x: 70, y: 20 + i * rowH + bh / 2 }; svg += gutterArrow(p.x + bw / 2 + 2, p.y, mid.x - bw / 2 - 4, mid.y); boxes += nodeRect(p.x, p.y, bw, bh, short(m)); });
    right.slice(0, 12).forEach(function (m, i) { var p = { x: W - 70, y: 20 + i * rowH + bh / 2 }; svg += gutterArrow(mid.x + bw / 2 + 2, mid.y, p.x - bw / 2 - 4, p.y); boxes += nodeRect(p.x, p.y, bw, bh, short(m)); });
    svg += boxes;
    svg += nodeRect(mid.x, mid.y, bw, bh, centre, 'focus') + '</svg>';
    return svg + ("<div class=\"caption\">" + tr("Left: modules that depend on it (fan-in ")) + left.length + tr("). Right: modules it depends on (fan-out ") + right.length + ').' + (f ? tr(" Threshold ") + f.evidence.threshold.fanIn + ' / ' + f.evidence.threshold.fanOut + tr(" from config.") : tr(" Below the hub threshold.")) +
      ("</div>" + "<details>" + "<summary>" + tr("What does high coupling mean?") + "</summary>" + "<div class=\"caption\">" + tr("A hub is a module that is both widely depended on (fan-in) and depends widely (fan-out). Changes may affect dependents or require coordination with dependencies. This is a design signal, not a proven bug. Check whether its dependents cluster by responsibility before deciding to split.") + "</div>" + "</details>") + (f ? hubSources(c, f) : '');
  }
  // Two bars: imports coming in vs going out, and where I = out / (in + out) lands.
  function instabilityDiagram(c) {
    var ind = c.indicators.items.filter(function (i) { return i.key === 'instability'; })[0] || {};
    var fi = ind.fanIn || 0, fo = ind.fanOut || 0;
    var W = 400, H = 110, max = Math.max(fi, fo, 1), scale = 250 / max;
    var svg = svgOpen(W, H);
    svg += ("<text x=\"12\" y=\"30\">" + tr("in ")) + fi + '</text><rect class="bar" x="70" y="18" width="' + (fi * scale) + '" height="16"/>';
    svg += ("<text x=\"12\" y=\"62\">" + tr("out ")) + fo + '</text><rect class="bar" x="70" y="50" width="' + (fo * scale) + '" height="16"/>';
    var I = ind.instability === undefined || ind.instability === null ? null : ind.instability;
    svg += ("<text class=\"muted\" x=\"70\" y=\"92\">" + tr("0 stable") + "</text>" + "<text class=\"muted\" x=\"320\" y=\"92\" text-anchor=\"end\">" + tr("1 volatile") + "</text>" + "<path class=\"e e\" d=\"M70,86 L320,86\"/>");
    if (I !== null) svg += '<circle cx="' + (70 + I * 250) + '" cy="86" r="5" fill="#34D399"/><text x="' + (70 + I * 250) + '" y="76" text-anchor="middle">I = ' + I + '</text>';
    svg += '</svg>';
    return svg + ("<div class=\"caption\">" + tr("Fan-in / fan-out summed over the modules mapped to this component (each counts modules, not import statements). High fan-in says \"change carefully\"; high fan-out says \"changes elsewhere reach me\".") + "</div>");
  }
  function setOn(on) {
    reader.hidden = !on;
    if (!on) root.removeAttribute('data-bauify-reader-collapsed');
    positionReader();
    root.removeAttribute('data-bauify-source');
    root.setAttribute('data-bauify', on ? 'on' : 'off');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      data.components.forEach(function (c) { var g = svg.querySelector('g[data-node-id="' + c.id + '"]'); if (g) g.classList.toggle('bauify-mapped', c.modules.length > 0); });
      drawLayer();
      showOverview();
    } else { setFocus([]); if (layer) layer.remove(); layer = null; panel.hidden = true; detail.hidden = true; codePane.hidden = true; overview.hidden = true; if (svg) svg.querySelectorAll('.bauify-mapped').forEach(function (g) { g.classList.remove('bauify-mapped'); }); }
  }
  btn.addEventListener('click', function () { setOn(root.getAttribute('data-bauify') !== 'on'); });
  // The Atlas view hands a finding back here to show its source evidence.
  window.__archifyShowSource = function(file, line, snapshot) { setOn(true); showCode(file, line, tr('Captured PR source; inspect changes against the merge-base.'), 'info', false, null, null, null, snapshot); };
  window.__archifyShowFinding = function (id, parent) {
    if (!findingById[id]) return;
    if (root.getAttribute('data-bauify') !== 'on') setOn(true);
    showFinding(id, parent);
  };
  document.addEventListener('keydown', function (e) {
    if (standalone) return;
    if (e.key !== 'c' && e.key !== 'C') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(t.tagName || '') !== -1)) return;
    btn.click();
  });
  if (svg) svg.addEventListener('click', function (e) {
    if (root.getAttribute('data-bauify') !== 'on') return;
    var g = e.target.closest && e.target.closest('g[data-node-id]');
    if (!g) return;
    e.stopPropagation(); e.preventDefault();
    show(g.getAttribute('data-node-id'));
  }, true);
  if (standalone || data.ui && data.ui.openByDefault && typeof window.__archifyReanalyze !== 'function') setOn(true);
  window.addEventListener('resize', function () { positionReader(); if (root.getAttribute('data-bauify') === 'on') drawLayer(); });
})();
