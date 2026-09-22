// Installed before member initialization. The shell owns visits; readerLayout
// places this single directory/inspector rail outside the graph reading area.
export function installAtlasNavigation({ bundle, diagram, frame, navigate, back, hasPrevious, directoryOpen, setDirectoryOpen, onStateChange, workbench }) {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const zh = bundle.meta.locale === 'zh-CN';
  const member = bundle.members[diagram];
  const parents = new Map(bundle.details.map(item => [item.to, item.from]));
  function element(tag, className, parent, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  function button(text, parent, callback, className = '') {
    const node = element('button', className, parent, text);
    node.type = 'button'; node.addEventListener('click', callback);
    return node;
  }
  const style = element('style', '', doc.head);
  style.textContent = `
html[data-atlas-member]{--atlas-action:var(--frontend-stroke)}
html[data-atlas-member][data-theme=light]{--atlas-action:#0e7490}
html[data-atlas-member] .header{min-height:3rem}
html[data-atlas-member] .header-row{gap:.65rem}
html[data-atlas-member] .header,html[data-atlas-member] .toolbar,html[data-atlas-member] .guided-views{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
html[data-atlas-member] .header h1{font-weight:600;letter-spacing:-.025em}
html[data-atlas-member] .diagram-container{border-color:transparent;border-radius:0;background:none;box-shadow:none}
html[data-atlas-member] .guided-views{border-color:transparent;border-radius:0;background:none;box-shadow:none;backdrop-filter:none}
.atlas-navigation{display:flex;gap:.4rem;flex:none}
.atlas-heading{min-width:0}.atlas-heading h1{overflow-wrap:anywhere}
.atlas-navigation button,.atlas-breadcrumb button,.atlas-directory-section button,.atlas-parent-context button{font:inherit;cursor:pointer}
.atlas-navigation button{min-height:2rem;padding:.35rem .55rem;border:0;border-radius:.4rem;background:none;color:var(--text-muted);font-size:.85rem}
.atlas-navigation button:hover{background:var(--toolbar-hover);color:var(--text)}
.atlas-breadcrumb{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;font-size:12px;color:var(--text-muted);margin-bottom:.25rem}
.atlas-breadcrumb button{border:0;background:none;color:inherit;padding:0;text-align:left;overflow-wrap:anywhere}
.atlas-breadcrumb button:hover{color:var(--atlas-action)}
.atlas-rail{position:fixed;display:flex;flex-direction:column;top:24px;left:16px;bottom:24px;width:var(--atlas-rail-width,288px);min-height:0;overflow:hidden;color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.atlas-rail-brand{flex:none;display:flex;align-items:baseline;gap:10px;padding:0 12px 20px;overflow-wrap:anywhere}
.atlas-rail-brand strong{font:600 20px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.02em}
.atlas-rail-brand span{font-size:11px;color:var(--text-muted);flex:none}
html[data-atlas-workbench=true] .atlas-rail-brand{visibility:hidden}
.atlas-workbench-placeholder{height:36px;min-height:36px;pointer-events:none}
html[data-atlas-workbench=true][data-atlas-layout=rail] .atlas-compact-navigation{display:none}
html[data-atlas-workbench=true] .atlas-compact-navigation>.atlas-workbench-placeholder{flex:0 0 min(280px,100%);width:min(280px,100%);min-width:0}
html[data-atlas-layout=rail] .container{margin-left:var(--atlas-reader-offset);margin-right:0}
html:not([data-atlas-layout=rail]) .atlas-rail{display:none}
.atlas-compact-navigation:empty{display:none}
.atlas-directory-section{display:flex;flex-direction:column;flex:none;min-height:0}
.atlas-directory-section[data-open=true]{flex:1}
.atlas-directory-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:36px;padding:6px 12px;border:0;border-radius:6px;background:none;color:var(--text-muted);text-align:left;font:500 13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif!important;flex:none}
.atlas-directory-toggle::after{content:'›';font-size:18px}
.atlas-directory-toggle[aria-expanded=true]::after{content:'×'}
.atlas-directory-toggle:hover{background:var(--toolbar-hover);color:var(--text)}
.atlas-directory{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;padding:12px 0;overscroll-behavior:contain}
.atlas-directory-search{display:block;width:calc(100% - 24px);min-height:36px;margin:0 12px 12px;padding:7px 10px;border:1px solid var(--toolbar-border);border-radius:6px;background:var(--panel);color:var(--text);font:inherit}
.atlas-directory-search::placeholder{color:var(--text-muted)}
.atlas-directory ul{list-style:none;padding:0;margin:0}.atlas-directory ul ul{padding-left:12px;margin-left:12px}
.atlas-directory-link{display:block;position:relative;width:100%;min-height:36px;padding:8px 12px;text-align:left;border:0;border-radius:6px;background:none;color:var(--text-muted);font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif!important;overflow-wrap:anywhere}
.atlas-directory-link:hover,.atlas-directory-link[aria-current=page]{background:color-mix(in srgb,var(--atlas-action) 8%,transparent);color:var(--atlas-action)}
.atlas-directory-link[aria-current=page]{font-weight:600!important}
.atlas-directory-link[aria-current=page]::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:2px;background:var(--atlas-action)}
.atlas-directory-empty{padding:0 12px;color:var(--text-muted);font-size:13px}
.atlas-inspector{display:flex;flex-direction:column;flex:1;min-height:0;margin:18px 12px 0;font:14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--text)}
.atlas-overview{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain;padding-right:4px}
.atlas-overview-heading{font:500 12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--text-muted);margin:0 0 20px}
.atlas-selection-hint{position:absolute;left:1.5rem;bottom:1rem;display:flex;align-items:center;height:2.4rem;margin:0;color:var(--text-muted);font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none}
.atlas-selection-hint[data-selected=true]{visibility:hidden}
.atlas-structure-inspection{margin:0;padding:0 1rem .75rem;color:var(--text-muted);font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}
html[data-embed=true] .atlas-selection-hint,html[data-present=true] .atlas-selection-hint{display:none}
@media(max-width:720px){.atlas-selection-hint{position:static;height:auto;min-height:20px;margin-top:12px;transform:translateX(var(--archify-scroll-x,0px))}}
.atlas-overview .cards{display:block;margin:0;padding:0}
.atlas-overview .card{border:0;border-radius:0;background:none;box-shadow:none;padding:0;margin:0 0 28px;min-width:0}
.atlas-overview .card-header{padding:0;margin-bottom:12px;gap:8px}
.atlas-overview .card h3{font:600 15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:0;color:var(--text)}
.atlas-overview .card ul{margin:0;padding:0;list-style:none}
.atlas-overview .card li{font:14px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--text-muted);margin:0 0 10px;overflow-wrap:anywhere}
.atlas-overview .card-dot{width:5px;height:5px;box-shadow:none}
.atlas-inspector #focus-chip{position:static;inset:auto;display:flex;flex-direction:column;flex:1;min-height:0;width:100%;max-width:none;max-height:none;overflow:hidden;border:0;border-radius:0;background:none;box-shadow:none;backdrop-filter:none;color:var(--text);font-family:inherit}
.atlas-inspector .relationship-lens-head{position:relative;display:block;flex:none;padding:0;background:none;border:0}
.atlas-inspector .relationship-lens-eyebrow{font:500 12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:0;color:var(--text-muted);margin-bottom:8px;text-transform:none}
.atlas-inspector .relationship-lens-title{font:600 20px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:-.02em;color:var(--text)}
.atlas-inspector .relationship-lens-actions{display:flex;flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin:12px 0 4px}
.atlas-inspector #btn-focus-clear,.atlas-inspector #btn-focus-copy,.atlas-return-to-graph{width:auto;height:auto;min-height:32px;padding:6px 0;border:0;border-radius:0;background:none;color:var(--text-muted);font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;text-align:left;cursor:pointer}
.atlas-inspector #btn-focus-copy{color:var(--atlas-action)}
.atlas-focus-navigation{margin:16px 0 12px}
.atlas-focus-navigation button,.atlas-reference-structure{display:block;width:100%;min-height:36px;text-align:left;padding:9px 11px;border:0;border-radius:6px;background:color-mix(in srgb,var(--atlas-action) 9%,transparent);color:var(--atlas-action);font:500 14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;overflow-wrap:anywhere}
.atlas-reference-structure{margin:0 0 16px}
.atlas-focus-navigation button:hover,.atlas-reference-structure:hover{background:color-mix(in srgb,var(--atlas-action) 15%,transparent)}
.atlas-focus-navigation button[data-atlas-reference]{background:none;padding-left:0;padding-right:0}
html[data-atlas-member][data-theme=light] .atlas-focus-navigation button:not([data-atlas-reference]),html[data-atlas-member][data-theme=light] .atlas-directory-link:hover,html[data-atlas-member][data-theme=light] .atlas-directory-link[aria-current=page]{color:var(--text)}
.atlas-inspector-tabs{display:flex;flex:none;gap:14px;margin:10px 0 0;border-bottom:1px solid var(--toolbar-border)}
.atlas-inspector-tabs [role=tab]{display:block;min-width:0;min-height:38px;padding:8px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:none;color:var(--text-muted);font:500 13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}
.atlas-inspector-tabs [role=tab][aria-selected=true]{color:var(--text);border-bottom-color:var(--atlas-action)}
.atlas-inspector-panel{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain;padding:20px 4px 16px 0}
.atlas-inspector .semantic-passport-detail{font:14px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--text);margin:0 0 18px}
.atlas-inspector .semantic-passport-meta{margin:0;gap:6px}
.atlas-inspector .semantic-passport-meta span,.atlas-inspector .semantic-passport-meta code{font-size:11px;line-height:1.5;letter-spacing:0;padding:3px 6px;border-radius:4px;color:var(--text-muted)}
.atlas-inspector .semantic-passport-meta code{font-family:ui-monospace,SFMono-Regular,monospace}
.atlas-inspector .semantic-passport-meta [data-passport=kind]{color:var(--atlas-action);font-weight:500}
.atlas-inspector #focus-evidence{border:0;background:none;padding:0;margin:0}
.atlas-inspector .semantic-passport-evidence-head{display:block;margin-bottom:16px}
.atlas-inspector .semantic-passport-evidence-status{color:var(--text-muted);font-size:11px;line-height:1.5;letter-spacing:0;font-weight:500}
.atlas-inspector .semantic-passport-repository{display:block;max-width:none;text-align:left;font-size:12px;line-height:1.6;margin-top:8px;color:var(--text-muted)}
.atlas-inspector .semantic-passport-source{padding:12px 0;border-radius:0;border-bottom:1px solid var(--toolbar-border);gap:4px 8px}
.atlas-inspector .semantic-passport-source strong{font-size:13px;line-height:1.55;font-weight:500}
.atlas-inspector .semantic-passport-source code{color:var(--text-muted);font-size:11px}
.atlas-inspector .semantic-passport-source small{font:12px/1.65 ui-monospace,SFMono-Regular,monospace;color:var(--text-muted);user-select:text}
.atlas-inspector .semantic-passport-source small,.atlas-inspector .semantic-passport-source strong,.atlas-inspector .semantic-passport-repository,.atlas-inspector .semantic-passport-detail,.atlas-inspector .relationship-lens-title,.atlas-inspector .semantic-passport-meta span,.atlas-inspector .semantic-passport-meta code,.atlas-inspector .relationship-lens-row strong,.atlas-inspector .relationship-lens-row small{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
.atlas-source-scope,.atlas-source-empty,.atlas-detail-empty{margin:16px 0 0;color:var(--text-muted);font-size:12px;line-height:1.65;overflow-wrap:anywhere}
.atlas-inspector .relationship-lens-summary{font-size:12px;line-height:1.6;margin:0;color:var(--text-muted)}
.atlas-inspector .semantic-passport-reach{padding:16px 0;margin:0;border:0}
.atlas-inspector .semantic-passport-reach-label{font-size:11px;letter-spacing:0;color:var(--text-muted)}
.atlas-inspector .semantic-passport-reach-actions{gap:8px;margin-top:4px}
.atlas-inspector .semantic-passport-reach-actions button{font-size:12px;min-height:36px;border-radius:5px}
.atlas-inspector .semantic-passport-reach-actions strong{color:var(--text);font-size:12px}
.atlas-inspector .semantic-passport-reach-status{font-size:12px;line-height:1.6}
.atlas-inspector #relationship-lens-list{display:block;max-height:none;overflow:visible;border:0;padding:0}
.atlas-inspector .relationship-lens-group{margin:0 0 18px}
.atlas-inspector .relationship-lens-group-title{font-size:11px;letter-spacing:0;padding:0 0 8px;color:var(--text-muted)}
.atlas-inspector .relationship-lens-row{min-height:48px;padding:9px 8px;gap:4px 8px;border-radius:5px}
.atlas-inspector .relationship-lens-row strong{font-size:13px;line-height:1.5;font-weight:500}
.atlas-inspector .relationship-lens-row small{font-size:12px;line-height:1.5;color:var(--text-muted)}
.atlas-inspector .relationship-lens-row .relationship-lens-direction{color:var(--text-muted);font-size:10px;letter-spacing:0}
.atlas-inspector .relationship-lens-empty{font-size:13px;line-height:1.6;text-align:left;padding:0;color:var(--text-muted)}
.atlas-inspector #focus-chip[data-relationship-previewing=true] .relationship-lens-group-title,.atlas-inspector #focus-chip[data-relationship-previewing=true] .relationship-lens-row{display:grid}
.atlas-parent-context{flex:none;margin-top:20px;font-size:12px;color:var(--text-muted)}
.atlas-parent-context summary{cursor:pointer;list-style:none;min-height:32px;line-height:32px}.atlas-parent-context summary::after{content:'⌄';margin-left:8px}
.atlas-parent-panel{padding-top:8px;max-height:min(22vh,12rem);overflow:auto;scrollbar-width:thin;overscroll-behavior:contain}.atlas-parent-panel p{margin:0 0 6px;line-height:1.6;overflow-wrap:anywhere}
.atlas-parent-panel button{border:0;background:none;padding:0;margin-bottom:12px;text-align:left;font-size:12px;line-height:1.6;color:var(--atlas-action);overflow-wrap:anywhere}
.atlas-inspection-slot{width:100%;max-width:var(--archify-reader-width,1440px);margin:0 auto}
.atlas-inspection-slot:empty,.atlas-inspection-slot:has(#focus-chip[hidden]){display:none}
.atlas-rail>.atlas-parent-context{margin:16px 12px 0}
.atlas-compact-navigation{margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 20px}
.atlas-compact-navigation>.atlas-parent-context{margin-top:0;max-width:28rem}
.atlas-compact-navigation .atlas-directory-section{flex:1;min-width:180px}
.atlas-compact-navigation .atlas-directory-toggle{padding-left:0;max-width:20rem}
.atlas-compact-navigation .atlas-directory{max-height:300px}
.atlas-inspection-slot .atlas-inspector{margin:24px 0 0;padding:0 0 24px}
.atlas-inspection-slot #focus-chip{max-height:none;overflow:visible}
.atlas-inspection-slot .atlas-inspector-panel{max-height:none;overflow:visible}
.atlas-inspection-slot .atlas-overview{display:none}
.atlas-inspection-slot .relationship-lens-actions{justify-content:flex-start;gap:20px}
.atlas-inspection-slot .atlas-focus-navigation{max-width:28rem}
.atlas-inspection-jump{min-height:36px;border:0;background:none;color:var(--atlas-action);font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}
.atlas-inspection-jump:disabled{color:var(--text-muted);cursor:default}
html[data-atlas-layout=rail] .atlas-inspection-jump,html[data-atlas-layout=rail] .atlas-return-to-graph{display:none}
.atlas-status{font-size:.75rem;color:var(--atlas-action)}.atlas-status:empty{display:none}
.atlas-navigation [hidden],.atlas-breadcrumb[hidden],.atlas-directory[hidden],.atlas-directory [hidden],.atlas-focus-navigation[hidden],.atlas-parent-context[hidden],.atlas-inspector[hidden],.atlas-inspector [hidden],.atlas-inspection-jump[hidden]{display:none}
.atlas-inspector #focus-chip[hidden],.atlas-inspector #relationship-lens-list[hidden]{display:none}
.atlas-rail button:focus-visible,.atlas-navigation button:focus-visible,.atlas-breadcrumb button:focus-visible,.atlas-inspector button:focus-visible,.atlas-inspector [role=tabpanel]:focus-visible,.atlas-inspector summary:focus-visible,.atlas-directory-toggle:focus-visible,.atlas-directory-search:focus-visible,.atlas-inspection-jump:focus-visible{outline:2px solid var(--atlas-action);outline-offset:3px}
html[data-atlas-member] svg[data-focus-active] [data-node-id]:not([data-focus-match]),html[data-atlas-member] svg[data-focus-active] [data-edge-from]:not([data-focus-match]){opacity:1}
html[data-atlas-member] svg[data-focus-active] [data-focus-selected]{filter:none}
html[data-preset=blueprint] .atlas-directory-link,html[data-preset=blueprint] .atlas-focus-navigation button{border-radius:2px}
html[data-embed=true] .atlas-rail,html[data-embed=true] .atlas-navigation,html[data-embed=true] .atlas-breadcrumb,html[data-embed=true] .atlas-compact-navigation,html[data-embed=true] .atlas-inspection-slot{display:none}
@media(max-width:720px){html[data-atlas-member] .header-row{flex-wrap:wrap}.atlas-navigation button,.atlas-directory-link,.atlas-directory-toggle,.atlas-focus-navigation button,.atlas-reference-structure,.atlas-inspector-tabs [role=tab],.atlas-inspection-jump,.atlas-inspector #btn-focus-clear,.atlas-inspector #btn-focus-copy,.atlas-return-to-graph{min-height:44px}.atlas-compact-navigation{display:block}}
@media print{.atlas-rail,.atlas-navigation,.atlas-breadcrumb,.atlas-compact-navigation,.atlas-inspection-slot,.atlas-status{display:none!important}html[data-atlas-layout=rail] .container{margin:0 auto}}
`;
  const container = doc.querySelector('.container');
  const row = doc.querySelector('.header-row');
  const heading = element('div', 'atlas-heading');
  const title = doc.querySelector('h1');
  title.tabIndex = -1;
  title.before(heading);
  const breadcrumb = element('nav', 'atlas-breadcrumb', heading);
  breadcrumb.id = 'atlas-breadcrumb'; breadcrumb.setAttribute('aria-label', zh ? '架构层级' : 'Architecture hierarchy');
  heading.append(title);
  const lineage = [];
  for (let cursor = diagram; parents.has(cursor);) { cursor = parents.get(cursor).diagram; lineage.unshift(cursor); }
  for (const id of lineage) {
    button(bundle.members[id].title, breadcrumb, () => navigate(id)).id = `atlas-ancestor-${id}`;
    element('span', '', breadcrumb, '›').setAttribute('aria-hidden', 'true');
  }
  breadcrumb.hidden = !lineage.length;
  const controls = element('nav', 'atlas-navigation'); controls.setAttribute('aria-label', zh ? '架构导航' : 'Architecture navigation');
  row.prepend(controls);
  const backButton = button('←', controls, back);
  backButton.id = 'atlas-back'; backButton.hidden = !hasPrevious;
  backButton.setAttribute('aria-label', zh ? '返回上次访问' : 'Back to previous visit');
  const status = element('p', 'atlas-status', doc.querySelector('.header'));
  status.id = 'atlas-status'; status.setAttribute('role', 'status');
  const compactNavigation = element('div', 'atlas-compact-navigation');
  // A shared compact directory starts before member-dependent headings. This
  // keeps its host bounds stable even when a title or breadcrumb wraps.
  if (workbench) container.before(compactNavigation);
  else doc.querySelector('.header').after(compactNavigation);
  const rail = element('aside', 'atlas-rail no-print', doc.body);
  rail.setAttribute('aria-label', zh ? '架构目录与节点信息' : 'Architecture directory and node inspector');
  const brand = element('div', 'atlas-rail-brand', rail);
  element('strong', '', brand, bundle.members[bundle.entry].title);
  element('span', '', brand, zh ? '架构图集' : 'Architecture atlas');
  const directorySection = element('section', 'atlas-directory-section', rail);
  if (workbench) {
    doc.documentElement.setAttribute('data-atlas-workbench', 'true');
    brand.setAttribute('aria-hidden', 'true');
    directorySection.classList.add('atlas-workbench-placeholder');
    directorySection.setAttribute('aria-hidden', 'true');
  }
  // The host owns the actual directory in a persistent document. Legacy direct
  // installations retain their local controls; the member needs only a slot.
  const toggle = workbench ? null : button(zh ? '架构目录' : 'Architecture directory', directorySection, () => {
    showDirectory(directory.hidden);
    if (!directory.hidden) search.focus({ preventScroll: true });
  }, 'atlas-directory-toggle');
  const directory = workbench ? null : element('nav', 'atlas-directory', directorySection);
  const search = workbench ? null : element('input', 'atlas-directory-search', directory);
  if (!workbench) {
    toggle.id = 'atlas-directory-toggle'; toggle.setAttribute('aria-controls', 'atlas-directory');
    directory.id = 'atlas-directory'; directory.setAttribute('aria-label', zh ? '架构目录' : 'Architecture directory');
    search.id = 'atlas-directory-search'; search.type = 'search'; search.autocomplete = 'off';
    search.placeholder = zh ? '查找架构图' : 'Find a diagram';
    search.setAttribute('aria-label', zh ? '按名称筛选架构图' : 'Filter architecture diagrams by name');
  }
  function tree(id, list) {
    const item = element('li', '', list);
    const link = button(bundle.members[id].title, item, () => {
      navigate(id);
    }, 'atlas-directory-link');
    link.dataset.atlasDiagram = id;
    if (id === diagram) link.setAttribute('aria-current', 'page');
    const entry = { id, item, link, children: [] };
    const children = bundle.details.filter(detail => detail.from.diagram === id);
    if (children.length) {
      const nested = element('ul', '', item);
      for (const child of children) entry.children.push(tree(child.to, nested));
    }
    return entry;
  }
  const rootEntry = workbench ? null : tree(bundle.entry, element('ul', '', directory));
  const directoryEmpty = workbench ? null : element('p', 'atlas-directory-empty', directory, zh ? '没有匹配的架构图' : 'No matching diagrams.');
  if (directoryEmpty) directoryEmpty.hidden = true;
  function filterDirectory() {
    if (!directory) return;
    const query = search.value.trim().toLocaleLowerCase();
    function matches(entry) {
      const childMatches = entry.children.map(matches).some(Boolean);
      const match = !query || bundle.members[entry.id].title.toLocaleLowerCase().includes(query) || childMatches;
      entry.item.hidden = !match;
      return match;
    }
    directoryEmpty.hidden = matches(rootEntry);
  }
  const inspector = element('section', 'atlas-inspector', rail);
  inspector.setAttribute('aria-label', zh ? '架构检查器' : 'Architecture inspector');
  const overview = element('section', 'atlas-overview', inspector);
  overview.id = 'atlas-overview'; overview.setAttribute('aria-label', zh ? '本层概览' : 'Chapter overview');
  element('h2', 'atlas-overview-heading', overview, zh ? '本层概览' : 'Chapter overview');
  const selectionHint = element('p', 'atlas-selection-hint no-print', doc.querySelector('.diagram-container'), zh ? '选择节点，查看详情' : 'Select a node to view details');
  const inspectionHelp = element('p', 'atlas-structure-inspection', null, zh ? '选择图中节点，在检查器中查看职责、关系和源码；使用“进入”或“查看定义”继续探索。' : 'Select a node to inspect its role, relationships, and sources. Use Open or View definition to explore further.');
  doc.querySelector('.diagram-guide-head').after(inspectionHelp);
  // readerLayout moves the original chapter cards here when the viewport has
  // enough unused width, and returns them to document flow otherwise.
  overview.dataset.atlasCards = 'target';
  const chip = doc.getElementById('focus-chip'); inspector.append(chip);
  doc.querySelector('.relationship-lens-eyebrow').textContent = zh ? '选中节点' : 'Selected node';
  const focusTitle = doc.getElementById('relationship-lens-title'); focusTitle.tabIndex = -1;
  const actions = element('div', 'atlas-focus-navigation', doc.querySelector('.relationship-lens-copy'));
  const clearButton = doc.getElementById('btn-focus-clear');
  clearButton.textContent = zh ? '← 本层概览' : '← Chapter overview';
  clearButton.setAttribute('aria-label', zh ? '清除节点选择并查看本层概览' : 'Clear the node selection and show the chapter overview');
  const returnToGraph = button(zh ? '返回图 ↑' : 'Back to diagram ↑', doc.querySelector('.relationship-lens-actions'), () => {
    if (win.Archify.internalStructure?.surface() === 'structure') { win.Archify.internalStructure.close(); return; }
    const id = win.Archify.focus.active();
    const node = Array.from(doc.querySelectorAll('[data-node-id]')).find(item => item.getAttribute('data-node-id') === id);
    const target = node || doc.querySelector('.diagram-container');
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
  }, 'atlas-return-to-graph');
  returnToGraph.id = 'atlas-return-to-graph';
  const tabs = element('div', 'atlas-inspector-tabs', chip);
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', zh ? '节点资料' : 'Node information');
  const tabButtons = {
    details: button(zh ? '详情' : 'Details', tabs, () => {}),
    relationships: doc.getElementById('btn-focus-relations'),
    sources: button(zh ? '源码' : 'Sources', null, () => {})
  };
  tabButtons.details.id = 'atlas-tab-details'; tabButtons.sources.id = 'atlas-tab-sources';
  tabs.append(tabButtons.relationships, tabButtons.sources);
  const panels = {};
  for (const [key, tabButton] of Object.entries(tabButtons)) {
    tabButton.dataset.atlasTab = key; tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-controls', `atlas-panel-${key}`);
    const panel = element('div', 'atlas-inspector-panel', chip);
    panel.id = `atlas-panel-${key}`; panel.tabIndex = 0;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tabButton.id);
    panels[key] = panel;
  }
  const detail = doc.getElementById('focus-detail');
  const quicklook = doc.getElementById('focus-internal-structure');
  const meta = doc.getElementById('focus-passport-meta');
  panels.details.append(detail, ...(quicklook ? [quicklook] : []), meta);
  let structureTarget = null;
  const hasReferenceStructure = bundle.references.some(ref => ref.occurrence.diagram === diagram && Boolean(bundle.members[ref.target.diagram]?.structureNodes?.[ref.target.node]));
  const referenceStructure = hasReferenceStructure ? button(zh ? '查看内部结构 →' : 'View internal structure →', null, () => {
    if (structureTarget) navigate({ ...structureTarget, inspect: 'structure' });
  }, 'atlas-reference-structure node-structure-open') : null;
  if (referenceStructure) {
    referenceStructure.id = 'atlas-open-internal-structure'; referenceStructure.hidden = true;
    meta.before(referenceStructure);
  }
  const detailEmpty = element('p', 'atlas-detail-empty', panels.details, zh ? '此节点没有附加职责说明。' : 'No additional role description was provided for this node.');
  panels.relationships.append(doc.getElementById('focus-summary'), doc.getElementById('focus-reach'), doc.getElementById('relationship-lens-list'));
  const evidence = doc.getElementById('focus-evidence'); panels.sources.append(evidence);
  const sourceScope = element('p', 'atlas-source-scope', panels.sources);
  const sourceEmpty = element('p', 'atlas-source-empty', panels.sources, zh ? '此节点未提供已核验的源码位置。' : 'No verified source locations were provided for this node.');
  const parentContext = element('details', 'atlas-parent-context', rail);
  parentContext.id = 'atlas-parent';
  const parentSummary = element('summary', '', parentContext, zh ? '父层关系' : 'Parent relationships');
  const context = element('div', 'atlas-parent-panel', parentContext); context.id = 'atlas-context';
  for (const edge of member.parentContext || []) {
    element('p', '', context, `${edge.fromLabel} → ${edge.toLabel}${edge.label ? ` · ${edge.label}` : ''}`);
    if (edge.id) button(zh ? '在父图查看关系 ↗' : 'View parent relationship ↗', context, () => navigate(parents.get(diagram).diagram, undefined, edge.id));
  }
  const inspectionSlot = element('div', 'atlas-inspection-slot no-print'); container.after(inspectionSlot);
  const inspectSelection = button(zh ? '查看所选节点资料 ↓' : 'Inspect selected node ↓', compactNavigation, () => {
    showDirectory(false);
    inspector.scrollIntoView({ block: 'start' });
    focusTitle.focus({ preventScroll: true });
  }, 'atlas-inspection-jump');
  inspectSelection.id = 'atlas-inspect-selection';
  let selectedTab = 'details';
  let shown;
  let restoring = false;
  let layout = doc.documentElement.getAttribute('data-atlas-layout');
  const scrollRoots = { overview, ...(!workbench ? { directory } : {}), ...panels, parent: context };
  const scrollPositions = Object.fromEntries(Object.keys(scrollRoots).map(key => [key, 0]));
  function notifyChange() { if (!restoring && typeof onStateChange === 'function') onStateChange(); }
  function canRememberScroll(node) {
    return layout === doc.documentElement.getAttribute('data-atlas-layout') &&
      !node.closest('[hidden]') && node.getClientRects().length &&
      ['auto', 'scroll'].includes(win.getComputedStyle(node).overflowY);
  }
  function rememberScroll() {
    for (const [key, node] of Object.entries(scrollRoots)) {
      if (canRememberScroll(node)) scrollPositions[key] = node.scrollTop;
    }
  }
  function renderTabs() {
    for (const [key, tabButton] of Object.entries(tabButtons)) {
      const active = selectedTab === key;
      tabButton.setAttribute('aria-selected', String(active)); tabButton.tabIndex = active ? 0 : -1;
      panels[key].hidden = !active;
    }
    // This is the original runtime-owned Relations button. Its mobile expansion
    // attribute remains accurate even though the workbench uses actual tab panels.
    tabButtons.relationships.setAttribute('aria-expanded', String(selectedTab === 'relationships'));
    tabButtons.relationships.setAttribute('aria-label', zh ? '关系' : 'Relationships');
  }
  function selectTab(key, { focus = false, notify = true } = {}) {
    if (!panels[key]) return;
    rememberScroll(); selectedTab = key; renderTabs();
    panels[key].scrollTop = scrollPositions[key];
    if (focus) tabButtons[key].focus({ preventScroll: true });
    if (notify) notifyChange();
  }
  function renderDirectory() {
    const open = directoryOpen === true;
    if (directory) directory.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    directorySection.dataset.open = String(open); inspector.hidden = open;
    parentContext.hidden = open || !member.parentContext?.length;
  }
  function showDirectory(open) {
    if (workbench) { workbench.openDirectory(open); return; }
    rememberScroll(); directoryOpen = Boolean(open);
    if (typeof setDirectoryOpen === 'function') setDirectoryOpen(directoryOpen);
    renderDirectory();
    if (directoryOpen) directory.scrollTop = scrollPositions.directory;
    else {
      overview.scrollTop = scrollPositions.overview;
      panels[selectedTab].scrollTop = scrollPositions[selectedTab];
      if (parentContext.open) context.scrollTop = scrollPositions.parent;
    }
    notifyChange();
  }
  function syncAction() {
    const id = win.Archify.focus.active();
    const next = !chip.hidden && typeof id === 'string' ? id : null;
    selectionHint.dataset.selected = String(!chip.hidden);
    overview.hidden = Boolean(next); inspectSelection.disabled = !next;
    inspectSelection.setAttribute('aria-disabled', String(!next));
    detailEmpty.hidden = !detail.hidden;
    sourceEmpty.hidden = !evidence.hidden;
    sourceScope.textContent = evidence.hidden ? '' : evidence.title;
    sourceScope.hidden = !sourceScope.textContent;
    renderTabs();
    if (next === shown) return;
    if (next && directoryOpen && win.ArchifyAddress.active) {
      selectTab('details', { notify: false });
      showDirectory(false);
    }
    shown = next; actions.replaceChildren(); actions.hidden = true;
    const detailLink = bundle.details.find(item => item.from.diagram === diagram && item.from.node === next);
    const ref = bundle.references.find(item => item.occurrence.diagram === diagram && item.occurrence.node === next);
    structureTarget = ref && bundle.members[ref.target.diagram]?.structureNodes?.[ref.target.node]
      ? { diagram: ref.target.diagram, focus: ref.target.node } : null;
    if (referenceStructure) {
      referenceStructure.hidden = !structureTarget;
      if (structureTarget) referenceStructure.dataset.atlasStructure = next;
    }
    if (detailLink || ref) {
      const destination = detailLink ? detailLink.to : ref.target.diagram;
      const targetTitle = bundle.members[destination].title;
      const label = detailLink ? (zh ? `进入 ${targetTitle} →` : `Open ${targetTitle} →`) : (zh ? `查看 ${targetTitle} 中的定义 ↗` : `View definition in ${targetTitle} ↗`);
      const action = button(label, actions, () => navigate(destination, detailLink ? undefined : ref.target.node));
      if (detailLink) action.dataset.atlasDetail = next; else action.dataset.atlasReference = next;
      actions.hidden = false;
    }
    notifyChange();
  }
  function focusDescriptor() {
    const active = doc.activeElement;
    if (!active || active === doc.body || active === doc.documentElement) return null;
    if (active.id) return { id: active.id };
    if (active.matches('#relationship-lens-list [data-relationship-key]')) return { relationshipRow: active.getAttribute('data-relationship-key') };
    if (active.hasAttribute('data-relationship-hit-key')) return { relationshipHit: active.getAttribute('data-relationship-hit-key') };
    for (const attribute of ['data-atlas-diagram', 'data-atlas-detail', 'data-atlas-reference', 'data-node-id']) {
      if (active.hasAttribute(attribute)) return { attribute, value: active.getAttribute(attribute) };
    }
    const sources = Array.from(evidence.querySelectorAll('a.semantic-passport-source'));
    if (sources.includes(active)) return { sourceIndex: sources.indexOf(active) };
    if (active === parentSummary) return { parentSummary: true };
    const parentButtons = Array.from(context.querySelectorAll('button'));
    if (parentButtons.includes(active)) return { parentIndex: parentButtons.indexOf(active) };
    return null;
  }
  function restoreFocus(saved) {
    if (!saved || typeof saved !== 'object') return;
    if (workbench && (!workbench.canRestoreFocus(frame) || saved.id?.startsWith('atlas-directory') || saved.attribute === 'data-atlas-diagram')) return;
    let target;
    if (saved.id) target = doc.getElementById(saved.id);
    else if (typeof saved.relationshipRow === 'string' || saved.attribute === 'data-relationship-key') {
      target = Array.from(panels.relationships.querySelectorAll('.relationship-lens-row[data-relationship-key]')).find(node => node.getAttribute('data-relationship-key') === (saved.relationshipRow ?? saved.value));
    } else if (typeof saved.relationshipHit === 'string') {
      target = Array.from(doc.querySelectorAll('[data-relationship-hit-key]')).find(node => node.getAttribute('data-relationship-hit-key') === saved.relationshipHit);
    } else if (['data-atlas-diagram', 'data-atlas-detail', 'data-atlas-reference', 'data-node-id'].includes(saved.attribute)) {
      target = Array.from(doc.querySelectorAll(`[${saved.attribute}]`)).find(node => node.getAttribute(saved.attribute) === saved.value);
    } else if (Number.isInteger(saved.sourceIndex)) target = evidence.querySelectorAll('a.semantic-passport-source')[saved.sourceIndex];
    else if (saved.parentSummary) target = parentSummary;
    else if (Number.isInteger(saved.parentIndex)) target = context.querySelectorAll('button')[saved.parentIndex];
    if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true });
  }
  function snapshot() {
    rememberScroll();
    return { tab: selectedTab, ...(!workbench ? { directoryOpen: directoryOpen === true, directoryQuery: search.value } : {}), scroll: { ...scrollPositions }, parentOpen: parentContext.open, focus: focusDescriptor() };
  }
  function restore(state, options = {}) {
    if (!state || typeof state !== 'object') return;
    restoring = true;
    try {
      if (panels[state.tab]) selectedTab = state.tab;
      if (!workbench) {
        directoryOpen = state.directoryOpen === true;
        search.value = typeof state.directoryQuery === 'string' ? state.directoryQuery : '';
      }
      for (const key of Object.keys(scrollRoots)) {
        if (Number.isFinite(state.scroll?.[key]) && state.scroll[key] >= 0) scrollPositions[key] = state.scroll[key];
      }
      parentContext.open = state.parentOpen === true;
      filterDirectory(); renderDirectory(); renderTabs();
      for (const [key, node] of Object.entries(scrollRoots)) node.scrollTop = scrollPositions[key];
      if (options.focus !== false) restoreFocus(state.focus);
    } finally { restoring = false; }
  }
  tabs.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-atlas-tab]');
    if (tabButton) selectTab(tabButton.dataset.atlasTab);
  });
  tabs.addEventListener('keydown', event => {
    const keys = Object.keys(tabButtons);
    const current = event.target.closest('[data-atlas-tab]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const index = keys.indexOf(current.dataset.atlasTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    event.preventDefault(); event.stopPropagation();
    selectTab(keys[next], { focus: true });
  });
  search?.addEventListener('input', () => { filterDirectory(); notifyChange(); });
  parentContext.addEventListener('toggle', () => {
    if (parentContext.open && !directoryOpen) context.scrollTop = scrollPositions.parent;
    notifyChange();
  });
  for (const [key, node] of Object.entries(scrollRoots)) {
    node.addEventListener('scroll', () => {
      if (!canRememberScroll(node) || scrollPositions[key] === node.scrollTop) return;
      scrollPositions[key] = node.scrollTop; notifyChange();
    }, { passive: true });
  }
  const observer = new win.MutationObserver(syncAction);
  observer.observe(doc.getElementById('focus-id'), { childList: true, characterData: true, subtree: true });
  observer.observe(chip, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(evidence, { attributes: true, attributeFilter: ['hidden', 'title'] });
  const layoutObserver = new win.MutationObserver(() => {
    layout = doc.documentElement.getAttribute('data-atlas-layout');
    for (const [key, node] of Object.entries(scrollRoots)) node.scrollTop = scrollPositions[key];
  });
  layoutObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-atlas-layout'] });
  actions.hidden = true; directoryOpen = directoryOpen === true;
  renderDirectory(); renderTabs();
  win.ArchifyAddress.run(syncAction);
  function handleEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Existing top-level tools own their closing behavior before a rail pane.
    if (['finder', 'guide', 'radar', 'semanticLens', 'exportMenu', 'preset'].some(name => win.Archify[name]?.isOpen?.())) return;
    if (!workbench && !directory.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); showDirectory(false); toggle.focus({ preventScroll: true });
    } else if (parentContext.open) {
      event.preventDefault(); event.stopImmediatePropagation(); parentContext.open = false; parentSummary.focus({ preventScroll: true });
    }
  }
  doc.addEventListener('keydown', handleEscape, true);
  doc.addEventListener('focusin', notifyChange);
  return { status, snapshot, restore, restoreFocus,
    showInformation(key, options = {}) {
      if (!panels[key]) return false;
      selectTab(key, { focus: options.focus === true });
      inspector.scrollIntoView({ block: 'start' });
      return true;
    },
    focus() {
      if (workbench && !workbench.canRestoreFocus(frame)) return;
      if (win.Archify.internalStructure?.surface() === 'structure') win.Archify.internalStructure.focus();
      else title.focus({ preventScroll: true });
    },
    setDirectoryOpen(open) {
      rememberScroll(); directoryOpen = Boolean(open); renderDirectory();
      // A hidden panel has no scrollable layout box. A restored visit keeps its
      // reading position in the snapshot until the inspector is visible again.
      if (!directoryOpen) {
        overview.scrollTop = scrollPositions.overview;
        panels[selectedTab].scrollTop = scrollPositions[selectedTab];
        if (parentContext.open) context.scrollTop = scrollPositions.parent;
      }
    },
    dispose() {
    observer.disconnect(); layoutObserver.disconnect(); doc.removeEventListener('keydown', handleEscape, true); doc.removeEventListener('focusin', notifyChange);
  } };
}
