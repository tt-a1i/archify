// Overlay: layer Bauify's module facts onto an Archify-delivered HTML.
//
// The delivered artifact is never modified; a new file is written next to it.
// The overlay adds one toolbar button ("Code analysis"). When it is on, the
// authored diagram and guided views recede and every mapped component gets a
// status ring around its box: pulsing red for supplied error findings,
// amber when a rule warns (eager cycle, hub), blue when only informational facts exist
// (lazy/runtime or package-level cycle), green when nothing fired, grey when no code maps to it.
// A legend next to the hint spells out the danger level behind each colour.
// Clicking a component opens a panel with the indicators, the mapped modules,
// every file with its LOC and import counts, and the module edges with
// file:line evidence. Clicking an indicator opens a second panel with the
// findings behind it and a small diagram Bauify draws to explain them (the
// cycle ring, the hub star, the in/out bars). Every file:line a finding
// cites is a button; with --source the lines around it are embedded and open
// in a third panel with the line highlighted. No import lines are drawn on
// the authored diagram itself.
// The whole Bauify dataset (module graph plus per-file facts) is embedded in
// the page so future findings can attach to a file without re-running.
// Nothing in the authored IR is changed or inferred.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../extract/shared/diagnostics.mjs';

export function buildOverlay({ ir, graph, html, map, facts = null, findings = [], sourceRoot = null }) {
  if (!html.includes('data-node-id=') || !html.includes('class="toolbar"')) {
    fail('overlay/not-archify-html', 'The HTML does not look like an Archify architecture artifact.', {
      evidence: { hasNodes: html.includes('data-node-id='), hasToolbar: html.includes('class="toolbar"') },
      supportedFixes: ['pass the HTML written by `archify deliver architecture`'],
    });
  }
  const modules = new Map(graph.modules.map((m) => [m.id, m]));
  const mapping = resolveMapping(ir, graph, map);
  const claimed = new Set([...mapping.values()].flat());
  const fileIndex = indexFiles(graph, facts);
  const findingsByFile = new Map();
  for (const f of findings) {
    const key = f.subject && f.subject.file ? f.subject.file : null;
    if (key) (findingsByFile.get(key) || findingsByFile.set(key, []).get(key)).push(f);
  }

  const components = ir.components.map((c) => {
    const ids = mapping.get(c.id) || [];
    const mods = ids.map((id) => modules.get(id)).filter(Boolean);
    const set = new Set(ids);
    const outgoing = aggregate(graph.edges.filter((e) => set.has(e.from) && !set.has(e.to)), 'to', mapping);
    const incoming = aggregate(graph.edges.filter((e) => set.has(e.to) && !set.has(e.from)), 'from', mapping);
    const internal = graph.edges.filter((e) => set.has(e.from) && set.has(e.to)).reduce((n, e) => n + e.weight, 0);
    return {
      id: c.id,
      label: c.label,
      modules: mods.map((m) => ({ id: m.id, label: m.label, path: m.path, files: m.files, loc: m.loc, fanIn: m.fanIn, fanOut: m.fanOut, instability: m.instability, entry: m.entry })),
      files: mods.reduce((n, m) => n + m.files, 0),
      loc: mods.reduce((n, m) => n + m.loc, 0),
      internalImports: internal,
      outgoing,
      incoming,
      fileList: ids.flatMap((id) => (fileIndex.get(id) || []).map((f) => ({ ...f, module: id }))).map((f) => ({ ...f, findings: findingsByFile.get(f.path) || [] })),
      findings: findings.filter((f) => touches(f, set, c.id, new Set(ids.flatMap((id) => (fileIndex.get(id) || []).map((f) => f.path))))),
      indicators: indicators(set, mods, findings, mapping, new Set(ids.flatMap((id) => (fileIndex.get(id) || []).map((f) => f.path)))),
    };
  });

  // Component-level edges (deduplicated, both directions kept separately).
  const edgeMap = new Map();
  for (const c of components) for (const o of c.outgoing) if (o.component) {
    const key = `${c.id}>${o.component}`;
    edgeMap.set(key, { from: c.id, to: o.component, weight: o.weight, evidence: o.evidence });
  }
  const edges = [...edgeMap.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  const unmapped = graph.modules.filter((m) => !claimed.has(m.id)).map((m) => ({ id: m.id, label: m.label, files: m.files, loc: m.loc, fanIn: m.fanIn, fanOut: m.fanOut }));

  const payload = {
    generator: 'bauify',
    repository: graph.repository,
    unresolved: graph.unresolved,
    excluded: graph.excluded,
    totals: { modules: graph.modules.length, edges: graph.edges.length, files: facts ? facts.files.length : null, findings: findings.length },
    hasFileFacts: Boolean(facts),
    components,
    edges,
    unmapped,
    snippets: sourceRoot ? collectSnippets(findings, sourceRoot, components) : {},
  };

  const injection = `\n<!-- bauify overlay: authored diagram untouched; analysis layer below -->\n<script type="application/json" id="bauify-analysis">${JSON.stringify(payload).replace(/<\//g, '<\\/')}</script>\n<style id="bauify-style">${CSS}</style>\n<script id="bauify-script">${JS}</script>\n`;
  const idx = html.lastIndexOf('</body>');
  const out = idx === -1 ? html + injection : html.slice(0, idx) + injection + html.slice(idx);
  return { html: out, mapped: components.filter((c) => c.modules.length).length, components: components.length, edges: edges.length, unmapped: unmapped.length, snippets: Object.keys(payload.snippets).length };
}

// A finding touches a component when its subject names the component, one of
// its modules, or a cycle containing one of its modules.
function touches(f, set, componentId, filePaths) {
  const sub = f.subject || {};
  if (sub.component === componentId) return true;
  if (Array.isArray(sub.files) && filePaths && sub.files.some((p) => filePaths.has(p))) return true;
  if (sub.module && set.has(sub.module)) return true;
  if (Array.isArray(sub.modules) && sub.modules.some((m) => set.has(m))) return true;
  return false;
}

// Key indicators shown on the diagram and at the top of the panel. Each one
// states what was checked and the value found; status is red / amber / blue / green.
function indicators(set, mods, findings, mapping, filePaths) {
  if (!mods.length) return { status: 'grey', items: [] };
  const owner = new Map();
  for (const [cid, ids] of mapping) for (const id of ids) owner.set(id, cid);
  // Tiers follow reported severity. Current cycle rules use warning or info;
  // neither a deferred cycle nor a missing finding establishes import safety.
  const fileCycles = findings.filter((f) => f.code === 'coupling/import-cycle' && f.subject.files.some((p) => filePaths.has(p)));
  const proven = fileCycles.filter((f) => f.severity === 'error');
  const eagerFileCycles = fileCycles.filter((f) => f.evidence.kind === 'eager' && f.severity !== 'error');
  const lazyFileCycles = fileCycles.filter((f) => f.evidence.kind !== 'eager');
  const cycles = findings.filter((f) => f.code === 'coupling/cycle' && f.subject.modules.some((m) => set.has(m)));
  const partners = new Set();
  for (const f of cycles) for (const m of f.subject.modules) if (!set.has(m)) partners.add(owner.get(m) ? `component:${owner.get(m)}` : `module:${m}`);
  const internalOnly = cycles.length > 0 && partners.size === 0;
  const cycleStatus = proven.length ? 'red' : eagerFileCycles.length ? 'amber' : (lazyFileCycles.length || cycles.length) ? 'blue' : 'green';
  const cycleValue = proven.length
    ? `reported import-cycle error (${proven.map((f) => f.subject.files.length).join(', ')} files) ${proven[0].evidence.risk ? ` — ${proven[0].evidence.risk.loadingNote}` : ""}`
    : eagerFileCycles.length
      ? `module-scope import cycle (${eagerFileCycles.map((f) => f.subject.files.length).join(', ')} files); load-time behavior unverified`
      : lazyFileCycles.length
        ? `cycle with deferred or conditional imports (${lazyFileCycles.map((f) => f.subject.files.length).join(', ')} files); initialization behavior not proven`
        : cycles.length
          ? (internalOnly ? 'package-level cycle inside this component; no file cycles' : `package-level cycle with ${partners.size} other${partners.size === 1 ? '' : 's'}; no file cycles`)
          : 'none';
  const hubs = findings.filter((f) => f.code === 'coupling/hub' && set.has(f.subject.module));
  const fanIn = mods.reduce((n, m) => n + m.fanIn, 0);
  const fanOut = mods.reduce((n, m) => n + m.fanOut, 0);
  const instability = fanIn + fanOut === 0 ? null : Math.round((fanOut / (fanIn + fanOut)) * 100) / 100;
  const items = [
    {
      key: 'cycle', label: 'Circular dependency',
      status: cycleStatus,
      value: cycleValue,
      detail: cycleStatus === 'green' ? [] : [...partners].sort(),
      findings: [...fileCycles, ...cycles].map((f) => f.id).filter(Boolean),
    },
    {
      key: 'hub', label: 'Hub module',
      status: hubs.length ? 'amber' : 'green',
      value: hubs.length ? hubs.map((h) => `${h.subject.module} (in ${h.evidence.fanIn} · out ${h.evidence.fanOut})`).join(', ') : 'none',
      detail: [],
      findings: hubs.map((f) => f.id).filter(Boolean),
    },
    {
      key: 'instability', label: 'Instability',
      status: 'neutral',
      value: instability === null ? 'n/a (no edges)' : `${instability} (in ${fanIn} · out ${fanOut})`,
      detail: [],
      findings: [],
      fanIn, fanOut, instability,
    },
  ];
  const status = ['red', 'amber', 'blue'].find((t) => items.some((i) => i.status === t)) || 'green';
  return { status, items };
}

// moduleId -> [{ path, loc, role, importsOut, importedBy }], from raw-facts when
// available (per-file import counts count resolved in-tree edges only).
function indexFiles(graph, facts) {
  const index = new Map();
  if (!facts) return index;
  const byDepth = [...graph.modules].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  const excluded = new Set(graph.excluded.roles || []);
  const moduleOf = (file) => {
    if (graph.fileModules) return graph.fileModules[file] || null;
    for (const m of byDepth) { if (m.path === '') continue; if (file === m.path || file.startsWith(`${m.path}/`)) return m.id; }
    return file.includes('/') ? null : (graph.modules.find((m) => m.path === '' && m.entry.includes(file)) || {}).id || null;
  };
  const out = new Map(); const inn = new Map();
  for (const i of facts.imports) if (i.resolved) { out.set(i.from, (out.get(i.from) || 0) + 1); inn.set(i.to, (inn.get(i.to) || 0) + 1); }
  for (const f of facts.files) {
    if (excluded.has(f.role)) continue;
    const id = moduleOf(f.path);
    if (!id) continue;
    (index.get(id) || index.set(id, []).get(id)).push({ path: f.path, loc: f.loc, role: f.role, importsOut: out.get(f.path) || 0, importedBy: inn.get(f.path) || 0 });
  }
  for (const list of index.values()) list.sort((a, b) => (a.path < b.path ? -1 : 1));
  return index;
}

// componentId -> [moduleId]. Explicit `map` wins; otherwise derive from each
// component's `sources` paths: a source under a module's path claims that
// module and, when no other component claims them, its descendant modules.
function resolveMapping(ir, graph, map) {
  const result = new Map();
  const byPathDepth = [...graph.modules].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  const moduleForFile = (file) => {
    const rel = graph.repository.root && graph.repository.root !== '.' && file.startsWith(`${graph.repository.root}/`) ? file.slice(graph.repository.root.length + 1) : file;
    if (graph.fileModules && graph.fileModules[rel]) return graph.fileModules[rel];
    for (const m of byPathDepth) {
      if (m.path === '' ) continue;
      if (rel === m.path || rel.startsWith(`${m.path}/`)) return m.id;
    }
    return rel.includes('/') ? null : (graph.modules.find((m) => m.path === '' && m.entry.includes(rel)) || {}).id || null;
  };
  for (const c of ir.components) {
    if (map && Array.isArray(map[c.id])) { result.set(c.id, [...new Set(map[c.id])]); continue; }
    const ids = new Set();
    for (const s of c.sources || []) { const id = moduleForFile(s.path); if (id) ids.add(id); }
    // A component with no sources whose id is a module id (the bridge IR, or an IR that reuses
    // module ids on purpose) maps to that module.
    if (!ids.size && !(c.sources || []).length && graph.modules.some((m) => m.id === c.id)) ids.add(c.id);
    result.set(c.id, [...ids]);
  }
  // Descendants: a module whose path starts with a claimed module's path joins it when unclaimed.
  const claimed = new Set([...result.values()].flat());
  for (const [cid, ids] of result) {
    for (const parent of [...ids]) {
      const p = graph.modules.find((m) => m.id === parent);
      if (!p || p.path === '') continue;
      for (const m of graph.modules) if (!claimed.has(m.id) && m.path.startsWith(`${p.path}/`)) { ids.push(m.id); claimed.add(m.id); }
    }
  }
  return result;
}

function aggregate(edges, side, mapping) {
  const owner = new Map();
  for (const [cid, ids] of mapping) for (const id of ids) owner.set(id, cid);
  const acc = new Map();
  for (const e of edges) {
    const other = e[side];
    const key = owner.get(other) || `module:${other}`;
    if (!acc.has(key)) acc.set(key, { component: owner.get(other) || null, module: owner.get(other) ? null : other, weight: 0, evidence: [] });
    const a = acc.get(key);
    a.weight += e.weight;
    a.evidence = [...a.evidence, ...e.evidence].slice(0, 6);
  }
  return [...acc.values()].sort((a, b) => b.weight - a.weight);
}

// Full text of every file a finding points at (evidence imports, the
// partial-init proof), read from the analyzed tree at overlay time, so the
// page can show the cited line with the whole file around it to scroll
// through. Include listed component files as well as cited evidence files.
function collectSnippets(findings, sourceRoot, components) {
  const wanted = new Set(components.flatMap((c) => (c.fileList || []).map((f) => f.path)));
  for (const f of findings) {
    const ev = f.evidence || {};
    for (const v of ev.imports || []) if (v.file) wanted.add(v.file);
    for (const v of ev.closingLazyImports || []) if (v.file) wanted.add(v.file);
    const candidate = ev.partialInitCandidate || ev.proof;
    if (candidate) { wanted.add(candidate.entry); wanted.add(candidate.importer); }
    if (f.subject && f.subject.file) wanted.add(f.subject.file);
  }
  const out = {};
  for (const file of [...wanted].sort()) {
    let text;
    try {
      const root = fs.realpathSync(sourceRoot);
      const target = fs.realpathSync(path.resolve(root, file));
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
      text = fs.readFileSync(target, 'utf8');
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    out[file] = { total: lines.length, lines };
  }
  return out;
}

const CSS = `
html[data-bauify="on"] path[data-edge-id], html[data-bauify="on"] text[data-edge-label-for], html[data-bauify="on"] .edge-label { opacity: .12; }
html[data-bauify="on"] g[data-node-id] { opacity: .35; transition: opacity .15s; }
html[data-bauify="on"] g[data-node-id].bauify-mapped { opacity: 1; }
html[data-bauify="on"] .guided-views, html[data-bauify="on"] [class*="story"], html[data-bauify="on"] [class*="chapter"] { opacity: .25; pointer-events: none; }
#bauify-layer { pointer-events: none; }
#bauify-layer rect { fill: none; stroke-linejoin: round; }
/* The ring sits well outside Archify's own coloured border and is blurred into a halo, so the two never read as one outline. */
#bauify-layer rect.red { stroke: #FB7185; stroke-width: 6; filter: blur(4px); animation: bauify-glow-red 1.3s ease-in-out infinite; }
#bauify-layer rect.amber { stroke: #FBBF24; stroke-width: 5; opacity: .7; filter: blur(3.5px); }
#bauify-layer rect.blue { stroke: #60A5FA; stroke-width: 4; opacity: .55; filter: blur(3px); }
#bauify-layer rect.green { stroke: #34D399; stroke-width: 3; opacity: .45; filter: blur(2.5px); }
#bauify-layer rect.grey { stroke: #64748B; stroke-width: 1; opacity: .35; stroke-dasharray: 4 3; }
@keyframes bauify-glow-red {
  0%, 100% { opacity: .25; filter: blur(3px); }
  50% { opacity: 1; filter: blur(6px) drop-shadow(0 0 14px #FB7185); }
}
@media (prefers-reduced-motion: reduce) { #bauify-layer rect.red { animation: none; opacity: .9; filter: blur(4px) drop-shadow(0 0 10px #FB7185); } }
#bauify-legend { display: grid; gap: 3px; margin-top: 4px; font-size: 11px; }
#bauify-legend span { white-space: nowrap; }
#bauify-hint .k { color: var(--text-muted, #94a3b8); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
#bauify-legend i, #bauify-detail h3 i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
#bauify-legend b { color: var(--text, #f8fafc); font-weight: 600; margin-right: 4px; }
.bauify-red { background: #FB7185; } .bauify-amber { background: #FBBF24; } .bauify-blue { background: #60A5FA; } .bauify-green { background: #34D399; } .bauify-grey { background: #64748B; } .bauify-neutral { background: #64748B; }
#bauify-detail { position: fixed; left: 412px; top: 76px; width: 420px; max-height: calc(100vh - 100px); overflow: auto; z-index: 60; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text, #f8fafc); border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; padding: 14px 16px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; box-shadow: 0 18px 48px rgba(0,0,0,.3); }
#bauify-detail[hidden] { display: none; }
#bauify-detail h3 { margin: 0 0 2px; font-size: 14px; }
#bauify-detail .level { font-size: 11px; color: var(--text-muted, #94a3b8); }
#bauify-detail .level b { color: var(--text, #f8fafc); }
#bauify-detail svg.diagram { display: block; width: 100%; height: auto; margin-top: 6px; border: 1px solid var(--panel-border, #1e293b); border-radius: 8px; background: var(--bg, #0b1220); font-family: ui-monospace, Menlo, Consolas, monospace; }
#bauify-detail svg.diagram text { fill: var(--text, #f8fafc); font-size: 10px; }
#bauify-detail svg.diagram text.muted { fill: var(--text-muted, #94a3b8); font-size: 9px; }
#bauify-detail svg.diagram rect.node { fill: var(--panel, #0f172a); stroke: var(--panel-border, #1e293b); stroke-width: 1; }
#bauify-detail svg.diagram rect.node.focus { stroke: var(--backend-stroke, #34D399); stroke-width: 1.5; }
#bauify-detail svg.diagram path.e { fill: none; stroke: var(--text-muted, #94a3b8); stroke-width: 1.2; }
#bauify-detail svg.diagram path.e.lazy { stroke-dasharray: 4 3; }
#bauify-detail svg.diagram path.e.red { stroke: #FB7185; } #bauify-detail svg.diagram path.e.amber { stroke: #FBBF24; } #bauify-detail svg.diagram path.e.blue { stroke: #60A5FA; }
#bauify-detail svg.diagram rect.bar { fill: var(--backend-stroke, #34D399); opacity: .8; }
#bauify-detail .caption { color: var(--text-muted, #94a3b8); font-size: 11px; margin-top: 4px; }
#bauify-panel .ind.link { cursor: pointer; }
#bauify-panel .ind.link:hover { background: color-mix(in srgb, var(--text, #f8fafc) 5%, transparent); }
#bauify-panel .ind .more { color: var(--backend-stroke, #34D399); font-size: 11px; }
#bauify-panel .ind.active { background: color-mix(in srgb, var(--backend-stroke, #34D399) 8%, transparent); }
#bauify-panel .ind { display: grid; grid-template-columns: 12px 1fr; gap: 8px; align-items: start; padding: 6px 0; border-top: 1px solid var(--panel-border, #1e293b); }
#bauify-panel .ind i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; }
#bauify-panel .ind i.red { background: #FB7185; } #bauify-panel .ind i.amber { background: #FBBF24; } #bauify-panel .ind i.blue { background: #60A5FA; } #bauify-panel .ind i.green { background: #34D399; } #bauify-panel .ind i.neutral { background: #64748B; }
#bauify-panel .ind b { display: block; }
#bauify-panel .ind span.v { color: var(--text-muted, #94a3b8); display: block; }
#bauify-panel .ind .detail { color: var(--text-muted, #94a3b8); font-size: 11px; }
#bauify-panel h3 .badge { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #0b1220; }
#bauify-panel h3 .badge.red { background: #FB7185; } #bauify-panel h3 .badge.amber { background: #FBBF24; } #bauify-panel h3 .badge.blue { background: #60A5FA; } #bauify-panel h3 .badge.green { background: #34D399; } #bauify-panel h3 .badge.grey { background: #94a3b8; }
#bauify-panel { position: fixed; left: 16px; top: 76px; width: 380px; max-height: calc(100vh - 100px); overflow: auto; z-index: 60; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text, #f8fafc); border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; padding: 14px 16px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; box-shadow: 0 18px 48px rgba(0,0,0,.3); }
#bauify-panel[hidden] { display: none; }
#bauify-panel h3 { margin: 0 0 2px; font-size: 14px; }
#bauify-panel .k, #bauify-detail .k { color: var(--text-muted, #94a3b8); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin-top: 12px; }
#bauify-panel .stat { display: inline-block; margin: 6px 10px 0 0; padding: 3px 8px; border: 1px solid var(--panel-border, #1e293b); border-radius: 999px; }
#bauify-panel .edge { padding: 6px 0; border-top: 1px solid var(--panel-border, #1e293b); }
#bauify-panel .edge b { color: var(--backend-stroke, #34D399); }
#bauify-panel .ev, #bauify-detail .ev { color: var(--text-muted, #94a3b8); font-size: 11px; }
#bauify-panel .ev div, #bauify-detail .ev div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#bauify-panel .close, #bauify-detail .close { position: sticky; float: right; top: 0; margin: -4px -6px 0 0; top: 8px; background: none; border: 0; color: var(--text-muted, #94a3b8); font-size: 16px; cursor: pointer; }
#bauify-panel .warn { color: var(--text-muted, #94a3b8); font-style: italic; }
#btn-bauify[aria-pressed="true"] { outline: 1px solid var(--backend-stroke, #34D399); }
#bauify-panel details { margin-top: 6px; }
#bauify-panel summary { cursor: pointer; color: var(--text-muted, #94a3b8); font-size: 11px; }
#bauify-panel table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
#bauify-panel td { padding: 2px 4px 2px 0; border-top: 1px solid var(--panel-border, #1e293b); vertical-align: top; }
#bauify-panel td.n { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted, #94a3b8); white-space: nowrap; }
#bauify-panel td.p { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#bauify-panel .finding, #bauify-detail .finding { padding: 6px 8px; margin-top: 6px; border-left: 2px solid #FB7185; background: color-mix(in srgb, #FB7185 8%, transparent); }
#bauify-panel .finding.warning, #bauify-detail .finding.warning { border-left-color: #FBBF24; background: color-mix(in srgb, #FBBF24 10%, transparent); }
#bauify-panel .finding.info, #bauify-detail .finding.info { border-left-color: #60A5FA; background: color-mix(in srgb, #60A5FA 8%, transparent); }
#bauify-panel .finding code, #bauify-detail .finding code { font-size: 10px; color: var(--text-muted, #94a3b8); }
#bauify-hint { position: fixed; left: 16px; top: 76px; max-width: 820px; z-index: 59; padding: 8px 12px; border-radius: 8px; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text-muted, #94a3b8); border: 1px solid var(--panel-border, #1e293b); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
#bauify-hint[hidden] { display: none; }
#bauify-detail a { color: var(--backend-stroke, #34D399); text-decoration: none; } #bauify-detail a:hover { text-decoration: underline; }
#bauify-detail table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; } #bauify-detail td { padding: 2px 4px 2px 0; border-top: 1px solid var(--panel-border, #1e293b); vertical-align: top; } #bauify-detail td.n { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted, #94a3b8); white-space: nowrap; } #bauify-detail td.p { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#bauify-detail .ref { display: block; width: 100%; text-align: left; margin: 2px 0; padding: 4px 6px; border: 1px solid var(--panel-border, #1e293b); border-radius: 6px; background: none; color: var(--text, #f8fafc); font: inherit; font-size: 11px; cursor: pointer; }
#bauify-detail .ref:hover, #bauify-detail .ref.active { border-color: var(--backend-stroke, #34D399); background: color-mix(in srgb, var(--backend-stroke, #34D399) 8%, transparent); }
#bauify-detail .ref b { color: var(--backend-stroke, #34D399); font-weight: 600; }
#bauify-detail .ref span { color: var(--text-muted, #94a3b8); }
#bauify-detail .ref em { color: var(--text-muted, #94a3b8); font-style: normal; }
#bauify-code { position: fixed; right: 12px; top: 76px; width: min(600px, max(300px, calc(100vw - 860px))); box-sizing: border-box; max-height: calc(100vh - 92px); overflow: auto; z-index: 60; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text, #f8fafc); border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; padding: 14px 16px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; box-shadow: 0 18px 48px rgba(0,0,0,.3); }
.source-file { padding: 0; border: 0; background: none; color: var(--backend-stroke, #159f88); font: inherit; cursor: pointer; text-align: left; }
.source-file:hover { text-decoration: underline; }
#bauify-code[hidden] { display: none; }
#bauify-code h3 { margin: 0 0 2px; font-size: 13px; word-break: break-all; }
#bauify-code h3 a { color: var(--backend-stroke, #34D399); text-decoration: none; } #bauify-code h3 a:hover { text-decoration: underline; }
#bauify-code .k { color: var(--text-muted, #94a3b8); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin-top: 12px; }
#bauify-code .close { float: right; margin: -2px -6px 0 0; background: none; border: 0; color: var(--text-muted, #94a3b8); font-size: 16px; cursor: pointer; }
#bauify-code .why { color: var(--text-muted, #94a3b8); font-size: 11px; margin-top: 4px; }
#bauify-code pre { margin: 8px 0 0; padding: 6px 0; border: 1px solid var(--panel-border, #1e293b); border-radius: 8px; background: var(--bg, #0b1220); overflow: auto; max-height: calc(100vh - 210px); overscroll-behavior: contain; font-size: 12px; line-height: 1.35; }
#bauify-code .grip { position: sticky; top: -14px; z-index: 1; cursor: grab; user-select: none; margin: -14px -16px 0; padding: 10px 16px 4px; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); border-bottom: 1px dashed var(--panel-border, #1e293b); }
#bauify-code .grip:active { cursor: grabbing; }
#bauify-code .grip .k { margin-top: 0; }
#bauify-code .grip .k::before { content: '⋮⋮ '; letter-spacing: -2px; }
#bauify-code pre .ln { display: block; white-space: pre; padding: 0 10px; }
#bauify-code pre .ln i { display: inline-block; width: 3.5em; text-align: right; margin-right: 10px; color: var(--text-muted, #94a3b8); font-style: normal; user-select: none; }
#bauify-code pre .ln.hit { background: color-mix(in srgb, #FBBF24 18%, transparent); box-shadow: inset 3px 0 0 #FBBF24; }
#bauify-code pre .ln.hit.blue { background: color-mix(in srgb, #60A5FA 18%, transparent); box-shadow: inset 3px 0 0 #60A5FA; }
#bauify-code pre .ln.hit.red { background: color-mix(in srgb, #FB7185 18%, transparent); box-shadow: inset 3px 0 0 #FB7185; }
#bauify-code pre .gap { display: block; padding: 2px 10px; color: var(--text-muted, #94a3b8); font-size: 10px; }
#bauify-detail .fixes { margin-top: 4px; } #bauify-detail .fixes div { white-space: normal; }
`;

const JS = `
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

  var panel = document.createElement('aside');
  panel.id = 'bauify-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Bauify code analysis');
  document.body.appendChild(panel);

  var layer = null;
  var hint = document.createElement('div');
  hint.id = 'bauify-hint'; hint.hidden = true;
  document.body.appendChild(hint);
  var detail = document.createElement('aside');
  detail.id = 'bauify-detail'; detail.hidden = true; detail.setAttribute('aria-label', 'Bauify finding details');
  document.body.appendChild(detail);
  var codePane = document.createElement('aside');
  codePane.id = 'bauify-code'; codePane.hidden = true; codePane.setAttribute('aria-label', 'Bauify source excerpt');
  document.body.appendChild(codePane);
  // Danger levels behind the colours. Same wording everywhere: legend, badge, detail header.
  var LEVELS = {
    red: { name: 'critical', text: 'an error was reported; inspect its evidence and assumptions' },
    amber: { name: 'warning', text: 'eager import cycle (potentially import-order dependent) or hub module' },
    blue: { name: 'info', text: 'structural coupling; initialization behavior is not established' },
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
      ring.setAttribute('class', c.indicators.status);
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = c.label + ': ' + c.indicators.items.map(function (i) { return i.label + ' — ' + i.value; }).join('; ');
      ring.appendChild(title);
      layer.appendChild(ring);
    });
    svg.appendChild(layer);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function show(id) {
    var c = byId[id]; if (!c) return;
    hint.hidden = true;
    var h = '<button class="close" aria-label="Close">×</button>';
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
    h += '<div class="k">Repository</div><div class="ev">' + esc(data.repository.url || 'no origin') + (data.repository.revision ? ' @ ' + data.repository.revision.slice(0, 7) : '') +
      '<br>' + data.totals.modules + ' modules · ' + data.totals.edges + ' module edges · ' + data.unmapped.length + ' not on this diagram</div>';
    panel.innerHTML = h;
    panel.hidden = false;
    detail.hidden = true; codePane.hidden = true;
    panel.querySelector('.close').addEventListener('click', function () { panel.hidden = true; detail.hidden = true; codePane.hidden = true; hint.hidden = false; });
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
  function ref(file, line, rest, why, tone) {
    return '<button type="button" class="ref" data-file="' + esc(file) + '" data-line="' + line + '" data-why="' + esc(why || '') + '" data-tone="' + (tone || '') + '"><b>' + esc(short(file)) + '</b> <em>(line ' + line + ')</em>' + (rest ? ' ' + rest : '') + '</button>';
  }
  function findingCard(f) {
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
    if (f.evidence && f.evidence.imports && f.evidence.imports.length) {
      var isCycle = f.code === 'coupling/import-cycle' || f.code === 'coupling/cycle';
      ev += '<div class="ev" style="margin-top:4px">' + (isCycle ? 'Imports on the cycle — click one to see the code:' : 'Evidence — click to see the code:') + '</div>';
      f.evidence.imports.slice(0, 8).forEach(function (v) {
        var deferred = v.lazy || v.conditional || v.deferred || v.typeOnly;
        var kindText = deferred ? 'deferred / conditional / type-only import · dashed' : 'recorded module-scope import · solid';
        ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· ' + kindText + '</em>',
          deferred ? 'Execution timing is not proven; deferred functions may be called during initialization. Type-only imports are not runtime dependencies.' : 'Recorded at module scope; execution order and runtime behavior are not verified.', tone);
      });
      if (f.evidence.imports.length > 8) ev += '<div class="ev">… ' + (f.evidence.imports.length - 8) + ' more in findings.json</div>';
    }
    var fixes = (f.supportedFixes || []).length ? '<div class="ev fixes">' + f.supportedFixes.map(function (x) { return '<div>· ' + esc(x) + '</div>'; }).join('') + '</div>' : '';
    return '<div class="finding ' + esc(f.severity) + '"><b>' + esc(f.code) + '</b> · ' + esc(f.severity) + (f.id ? ' · ' + esc(f.id) : '') + '<br>' + esc(f.message) + ev + fixes + '</div>';
  }
  // Source excerpt for one file:line, from the windows embedded at overlay time.
  function showCode(file, line, why, tone) {
    var snip = (data.snippets || {})[file];
    line = Number.isInteger(line) && line > 0 ? line : null;
    var h = '<div class="grip" title="Drag to move up or down"><button class="close" aria-label="Close">×</button><div class="k">Source · ' + (line ? 'line ' + line : 'full file · no specific finding line') + ' · drag to move</div><h3>' + esc(file) + '</h3></div>';
    if (why) h += '<div class="why">' + esc(why) + '</div>';
    if (!snip) {
      h += '<div class="why" style="margin-top:10px">Source lines are not embedded in this page. Restart Code Analysis to include this file and its context.</div>';
    } else {
      h += '<pre>';
      snip.lines.forEach(function (text, i) {
        var n = i + 1;
        h += '<span class="ln' + (n === line ? ' hit ' + (tone || '') : '') + '"><i>' + n + '</i>' + esc(text) + '</span>';
      });
      h += '</pre>';
    }
    codePane.innerHTML = h;
    codePane.hidden = false;
    codePane.querySelector('.close').addEventListener('click', function () { codePane.hidden = true; detail.querySelectorAll('.ref.active').forEach(function (x) { x.classList.remove('active'); }); });
    // Vertical drag on the header; the pane keeps the top the user left it at across clicks.
    var grip = codePane.querySelector('.grip');
    grip.addEventListener('pointerdown', function (e) {
      if (e.target.closest('a') || e.target.closest('.close') || e.button !== 0) return;
      var startY = e.clientY, startTop = codePane.getBoundingClientRect().top;
      grip.setPointerCapture(e.pointerId);
      var move = function (ev) { var top = Math.max(8, Math.min(window.innerHeight - 60, startTop + ev.clientY - startY)); codePane.style.top = top + 'px'; codePane.style.maxHeight = 'calc(100vh - ' + (top + 16) + 'px)'; };
      var up = function () { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    var hit = codePane.querySelector('.ln.hit');
    if (hit) hit.scrollIntoView({ block: 'center' });
  }
  function showDetail(c, key) {
    var ind = c.indicators.items.filter(function (i) { return i.key === key; })[0]; if (!ind) return;
    var ids = ind.findings || [];
    var fl = allFindings(c).filter(function (f) { return ids.indexOf(f.id) !== -1; });
    var lvl = LEVELS[ind.status] || LEVELS.neutral;
    var h = '<button class="close" aria-label="Close">×</button>';
    h += '<div class="k">' + esc(c.label) + '</div><h3><i class="bauify-' + ind.status + '"></i>' + esc(ind.label) + '</h3>';
    h += '<div class="level"><b>' + esc(lvl.name) + '</b> — ' + esc(ind.value) + (ind.status === 'neutral' ? '' : '<br>' + esc(lvl.text)) + '</div>';
    h += '<div class="k">Diagram details</div>' + diagram(c, key, fl);
    h += '<div class="k">Findings · ' + fl.length + '</div>';
    if (!fl.length) h += '<div class="ev">' + (key === 'instability' ? 'Instability measures dependency direction: out / (in + out). 0 = no outgoing dependencies, 1 = no incoming dependents. It is not a failure probability or a quality verdict.' : 'No finding for this indicator; this is not a safety guarantee.') + '</div>';
    fl.forEach(function (f) { h += findingCard(f); });
    detail.innerHTML = h;
    detail.hidden = false;
    codePane.hidden = true;
    detail.querySelector('.close').addEventListener('click', function () { detail.hidden = true; codePane.hidden = true; panel.querySelectorAll('.ind.active').forEach(function (x) { x.classList.remove('active'); }); });
    detail.querySelectorAll('.ref').forEach(function (el) {
      el.addEventListener('click', function () {
        detail.querySelectorAll('.ref.active').forEach(function (x) { x.classList.remove('active'); }); el.classList.add('active');
        showCode(el.getAttribute('data-file'), parseInt(el.getAttribute('data-line'), 10), el.getAttribute('data-why'), el.getAttribute('data-tone'));
      });
    });
  }
  // Source links: GitHub-style blob/tree URLs from the origin + revision the facts were taken at.
  function repoBase() {
    var r = data.repository || {}; if (!r.url || !r.revision) return null;
    var u = String(r.url).replace(/^git@([^:]+):/, 'https://$1/').replace(/^([a-z][a-z0-9+.-]*:\\/\\/)[^/@\\s]+@/i, '$1').replace(/\\.git$/, '');
    if (!/^https?:\\/\\//.test(u)) return null;
    var root = r.root && r.root !== '.' ? r.root.replace(/\\/$/, '') + '/' : '';
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
    return instabilityDiagram(c);
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
    return svg + '<div class="caption">' + (isFile ? 'Representative file cycle. ' : 'Representative package-level cycle. ') + 'Solid = recorded module-scope dependency; dashed = deferred, conditional, type-only or asynchronous dependency. Green box = belongs to this component. Line numbers are in the findings below. ' +
      (f.evidence.kind !== 'eager' ? 'This dependency component contains deferred, conditional, or type-only edges. The drawing does not prove import-time safety.' : 'Module-scope dependency cycle. Inspect execution order and binding access; a graph alone does not prove failure.') + '</div>';
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
      '<br>A hub is a module that is both widely depended on (fan-in) and depends widely (fan-out). High fan-in means every change here ripples out to its dependents; high fan-out means changes elsewhere ripple in. Both at once is the usual shape of a module that has absorbed several responsibilities — a coordination point, not a bug. Check whether its dependents cluster by reason: that is where a split would go.</div>' + (f ? hubSources(c, f) : '');
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
    root.setAttribute('data-bauify', on ? 'on' : 'off');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      data.components.forEach(function (c) { var g = svg.querySelector('g[data-node-id="' + c.id + '"]'); if (g) g.classList.toggle('bauify-mapped', c.modules.length > 0); });
      drawLayer();
      hint.innerHTML = '<div class="k">Hint</div>' + legend();
      hint.hidden = false;
    } else { if (layer) layer.remove(); layer = null; panel.hidden = true; detail.hidden = true; codePane.hidden = true; hint.hidden = true; svg.querySelectorAll('.bauify-mapped').forEach(function (g) { g.classList.remove('bauify-mapped'); }); }
  }
  btn.addEventListener('click', function () { setOn(root.getAttribute('data-bauify') !== 'on'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'c' || e.key === 'C') { if (['INPUT', 'TEXTAREA'].indexOf((e.target && e.target.tagName) || '') === -1) btn.click(); } });
  svg.addEventListener('click', function (e) {
    if (root.getAttribute('data-bauify') !== 'on') return;
    var g = e.target.closest && e.target.closest('g[data-node-id]');
    if (!g) return;
    e.stopPropagation(); e.preventDefault();
    show(g.getAttribute('data-node-id'));
  }, true);
  window.addEventListener('resize', function () { if (root.getAttribute('data-bauify') === 'on') drawLayer(); });
})();
`;
