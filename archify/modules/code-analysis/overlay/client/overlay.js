(function () {
  var data = JSON.parse(document.getElementById('bauify-analysis').textContent);
  var root = document.documentElement;
  var toolbar = document.querySelector('.toolbar');
  var svg = document.querySelector('svg');
  if (!toolbar || !svg) return;
  var byId = {}; data.components.forEach(function (c) { byId[c.id] = c; });

  var externalToggle = document.getElementById('analysis-view-toggle');
  var btn = externalToggle || document.createElement('button');
  if (!externalToggle) btn.id = 'btn-bauify'; btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Show or hide the code analysis layer (C)'; btn.textContent = 'Code Analysis';
  if (!externalToggle) toolbar.appendChild(btn);

  var reader = document.createElement('aside');
  reader.id = 'bauify-reader'; reader.hidden = true; reader.setAttribute('aria-label', 'Code analysis reader');
  reader.innerHTML = '<nav class="reader-nav" aria-label="Analysis navigation"><span class="reader-path">Analysis / Overview</span><span class="reader-actions">' +
    (document.getElementById('bauify-atlas-data') ? '<button type="button" class="reader-atlas" title="Whole-repository view of files, dependencies and functions">Atlas</button> ' : '') +
    '<button type="button" class="reader-toggle" aria-expanded="true">View diagram</button></span></nav>';
  document.body.appendChild(reader);
  var readerCollapsed = false;
  function setReaderCollapsed(collapsed) {
    var changed = readerCollapsed !== collapsed;
    readerCollapsed = collapsed;
    reader.classList.toggle('collapsed', collapsed);
    if (collapsed) root.setAttribute('data-bauify-reader-collapsed', 'true'); else root.removeAttribute('data-bauify-reader-collapsed');
    reader.querySelector('.reader-toggle').textContent = collapsed ? 'Show analysis' : 'View diagram';
    reader.querySelector('.reader-toggle').setAttribute('aria-expanded', String(!collapsed));
    if (changed) requestAnimationFrame(function () { if (window.Archify && Archify.view && Archify.view.centerAt && focused.length) locateComponents(focused); });
  }
  reader.querySelector('.reader-toggle').addEventListener('click', function () { setReaderCollapsed(!readerCollapsed); });
  var atlasButton = reader.querySelector('.reader-atlas');
  if (atlasButton) atlasButton.addEventListener('click', function () { if (window.__archifyAtlas) window.__archifyAtlas.open(); });
  function readerPage(name) {
    reader.hidden = false;
    reader.querySelector('.reader-path').textContent = 'Analysis / ' + name;
    setReaderCollapsed(false);
  }
  function positionReader() {
    var bar = toolbar.getBoundingClientRect();
    var header = document.querySelector('.header');
    root.style.setProperty('--bauify-reader-top', Math.max(76, Math.ceil(Math.max(bar.bottom, header ? header.getBoundingClientRect().bottom : 0) + 12)) + 'px');
  }

  var panel = document.createElement('section');
  panel.id = 'bauify-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Bauify code analysis');
  reader.appendChild(panel);

  var layer = null;
  // The left column's home: the project overview. A component panel replaces it; "Overview" brings it back.
  var overview = document.createElement('section');
  overview.id = 'bauify-overview'; overview.hidden = true; overview.setAttribute('aria-label', 'Code analysis overview');
  reader.appendChild(overview);
  var findingById = {}; (data.findings || []).forEach(function (f) { findingById[f.id] = f; });
  var entryById = {}; ((data.overview && data.overview.findings) || []).forEach(function (e) { entryById[e.id] = e; });
  var moduleInfo = {};
  data.components.forEach(function (c) { c.modules.forEach(function (m) { moduleInfo[m.id] = m; }); });
  (data.unmapped || []).forEach(function (m) { if (!moduleInfo[m.id]) moduleInfo[m.id] = { id: m.id, label: m.label, path: m.label, files: m.files, loc: m.loc, fanIn: m.fanIn, fanOut: m.fanOut, fileList: m.fileList || [] }; });
  var detail = document.createElement('section');
  detail.id = 'bauify-detail'; detail.hidden = true; detail.setAttribute('aria-label', 'Bauify finding details');
  reader.appendChild(detail);
  var codePane = document.createElement('section');
  codePane.id = 'bauify-code'; codePane.hidden = true; codePane.setAttribute('aria-label', 'Bauify source excerpt');
  reader.appendChild(codePane);
  // Danger levels behind the colours. Same wording everywhere: legend, badge, detail header.
  var LEVELS = {
    red: { name: 'critical', text: 'circular dependency: the parts cannot be understood, tested or changed on their own. A structural problem to fix, not a proven runtime failure' },
    amber: { name: 'warning', text: 'maintenance burden: cycle through deferred imports, hub or concentrated module, very large file, crossed architecture boundary, or very complex function' },
    blue: { name: 'info', text: 'a signal to read; no change is required' },
    green: { name: 'clean', text: 'no rule fired' },
    grey: { name: 'unmapped', text: 'no source code maps to this component' },
    neutral: { name: 'metric', text: 'a number, not a verdict' }
  };
  function legend() {
    return '<div id="bauify-legend">' + ['red', 'amber', 'blue', 'green', 'grey'].map(function (t) {
      return '<span title="' + LEVELS[t].text + '"><i class="bauify-' + t + '"></i><b>' + LEVELS[t].name + '</b>' + LEVELS[t].text + '</span>';
    }).join('') + '</div>';
  }
  function nodeBox(id) {
    var g = svg.querySelector('g[data-node-id="' + id + '"]');
    if (!g) return null;
    var b = g.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  }
  function drawLayer() {
    if (layer) layer.remove();
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.id = 'bauify-layer';
    data.components.forEach(function (c) {
      var b = nodeBox(c.id); if (!b) return;
      // Status ring: a rounded outline just outside the node box. Red pulses, amber glows softly, green/grey stay quiet.
      var pad = 10;
      var ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      ring.setAttribute('x', b.x - pad); ring.setAttribute('y', b.y - pad);
      ring.setAttribute('width', b.w + pad * 2); ring.setAttribute('height', b.h + pad * 2);
      ring.setAttribute('rx', 14); ring.setAttribute('ry', 14);
      ring.setAttribute('class', c.indicators.status + (focused.indexOf(c.id) !== -1 ? ' focus' : ''));
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = c.label + ': ' + c.indicators.items.map(function (i) { return i.label + ' — ' + i.value; }).join('; ');
      ring.appendChild(title);
      layer.appendChild(ring);
    });
    svg.appendChild(layer);
  }
  var focused = [];
  function setFocus(ids) {
    focused = ids || [];
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
    readerPage('Overview');
    root.removeAttribute('data-bauify-source');
    panel.hidden = true; detail.hidden = true; codePane.hidden = true; setFocus([]);
    overview.querySelectorAll('.bauify-item.active').forEach(function (x) { x.classList.remove('active'); });
    overview.hidden = false;
    var heading = overview.querySelector('h3'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function show(id) {
    readerPage('Component');
    root.removeAttribute('data-bauify-source');
    var c = byId[id]; if (!c) return;
    overview.hidden = true; setFocus([]);
    var h = '<button class="close" aria-label="Close">×</button><button type="button" class="back">← Overview</button>';
    h += '<div class="k">Bauify · code analysis</div><h3>' + esc(c.label) + '<span class="badge ' + c.indicators.status + '">' + c.indicators.status + ' · ' + LEVELS[c.indicators.status].name + '</span></h3>';
    h += '<div class="ev">' + esc(LEVELS[c.indicators.status].text) + '</div>';
    if (c.indicators.items.length) {
      h += '<div class="k">Indicators · click one for its findings and a diagram</div>';
      c.indicators.items.forEach(function (i) {
        var n = (i.findings || []).length;
        h += '<div class="ind link" data-ind="' + i.key + '" role="button" tabindex="0"><i class="' + i.status + '"></i><div><b>' + esc(i.label) + ' <span class="more">' + (n ? n + ' finding' + (n === 1 ? '' : 's') + ' ›' : 'details ›') + '</span></b><span class="v">' + esc(i.value) + '</span>' +
          (i.detail.length ? '<div class="detail">with: ' + i.detail.map(function (d) { var m = d.split(':'); return m[0] === 'component' && byId[m[1]] ? esc(byId[m[1]].label) : esc(m[1]) + ' (not on diagram)'; }).join(', ') + '</div>' : '') + '</div></div>';
      });
    }
    if (!c.modules.length) {
      h += '<p class="warn">No source module is mapped to this component (external system, or no sources in the IR).</p>';
    } else {
      h += '<div>' + c.modules.map(function (m) { return esc(m.label); }).join(' · ') + '</div>';
      h += '<span class="stat">' + c.files + ' files</span><span class="stat">' + c.loc + ' LOC</span>';
      var fi = c.incoming.reduce(function (n, e) { return n + e.weight; }, 0), fo = c.outgoing.reduce(function (n, e) { return n + e.weight; }, 0);
      h += '<span class="stat">in ' + fi + '</span><span class="stat">out ' + fo + '</span>';
      if (c.internalImports) h += '<span class="stat">internal ' + c.internalImports + '</span>';
      var section = function (title, list, arrow) {
        if (!list.length) return '';
        var s = '<details><summary>' + title + ' · ' + list.length + '</summary>';
        list.forEach(function (e) {
          var target = e.component ? (byId[e.component] ? byId[e.component].label : e.component) : (e.module + ' (not on diagram)');
          s += '<div class="edge"><b>' + arrow + '</b> ' + esc(target) + ' <span class="ev">' + e.weight + ' import' + (e.weight === 1 ? '' : 's') + '</span><div class="ev">' +
            e.evidence.map(function (v) { return '<div>' + fileLink(v.file, v.line) + ' → ' + esc(v.to) + '</div>'; }).join('') + '</div></div>';
        });
        return s + '</details>';
      };
      h += section('Imports from here', c.outgoing, 'OUT →');
      h += section('Imported by', c.incoming, '← IN');
      if (c.fileList && c.fileList.length) {
        h += '<details><summary>Files · ' + c.fileList.length + '</summary><table>';
        c.fileList.forEach(function (f) {
          h += '<tr><td class="p" title="' + esc(f.path) + '">' + esc(f.path) + (f.findings.length ? ' <b>!' + f.findings.length + '</b>' : '') + '</td><td class="n">' + f.loc + ' LOC</td><td class="n">out ' + f.importsOut + '</td><td class="n">in ' + f.importedBy + '</td></tr>';
        });
        h += '</table></details>';
      }
    }
    h += '<div class="k">Repository</div><div class="ev">' + esc(data.repository.url || 'no origin') + (data.repository.sourceKind === 'working-tree' ? ' · Working tree' + (data.repository.baseRevision ? ' (base ' + esc(data.repository.baseRevision.slice(0, 7)) + ')' : '') : (data.repository.revision ? ' @ ' + esc(data.repository.revision.slice(0, 7)) : '')) +
      '<br>' + data.totals.modules + ' modules · ' + data.totals.edges + ' module edges · ' + data.unmapped.length + ' not on this diagram</div>';
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
    var seen = {}; return fl.filter(function (f) { var k = f.id || f.code + JSON.stringify(f.subject); if (seen[k]) return false; seen[k] = true; return true; });
  }
  function ref(file, line, rest, why, tone, rangeStart, rangeEnd) {
    return '<button type="button" class="ref" data-file="' + esc(file) + '" data-line="' + line + '" data-range-start="' + (rangeStart || '') + '" data-range-end="' + (rangeEnd || '') + '" data-why="' + esc(why || '') + '" data-tone="' + (tone || '') + '"><b>' + esc(short(file)) + '</b> <em>(line ' + line + ')</em>' + (rest ? ' ' + rest : '') + '</button>';
  }
  function nextStepHtml(f) {
    var text = f.code === 'coupling/hub' ? 'Check whether dependencies cluster by responsibility before splitting this module.'
      : f.code === 'coupling/concentration' ? 'Decide whether this concentration is intended. A small shared kernel or one cohesive responsibility can be accepted with that reason; otherwise look for parts that change for different reasons or are used by only a few modules.'
      : f.code === 'coupling/import-cycle' ? 'Inspect the cited imports and initialization behavior before changing this dependency.'
      : f.code === 'coupling/cycle' ? 'Check which shared responsibility links these modules. A module cycle does not establish a file-level failure.'
      : f.code === 'architecture/boundary' ? 'Check what the cited imports need from the other layer: move it behind an interface in an allowed layer, or update the rule if this dependency is intended.'
      : f.code === 'coupling/internal-leak' ? 'List what the cited imports use, export it from one entry file of the module, and point the imports there. If deep imports are the convention here, declare the entry files in the analysis config instead.'
      : f.code === 'complexity/function' ? 'Start at the deepest nested block: extract it into a named helper, or return early for edge cases. Make sure the current behavior is covered by tests before restructuring.'
      : 'Review the evidence and assumptions before changing code.';
    return '<div class="next-step"><b>Suggested next step</b><p>' + esc(text) + '</p></div>';
  }
  function findingCard(f, compact) {
    var ev = '';
    var tone = f.severity === 'error' ? 'red' : f.severity === 'warning' ? 'amber' : 'blue';
    if (f.evidence && f.evidence.risk) ev += '<div class="ev"><div>import risk: <b>' + esc(f.evidence.risk.loading) + '</b> — ' + esc(f.evidence.risk.loadingNote) + '</div></div>';
    if (f.evidence && (f.evidence.partialInitCandidate || f.evidence.proof)) {
      var pr = f.evidence.partialInitCandidate || f.evidence.proof;
      ev += '<div class="ev" style="margin-top:4px">Potential partial initialization when <b>' + esc(pr.entry) + '</b> is imported first (chain ' + esc(pr.chain.join(' → ')) + '):</div>';
      ev += ref(pr.entry, pr.viaLine, '<span>→ leaves for ' + esc(short(pr.chain[1] || pr.importer)) + ' before <b>' + esc(pr.name) + '</b> exists</span>', 'This module-scope import runs before ' + pr.name + ' is bound (line ' + pr.boundAt + '); static line order alone does not prove the execution sequence.', tone);
      ev += ref(pr.importer, pr.line, '<span>→ asks the half-built ' + esc(short(pr.entry)) + ' for <b>' + esc(pr.name) + '</b></span>', 'May read ' + pr.name + ' before its binding; execution timing and failure are not proven.', tone);
      ev += ref(pr.entry, pr.boundAt, '<span>→ <b>' + esc(pr.name) + '</b> has its recorded binding here</span>', 'The binding the other side needed; it only exists once the file has run this far.', 'amber');
    }
    if (f.code === 'complexity/function' && f.subject && f.subject.file) {
      ev += '<div class="ev" style="margin-top:4px">Where to look — click to see the code:</div>';
      ev += ref(f.subject.file, f.subject.line, '<span>' + esc(f.subject.function) + '() starts</span> <em>· ' + plural(f.evidence.length, 'line') + '</em>', 'The function this finding measures (lines ' + f.subject.line + '–' + f.subject.endLine + ').', tone, f.subject.line, f.subject.endLine);
      if (f.evidence.deepestLine && f.evidence.deepestLine !== f.subject.line) ev += ref(f.subject.file, f.evidence.deepestLine, '<span>deepest nesting (' + f.evidence.nesting + ' levels)</span>', 'The most deeply nested block; usually the best place to start simplifying.', tone, f.subject.line, f.subject.endLine);
    }
    if (f.evidence && f.evidence.imports && f.evidence.imports.length) {
      var isCycle = f.code === 'coupling/import-cycle' || f.code === 'coupling/cycle';
      var crossing = f.code === 'architecture/boundary' && f.subject && f.subject.boundary;
      var leak = f.code === 'coupling/internal-leak';
      ev += '<div class="ev" style="margin-top:4px">' + (isCycle ? 'Imports on the cycle — click one to see the code:' : crossing ? 'Imports that cross the boundary — click one to see the code:' : leak ? 'Imports that reach inside the module — click one to see the code:' : 'Evidence — click to see the code:') + '</div>';
      f.evidence.imports.slice(0, 8).forEach(function (v) {
        if (crossing) {
          var kind = data.repository.language === 'java' ? 'Java source dependency' : v.typeOnly ? 'type-only import' : (v.lazy || v.conditional) ? 'deferred or conditional import' : 'module-scope import';
          ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· ' + kind + '</em>',
            'This import makes ' + crossing.from + ' depend on ' + crossing.to + ', which the configured rule forbids.' + (v.typeOnly ? ' It is type-only: nothing is loaded at runtime, but the layer still depends on code in the other layer.' : ''), tone);
          return;
        }
        if (leak) {
          ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· internal file</em>',
            'This import reaches a file inside ' + modLabel(f.subject.module) + (f.evidence.entries.length ? ' instead of its entry point (' + f.evidence.entries.map(short).join(', ') + ').' : ', which has no entry file.'), tone);
          return;
        }
        var deferred = v.lazy || v.conditional || v.deferred || v.typeOnly;
        var structural = f.evidence.kind === 'structural';
        var kindText = structural ? 'Java source dependency · solid' : deferred ? 'deferred / conditional / type-only import · dashed' : 'recorded module-scope import · solid';
        ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· ' + kindText + '</em>',
          structural ? 'A recorded Java import or type reference; class initialization behavior was not assessed.' : deferred ? 'Execution timing is not proven; deferred functions may be called during initialization. Type-only imports are not runtime dependencies.' : 'Recorded at module scope; execution order and runtime behavior are not verified.', tone);
      });
      if (f.evidence.imports.length > 8) ev += '<div class="ev">… ' + (f.evidence.imports.length - 8) + ' more in findings.json</div>';
    }
    var fixes = (f.supportedFixes || []).length ? '<div class="ev fixes">' + f.supportedFixes.map(function (x) { return '<div>· ' + esc(x) + '</div>'; }).join('') + '</div>' : '';
    return (compact ? '' : nextStepHtml(f)) + '<div class="finding ' + esc(f.severity) + '">' + ev + '<details class="technical"><summary>Rule details and alternatives</summary><b>' + esc(f.code) + '</b> · ' + esc(f.severity) + (f.id ? ' · ' + esc(f.id) : '') + '<p>' + esc(f.message) + '</p>' + fixes + '</details></div>';
  }
  // Source excerpt for one file:line, from the windows embedded at overlay time.
  function showCode(file, line, why, tone, full, rangeStart, rangeEnd) {
    readerPage('Source');
    var snip = (data.snippets || {})[file];
    line = Number.isInteger(line) && line > 0 ? line : null;
    var sourceParent = detail.hidden ? 'Component' : 'Problem';
    var h = '<div class="grip"><button class="close" aria-label="Close">×</button><button type="button" class="source-back back">← ' + sourceParent + '</button><div class="k">Source · ' + (line ? 'line ' + line : (full ? 'full file' : 'file preview') + ' · no specific finding line') + '</div><h3>' + esc(file) + '</h3></div>';
    if (why) h += '<div class="why">' + esc(why) + '</div>';
    if (!snip) {
      h += '<div class="why" style="margin-top:10px">Source is unavailable in this report. Re-analyze with the local service, or read this file in your editor.</div>';
    } else {
      var changes = snip.changes;
      var added = new Set(changes ? changes.added : []), modified = new Set(changes ? changes.modified : []);
      var deleted = new Map((changes ? changes.deleted : []).map(function (item) { return [item.after, item.count]; }));
      if (changes && changes.status !== 'unavailable') {
        h += '<div class="diff-legend">Captured changes vs base commit ' + esc((data.repository && data.repository.baseRevision || '').slice(0, 7)) + ' (staged + unstaged)';
        if (changes.status === 'unchanged') h += ' · No changes';
        else h += ' · <span class="added">+ Added</span> · <span class="modified">~ Modified</span> · <span class="deleted">− Deleted</span>';
        if (changes.status === 'added') h += ' · New file';
        h += '</div>';
      } else if (changes) h += '<div class="diff-legend">Change markers unavailable: no readable base commit.</div>';
      var deletion = function (after) { return deleted.has(after) ? '<span class="diff-deleted" title="Deleted from the base commit">− ' + deleted.get(after) + ' deleted line(s)</span>' : ''; };
      var start = full ? 0 : line ? Math.max(0, Math.min(line - 5, snip.lines.length - 9)) : 0;
      var end = full ? snip.lines.length : Math.min(snip.lines.length, start + (line ? 9 : 12));
      h += '<div class="why">Lines ' + (start + 1) + '–' + end + ' of ' + snip.lines.length + (line || full ? '' : ' · opening lines, not finding evidence') + '</div>';
      if (rangeStart && rangeEnd) h += '<div class="why">Highlighted function: lines ' + rangeStart + '–' + rangeEnd + (full ? '' : ' · excerpt only; expand for the complete function') + '</div>';
      if (snip.lines.length > (line ? 9 : 12)) h += '<button type="button" class="source-file source-toggle">' + (full ? 'Show excerpt' : 'Show full file') + '</button>';
      h += '<pre' + (full ? '' : ' class="excerpt"') + '>';
      if (!start) h += deletion(0);
      snip.lines.forEach(function (text, i) {
        if (i < start || i >= end) return;
        var n = i + 1;
        var kind = added.has(n) ? 'added' : modified.has(n) ? 'modified' : '';
        h += '<span class="ln' + (rangeStart && n >= rangeStart && n <= rangeEnd ? ' range-hit' : '') + (n === line ? ' hit ' + (tone || '') : '') + (kind ? ' diff-' + kind : '') + '"' + (kind ? ' title="' + (kind === 'added' ? 'Added' : 'Modified') + ' since base commit"' : '') + '><i>' + n + '</i>' + esc(text) + '</span>';
        h += deletion(n);
      });
      h += '</pre>';
    }
    codePane.innerHTML = h;
    codePane.hidden = false;
    document.documentElement.setAttribute('data-bauify-source', 'on');
    var sourceToggle = codePane.querySelector('.source-toggle');
    if (sourceToggle) sourceToggle.addEventListener('click', function () { showCode(file, line, why, tone, !full, rangeStart, rangeEnd); });
    var backToSourceParent = function () { codePane.hidden = true; document.documentElement.removeAttribute('data-bauify-source'); readerPage(sourceParent); var active = detail.querySelector('.ref.active'); if (active) active.focus({ preventScroll: true }); detail.querySelectorAll('.ref.active').forEach(function (x) { x.classList.remove('active'); }); };
    codePane.querySelector('.close').addEventListener('click', backToSourceParent);
    codePane.querySelector('.source-back').addEventListener('click', backToSourceParent);
    var hit = codePane.querySelector('.ln.hit');
    if (hit) codePane.scrollTop = Math.max(0, hit.offsetTop - codePane.offsetTop - codePane.clientHeight / 2);
  }
  function showDetail(c, key) {
    readerPage('Problem');
    root.removeAttribute('data-bauify-source');
    panel.hidden = true;
    var ind = c.indicators.items.filter(function (i) { return i.key === key; })[0]; if (!ind) return;
    var ids = ind.findings || [];
    var fl = allFindings(c).filter(function (f) { return ids.indexOf(f.id) !== -1; });
    var lvl = LEVELS[ind.status] || LEVELS.neutral;
    var h = '<button class="close" aria-label="Close">×</button><button class="back" type="button">← Component</button>';
    h += '<div class="k">' + esc(c.label) + '</div><h3><i class="bauify-' + ind.status + '"></i>' + esc(ind.label) + '</h3>';
    h += '<div class="level"><b>' + esc(lvl.name) + '</b> — ' + esc(ind.value) + (ind.status === 'neutral' ? '' : '<br>' + esc(lvl.text)) + '</div>';
    h += '<details class="relationship"><summary>Relationships and metrics</summary>' + diagram(c, key, fl) + '</details>';
    h += '<div class="k">Findings · ' + fl.length + '</div>';
    if (!fl.length) h += '<div class="ev">' + (key === 'instability' ? 'Instability measures dependency direction: out / (in + out). 0 = no outgoing dependencies, 1 = no incoming dependents. It is not a failure probability or a quality verdict.' : 'No finding for this indicator; this is not a safety guarantee.') + '</div>';
    fl.forEach(function (f) { h += quickHandoff(f) + evidencePreview(f) + findingCard(f) + taskHtml(f); });
    detail.innerHTML = h;
    detail.hidden = false;
    codePane.hidden = true;
    var backToComponent = function () { readerPage('Component'); detail.hidden = true; codePane.hidden = true; panel.hidden = false; panel.querySelectorAll('.ind.active').forEach(function (x) { x.classList.remove('active'); }); };
    detail.querySelector('.close').addEventListener('click', backToComponent);
    detail.querySelector('.back').addEventListener('click', backToComponent);
    wireRefs();
    wireTasks();
  }
  function wireRefs() {
    detail.querySelectorAll('.ref').forEach(function (el) {
      el.addEventListener('click', function () {
        detail.querySelectorAll('.ref.active').forEach(function (x) { x.classList.remove('active'); }); el.classList.add('active');
        showCode(el.getAttribute('data-file'), parseInt(el.getAttribute('data-line'), 10), el.getAttribute('data-why'), el.getAttribute('data-tone'), false, Number(el.getAttribute('data-range-start')), Number(el.getAttribute('data-range-end')));
      });
    });
  }
  // --- overview: project-level reading, built from data.overview ------------
  var VERDICT = {
    attention: { tone: 'amber', text: 'Needs attention' },
    'signals-only': { tone: 'blue', text: 'Signals only' },
    'none-found': { tone: 'green', text: 'No findings within the checks that ran' }
  };
  var GROUPS = { 'coupling/import-cycle': 'Import cycles', 'coupling/cycle': 'Module cycles', 'coupling/hub': 'Hub modules', 'coupling/concentration': 'Concentration', 'coupling/internal-leak': 'Internal imports', 'architecture/boundary': 'Boundary violations', 'complexity/function': 'Complex functions' };
  var LANGS = { py: 'Python', ts: 'JS/TS', java: 'Java' };
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function toneOf(severity) { return severity === 'error' ? 'red' : severity === 'warning' ? 'amber' : 'blue'; }
  function modLabel(id) { return moduleInfo[id] ? moduleInfo[id].label : id; }
  function findingTitle(f) {
    var s = f.subject || {};
    if (f.code === 'coupling/import-cycle' && s.files) return 'Import cycle · ' + plural(s.files.length, 'file');
    if (f.code === 'coupling/cycle' && s.modules) return 'Module cycle · ' + plural(s.modules.length, 'module');
    if (f.code === 'coupling/hub' && s.module) return modLabel(s.module) + ' connects many modules';
    if (f.code === 'coupling/concentration') return s.file ? short(s.file) + ' is a very large file' : modLabel(s.module) + ' concentrates the project';
    if (f.code === 'coupling/internal-leak' && s.module) return modLabel(s.module) + ' is imported through its internals';
    if (f.code === 'architecture/boundary' && s.boundary) return s.boundary.from + ' depends on ' + s.boundary.to;
    // Java names carry their parameter types to tell overloads apart.
    if (f.code === 'complexity/function' && s.function) return s.function + (s.function.endsWith(')') ? '' : '()') + ' is complex';
    return f.code;
  }
  function concentrationWhat(ev) {
    var pct = function (share) { return Math.round(share * 100) + '%'; };
    var parts = [];
    if (ev.reach) parts.push(ev.reach.dependents + ' of ' + plural(ev.reach.modules, 'other module') + ' depend on it (' + pct(ev.reach.share) + ')');
    if (ev.size) parts.push(pct(ev.size.share) + ' of the analyzed lines (' + ev.size.loc + ' of ' + ev.size.totalLoc + ')');
    if (ev.loc) parts.push(plural(ev.loc, 'line') + ' · threshold ' + ev.threshold.fileLines);
    return parts.join(' · ');
  }
  function findingWhat(f) {
    var s = f.subject || {};
    if (f.code === 'coupling/concentration' && f.evidence) return concentrationWhat(f.evidence);
    if (s.files) return 'Files: ' + s.files.slice(0, 3).map(short).join(', ') + (s.files.length > 3 ? ' …' : '');
    if (s.modules) return 'Modules: ' + s.modules.slice(0, 4).map(modLabel).join(', ') + (s.modules.length > 4 ? ' …' : '');
    if (f.code === 'coupling/hub' && f.evidence) return f.evidence.fanIn + ' modules depend on it; it depends on ' + f.evidence.fanOut + '.';
    if (f.code === 'coupling/internal-leak' && f.evidence) return plural(f.evidence.totalImports, 'import') + ' from ' + plural(f.evidence.consumers.length, 'module') + ' reach ' + plural(f.evidence.internalFiles.length, 'internal file') + ' of ' + f.evidence.moduleFiles + (f.evidence.entries.length ? ' · entry point: ' + f.evidence.entries.map(short).join(', ') : ' · no entry file');
    if (f.code === 'complexity/function' && f.evidence) return 'complexity ' + f.evidence.complexity + ' · nesting ' + f.evidence.nesting + ' · ' + plural(f.evidence.length, 'line') + ' · ' + short(s.file);
    if (f.code === 'architecture/boundary' && f.evidence) return plural(f.evidence.totalImports, 'import') + ' in ' + plural(f.evidence.files.length, 'file') + ' · rule: ' + (f.evidence.rule.reason || s.boundary.from + ' must not depend on ' + s.boundary.to);
    return f.message;
  }
  function findingWhere(f) {
    var ids = f.componentIds || [];
    var where = ids.length ? ids.map(function (id) { return byId[id] ? byId[id].label : id; }).join(', ') : 'not on this diagram';
    var e = entryById[f.id];
    var s = f.subject || {}, first = (f.evidence && f.evidence.imports || [])[0];
    var path = s.file ? s.file + (s.line ? ':' + s.line : '') : first ? first.file + ':' + first.line : '';
    return (path ? path + ' · ' : '') + where + (e && e.relatedIds.length ? ' · +' + e.relatedIds.length + ' related' : '');
  }
  function findingRow(id, n) {
    var f = findingById[id]; if (!f) return '';
    var r = f.review || {};
    var badges = (r.since === 'new' ? '<span class="badge-new">new</span>' : '') +
      (r.status === 'accepted' ? '<span class="badge-accepted">' + (f.severity === 'error' ? 'accepted · still to fix' : 'accepted') + '</span>' : r.status === 'accepted-changed' ? '<span class="badge-accepted">accepted · evidence changed</span>' : '');
    return '<button type="button" class="bauify-item ' + toneOf(f.severity) + (r.status === 'accepted' ? (f.severity === 'error' ? ' accepted-error' : ' accepted') : '') + '" data-finding="' + esc(id) + '"' + (r.reason ? ' title="Accepted: ' + esc(r.reason) + '"' : '') + '>' + (n ? '<span class="n">' + n + '</span>' : '') +
      '<b>' + esc(findingTitle(f)) + '</b> <em>' + esc(f.severity) + '</em>' + badges + '<span class="what">' + esc(findingWhat(f)) + '</span><span class="where">' + esc(findingWhere(f)) + '</span>' + (n && data.tasks && data.tasks[id] ? '<span class="what">' + esc(data.tasks[id].task.impact.map(function (v) { return v.statement; }).join(' ')) + '</span>' : '') + '</button>';
  }
  function coverageHtml(c) {
    if (!c) return '';
    var lines = [];
    var files = c.files || {};
    lines.push((LANGS[c.language] || c.language || 'Unknown language') + (files.analyzed !== null && files.analyzed !== undefined ? ' · ' + plural(files.analyzed, 'file') + ' analyzed' : '') +
      (files.excludedByRole ? ' · ' + files.excludedByRole + ' ' + (files.excludedRoles || []).join('/') + ' files left out' : ''));
    (c.otherLanguages || []).forEach(function (x) { lines.push('Not analyzed: ' + plural(x.files, (LANGS[x.adapter] || x.adapter) + ' file') + ' (one language per run)'); });
    var pe = files.parseErrors || [];
    if (pe.length) lines.push(plural(pe.length, 'file') + ' could not be parsed: ' + pe.slice(0, 3).join(', ') + (pe.length > 3 ? ' …' : ''));
    var u = c.unresolved || {}, unresolved = (u.unknown || 0) + (u.opaque || 0);
    // Java counts each unresolved type reference as well as imports.
    if (unresolved) lines.push(plural(unresolved, c.language === 'java' ? 'dependency record' : 'import') + ' could not be resolved');
    if ((c.unmappedModules || []).length) lines.push(plural(c.unmappedModules.length, 'module') + ' not on this diagram');
    var run = (c.rules && c.rules.run) || [], off = (c.rules && c.rules.suppressed) || [];
    lines.push('Checked: ' + (run.length ? run.map(function (r) { return (GROUPS[r] || r).toLowerCase(); }).join(', ') : 'nothing') + (off.length ? ' · switched off: ' + off.join(', ') : ''));
    var b = c.boundaries;
    if (b) {
      lines.push('Boundaries: ' + plural(b.layers.length, 'layer') + ', ' + plural(b.rules, 'rule') + ' from the analysis config');
      b.layers.filter(function (l) { return !l.files; }).forEach(function (l) { lines.push('Layer "' + l.name + '" matches no analyzed file; check its globs'); });
    }
    var missing = [['complexity/', 'complexity'], ['redundancy/', 'duplication'], ['architecture/', 'architecture boundaries (none configured)']].filter(function (d) { return !run.some(function (r) { return r.indexOf(d[0]) === 0; }); }).map(function (d) { return d[1]; });
    if (missing.length) lines.push('Not checked: ' + missing.join(', '));
    var incomplete = (c.otherLanguages || []).length || pe.length || unresolved || off.length;
    return '<details class="coverage"><summary>Coverage · ' + esc(LANGS[c.language] || c.language || 'Unknown') + ' · ' + (files.analyzed == null ? 'file count unavailable' : plural(files.analyzed, 'file')) + (incomplete ? ' · incomplete' : '') + '</summary><div class="ev cov">' + lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div></details>';
  }
  // Since the previous run, and against the baseline. Fixed findings are no longer
  // in this result, so they are listed from the comparison itself.
  function reviewHtml(r) {
    if (!r) return '';
    var h = '';
    var c = r.comparison;
    if (c) {
      var gone = c.notDetected || c.fixed || [];
      h += '<div class="ev review-line">Since the previous analysis: ' + c.new.length + ' new · ' + gone.length + ' no longer detected · ' + c.evidenceChanged.length + ' with changed evidence</div>';
      if (c.comparable !== true) h += '<p class="ev comparison-notice">Results are not directly comparable: ' + esc((c.reasons || []).map(function (r) { return typeof r === 'string' ? r : (r && (r.message || r.code)) || ''; }).filter(Boolean).join(' ') || 'comparison context unavailable') + '. Missing findings do not establish a fix.</p>';
      if (gone.length) h += '<details><summary>No longer detected · ' + gone.length + '</summary><div class="ev">' + gone.map(function (f) { return '<div>' + esc(GROUPS[f.code] || f.code) + ': ' + esc(f.message) + (f.likelyCause ? ' · ' + esc(f.likelyCause) : '') + '</div>'; }).join('') + '</div></details>';
    }
    var b = r.baseline;
    if (b) {
      h += '<div class="ev review-line">Baseline: ' + b.accepted + ' accepted' + (b.changed.length ? ' · ' + b.changed.length + ' changed since accepted and shown again' : '') + (b.stale.length ? ' · ' + plural(b.stale.length, 'entry') .replace('entrys', 'entries') + ' no longer found' : '') + '</div>';
      if (b.stale.length) h += '<details><summary>Baseline entries no longer found · ' + b.stale.length + '</summary><div class="ev">' + b.stale.map(function (e) { return '<div>' + esc(e.id) + ' (' + esc(e.code) + ') · ' + esc(e.reason) + '</div>'; }).join('') + '<div>Fixed or moved; remove them from the baseline file.</div></div></details>';
    }
    return h;
  }
  function renderOverview() {
    var o = data.overview;
    if (!o) { overview.innerHTML = '<div class="k">Code analysis</div>' + legend(); return; }
    var v = VERDICT[o.verdict] || VERDICT['none-found'];
    var acceptedCount = o.counts.accepted || 0;
    var acceptedErrors = o.counts.acceptedErrors || 0;
    // An error stays red after it is accepted: the baseline unblocks CI, it does not fix the structure.
    if (o.counts.error) v = { tone: 'red', text: 'Structural problems to fix' };
    else if (acceptedErrors) v = { tone: 'red', text: 'Accepted structural problems still present' };
    var verdictText = !o.counts.error && !acceptedErrors && o.verdict === 'none-found' && acceptedCount ? 'No open findings · ' + acceptedCount + ' accepted in the baseline' : v.text;
    var counts = [plural(o.counts.findings, 'finding')]
      .concat(['error', 'warning', 'info'].filter(function (k) { return o.counts[k]; }).map(function (k) { return o.counts[k] + ' ' + k; }))
      .concat(acceptedCount ? [acceptedCount + ' accepted'] : [])
      .concat(o.counts.offDiagram ? [o.counts.offDiagram + ' not on this diagram'] : []).join(' · ');
    var h = typeof window.__archifyReanalyze === 'function' ? '<button type="button" class="bauify-reanalyze" title="Read the repository again and compare with this result">Re-analyze</button>' : '';
    h += '<h3><i class="bauify-' + v.tone + '"></i>' + esc(verdictText) + '</h3>';
    h += '<div class="ev">' + esc(counts) + '</div>';
    var checkedRules = o.coverage && o.coverage.rules && o.coverage.rules.run || [];
    var unchecked = [['redundancy/', 'duplicate code'], ['conventions/', 'project coding conventions']].filter(function (x) { return !checkedRules.some(function (r) { return r.indexOf(x[0]) === 0; }); }).map(function (x) { return x[1]; });
    if (unchecked.length) h += '<div class="coverage-notice">Not checked: ' + esc(unchecked.join(', ')) + '. See Coverage for the full scope.</div>';
    h += reviewHtml(o.review);
    if (o.priorities.length) {
      var picks = o.priorities.map(function (id) { return findingById[id]; }).filter(Boolean);
      var hubs = picks.filter(function (f) { return f.code === 'coupling/hub'; });
      var onlyBoundaries = picks.every(function (f) { return f.code === 'architecture/boundary'; });
      var anyCycle = picks.some(function (f) { return f.code === 'coupling/import-cycle' || f.code === 'coupling/cycle'; });
      // The lead follows the first priority; the cycle caveat only when a cycle is listed.
      var first = picks[0] || {};
      var lead = first.code === 'coupling/hub' ? 'Start with responsibility boundaries in ' + hubs.map(function (f) { return esc(modLabel(f.subject.module)); }).join(' and ') + '. '
        : first.code === 'complexity/function' ? 'Start with the most complex functions below. '
        : onlyBoundaries ? 'Start with the layer rules broken below. '
        : 'Start with the dependency structures below. ';
      h += '<p class="verdict-note">' + lead + 'Each finding links to its evidence' + (anyCycle ? '; runtime failure is not proven.' : '.') + '</p>';
    }
    if (o.priorities.length) {
      h += '<div class="k">Look at first</div>';
      o.priorities.forEach(function (id, i) { h += findingRow(id, i + 1); });
    } else if (acceptedCount) h += '<div class="ev" style="margin-top:8px">Every finding is accepted in the baseline' + (acceptedErrors ? ', including ' + plural(acceptedErrors, 'circular dependency finding') + ' that ' + (acceptedErrors === 1 ? 'is' : 'are') + ' still in the code and stay' + (acceptedErrors === 1 ? 's' : '') + ' red' : '') + '. New findings, and accepted ones whose code changes, will show up here.</div>';
    else h += '<div class="ev" style="margin-top:8px">No rule fired. This covers only the checks listed under Coverage; it is not a quality guarantee.</div>';
    if (o.groups.length) {
      h += '<div class="k">All findings · click a component on the diagram for its own view</div>';
      o.groups.forEach(function (g) {
        h += '<details><summary><i class="bauify-' + toneOf(g.severity) + '"></i>' + esc(GROUPS[g.code] || g.code) + ' · ' + g.count + '</summary>' + g.ids.map(function (id) { return findingRow(id); }).join('') + '</details>';
      });
    }
    h += coverageHtml(o.coverage);
    h += '<details><summary>Colour key</summary>' + legend() + '</details>';
    overview.innerHTML = h;
    var again = overview.querySelector('.bauify-reanalyze');
    if (again) again.addEventListener('click', function () {
      again.disabled = true; again.textContent = 'Analyzing…';
      window.__archifyReanalyze().catch(function (error) {
        again.disabled = false; again.textContent = 'Re-analyze';
        var note = overview.querySelector('.reanalyze-error') || again.insertAdjacentElement('afterend', document.createElement('div'));
        note.className = 'ev reanalyze-error'; note.textContent = 'Re-analysis failed: ' + error.message + ' The result shown is from the last successful run.';
      });
    });
    overview.querySelectorAll('[data-finding]').forEach(function (el) {
      el.addEventListener('click', function () {
        overview.querySelectorAll('.bauify-item.active').forEach(function (x) { x.classList.remove('active'); });
        overview.querySelectorAll('[data-finding="' + el.getAttribute('data-finding') + '"]').forEach(function (x) { x.classList.add('active'); });
        showFinding(el.getAttribute('data-finding'));
      });
    });
  }
  // One finding opened from the overview. It may span several components or none,
  // so the diagram helpers get a stand-in component holding everything it touches.
  function findingScope(f) {
    var comps = (f.componentIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
    var mods = comps.flatMap(function (c) { return c.modules; });
    (f.moduleIds || []).forEach(function (id) { if (moduleInfo[id] && !mods.some(function (m) { return m.id === id; })) mods.push(moduleInfo[id]); });
    var files = comps.flatMap(function (c) { return c.fileList || []; });
    (f.moduleIds || []).forEach(function (id) { ((moduleInfo[id] || {}).fileList || []).forEach(function (file) { if (!files.some(function (v) { return v.path === file.path; })) files.push(file); }); });
    return { label: comps.map(function (c) { return c.label; }).join(', ') || 'not on this diagram', modules: mods, fileList: files, incoming: [], outgoing: [], findings: [f] };
  }
  function evidencePreview(f) {
    var captured = (data.tasks || {})[f.id];
    var locations = captured ? captured.task.locations.filter(function (l) { return l.startLine; }).slice(0, 2) : [];
    if (!locations.length && f.subject && f.subject.file && f.subject.line) locations = [{ file: f.subject.file, startLine: f.subject.line, endLine: f.subject.endLine }];
    if (!locations.length) locations = (f.evidence && f.evidence.imports || []).slice(0, 2).map(function (v) { return { file: v.file, startLine: v.line, endLine: v.line }; });
    return locations.map(function (loc) {
      var snip = (data.snippets || {})[loc.file], focus = f.code === 'complexity/function' ? f.evidence.deepestLine || loc.startLine : loc.startLine;
      var h = '<div class="inline-evidence">' + ref(loc.file, focus, '', 'Captured source evidence. Read the complete context before editing.', toneOf(f.severity), loc.startLine, loc.endLine);
      if (!snip) return h + '<div class="ev">Source unavailable in this report. Open the file in your editor or re-analyze.</div></div>';
      var start = Math.max(0, focus - 5), end = Math.min(snip.lines.length, start + 9);
      h += '<pre aria-label="Code excerpt from ' + esc(loc.file) + '">';
      snip.lines.slice(start, end).forEach(function (text, i) { var n = start + i + 1; h += '<span class="evidence-line' + (n === focus ? ' focus-line' : '') + '"><span class="line-number">' + n + '  </span>' + esc(text) + '</span>'; });
      h += '</pre><div class="ev">Captured lines ' + (start + 1) + '–' + end + ' of ' + snip.lines.length + ' · excerpt only; click the path to expand.</div></div>';
      return h;
    }).join('');
  }
  function taskHtml(f) {
    return '<details class="ai-task" data-task-id="' + esc(f.id) + '"><summary>Task preview and download</summary><p class="ev">Review the brief, then give it to your coding AI. Exporting does not modify code.</p><p class="task-status ev" role="status" aria-live="polite">Open to prepare the task.</p><div class="task-actions"><button type="button" class="task-copy" disabled>Copy AI task</button><button type="button" class="task-download" disabled>Download .md</button><button type="button" class="task-refresh">Check again</button></div><label class="ev">Task preview · select text to copy manually<textarea class="task-preview" readonly spellcheck="false" aria-label="AI task preview"></textarea></label></details>';
  }
  function quickHandoff(f) {
    return '<div class="quick-handoff" data-handoff-id="' + esc(f.id) + '"><div class="task-actions"><button type="button" class="quick-copy">Copy task for AI</button></div><p class="ev handoff-status" role="status" aria-live="polite">Includes evidence, suggestions and allowed files. Paste it into your coding AI.</p></div>';
  }
  function wireTasks() {
    detail.querySelectorAll('.ai-task').forEach(function (box) {
      var id = box.getAttribute('data-task-id'), payload = null, busy = false;
      var status = box.querySelector('.task-status'), preview = box.querySelector('.task-preview');
      var copy = box.querySelector('.task-copy'), download = box.querySelector('.task-download'), refresh = box.querySelector('.task-refresh');
      var quick = detail.querySelector('[data-handoff-id="' + id + '"]');
      var quickCopy = quick && quick.querySelector('.quick-copy');
      var say = function (text) { status.textContent = text; if (quick) quick.querySelector('.handoff-status').textContent = text; };
      var describe = function (p) {
        var e = p.task.evidence;
        var labels = { valid: 'Evidence matches the current working tree.', captured: 'Snapshot only; current source has not been checked. Ask your coding AI to verify it before editing.', changed: 'Evidence changed. Re-analyze and review the current code before editing.', missing: 'A cited file is missing. Re-analyze before editing.', unverifiable: 'Evidence could not be verified. Read the cited files before editing.' };
        return (labels[e.status] || 'Evidence status unknown.') + (e.reason ? ' ' + e.reason : '') + (e.checkedAt ? ' Checked ' + e.checkedAt + '.' : '');
      };
      var prepare = async function () {
        if (busy) return null;
        busy = true; copy.disabled = download.disabled = refresh.disabled = true;
        if (quickCopy) quickCopy.disabled = true;
        say('Preparing task and checking available evidence…');
        try {
          var note = '';
          if (typeof window.__archifyBuildTask === 'function') {
            try { payload = await window.__archifyBuildTask(id); }
            catch (error) {
              if (error.status) throw error;
              payload = (data.tasks || {})[id];
              note = 'Local service unavailable. ';
            }
          } else { payload = (data.tasks || {})[id]; note = 'Offline report. '; }
          if (!payload) throw new Error('Task source is unavailable. Re-analyze with the local service to create this task.');
          if (data.repository.snapshotId && payload.task.source.snapshotId && data.repository.snapshotId !== payload.task.source.snapshotId) throw new Error('The service has a newer analysis snapshot than this page. Re-analyze to refresh the displayed evidence.');
          preview.value = payload.markdown;
          say(note + describe(payload));
          return payload;
        } catch (error) {
          payload = null; preview.value = '';
          say('Could not prepare task: ' + error.message + ' Re-analyze if this page shows an older result, then retry.');
          return null;
        } finally { busy = false; copy.disabled = download.disabled = !payload; refresh.disabled = false; if (quickCopy) quickCopy.disabled = false; }
      };
      box.addEventListener('toggle', function () { if (box.open && !payload && !busy) prepare(); });
      refresh.addEventListener('click', prepare);
      var copyTask = async function () {
        var p = await prepare(); if (!p || !box.isConnected) return;
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(p.markdown);
          say('Copied AI task. Paste it into your coding AI. ' + describe(p));
        } catch (error) { box.open = true; preview.focus(); preview.select(); say('Automatic copy unavailable. The task text is selected; press Ctrl+C or copy it manually. ' + describe(p)); }
      };
      copy.addEventListener('click', copyTask);
      if (quickCopy) quickCopy.addEventListener('click', copyTask);
      download.addEventListener('click', async function () {
        var p = await prepare(); if (!p || !box.isConnected) return;
        var url = URL.createObjectURL(new Blob([p.markdown], { type: 'text/markdown;charset=utf-8' }));
        var link = document.createElement('a'); link.href = url; link.download = p.task.taskId + '.md'; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        say('Download requested. ' + describe(p));
      });
    });
  }
  function showFinding(id) {
    var f = findingById[id]; if (!f) return;
    readerPage('Problem');
    root.removeAttribute('data-bauify-source');
    overview.hidden = true; panel.hidden = true;
    var e = entryById[id];
    var tone = toneOf(f.severity), lvl = LEVELS[tone];
    var scope = findingScope(f);
    setFocus(f.componentIds || []);
    var h = '<button class="close" aria-label="Close">×</button><button class="back" type="button">← Overview</button>';
    h += '<div class="k">' + esc(GROUPS[f.code] || f.code) + ' · ' + esc(scope.label) + '</div><h3><i class="bauify-' + tone + '"></i>' + esc(findingTitle(f)) + '</h3>';
    var explanation = f.code === 'coupling/hub' ? 'High incoming and outgoing coupling; inspect responsibilities before deciding to split.'
      : f.code === 'coupling/concentration' ? 'Much of the project depends on, or lives in, this one place. These are static counts with their thresholds, not proof that it must be split.'
      : f.code === 'architecture/boundary' ? 'These imports break a boundary declared in the analysis config. The rule comes from the config, not from the diagram.'
      : f.code === 'coupling/internal-leak' ? (f.evidence && f.evidence.entrySource === 'config' ? 'These imports bypass the entry files declared in the analysis config.' : 'Other modules depend on this module\'s internal files, so moving or renaming any of them breaks importers. Deep imports can be a deliberate convention; this is a signal, not a defect.')
      : f.code === 'complexity/function' ? 'Cyclomatic complexity counts independent paths through the function. A high count is a maintenance signal, not a defect.' : lvl.text;
    h += '<div class="level"><b>' + esc(lvl.name) + '</b> — ' + esc(findingWhat(f)) + '<br>' + esc(explanation) + '</div>';
    if (f.review && f.review.reason) h += '<p class="ev"><span class="badge-accepted">' + (f.review.status === 'accepted-changed' ? 'accepted · evidence changed' : f.severity === 'error' ? 'accepted · still to fix' : 'accepted') + '</span> ' + esc(f.review.reason) + (f.review.status === 'accepted-changed' ? ' — the code behind it changed since it was accepted; review it again.' : f.severity === 'error' ? ' — accepting it keeps CI from failing; the cycle is still there and stays red.' : '') + '</p>';
    h += quickHandoff(f) + '<div class="k">Code evidence</div>' + evidencePreview(f);
    h += nextStepHtml(f) + taskHtml(f);
    if ((f.componentIds || []).length) h += '<button type="button" class="locate">Locate related components</button>';
    else h += '<p class="ev">Not mapped to this diagram. Use the code evidence above.</p>';
    var pic = f.code === 'coupling/import-cycle' || f.code === 'coupling/cycle' ? cycleDiagram(scope, [f]) : f.code === 'coupling/hub' ? hubDiagram(scope, [f]) : f.code === 'architecture/boundary' ? boundaryDiagram([f]) : f.code === 'complexity/function' ? complexityDiagram([f]) : '';
    if (pic) h += '<details class="relationship"><summary>Relationships and metrics</summary>' + pic + '</details>';
    h += '<details class="more-evidence"><summary>All evidence and rule details</summary>' + findingCard(f, true) + '</details>';
    if (e && e.relatedIds.length) h += '<div class="k">Same structure, also reported as</div>' + e.relatedIds.map(function (r) { return findingRow(r); }).join('');
    detail.innerHTML = h;
    detail.hidden = false;
    codePane.hidden = true;
    detail.scrollTop = 0;
    detail.querySelector('.close').addEventListener('click', showOverview);
    detail.querySelector('.back').addEventListener('click', showOverview);
    var locate = detail.querySelector('.locate');
    if (locate) locate.addEventListener('click', function () { locateComponents(f.componentIds, true); });
    detail.querySelectorAll('[data-finding]').forEach(function (el) { el.addEventListener('click', function () { showFinding(el.getAttribute('data-finding')); }); });
    wireRefs();
    wireTasks();
    var heading = detail.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
  }
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
    var h = '<div class="k">Hub module source</div><div class="ev">' + esc(m.path || '(repository root)') +
      ' · ' + m.files + ' files · ' + m.loc + ' LOC</div>';
    if (files.length) {
      h += '<table>' + files.slice(0, 40).map(function (x) { return '<tr><td class="p">' + sourceLinks(c, x.path) + '</td><td class="n">' + x.loc + ' LOC</td><td class="n">out ' + x.importsOut + '</td><td class="n">in ' + x.importedBy + '</td></tr>'; }).join('') + '</table>';
      if (files.length > 40) h += '<div class="ev">… ' + (files.length - 40) + ' more</div>';
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
    if (!rows.length) return '<div class="ev">No measured function reaches a threshold here.</div>';
    // Per row: the function name, then one labelled bar for complexity and one for nesting.
    var W = 400, rowH = 58, H = rows.length * rowH + 8, x0 = 112, span = 270;
    var svg = svgOpen(W, H);
    rows.forEach(function (f, i) {
      var y = 6 + i * rowH, t = f.evidence.threshold || {};
      var cMax = Math.max(f.evidence.complexity, t.complexity || 1) * 1.15, nMax = Math.max(f.evidence.nesting, t.nesting || 1) * 1.15;
      var name = f.subject.function.length > 56 ? f.subject.function.slice(0, 55) + '…' : f.subject.function;
      svg += '<text x="8" y="' + (y + 11) + '">' + esc(name) + '()</text>';
      svg += '<text class="muted" x="8" y="' + (y + 29) + '">complexity ' + f.evidence.complexity + '</text>';
      svg += '<rect class="bar" x="' + x0 + '" y="' + (y + 20) + '" width="' + (span * f.evidence.complexity / cMax) + '" height="11"/>';
      svg += '<text class="muted" x="8" y="' + (y + 47) + '">nesting ' + f.evidence.nesting + '</text>';
      svg += '<rect class="bar" x="' + x0 + '" y="' + (y + 38) + '" width="' + Math.max(2, span * f.evidence.nesting / nMax) + '" height="11" opacity=".6"/>';
      if (t.complexity) svg += '<path class="e amber" d="M' + (x0 + span * t.complexity / cMax) + ',' + (y + 17) + ' L' + (x0 + span * t.complexity / cMax) + ',' + (y + 34) + '"/>';
      if (t.nesting) svg += '<path class="e amber" d="M' + (x0 + span * t.nesting / nMax) + ',' + (y + 35) + ' L' + (x0 + span * t.nesting / nMax) + ',' + (y + 52) + '"/>';
    });
    svg += '</svg>';
    return svg + '<div class="caption">Upper bar: cyclomatic complexity; lower bar: nesting depth. Amber ticks mark the thresholds of the level this finding reached; reaching either one is enough. Thresholds are configurable; function length is context only.</div>';
  }
  // One row per crossed boundary: the layer that imports, a crossed-out arrow, the layer it must not reach.
  function boundaryDiagram(fl) {
    var rows = fl.filter(function (f) { return f.subject && f.subject.boundary; });
    if (!rows.length) return '<div class="ev">No configured boundary is crossed here.</div>';
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
    return svg + '<div class="caption">Layers and rules come from the analysis config. Each arrow is a dependency the rule forbids; the cited imports are listed below. Imports between files in no declared layer are not checked.</div>';
  }
  // Ring of the files (or modules) on the shortest cycle; lazy edges dashed.
  function cycleDiagram(c, fl) {
    var f = fl.filter(function (x) { return x.code === 'coupling/import-cycle'; })[0] || fl.filter(function (x) { return x.code === 'coupling/cycle'; })[0];
    if (!f) return '<div class="ev">No cycle was found in the recorded dependencies for this component. Unresolved or unmodeled execution may add dependencies.</div>';
    var isFile = f.code === 'coupling/import-cycle';
    var nodes = (f.evidence.path || []).slice(0, 8);
    if (nodes.length === 0) return '<div class="ev">Cycle path not recorded.</div>';
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
    return svg + '<div class="caption">' + (isFile ? 'Representative file cycle.' : 'Representative package-level cycle.') + ' Runtime failure is not proven.</div><details><summary>How to read this diagram</summary><div class="caption">Solid = recorded module-scope dependency; dashed = deferred, conditional, type-only or asynchronous dependency. Green box = belongs to this component. Line numbers are in the findings below. ' +
      (f.evidence.kind === 'structural' ? 'Structural Java source dependencies. Class initialization order and runtime failure were not assessed.' : f.evidence.kind !== 'eager' ? 'This dependency component contains deferred, conditional, or type-only edges. The drawing does not prove import-time safety.' : 'Module-scope dependency cycle. Inspect execution order and binding access; a graph alone does not prove failure.') + '</div></details>';
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
    return svg + '<div class="caption">Left: modules that depend on it (fan-in ' + left.length + '). Right: modules it depends on (fan-out ' + right.length + ').' + (f ? ' Threshold ' + f.evidence.threshold.fanIn + ' / ' + f.evidence.threshold.fanOut + ' from config.' : ' Below the hub threshold.') +
      '</div><details><summary>What does high coupling mean?</summary><div class="caption">A hub is a module that is both widely depended on (fan-in) and depends widely (fan-out). Changes may affect dependents or require coordination with dependencies. This is a design signal, not a proven bug. Check whether its dependents cluster by responsibility before deciding to split.</div></details>' + (f ? hubSources(c, f) : '');
  }
  // Two bars: imports coming in vs going out, and where I = out / (in + out) lands.
  function instabilityDiagram(c) {
    var ind = c.indicators.items.filter(function (i) { return i.key === 'instability'; })[0] || {};
    var fi = ind.fanIn || 0, fo = ind.fanOut || 0;
    var W = 400, H = 110, max = Math.max(fi, fo, 1), scale = 250 / max;
    var svg = svgOpen(W, H);
    svg += '<text x="12" y="30">in ' + fi + '</text><rect class="bar" x="70" y="18" width="' + (fi * scale) + '" height="16"/>';
    svg += '<text x="12" y="62">out ' + fo + '</text><rect class="bar" x="70" y="50" width="' + (fo * scale) + '" height="16"/>';
    var I = ind.instability === undefined || ind.instability === null ? null : ind.instability;
    svg += '<text class="muted" x="70" y="92">0 stable</text><text class="muted" x="320" y="92" text-anchor="end">1 volatile</text><path class="e e" d="M70,86 L320,86"/>';
    if (I !== null) svg += '<circle cx="' + (70 + I * 250) + '" cy="86" r="5" fill="#34D399"/><text x="' + (70 + I * 250) + '" y="76" text-anchor="middle">I = ' + I + '</text>';
    svg += '</svg>';
    return svg + '<div class="caption">Fan-in / fan-out summed over the modules mapped to this component (each counts modules, not import statements). High fan-in says "change carefully"; high fan-out says "changes elsewhere reach me".</div>';
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
      renderOverview();
      showOverview();
    } else { setFocus([]); if (layer) layer.remove(); layer = null; panel.hidden = true; detail.hidden = true; codePane.hidden = true; overview.hidden = true; svg.querySelectorAll('.bauify-mapped').forEach(function (g) { g.classList.remove('bauify-mapped'); }); }
  }
  btn.addEventListener('click', function () { setOn(root.getAttribute('data-bauify') !== 'on'); });
  // The Atlas view hands a finding back here to show its source evidence.
  window.__archifyShowFinding = function (id) {
    if (!findingById[id]) return;
    if (root.getAttribute('data-bauify') !== 'on') setOn(true);
    showFinding(id);
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'c' && e.key !== 'C') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(t.tagName || '') !== -1)) return;
    btn.click();
  });
  svg.addEventListener('click', function (e) {
    if (root.getAttribute('data-bauify') !== 'on') return;
    var g = e.target.closest && e.target.closest('g[data-node-id]');
    if (!g) return;
    e.stopPropagation(); e.preventDefault();
    show(g.getAttribute('data-node-id'));
  }, true);
  window.addEventListener('resize', function () { positionReader(); if (root.getAttribute('data-bauify') === 'on') drawLayer(); });
})();
