// Mounted by the existing analysis reader; no separate page or filesystem API.
window.__archifyCreateWorkspace = function (data, pane, actions) {
  const tr = actions.tr;
  const { files, imports, outsideTargets, modules, scope, snapshot, language, revision } = data.workspace;
  const pr = data.pullRequest;
  const heads = new Map(files.map(row => [row[0], row]));
  const headModules = new Map(modules);
  const labels = new Map([...(pr?.oldModules || []), ...modules]);
  const statuses = { added: 'Added', modified: 'Modified', removed: 'Removed', renamed: 'Renamed', copied: 'Copied' };
  const prior = new Map(Object.entries(pr?.baseOwners || {}));
  const changes = (pr?.changedFiles || []).filter(row => typeof row.path === 'string');
  const findChange = new Map(changes.map(row => [row.path, row]));
  const outgoing = new Map();
  const incoming = new Map();
  const relations = new Map();
  const add = (map, key, row) => {
    if (key == null) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  for (const [from, to, line] of imports) {
    const a = files[from], b = files[to];
    const edge = { from: a[0], to: b[0], line };
    add(outgoing, a[0], edge);
    add(incoming, b[0], edge);
    add(relations, a[1], edge);
    if (a[1] !== b[1]) add(relations, b[1], edge);
  }

  const storeKey = 'archify-map-refresh:' + location.pathname + ':' + scope + ':' + (pr ? pr.repository + '#' + pr.number : 'repository');
  let mode = pr ? 'changes' : 'repository', selected = null, moduleFilter = '', statusFilter = '', text = '';
  let pageSize = 100, folders = new Set(), listing, detail, count, chooser, filter, search, tabs, notice, missing = false;
  let mounted = false;
  const basePath = row => row?.previousPath || row?.path;
  const moduleOf = path => heads.get(path)?.[1] || (mode === 'changes' ? prior.get(basePath(findChange.get(path)) || path) : null);
  const label = id => labels.get(id) || id;
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const btn = (value, fn, cls) => {
    const node = el('button', value, cls);
    node.type = 'button';
    node.addEventListener('click', fn);
    return node;
  };
  const option = (value, caption) => {
    const node = el('option', caption);
    node.value = value;
    return node;
  };
  const paragraph = text => el('p', text, 'map-note');
  const lineLabel = (path, line) => path + (line ? ':' + line : '');
  const focusKey = path => {
    let i = path.lastIndexOf('/');
    while (i > 0) { folders.add(path.slice(0, i)); i = path.lastIndexOf('/', i - 1); }
  };
  const highlights = () => {
    const value = selected;
    actions.atlas(mode, value?.kind === 'file' ? value.key : null,
      value?.kind === 'module' ? value.key : value ? moduleOf(value.key) : null);
  };

  function pick(kind, key, graph = false) {
    if (kind === 'file' && !heads.has(key) && !findChange.has(key)) return;
    if (kind === 'module' && !labels.has(key)) return;
    selected = key ? { kind, key } : null;
    missing = false;
    if (graph) {
      text = ''; search.value = '';
      statusFilter = ''; filter.value = '';
      pageSize = 100;
    }
    if (kind === 'module') {
      moduleFilter = key;
      chooser.value = key;
    }
    if (kind === 'file') {
      if (moduleFilter !== moduleOf(key) && prior.get(basePath(findChange.get(key))) !== moduleFilter) {
        moduleFilter = ''; chooser.value = '';
      }
      focusKey(key);
    }
    if (!graph) highlights();
    renderTree();
    renderDetail();
    if (graph && kind === 'file') {
      let row = listing.querySelector('[aria-current="true"]');
      if (!row && (mode === 'changes' ? findChange.has(key) : heads.has(key))) {
        // The Atlas can select a file below the rows currently rendered.
        text = key; search.value = key;
        renderTree();
        row = listing.querySelector('[aria-current="true"]');
      }
      row?.scrollIntoView({ block: 'nearest' });
    }
  }
  const isVisible = () => mounted && pane.querySelector('.map-workspace') != null && !pane.hidden;

  function switchMode(next) {
    if (mode === next) return;
    mode = next;
    statusFilter = ''; filter.value = '';
    filter.parentElement.hidden = mode !== 'changes';
    pageSize = 100;
    if (mode === 'repository' && selected && (selected.kind === 'file' ? !heads.has(selected.key) : !headModules.has(selected.key))) {
      selected = null; moduleFilter = '';
    }
    updateModuleOptions();
    updateTabs();
    renderTree();
    renderDetail();
    highlights();
  }

  function updateTabs() {
    for (const child of tabs.querySelectorAll('[data-map-mode]')) child.setAttribute('aria-pressed', String(child.dataset.mapMode === mode));
    notice.textContent = mode === 'changes'
      ? tr('PR #{number} · merge-base {base} → head {head} · scope {scope}', { number: pr.number, base: pr.baseSHA.slice(0, 8), head: pr.headSHA.slice(0, 8), scope: pr.scope })
      : tr('Captured files · scope {scope}', { scope });
  }

  function renderTree() {
    const query = text.trim().toLowerCase();
    let rows = mode === 'changes' ? changes.map(item => [item.path, item]) : files.map(item => [item[0], null]);
    rows = rows.filter(([path, change]) =>
      (!moduleFilter || moduleOf(path) === moduleFilter || prior.get(basePath(change)) === moduleFilter)
      && (!statusFilter || change?.status === statusFilter)
      && (!query || path.toLowerCase().includes(query) || change?.previousPath?.toLowerCase().includes(query)));
    count.textContent = tr('{count} matching files', { count: rows.length });

    const root = { children: new Map(), entries: [] };
    for (const [path, change] of rows) {
      const parts = path.split('/');
      const leaf = parts.pop();
      let node = root, prefix = '';
      if (!query) for (const part of parts) {
        prefix += (prefix ? '/' : '') + part;
        if (!node.children.has(part)) node.children.set(part, { path: prefix, children: new Map(), entries: [] });
        node = node.children.get(part);
      }
      node.entries.push({ path, name: query ? path : leaf, change });
    }
    const rendered = document.createDocumentFragment();
    let total = 0, limited = false;
    const append = node => { rendered.appendChild(node); total++; };
    const walk = (node, depth) => {
      for (const [name, branch] of node.children) {
        if (total >= pageSize) { limited = true; return; }
        const open = folders.has(branch.path);
        const folder = btn(name, () => {
          if (open) folders.delete(branch.path); else folders.add(branch.path);
          renderTree();
          [...listing.querySelectorAll('[data-map-folder]')].find(button => button.dataset.mapFolder === branch.path)?.focus();
        }, 'map-tree-row map-folder');
        folder.dataset.mapFolder = branch.path;
        folder.style.setProperty('--map-depth', Math.min(8, depth));
        folder.setAttribute('aria-expanded', String(open));
        append(folder);
        if (open) walk(branch, depth + 1);
      }
      for (const file of node.entries) {
        if (total >= pageSize) { limited = true; return; }
        const current = selected?.kind === 'file' && selected.key === file.path;
        const row = btn(null, () => {
          pick('file', file.path);
          listing.querySelector('[aria-current="true"]')?.focus();
        }, 'map-tree-row map-file');
        row.dataset.mapFile = file.path;
        row.style.setProperty('--map-depth', Math.min(8, depth));
        row.title = file.path;
        if (current) row.setAttribute('aria-current', 'true');
        row.append(el('span', file.name));
        const status = file.change && tr(statuses[file.change.status] || 'Other change');
        if (status) row.append(el('small', status, 'map-badge'));
        append(row);
      }
    };
    walk(root, 0);
    if (!rows.length) append(paragraph(tr('No matching files.')));
    if (limited) append(btn(tr('Show more rows'), () => { pageSize += 100; renderTree(); }, 'map-more'));
    listing.replaceChildren(rendered);
  }

  function source(path, side, line, pair) {
    const node = btn((side ? tr(side === 'base' ? 'Merge-base' : 'PR head') + ' · ' : '') + lineLabel(path, line),
      () => actions.source(path, side, line, pair, node), 'map-source-link');
    if (!actions.hasSource(path, side, line)) {
      node.disabled = true;
      node.title = tr('Source unavailable in this captured report.');
    }
    return node;
  }

  function staticEvidence(target) {
    const edges = target.kind === 'module' ? relations.get(target.key) || [] :
      [...new Set([...(outgoing.get(target.key) || []), ...(incoming.get(target.key) || [])])];
    const box = el('section', null, 'map-evidence');
    box.append(el('h4', tr('Direct captured dependencies')));
    if (!edges.length) box.append(paragraph(tr('No captured in-scope relationship for this selection.')));
    for (const edge of edges.slice(0, 30)) {
      const row = el('div', null, 'map-evidence-row');
      row.append(source(edge.from, null, edge.line), el('span', ' → ' + edge.to));
      box.append(row);
    }
    if (edges.length > 30) box.append(paragraph(tr('{count} more records omitted.', { count: edges.length - 30 })));
    if (target.kind === 'file') {
      const file = heads.get(target.key);
      const n = file && unresolvedFor.get(file[0]);
      if (n) box.append(paragraph(tr('{count} import records lack a captured in-scope target.', { count: n })));
    }
    detail.append(box);
    const anchors = new Set(target.kind === 'file' && actions.hasSource(target.key) ? [target.key] : []);
    for (const edge of edges) if (actions.hasSource(edge.from, null, edge.line)) anchors.add(lineLabel(edge.from, edge.line));
    return { section: 'Direct captured dependencies', available: edges.length,
      rows: edges.slice(0, 12).map(edge => [lineLabel(edge.from, edge.line), 'imports', edge.to]), anchors: [...anchors] };
  }
  const unresolvedFor = new Map(files.map(([path], i) => [path, outsideTargets[i]]));

  const recordFiles = record => [record.path, record.from, record.to].filter(Boolean);
  function touches(target, record) {
    if (target.kind === 'module') return record.module === target.key || record.modules?.includes(target.key)
      || (record.paths || recordFiles(record)).some(path => heads.get(path)?.[1] === target.key || prior.get(path) === target.key);
    const previous = findChange.get(target.key)?.previousPath;
    return (record.paths || recordFiles(record)).some(path => path === target.key || path === previous);
  }
  function impactName(record) {
    const labels = {
      'dependency-added': 'Observed dependency added', 'dependency-removed': 'Observed dependency removed',
      'dependency-changed': 'Observed dependency form changed', 'function-metrics': 'Function measurements',
      'known-users': 'Known direct callers', 'known-importers': 'Known file importers',
      'definition-text': 'Definition text changed', 'file-source': 'File text changed',
      'structural-finding-added': 'Newly detected structural finding', 'structural-measures': 'Existing finding: observed measures changed',
      'module-coupling': 'Module coupling measured', 'module-added': 'Observed module added',
      'module-removed': 'Observed module removed', 'definition-added': 'Captured definition added',
      'definition-removed': 'Captured definition removed',
      existing: 'Already detected in merge-base', detected: 'Detected in head only',
      'not-detected': 'No longer detected in head'
    };
    return labels[record.status || record.kind] || 'Captured static observation';
  }
  function description(record, local = tr) {
    const kindOfChange = item => item.code === 'coupling/cycle' ? local('Module cycle') :
      item.code === 'coupling/import-cycle' ? local('File cycle') : item.name || (item.module && label(item.module)) || '';
    if (record.from && record.to) return record.from + ' → ' + record.to;
    const subject = kindOfChange(record);
    if (record.kind === 'function-metrics' && record.before && record.after) {
      return subject + ' · ' + local('Complexity {before} → {after}', { before: record.before.complexity, after: record.after.complexity });
    }
    if (record.kind === 'module-coupling' && record.before && record.after) {
      return subject + ' · ' + local('Fan-in {before} → {after}; fan-out {outBefore} → {outAfter}', {
        before: record.before.fanIn, after: record.after.fanIn, outBefore: record.before.fanOut, outAfter: record.after.fanOut
      });
    }
    return subject || record.path || '';
  }

  const english = (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? '');
  function changeEvidence(target, pair) {
    const box = el('section', null, 'map-evidence');
    box.append(el('h4', tr('Structure and complexity changes')));
    if (pr.impact?.comparison?.comparable !== true) box.append(paragraph(tr('The two analyses are not fully comparable; a missing record is unknown.')));
    const cycles = (pr.cycles?.records || []).filter(record => touches(target, record));
    const cycleIds = new Set(cycles.map(record => record.id));
    const records = [...cycles, ...(pr.impact?.records || []).filter(record => touches(target, record)
      && !(record.kind === 'structural-finding-added' && cycleIds.has(record.findingId)))];
    const globalOmissions = (pr.impact?.omitted || 0) + (pr.cycles?.omitted || 0);
    if (pr.impact?.status !== 'available' || globalOmissions) {
      box.append(paragraph(tr('This comparison has limited coverage. Omitted records may affect this selection.')));
    }
    const incomplete = (pr.impact?.coverage?.skipped || []).some(entry =>
      entry.file === target.key || entry.file === findChange.get(target.key)?.previousPath ||
      (target.kind === 'module' && (heads.get(entry.file)?.[1] === target.key || prior.get(entry.file) === target.key)));
    if (incomplete) box.append(paragraph(tr('Some source or relationships for this selection were not measured.')));
    if (!records.length) box.append(paragraph(tr('No scoped structural or complexity change is recorded for this selection.')));
    const anchors = new Set();
    for (const side of ['base', 'head']) {
      if (pair?.[side] && actions.hasSource(pair[side], side)) anchors.add(side + ' ' + pair[side]);
    }
    for (const record of records.slice(0, 24)) {
      const card = el('article', null, 'map-observation');
      card.append(el('strong', tr(impactName(record))));
      const desc = description(record);
      if (desc) card.append(el('p', desc));
      for (const loc of record.locations || []) {
        if (!loc.file || (loc.side !== 'base' && loc.side !== 'head')) continue;
        card.append(source(loc.file, loc.side, loc.line));
        if (actions.hasSource(loc.file, loc.side, loc.line)) anchors.add(loc.side + ' ' + lineLabel(loc.file, loc.line));
      }
      box.append(card);
    }
    if (records.length > 24) box.append(paragraph(tr('{count} more records omitted.', { count: records.length - 24 })));
    box.append(paragraph(tr('Captured direct references do not establish runtime or transitive impact.')));
    detail.append(box);
    return { section: 'Observed PR changes and known references', available: records.length + globalOmissions,
      rows: records.slice(0, 12).map(record => [impactName(record), description(record, english)].filter(Boolean)),
      anchors: [...anchors], limited: incomplete || globalOmissions > 0 };
  }

  function sourcePair(key) {
    const change = findChange.get(key);
    return { base: change?.status === 'added' ? null : basePath(change) || key,
      head: change?.status === 'removed' ? null : key };
  }

  function renderDetail() {
    detail.replaceChildren();
    if (!selected) {
      detail.append(paragraph(tr(missing ? 'The previous selection is not in this capture.' : 'Choose a file or module to inspect.')));
      return;
    }
    const { kind, key } = selected;
    detail.append(el('h3', kind === 'file' ? key : label(key)));
    let pair, contextState;
    if (kind === 'file') {
      const file = heads.get(key), change = mode === 'changes' ? findChange.get(key) : null;
      const annotations = { 'parse-error': 'Could not parse', excluded: 'Excluded by role', unmapped: 'Not in the captured module graph' };
      if (file && file[2] !== 'analyzed') detail.append(paragraph(tr(annotations[file[2]])));
      if (!file && !prior.has(basePath(change) || key)) detail.append(paragraph(tr('Not analyzed in the captured scope.')));
      if (moduleOf(key)) detail.append(btn(tr('View module') + ' · ' + label(moduleOf(key)), () => pick('module', moduleOf(key)), 'map-action'));
      if (!file || file[2] !== 'analyzed') detail.append(paragraph(tr('This file has no selectable Atlas node.')));
      const buttons = el('div', null, 'map-actions');
      pair = sourcePair(key);
      if (mode === 'changes') {
        if (change) {
          const status = change.scopeBoundary ? (change.scopeBoundary === 'entered' ? 'Moved into this scope' : 'Moved out of this scope') :
            statuses[change.status] || 'Other change';
          contextState = { status, before: change.previousPath, after: key };
          detail.append(paragraph(tr(status) + (change.previousPath ? ' · ' + change.previousPath + ' → ' + key : '')));
        } else detail.append(paragraph(tr('This file is not in the captured changed-file list.')));
        if (change?.status !== 'added') buttons.append(source(pair.base, 'base', null, pair));
        if (change?.status !== 'removed') buttons.append(source(key, 'head', null, pair));
      } else buttons.append(source(key, null, null));
      detail.append(buttons);
    }
    const section = mode === 'changes' ? changeEvidence(selected, pair) : staticEvidence(selected);
    renderExport(section, contextState);
  }

  function renderExport(section, contextState) {
    const isPR = mode === 'changes';
    const box = el('details', null, 'map-export');
    box.append(el('summary', tr('Agent context')));
    const captured = window.__archifyFormatWorkspaceContext({
      ...section, target: { kind: selected.kind, path: selected.key, state: contextState },
      capture: { scope: isPR ? pr.scope : scope, snapshot, language, revision, ...(isPR
        ? { pr: pr.repository + '#' + pr.number, base: pr.baseSHA, head: pr.headSHA } : {}),
        note: isPR && (section.limited || pr.impact?.status !== 'available' || pr.impact?.comparison?.comparable !== true)
          ? 'Coverage limited or incomparable; missing change evidence is unknown.' : null }
    });
    const status = paragraph('');
    status.setAttribute('role', 'status');
    const preview = el('textarea');
    preview.readOnly = true;
    preview.value = captured;
    preview.setAttribute('aria-label', tr('Captured Agent context'));
    const row = el('div', null, 'map-actions');
    row.append(btn(tr('Copy context'), () => actions.copy(captured, status, preview, tr('Copied context.'), box)));
    const slug = selected.key.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 72).replace(/^[-.]+|[-.]+$/g, '') || 'selection';
    const selectKind = selected.kind;
    row.append(btn(tr('Download .md'), () => {
      try {
        const url = URL.createObjectURL(new Blob([captured], { type: 'text/markdown;charset=utf-8' }));
        const link = el('a');
        link.href = url;
        link.download = 'MAP-' + mode + '-' + selectKind + '-' + slug + '.md';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        status.textContent = tr('Download requested.');
      } catch (error) { status.textContent = tr('Could not request the download. Copy the context instead.'); }
    }));
    box.append(row, preview, status);
    detail.append(box);
  }

  function updateModuleOptions() {
    const options = [option('', tr('All modules'))];
    for (const [id, name] of mode === 'changes' ? labels : headModules) options.push(option(id, name));
    chooser.replaceChildren(...options);
    chooser.value = moduleFilter;
  }

  function mount(focus = true) {
    if (isVisible()) return;
    pane.replaceChildren();
    const view = el('div', null, 'map-workspace');
    const top = el('header', null, 'map-workspace-head');
    top.append(btn('← ' + tr('Overview'), actions.overview, 'back map-action'), el('h3', tr('Map workspace')));
    if (actions.canRefresh()) {
      const refresh = btn(tr('Re-analyze'), async () => {
        refresh.disabled = true;
        refresh.textContent = tr('Analyzing…');
        try {
          try { sessionStorage.setItem(storeKey, JSON.stringify({ selected, mode })); } catch (error) { /* optional */ }
          await actions.refresh();
        } catch (error) {
          try { sessionStorage.removeItem(storeKey); } catch (ignored) { /* optional */ }
          refresh.disabled = false;
          refresh.textContent = tr('Re-analyze');
          notice.textContent = tr('Re-analysis failed: ') + error.message + tr(' The result shown is from the last successful run.');
        }
      }, 'map-action map-refresh');
      top.append(refresh);
    }
    tabs = el('div', null, 'map-tabs');
    if (pr) for (const next of ['repository', 'changes']) {
      const item = btn(tr(next === 'changes' ? 'Changes' : 'Repository'), () => switchMode(next));
      item.dataset.mapMode = next;
      tabs.append(item);
    }
    notice = paragraph('');
    notice.setAttribute('role', 'status');
    const controls = el('div', null, 'map-controls');
    const wrap = (title, input) => {
      const tag = el('label');
      tag.append(el('span', tr(title)), input);
      return tag;
    };
    search = el('input'); search.type = 'search'; search.value = text;
    search.addEventListener('input', () => { text = search.value; pageSize = 100; renderTree(); });
    chooser = el('select');
    updateModuleOptions();
    chooser.addEventListener('change', () => {
      pageSize = 100;
      if (chooser.value) pick('module', chooser.value);
      else { moduleFilter = ''; selected = null; highlights(); renderTree(); renderDetail(); }
    });
    filter = el('select');
    filter.append(option('', tr('All changes')));
    for (const [value, title] of Object.entries(statuses)) filter.append(option(value, tr(title)));
    filter.value = statusFilter;
    filter.addEventListener('change', () => { statusFilter = filter.value; pageSize = 100; renderTree(); });
    const statusControl = wrap('Change status', filter);
    statusControl.hidden = mode !== 'changes';
    controls.append(wrap('Search files', search), wrap('Module', chooser), statusControl);
    count = paragraph('');
    count.setAttribute('aria-live', 'polite');
    listing = el('div', null, 'map-tree');
    listing.setAttribute('role', 'group');
    listing.setAttribute('aria-label', tr('File tree'));
    detail = el('div', null, 'map-selection');
    view.append(top, tabs, notice, controls, count, listing, detail);
    pane.append(view);
    pane.hidden = false;
    mounted = true;
    updateTabs();
    renderTree();
    renderDetail();
    if (focus) search.focus({ preventScroll: true });
  }

  return {
    mount, isVisible,
    selectModule: key => pick('module', key),
    fromAtlas: (kind, key) => pick(kind, key, true),
    clearGraphFocus: () => { selected = null; moduleFilter = ''; chooser.value = ''; renderTree(); renderDetail(); },
    focusAtlas: highlights,
    openAtlasSource: (file, line, side) => {
      const change = findChange.get(file) || changes.find(row => row.previousPath === file);
      if (!change || !actions.hasSource(file, side, line)) return false;
      pick('file', change.path, true);
      actions.source(file, side, line, sourcePair(change.path), listing.querySelector('[aria-current="true"]'));
      return true;
    },
    restore: () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storeKey));
        sessionStorage.removeItem(storeKey);
        if (!saved) return false;
        mode = saved.mode === 'changes' && pr ? 'changes' : 'repository';
        const value = saved.selected;
        if (value?.kind === 'file' && (heads.has(value.key) || (mode === 'changes' && findChange.has(value.key)))) {
          selected = value; focusKey(value.key);
        } else if (value?.kind === 'module' && (mode === 'changes' ? labels : headModules).has(value.key)) {
          selected = value; moduleFilter = value.key;
        } else { selected = null; missing = !!value; }
        return true;
      } catch (error) { return false; }
    }
  };
};
