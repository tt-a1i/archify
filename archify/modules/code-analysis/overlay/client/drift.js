(function () {
  'use strict';
  const embedded = document.getElementById('architecture-drift-data');
  const toolbar = document.querySelector('.toolbar');
  const diagram = document.querySelector('.diagram-container');
  const svg = diagram?.querySelector('g[data-node-id]')?.ownerSVGElement;
  if (!embedded || !toolbar || !diagram || !svg) return;
  const data = JSON.parse(embedded.textContent);
  const zh = data.locale === 'zh-CN';
  const tr = (en, cn) => zh ? cn : en;
  const labels = {
    'new-undeclared': tr('New, not declared', '新增，图上未声明'),
    'new-declared': tr('New, already declared', '新增，图上已声明'),
    'previously-observed': tr('Previously observed', '此前已观测'),
    'not-observed-at-head': tr('Not observed at head', '当前版本未观测到'),
    inconclusive: tr('Inconclusive', '无法判断'),
  };
  const reasons = {
    'adapter-changed': tr('Analyzer changed', '分析器变化'),
    'unverified-edge-evidence': tr('Edge evidence could not be verified', '关系证据无法核验'),
    'ambiguous-ownership': tr('Component ownership is ambiguous', '组件归属不唯一'),
    'component-not-mapped-on-both-sides': tr('Component is not mapped on both sides', '组件未同时映射到两个版本'),
    'unresolved-imports-changed': tr('Unresolved imports differ', '未解析导入有变化'),
    'resolution-inputs-changed': tr('Compiler or package resolution inputs changed', '编译或包解析输入有变化'),
    'affected-parse-errors': tr('A relevant source file failed to parse', '相关源文件解析失败'),
    'skipped-tree-entries-changed': tr('Skipped symlink or submodule entries changed', '被跳过的符号链接或子模块有变化'),
  };
  const filename = 'architecture-drift.md';
  const title = tr('Architecture drift', '架构漂移');
  const ns = 'http://www.w3.org/2000/svg';
  const name = new Map(data.components.map(c => [c.id, c.label]));
  const node = new Map(Array.from(svg.querySelectorAll('g[data-node-id]'), g => [g.dataset.nodeId, g]));
  const counts = side => {
    const c = data.coverage[side];
    const unresolved = (c.unresolvedImports?.unknown || 0) + (c.unresolvedImports?.opaque || 0) + (c.unresolvedImports?.outside || 0);
    return tr(
      c.files + ' files · ' + c.mappedComponents + ' mapped components · ' + c.unmappedModules + ' unmapped modules · ' +
        c.ambiguousModules + ' ambiguous · ' + c.scopedParseErrors + ' scoped parse errors · ' + unresolved + ' unresolved · ' + c.skippedLinks + ' skipped links',
      c.files + ' 个文件 · ' + c.mappedComponents + ' 个组件已映射 · ' + c.unmappedModules + ' 个模块未映射 · ' +
        c.ambiguousModules + ' 个归属不明 · ' + c.scopedParseErrors + ' 个范围内解析失败 · ' + unresolved + ' 个未解析 · ' + c.skippedLinks + ' 个跳过的链接'
    );
  };
  const limit = tr('Only static value imports between mapped components. This is not a runtime or whole-repository assessment.',
    '仅检查已映射组件之间的静态值导入。结论不代表运行时行为或全仓库覆盖。');
  const sideName = side => side === 'base' ? tr('Base', '基线') : tr('Head', '当前版本');
  const pairLabel = edge => name.get(edge.from) + ' → ' + name.get(edge.to);
  const sorted = [...data.edges].sort((a, b) => Object.keys(labels).indexOf(a.state) - Object.keys(labels).indexOf(b.state));
  const filterDefault = sorted.some(e => e.state !== 'previously-observed') ? 'changes' : 'all';

  function element(tag, text, className) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }
  function button(text, handler) {
    const b = element('button', text);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  }

  const panel = element('aside');
  panel.id = 'architecture-drift-panel';
  panel.hidden = true;
  panel.lang = data.locale;
  panel.setAttribute('aria-label', title);
  const toggle = button(title, () => setOpen(panel.hidden));
  toggle.id = 'architecture-drift-toggle';
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'false');
  toolbar.append(toggle);
  const bar = element('header');
  const heading = element('h2', title);
  heading.tabIndex = -1;
  const close = button(tr('Close', '关闭'), () => setOpen(false));
  bar.append(heading, close);
  const summary = element('p', tr(data.summary.newUndeclared + ' new undeclared · ' + data.summary.inconclusive + ' inconclusive',
    data.summary.newUndeclared + ' 条新增且未声明 · ' + data.summary.inconclusive + ' 条无法判断'), 'drift-summary');
  const coverage = element('details');
  coverage.append(element('summary', tr('Pins and coverage', '版本与覆盖范围')));
  for (const side of ['base', 'head']) {
    coverage.append(element('p', sideName(side) + ': ' + counts(side)), element('code', data.pins[side], 'drift-pin'));
  }
  coverage.append(element('p', limit));
  const detail = element('section');
  detail.setAttribute('aria-live', 'polite');
  const choice = element('select');
  choice.id = 'architecture-drift-filter';
  const choiceLabel = element('label', tr('Show relationships', '显示关系'));
  choiceLabel.htmlFor = choice.id;
  for (const [value, label] of [['changes', tr('Changes and inconclusive', '变动与无法判断')], ['all', tr('All observed pairs', '所有已观测关系')], ...Object.entries(labels)]) {
    const option = element('option', label);
    option.value = value;
    choice.append(option);
  }
  choice.value = filterDefault;
  choice.addEventListener('change', renderList);
  const list = element('ul');
  const browse = element('section');
  browse.append(choiceLabel, choice, list);
  panel.append(bar, summary, coverage, detail, browse);
  diagram.after(panel);
  diagram.parentElement.classList.add('architecture-drift-layout');
  const overlay = document.createElementNS(ns, 'svg');
  overlay.setAttribute('class', 'drift-geometry');
  overlay.setAttribute('aria-hidden', 'true');

  let active = null;
  let sourceReturn = null;
  let previousButton = null;
  function setOpen(open) {
    panel.hidden = !open;
    diagram.parentElement.classList.toggle('architecture-drift-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      heading.focus({ preventScroll: true });
      if (active) requestAnimationFrame(() => { if (!panel.hidden) highlight(active); });
    } else {
      clearHighlight();
      toggle.focus({ preventScroll: true });
    }
  }
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (sourceReturn && active) { showEdge(active); detail.querySelector('[data-drift-location="' + sourceReturn + '"]')?.focus(); sourceReturn = null; }
    else setOpen(false);
  });
  function clearHighlight() {
    overlay.remove();

  }
  function box(g) {
    const form = g.querySelector('rect') || g;
    const r = form.getBoundingClientRect(), area = diagram.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left - area.left - diagram.clientLeft + diagram.scrollLeft + r.width / 2,
      y: r.top - area.top - diagram.clientTop + diagram.scrollTop + r.height / 2, w: r.width / 2, h: r.height / 2 };
  }
  function anchor(a, b, gap) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.min(dx ? (a.w + gap) / Math.abs(dx) : Infinity, dy ? (a.h + gap) / Math.abs(dy) : Infinity);
    return { x: a.x + dx * d, y: a.y + dy * d };
  }
  function highlight(edge) {
    clearHighlight();
    const a = node.get(edge.from), b = node.get(edge.to);
    if (!a || !b) return;

    const p = box(a), q = box(b);
    if (!p || !q || (p.x === q.x && p.y === q.y)) return;
    const start = anchor(p, q, 4), end = anchor(q, p, 9);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const wing = turn => [end.x - 10 * Math.cos(angle + turn), end.y - 10 * Math.sin(angle + turn)];
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M ' + start.x + ' ' + start.y + ' L ' + end.x + ' ' + end.y +
      ' M ' + wing(.52).join(' ') + ' L ' + end.x + ' ' + end.y + ' L ' + wing(-.52).join(' '));
    const endpoint = (bounds, id) => {
      const rect = document.createElementNS(ns, 'rect');
      const box = { x: bounds.x - bounds.w - 1, y: bounds.y - bounds.h - 1, width: bounds.w * 2 + 2, height: bounds.h * 2 + 2, rx: 8 };
      for (const [key, val] of Object.entries(box)) rect.setAttribute(key, val);
      rect.dataset.driftEndpoint = id;
      return rect;
    };
    overlay.replaceChildren(path, endpoint(p, edge.from), endpoint(q, edge.to));
    overlay.classList.toggle('drift-confirmed', edge.declared);
    overlay.dataset.state = edge.state;
    // The diagram exporter clones only the authored SVG, not this sibling.
    diagram.append(overlay);
  }
  function renderList() {
    list.replaceChildren();
    const visible = sorted.filter(e => choice.value === 'all' || (choice.value === 'changes' ? e.state !== 'previously-observed' : e.state === choice.value));
    for (const edge of visible) {
      const li = element('li');
      const b = button(pairLabel(edge) + ' · ' + labels[edge.state], () => {
        previousButton = b;
        sourceReturn = null;
        showEdge(edge);
        detail.querySelector('h3').focus();
        detail.scrollIntoView({ block: 'nearest' });
      });
      b.dataset.driftPair = edge.from + ':' + edge.to;
      b.setAttribute('aria-pressed', String(active === edge));
      li.append(b);
      list.append(li);
    }
    if (!list.children.length) list.append(element('li', tr('No relationships in this view.', '此筛选下没有关系。')));
  }
  function selectTitle(edge) {
    const h = element('h3', pairLabel(edge));
    h.tabIndex = -1;
    return h;
  }
  function showEdge(edge) {
    active = edge;
    highlight(edge);
    Array.from(list.querySelectorAll('button'), b => b.setAttribute('aria-pressed', String(b.dataset.driftPair === edge.from + ':' + edge.to)));
    const dismiss = button(tr('Clear selection', '清除选择'), () => {
      detail.replaceChildren();
      active = null;
      clearHighlight();
      renderList();
      const id = previousButton?.dataset.driftPair;
      (Array.from(list.querySelectorAll('button')).find(b => b.dataset.driftPair === id) || choice).focus();
      previousButton = null;
    });
    detail.replaceChildren(selectTitle(edge), element('p', labels[edge.state] + ' · ' + edge.base.count + ' → ' + edge.head.count), dismiss);
    if (edge.reasons.length) detail.append(element('p', edge.reasons.map(r => reasons[r] || r).join(' · ')));
    for (const side of ['base', 'head']) {
      const locations = edge[side].locations;
      if (!locations.length) continue;
      const group = element('section');
      group.append(element('h4', sideName(side)));
      for (const [i, loc] of locations.entries()) {
        const b = button(loc.path + ':' + loc.line, () => showSource(edge, side, loc, side + '-' + i));
        b.dataset.driftLocation = side + '-' + i;
        group.append(b);
      }
      if (edge[side].count > locations.length) group.append(element('p', tr('Showing first ', '仅显示前 ') + locations.length));
      detail.append(group);
    }
    detail.append(button(tr('Download .md', '下载 .md'), () => download(edge)));
  }
  function showSource(edge, side, loc, reference) {
    sourceReturn = reference;
    const back = button(tr('Back to relationship', '返回关系'), () => {
      showEdge(edge);
      detail.querySelector('[data-drift-location="' + reference + '"]')?.focus();
      sourceReturn = null;
    });
    detail.replaceChildren(selectTitle(edge), back,
      element('p', sideName(side) + ' · ' + loc.path + ':' + loc.line, 'drift-location'),
      element('code', data.pins[side], 'drift-pin'),
      element('pre', loc.line + '  ' + loc.text), element('p', tr('Resolves to: ', '解析到：') + loc.target));
    back.focus();
  }
  function literal(text) {
    return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/[&<>\\\x60*_[\]{}()#!|~]/gu, c => '&#' + c.codePointAt(0) + ';');
  }
  function download(edge) {
    const out = ['# ' + title, '', '## ' + literal(pairLabel(edge)), '', labels[edge.state],
      '', '- ' + sideName('base') + ': ' + data.pins.base, '- ' + sideName('head') + ': ' + data.pins.head,
      '- ' + tr('Observed sites', '观测到的导入位置数') + ': ' + edge.base.count + ' → ' + edge.head.count,
      '- ' + tr('Authored IR SHA-256', '架构 IR SHA-256') + ': ' + data.inputs.irSha256,
      '- ' + tr('Mapping SHA-256', '映射 SHA-256') + ': ' + data.inputs.mapSha256,
      '- ' + tr('Effective config SHA-256', '配置 SHA-256') + ': ' + data.inputs.configSha256,
      '- ' + tr('Analyzer', '分析器') + ': ' + data.inputs.analyzer + ' / ' + data.inputs.adapterRevision, '', limit];
    if (edge.reasons.length) out.push('', edge.reasons.map(r => reasons[r] || r).join(' · '));
    for (const side of ['base', 'head']) {
      out.push('', '### ' + sideName(side), '', counts(side));
      for (const loc of edge[side].locations) out.push('- ' + literal(loc.path) + ':' + loc.line + ' → ' + literal(loc.target));
      if (edge[side].count > edge[side].locations.length) out.push(tr('Evidence list truncated.', '证据列表已截断。'));
    }
    const url = URL.createObjectURL(new Blob([out.join('\n') + '\n'], { type: 'text/markdown;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = filename;
    panel.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  renderList();
  let scheduled = false;
  const scheduleHighlight = () => {
    if (!active || panel.hidden || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (active && !panel.hidden) highlight(active);
    });
  };
  new ResizeObserver(scheduleHighlight).observe(diagram);
  new MutationObserver(scheduleHighlight).observe(svg, { attributeFilter: ['style', 'viewBox'] });
  diagram.addEventListener('scroll', scheduleHighlight, { passive: true });
})();
