// Serialized into the Atlas shell. The directory is created once in the host;
// members provide measured slots, never a second copy of these controls.
export function installAtlasWorkbench({ bundle, navigate, onLayoutChange = () => {} }) {
  const doc = document;
  const zh = bundle.meta.locale === 'zh-CN';
  const records = new Map();
  const links = new Map();
  let current = null;
  let open = false;
  let queued = 0;
  function element(tag, className, parent, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  const style = element('style', '', doc.head);
  style.textContent = `
#atlas-workbench{position:fixed;inset:0;z-index:20;pointer-events:none;color:var(--atlas-host-text,#e2e8f0);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--atlas-host-muted:#94a3b8;--atlas-host-action:#22d3ee;--atlas-host-border:#334155;--atlas-host-panel:#111827;--atlas-host-bg:#0d1117}
html[data-theme=light] #atlas-workbench{--atlas-host-text:#0f172a;--atlas-host-muted:#64748b;--atlas-host-action:#0e7490;--atlas-host-border:#cbd5e1;--atlas-host-panel:#fff;--atlas-host-bg:#f8fafc}
#atlas-workbench *{box-sizing:border-box}
#atlas-workbench .atlas-host-brand{position:absolute;display:flex;align-items:baseline;gap:10px;padding:0 12px 20px;overflow-wrap:anywhere;pointer-events:auto}
#atlas-workbench .atlas-host-brand strong{font:600 20px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.02em}
#atlas-workbench .atlas-host-brand span{font-size:11px;color:var(--atlas-host-muted);flex:none}
#atlas-workbench .atlas-host-directory-section{position:absolute;display:flex;flex-direction:column;min-height:0;pointer-events:auto;background:var(--atlas-host-bg)}
#atlas-workbench button{cursor:pointer}
#atlas-workbench .atlas-directory-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:36px;padding:6px 12px;border:0;border-radius:6px;background:none;color:var(--atlas-host-muted);text-align:left;font:500 13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;flex:none}
#atlas-workbench .atlas-directory-toggle::after{content:'›';font-size:18px;line-height:1}
#atlas-workbench .atlas-directory-toggle[aria-expanded=true]::after{content:'×'}
#atlas-workbench .atlas-directory{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;padding:12px 0;overscroll-behavior:contain}
#atlas-workbench .atlas-directory-search{display:block;width:calc(100% - 24px);min-height:36px;margin:0 12px 12px;padding:7px 10px;border:1px solid var(--atlas-host-border);border-radius:6px;background:var(--atlas-host-panel);color:inherit;font:inherit}
#atlas-workbench .atlas-directory-search::placeholder{color:var(--atlas-host-muted)}
#atlas-workbench ul{list-style:none;padding:0;margin:0}#atlas-workbench ul ul{padding-left:12px;margin-left:12px}
#atlas-workbench .atlas-directory-link{display:block;position:relative;width:100%;min-height:36px;padding:8px 12px;text-align:left;border:0;border-radius:6px;background:none;color:var(--atlas-host-muted);font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}
#atlas-workbench .atlas-directory-link:hover,#atlas-workbench .atlas-directory-link[aria-current=page],#atlas-workbench .atlas-directory-toggle:hover{background:color-mix(in srgb,var(--atlas-host-action) 8%,transparent);color:var(--atlas-host-text,#e2e8f0)}
#atlas-workbench .atlas-directory-link[aria-current=page]{font-weight:600}
#atlas-workbench .atlas-directory-link[aria-current=page]::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:2px;background:var(--atlas-host-action)}
#atlas-workbench .atlas-directory-empty{padding:0 12px;color:var(--atlas-host-muted);font-size:13px}
#atlas-workbench .atlas-host-status{position:absolute;left:12px;right:12px;top:100%;margin:0;padding:5px 8px;background:var(--atlas-host-bg);border-radius:4px;color:var(--atlas-host-action);font-size:12px;pointer-events:none;overflow-wrap:anywhere}
#atlas-workbench[data-layout=rail] .atlas-host-status{top:auto;bottom:0}
#atlas-workbench[data-layout=stacked] .atlas-directory-toggle{padding-left:0;max-width:20rem}
#atlas-workbench[data-layout=stacked] .atlas-directory{max-height:300px}
#atlas-workbench [hidden],#atlas-workbench .atlas-host-status:empty{display:none}
#atlas-workbench button:focus-visible,#atlas-workbench input:focus-visible{outline:2px solid var(--atlas-host-action);outline-offset:3px}
#atlas-workbench[data-preset=blueprint] .atlas-directory-link{border-radius:2px}
@media(max-width:720px){#atlas-workbench .atlas-directory-toggle,#atlas-workbench .atlas-directory-link{min-height:44px}}
@media print{#atlas-workbench{display:none!important}}
`;
  const root = element('div', '', doc.body);
  root.id = 'atlas-workbench';
  const brand = element('div', 'atlas-host-brand', root);
  element('strong', '', brand, bundle.members[bundle.entry].title);
  element('span', '', brand, zh ? '架构图集' : 'Architecture atlas');
  const section = element('section', 'atlas-host-directory-section', root);
  const toggle = element('button', 'atlas-directory-toggle', section, zh ? '架构目录' : 'Architecture directory');
  toggle.type = 'button'; toggle.id = 'atlas-directory-toggle';
  toggle.setAttribute('aria-controls', 'atlas-directory');
  const directory = element('nav', 'atlas-directory', section);
  directory.id = 'atlas-directory';
  directory.setAttribute('aria-label', zh ? '架构目录' : 'Architecture directory');
  const search = element('input', 'atlas-directory-search', directory);
  search.id = 'atlas-directory-search'; search.type = 'search'; search.autocomplete = 'off';
  search.placeholder = zh ? '查找架构图' : 'Find a diagram';
  search.setAttribute('aria-label', zh ? '按名称筛选架构图' : 'Filter architecture diagrams by name');
  function tree(id, list) {
    const item = element('li', '', list);
    const link = element('button', 'atlas-directory-link', item, bundle.members[id].title);
    link.type = 'button'; link.dataset.atlasDiagram = id;
    link.addEventListener('click', () => navigate(id));
    links.set(id, link);
    const entry = { id, item, children: [] };
    const children = bundle.details.filter(detail => detail.from.diagram === id);
    if (children.length) {
      const nested = element('ul', '', item);
      for (const child of children) entry.children.push(tree(child.to, nested));
    }
    return entry;
  }
  const treeRoot = tree(bundle.entry, element('ul', '', directory));
  const empty = element('p', 'atlas-directory-empty', directory, zh ? '没有匹配的架构图' : 'No matching diagrams.');
  empty.hidden = true;
  const status = element('p', 'atlas-host-status', section);
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    function match(entry) {
      const descendants = entry.children.map(match).some(Boolean);
      const visible = !query || bundle.members[entry.id].title.toLocaleLowerCase().includes(query) || descendants;
      entry.item.hidden = !visible;
      return visible;
    }
    empty.hidden = match(treeRoot);
    updateSlots(true); schedule();
  }
  function bounds(node, rect, offset = { left: 0, top: 0 }) {
    node.style.left = `${rect.left + offset.left}px`;
    node.style.top = `${rect.top + offset.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }
  function updateSlot(record) {
    const mode = record.doc.documentElement.getAttribute('data-atlas-layout');
    // scrollHeight includes the host's allocated viewport, so using it here
    // would feed a committed member's dimensions into its candidate and back.
    // A fixed compact reading area keeps filtering/current-item styling and
    // rail-to-compact commits independent of member layout.
    const height = mode === 'rail' ? '' : `${(record.win.innerWidth <= 720 ? 44 : 36) + (open ? 300 : 0)}px`;
    if (record.slot.style.height !== height) {
      record.slot.style.height = height;
      record.win.Archify?.readerLayout?.schedule();
      return true;
    }
    return false;
  }
  function updateSlots(notify = false) {
    let candidateChanged = false;
    for (const record of records.values()) {
      const changed = updateSlot(record);
      if (changed && record.state !== current) candidateChanged = true;
    }
    if (notify && candidateChanged) onLayoutChange();
  }
  function sync() {
    queued = 0;
    const record = current && records.get(current.frame);
    if (!record) {
      root.dataset.layout = 'rail'; brand.hidden = false; section.hidden = false;
      bounds(brand, { left: 16, top: 24, width: 280, height: 48 });
      bounds(section, { left: 16, top: 100, width: 280, height: open ? Math.max(36, window.innerHeight - 124) : 36 });
      return;
    }
    const html = record.doc.documentElement;
    const hidden = html.getAttribute('data-embed') === 'true';
    const mode = html.getAttribute('data-atlas-layout') || 'stacked';
    root.dataset.layout = mode;
    root.dataset.preset = html.getAttribute('data-preset') || '';
    brand.hidden = hidden || mode !== 'rail'; section.hidden = hidden;
    const computed = record.win.getComputedStyle(html);
    for (const [name, source] of Object.entries({ text: '--text', muted: '--text-muted', action: '--atlas-action', border: '--toolbar-border', panel: '--panel', bg: '--bg' })) {
      const value = computed.getPropertyValue(source).trim();
      if (value) root.style.setProperty(`--atlas-host-${name}`, value);
    }
    updateSlot(record);
    const offset = current.frame.getBoundingClientRect();
    if (!brand.hidden) bounds(brand, record.brand.getBoundingClientRect(), offset);
    if (!section.hidden) bounds(section, record.slot.getBoundingClientRect(), offset);
  }
  function schedule() { if (!queued) queued = requestAnimationFrame(sync); }
  function attach(state) {
    if (records.has(state.frame)) return;
    const memberDoc = state.frame.contentDocument;
    const memberWindow = state.frame.contentWindow;
    const record = { state, doc: memberDoc, win: memberWindow, slot: memberDoc.querySelector('.atlas-directory-section'), brand: memberDoc.querySelector('.atlas-rail-brand') };
    records.set(state.frame, record);
    state.navigation?.setDirectoryOpen(open);
    record.change = () => { updateSlot(record); if (current === state) schedule(); };
    record.mutations = new memberWindow.MutationObserver(record.change);
    record.mutations.observe(memberDoc.documentElement, { attributes: true, attributeFilter: ['data-atlas-layout', 'data-present', 'data-embed', 'data-theme', 'data-preset'] });
    if (typeof memberWindow.ResizeObserver === 'function') {
      record.sizes = new memberWindow.ResizeObserver(record.change);
      record.sizes.observe(record.slot); record.sizes.observe(record.brand);
    }
    memberWindow.addEventListener('scroll', record.change, { passive: true });
    memberWindow.addEventListener('resize', record.change, { passive: true });
    updateSlot(record);
  }
  function detach(state) {
    const frame = state?.frame || state;
    const record = records.get(frame);
    if (!record) return;
    record.mutations.disconnect(); record.sizes?.disconnect();
    record.win.removeEventListener('scroll', record.change);
    record.win.removeEventListener('resize', record.change);
    records.delete(frame);
  }
  function openDirectory(value) {
    open = Boolean(value);
    directory.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    for (const record of records.values()) record.state.navigation?.setDirectoryOpen(open);
    updateSlots(true); sync();
  }
  toggle.addEventListener('click', () => {
    openDirectory(!open);
    if (open) search.focus({ preventScroll: true });
  });
  search.addEventListener('input', filter);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !open) return;
    event.preventDefault(); event.stopPropagation(); openDirectory(false); toggle.focus({ preventScroll: true });
  });
  window.addEventListener('resize', schedule, { passive: true });
  openDirectory(false);
  return {
    attach, detach, sync, openDirectory,
    commit(state) {
      current = state;
      for (const [id, link] of links) {
        if (state?.diagram === id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      sync();
    },
    setStatus(text) { status.textContent = text || ''; },
    hasFocus() { return root.contains(doc.activeElement); },
    canRestoreFocus(frame) { return !doc.activeElement || doc.activeElement === doc.body || doc.activeElement === doc.documentElement || doc.activeElement === frame; },
    dispose() {
      for (const frame of Array.from(records.keys())) detach(frame);
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener('resize', schedule); root.remove(); style.remove();
    }
  };
}
