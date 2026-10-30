// Overlay: layer Bauify's module facts onto an Archify-delivered HTML.
//
// The delivered artifact is never modified; a new file is written next to it.
// The overlay adds one toolbar button ("Code analysis"). When it is on, the
// authored diagram and guided views recede and every mapped component gets a
// status ring around its box: pulsing red for supplied error findings,
// amber when a rule warns (eager cycle, hub), blue when only informational facts exist
// (lazy/runtime or package-level cycle), green when nothing fired, grey when no code maps to it.
// The left column opens on a project overview (verdict, up to three findings
// to look at first, every finding by rule, coverage, and the colour key);
// opening a finding there switches the shared reading column and dims the
// components it does not involve. Clicking a component replaces the overview
// with that component's panel, which links back to it.
// Clicking a component opens a panel with the indicators, the mapped modules,
// every file with its LOC and import counts, and the module edges with
// file:line evidence. Clicking an indicator switches to a problem page with the
// findings behind it and a small diagram Bauify draws to explain them (the
// cycle ring, the hub star, the in/out bars). Every file:line a finding
// cites is a button; with --source the lines around it are embedded and open
// in the same reading column with the line highlighted. No import lines are drawn on
// the authored diagram itself.
// The whole Bauify dataset (module graph plus per-file facts) is embedded in
// the page so future findings can attach to a file without re-running.
// `findings` lists every finding once, with the modules and components it
// touches; a finding whose modules are on no component has componentIds []
// and is still listed, so a project-level view never loses it.
// Nothing in the authored IR is changed or inferred.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../extract/shared/diagnostics.mjs';
import { sourceChanges } from './source-changes.mjs';
import { buildOverview } from './overview.mjs';
import { buildTaskPayloads } from '../lib/task.mjs';
import { buildAtlas, ATLAS_CSS, ATLAS_JS } from './atlas.mjs';

export function buildOverlay({ ir, graph, html, map, facts = null, findings = [], findingsDocument = null, sourceRoot = null, run = {} }) {
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

  // Indicators and the diagram rings show open findings: a finding accepted in
  // the baseline (with unchanged evidence) stays listed but does not colour the diagram.
  const accepted = new Set(Object.entries(run.review ? run.review.findings : {}).filter(([, r]) => r.status === 'accepted').map(([id]) => id));
  const openFindings = findings.filter((f) => !accepted.has(f.id));
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
      indicators: indicators(set, mods, openFindings, mapping, new Set(ids.flatMap((id) => (fileIndex.get(id) || []).map((f) => f.path)))),
    };
  });

  // Component-level edges (deduplicated, both directions kept separately).
  const edgeMap = new Map();
  for (const c of components) for (const o of c.outgoing) if (o.component) {
    const key = `${c.id}>${o.component}`;
    edgeMap.set(key, { from: c.id, to: o.component, weight: o.weight, evidence: o.evidence });
  }
  const edges = [...edgeMap.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  const unmapped = graph.modules.filter((m) => !claimed.has(m.id)).map((m) => ({ id: m.id, label: m.label, files: m.files, loc: m.loc, fanIn: m.fanIn, fanOut: m.fanOut, fileList: (fileIndex.get(m.id) || []).map((f) => ({ ...f, module: m.id })) }));
  const fileModule = new Map([...fileIndex].flatMap(([id, list]) => list.map((f) => [f.path, id])));
  const reviewed = run.review ? run.review.findings : {};
  const listed = findings.map((f) => ({
    ...(reviewed[f.id] ? { review: reviewed[f.id] } : {}),
    ...f,
    moduleIds: findingModules(f, fileModule),
    componentIds: components.filter((c) => c.findings.includes(f)).map((c) => c.id),
  }));

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
    findings: listed,
    tasks: facts && findingsDocument ? buildTaskPayloads({ findings: findingsDocument, facts, review: run.review }) : {},
    overview: buildOverview({ findings: listed, graph, facts, unmapped, run }),
    snippets: sourceRoot ? collectSnippets(findings, sourceRoot, components.concat(unmapped.filter((m) => listed.some((f) => (f.moduleIds || []).includes(m.id)))), facts) : {},
  };

  // The Atlas view needs raw facts (files, dependencies, functions); without them only the Classic view exists.
  const atlas = buildAtlas({ graph, facts, findings, review: run.review });
  // Its data precedes the Classic script, which offers the Atlas button only when the data is present.
  const atlasData = atlas ? `<script type="application/json" id="bauify-atlas-data">${scriptSafeJson(atlas)}</script>\n` : '';
  const atlasView = atlas ? `<style id="bauify-atlas-style">${ATLAS_CSS}</style>\n<script id="bauify-atlas-script">${ATLAS_JS}</script>\n` : '';
  const injection = `\n<!-- bauify overlay: authored diagram untouched; analysis layer below -->\n<script type="application/json" id="bauify-analysis">${scriptSafeJson(payload)}</script>\n${atlasData}<style id="bauify-style">${CSS}</style>\n<script id="bauify-script">${JS}</script>\n${atlasView}`;
  const idx = html.lastIndexOf('</body>');
  const out = idx === -1 ? html + injection : html.slice(0, idx) + injection + html.slice(idx);
  return { html: out, overview: payload.overview, mapped: components.filter((c) => c.modules.length).length, components: components.length, edges: edges.length, unmapped: unmapped.length, snippets: Object.keys(payload.snippets).length };
}

// Modules a finding is about: named directly, or owning one of its files.
// Files outside the graph (excluded roles, no facts) contribute nothing.
export function findingModules(f, fileModule) {
  const sub = f.subject || {};
  const ids = new Set();
  if (typeof sub.module === 'string') ids.add(sub.module);
  if (Array.isArray(sub.modules)) for (const m of sub.modules) ids.add(m);
  if (Array.isArray(sub.files)) for (const file of sub.files) if (fileModule.has(file)) ids.add(fileModule.get(file));
  if (typeof sub.file === 'string' && fileModule.has(sub.file)) ids.add(fileModule.get(sub.file));
  for (const file of boundaryFiles(f)) if (fileModule.has(file)) ids.add(fileModule.get(file));
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// A boundary finding is about both ends of every import that crosses it.
function boundaryFiles(f) {
  if (!f.subject || !f.subject.boundary) return [];
  return ((f.evidence && f.evidence.imports) || []).flatMap((i) => [i.file, i.to]);
}

// Embedded source text can contain `<!--` or `<script`, which move the HTML
// tokenizer into script-data escape states where the closing </script> no
// longer ends the element. Escaping every `<` keeps the JSON valid and inert.
export function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// A finding touches a component when its subject names the component, one of
// its modules, a cycle containing one of its modules, or a file on either end
// of an import crossing a declared boundary.
function touches(f, set, componentId, filePaths) {
  const sub = f.subject || {};
  if (sub.component === componentId) return true;
  if (sub.boundary && filePaths && boundaryFiles(f).some((p) => filePaths.has(p))) return true;
  if (typeof sub.file === 'string' && filePaths && filePaths.has(sub.file)) return true;
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
  const structuralFileCycles = fileCycles.filter((f) => f.evidence.kind === 'structural');
  const lazyFileCycles = fileCycles.filter((f) => !['eager', 'structural'].includes(f.evidence.kind));
  const cycles = findings.filter((f) => f.code === 'coupling/cycle' && f.subject.modules.some((m) => set.has(m)));
  const partners = new Set();
  for (const f of cycles) for (const m of f.subject.modules) if (!set.has(m)) partners.add(owner.get(m) ? `component:${owner.get(m)}` : `module:${m}`);
  const internalOnly = cycles.length > 0 && partners.size === 0;
  const cycleStatus = proven.length ? 'red' : eagerFileCycles.length ? 'amber' : (structuralFileCycles.length || lazyFileCycles.length || cycles.length) ? 'blue' : 'green';
  const cycleValue = proven.length
    ? `reported import-cycle error (${proven.map((f) => f.subject.files.length).join(', ')} files) ${proven[0].evidence.risk ? ` — ${proven[0].evidence.risk.loadingNote}` : ""}`
    : eagerFileCycles.length
      ? `module-scope import cycle (${eagerFileCycles.map((f) => f.subject.files.length).join(', ')} files); load-time behavior unverified`
      : structuralFileCycles.length
        ? `structural Java dependency cycle (${structuralFileCycles.map(f => f.subject.files.length).join(', ')} files); class initialization not assessed`
      : lazyFileCycles.length
        ? `cycle with deferred or conditional imports (${lazyFileCycles.map((f) => f.subject.files.length).join(', ')} files); initialization behavior not proven`
        : cycles.length
          ? (internalOnly ? 'package-level cycle inside this component; no file cycles' : `package-level cycle with ${partners.size} other${partners.size === 1 ? '' : 's'}; no file cycles`)
          : 'none';
  const hubs = findings.filter((f) => f.code === 'coupling/hub' && set.has(f.subject.module));
  // Only present when boundaries are configured and one is crossed here: an
  // unconfigured check must not show up as a green "no violations".
  const boundaries = findings.filter((f) => f.code === 'architecture/boundary' && boundaryFiles(f).some((p) => filePaths.has(p)));
  // Only present when functions were measured and one here reaches a threshold.
  const complex = findings.filter((f) => f.code === 'complexity/function' && filePaths.has(f.subject.file))
    .sort((a, b) => b.evidence.complexity - a.evidence.complexity || b.evidence.nesting - a.evidence.nesting);
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
    ...(boundaries.length ? [{
      key: 'boundary', label: 'Architecture boundary',
      status: boundaries.some((f) => f.severity === 'error') ? 'red' : 'amber',
      value: boundaries.map((f) => `${f.subject.boundary.from} → ${f.subject.boundary.to} (${f.evidence.totalImports} import${f.evidence.totalImports === 1 ? '' : 's'})`).join(', ') + ' cross a configured boundary',
      detail: [],
      findings: boundaries.map((f) => f.id).filter(Boolean),
    }] : []),
    ...(complex.length ? [{
      key: 'complexity', label: 'Complex functions',
      status: complex.some((f) => f.severity === 'warning') ? 'amber' : 'blue',
      value: `${complex.length} function${complex.length === 1 ? '' : 's'} over the threshold; highest ${complex[0].subject.function} (complexity ${complex[0].evidence.complexity}, nesting ${complex[0].evidence.nesting})`,
      detail: [],
      findings: complex.map((f) => f.id).filter(Boolean),
    }] : []),
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
// partial-init proof), captured by the extractor, so the
// page can show the cited line with the whole file around it to scroll
// through. Include listed component files as well as cited evidence files.
function collectSnippets(findings, sourceRoot, components, facts) {
  const captured = new Map((facts?.files || []).filter(f => typeof f.sourceText === 'string').map(f => [f.path, f.sourceText]));
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
    let text = captured.get(file);
    // New working-tree facts must never fall back to mutable source files.
    if (text === undefined && facts?.repository?.sourceKind === 'working-tree') continue;
    if (text === undefined) {
      try {
        const root = fs.realpathSync(sourceRoot);
        const target = fs.realpathSync(path.resolve(root, file));
        const relative = path.relative(root, target);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
        text = fs.readFileSync(target, 'utf8');
      } catch { continue; }
    }
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    out[file] = { total: lines.length, lines };
  }
  const changes = sourceChanges(sourceRoot, facts?.repository, new Map([...wanted].filter(file => captured.has(file)).map(file => [file, captured.get(file)])));
  for (const [file, change] of changes) if (out[file]) out[file].changes = change;
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
#bauify-legend span { white-space: normal; }
#bauify-legend i, #bauify-detail h3 i, #bauify-overview h3 i, #bauify-overview summary i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
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
#bauify-panel { position: fixed; left: 16px; top: 76px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; max-height: calc(100vh - 100px); overflow: auto; z-index: 60; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text, #f8fafc); border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; padding: 14px 16px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; box-shadow: 0 18px 48px rgba(0,0,0,.3); }
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
#bauify-overview { position: fixed; left: 16px; top: 76px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; max-height: calc(100vh - 100px); overflow: auto; z-index: 60; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text, #f8fafc); border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; padding: 14px 16px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; box-shadow: 0 18px 48px rgba(0,0,0,.3); }
#bauify-overview[hidden] { display: none; }
#bauify-overview h3 { margin: 4px 0 2px; font-size: 14px; }
#bauify-overview .k { color: var(--text-muted, #94a3b8); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin-top: 12px; }
#bauify-overview .ov-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
#bauify-overview .ov-head .k { margin-top: 0; }
#bauify-overview .ov-toggle { flex: none; width: 22px; height: 22px; padding: 0; border: 1px solid var(--panel-border, #1e293b); border-radius: 6px; background: none; color: var(--text-muted, #94a3b8); font: inherit; line-height: 1; cursor: pointer; }
#bauify-overview .ev { color: var(--text-muted, #94a3b8); font-size: 11px; }
#bauify-overview details { margin-top: 6px; }
#bauify-overview summary { cursor: pointer; color: var(--text-muted, #94a3b8); font-size: 11px; }
#bauify-overview .cov div { margin-top: 2px; }
#bauify-overview.collapsed { width: auto; max-width: min(380px, calc(100vw - 32px)); padding: 8px 12px; }
#bauify-overview.collapsed > :not(.ov-head):not(h3) { display: none; }
#bauify-overview.collapsed h3 { cursor: pointer; margin-bottom: 0; }
.bauify-item { display: block; width: 100%; box-sizing: border-box; text-align: left; margin: 6px 0 0; padding: 6px 8px; border: 0; border-left: 2px solid #60A5FA; border-radius: 0 6px 6px 0; background: color-mix(in srgb, #60A5FA 8%, transparent); color: var(--text, #f8fafc); font: inherit; font-size: 12px; cursor: pointer; }
.bauify-item.amber { border-left-color: #FBBF24; background: color-mix(in srgb, #FBBF24 10%, transparent); }
.bauify-item.red { border-left-color: #FB7185; background: color-mix(in srgb, #FB7185 8%, transparent); }
.bauify-item:hover, .bauify-item.active { outline: 1px solid var(--backend-stroke, #34D399); }
.bauify-item .n { display: inline-block; min-width: 16px; color: var(--text-muted, #94a3b8); }
.bauify-item em { color: var(--text-muted, #94a3b8); font-style: normal; font-size: 11px; }
.bauify-item .what, .bauify-item .where { display: block; color: var(--text-muted, #94a3b8); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#bauify-panel .back { display: block; margin: 0 0 6px; padding: 0; border: 0; background: none; color: var(--backend-stroke, #34D399); font: inherit; font-size: 11px; cursor: pointer; }
#bauify-panel .back:hover { text-decoration: underline; }
/* Opening a finding from the overview dims everything it does not involve. */
html[data-bauify-focus="on"] g[data-node-id]:not(.bauify-focus) { opacity: .35; }
html[data-bauify-focus="on"] #bauify-layer rect:not(.focus) { opacity: .12; animation: none; }
/* Narrow screens: deeper panels cover the shallower ones instead of colliding. */
@media (max-width: 1180px) { #bauify-detail { left: 16px; width: min(420px, calc(100vw - 32px)); box-sizing: border-box; z-index: 61; } }
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
/* Keep responsive overrides after the base source-panel rule. Below the
   three-column budget, source takes the foreground instead of a 300px sliver. */
@media (max-width: 1180px) { #bauify-code { left: 16px; right: 16px; width: auto; z-index: 62; } }
#bauify-code pre .ln { display: block; white-space: pre; padding: 0 10px; }
#bauify-code pre.excerpt .ln { white-space: pre-wrap; overflow-wrap: anywhere; }
/* Reading UI uses proportional text; source and numeric evidence keep monospace. */
#bauify-overview, #bauify-panel, #bauify-detail, #bauify-code { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.55; }
#bauify-overview h3, #bauify-panel h3, #bauify-detail h3 { font-size: 18px; line-height: 1.35; margin-top: 8px; }
#bauify-overview .k, #bauify-panel .k, #bauify-detail .k, #bauify-code .k { font-size: 11px; letter-spacing: .04em; }
#bauify-overview .ev, #bauify-panel .ev, #bauify-detail .ev, #bauify-detail .caption, #bauify-detail .level, #bauify-code .why, #bauify-code .diff-legend { font-size: 13px; }
#bauify-overview summary, #bauify-panel summary, #bauify-detail summary { font-size: 13px; cursor: pointer; }
.bauify-item { padding: 10px 12px; margin-top: 10px; }
.bauify-item b { font-size: 14px; }
.bauify-item .what, .bauify-item .where { font-size: 13px; }
.bauify-item .what { white-space: normal; overflow: visible; text-overflow: clip; }
#bauify-detail { left: 16px; width: min(420px, calc(100vw - 32px)); box-sizing: border-box; }
#bauify-code { left: 16px; right: auto; width: min(600px, calc(100vw - 32px)); }
#bauify-code pre, #bauify-code h3, .source-file, #bauify-detail td.n { font-family: ui-monospace, Menlo, Consolas, monospace; }
[data-bauify-source="on"] #bauify-detail, [data-bauify-source="on"] #bauify-panel, [data-bauify-source="on"] #bauify-overview { display: none; }
#bauify-detail .back { border: 0; padding: 0; background: none; color: var(--backend-stroke, #159f88); cursor: pointer; font: inherit; }
#bauify-code pre .ln.diff-added { border-left: 3px solid #34d399; padding-left: 7px; }
#bauify-code pre .ln.diff-modified { border-left: 3px solid #fbbf24; padding-left: 7px; }
#bauify-code pre .diff-deleted { display: block; color: #fb7185; padding: 0 10px; font-style: normal; font-size: 11px; }
#bauify-code .diff-legend { margin: 8px 0; font-size: 11px; color: var(--text-muted, #94a3b8); }
#bauify-code .diff-legend .added { color: #34d399; }
#bauify-code .diff-legend .modified { color: #fbbf24; }
#bauify-code .diff-legend .deleted { color: #fb7185; }
#bauify-code pre .ln i { display: inline-block; width: 3.5em; text-align: right; margin-right: 10px; color: var(--text-muted, #94a3b8); font-style: normal; user-select: none; }
#bauify-code pre .ln.hit { background: color-mix(in srgb, #FBBF24 18%, transparent); box-shadow: inset 3px 0 0 #FBBF24; }
#bauify-code pre .ln.hit.blue { background: color-mix(in srgb, #60A5FA 18%, transparent); box-shadow: inset 3px 0 0 #60A5FA; }
#bauify-code pre .ln.hit.red { background: color-mix(in srgb, #FB7185 18%, transparent); box-shadow: inset 3px 0 0 #FB7185; }
#bauify-code pre .gap { display: block; padding: 2px 10px; color: var(--text-muted, #94a3b8); font-size: 10px; }
#bauify-detail .fixes { margin-top: 4px; } #bauify-detail .fixes div { white-space: normal; }
/* Review: re-analysis, comparison with the previous run, baseline status. */
#bauify-overview .bauify-reanalyze { float: right; margin: 0 0 6px 8px; padding: 3px 10px; border: 1px solid var(--panel-border, #1e293b); border-radius: 6px; background: none; color: var(--backend-stroke, #34D399); font: inherit; font-size: 12px; cursor: pointer; }
#bauify-overview .bauify-reanalyze[disabled] { color: var(--text-muted, #94a3b8); cursor: progress; }
#bauify-overview .review-line { margin-top: 4px; }
.bauify-item.accepted { opacity: .62; }
.bauify-item .badge-new, .bauify-item .badge-accepted, #bauify-detail .badge-accepted { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; vertical-align: 1px; }
.bauify-item .badge-new { background: #FB7185; color: #0b1220; }
.bauify-item .badge-accepted, #bauify-detail .badge-accepted { border: 1px solid var(--panel-border, #1e293b); color: var(--text-muted, #94a3b8); }
/* One reading column owns the layout; the four pages retain their scroll state. */
#bauify-reader { position: fixed; left: 16px; top: var(--bauify-reader-top, 76px); bottom: 16px; width: 420px; z-index: 62; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; background: linear-gradient(var(--panel, #0f172a), var(--panel, #0f172a)), var(--bg, #0b1220); color: var(--text, #f8fafc); font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
#bauify-reader[hidden] { display: none; }
#bauify-reader > .reader-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--panel-border, #1e293b); }
#bauify-reader .reader-path { font-size: 12px; color: var(--text-muted, #94a3b8); }
#bauify-reader .reader-nav button, #bauify-reader .locate { border: 1px solid var(--panel-border, #1e293b); border-radius: 6px; padding: 4px 8px; background: none; color: var(--text, #f8fafc); cursor: pointer; font: inherit; font-size: 12px; }
#bauify-reader .back { border: 0; padding: 0; background: none; color: var(--backend-stroke, #159f88); cursor: pointer; font: inherit; }
#bauify-reader > #bauify-overview, #bauify-reader > #bauify-panel, #bauify-reader > #bauify-detail, #bauify-reader > #bauify-code { position: static; width: 100%; max-width: none; max-height: none; min-height: 0; flex: 1; overflow: auto; box-sizing: border-box; border: 0; border-radius: 0; box-shadow: none; padding: 16px; background: none; }
#bauify-reader.collapsed { bottom: auto; width: auto; max-width: calc(100vw - 32px); }
#bauify-reader.collapsed > section { display: none; }
#bauify-reader.collapsed > .reader-nav { border-bottom: 0; }
#bauify-code .grip { position: static; cursor: default; margin: 0 0 12px; padding: 0 0 12px; border-bottom-style: solid; }
#bauify-code .grip .k::before { content: none; }
#bauify-code pre { max-height: none; }
#bauify-reader .technical { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--panel-border, #1e293b); }
#bauify-reader .technical summary { color: var(--text-muted, #94a3b8); }
#bauify-reader .next-step { margin: 12px 0; padding: 12px; background: color-mix(in srgb, var(--backend-stroke, #34D399) 7%, transparent); border-radius: 8px; }
#bauify-reader .next-step p { margin: 4px 0; }
#bauify-reader .verdict-note { margin: 8px 0 16px; }
html[data-bauify="on"] .cards, html[data-bauify="on"] .guided-views { display: none; }
@media (min-width: 1001px) {
  html[data-bauify="on"] .container { width: 100%; max-width: none; }
  html[data-bauify="on"] .diagram-container { margin-top: 24px; }
  html[data-bauify="on"]:not([data-bauify-reader-collapsed]) .diagram-container,
  html[data-bauify="on"]:not([data-bauify-reader-collapsed]) .cards { margin-left: 444px; }
  html[data-bauify="on"] .guided-views { display: none; }
}
@media (max-width: 1000px) { #bauify-reader { width: calc(100vw - 32px); } }
@media print { #bauify-reader { display: none; } }
#bauify-reader button:focus-visible, #bauify-reader summary:focus-visible, #bauify-reader textarea:focus-visible { outline: 2px solid var(--backend-stroke, #159f88); outline-offset: 3px; }
#bauify-reader h3, #bauify-reader .where, #bauify-reader .task-status { overflow-wrap: anywhere; }
#bauify-reader .bauify-item .what, #bauify-reader .bauify-item .where { white-space: normal; overflow-wrap: anywhere; }
#bauify-reader { overflow-wrap: anywhere; }
#bauify-reader .ref { box-sizing: border-box; overflow-wrap: anywhere; }
#bauify-reader .ref b { color: var(--text, #f8fafc); }
#bauify-reader .inline-evidence { margin: 12px 0; }
#bauify-reader .inline-evidence pre { margin: 6px 0; padding: 10px; border-radius: 6px; background: var(--bg, #0b1220); font: 12px/1.6 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
#bauify-reader .inline-evidence .evidence-line { display: block; }
#bauify-reader .inline-evidence .focus-line, #bauify-code .ln.range-hit { background: color-mix(in srgb, var(--backend-stroke, #159f88) 12%, transparent); }
#bauify-reader .inline-evidence .line-number { color: var(--text-muted, #94a3b8); user-select: none; }
#bauify-reader .ai-task { margin: 16px 0; padding: 12px 0; border-top: 1px solid var(--panel-border, #1e293b); border-bottom: 1px solid var(--panel-border, #1e293b); }
#bauify-reader .ai-task > summary { color: var(--text, #f8fafc); font-weight: 600; }
#bauify-reader .task-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
#bauify-reader .task-actions button { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--panel-border, #1e293b); color: var(--text, #f8fafc); background: none; cursor: pointer; }
#bauify-reader .task-actions button:first-child { background: var(--text, #f8fafc); color: var(--panel, #0f172a); }
#bauify-reader .task-actions button:disabled { opacity: .5; cursor: wait; }
#bauify-reader .task-preview { display: block; box-sizing: border-box; width: 100%; min-height: 180px; max-height: 360px; resize: vertical; padding: 10px; border: 1px solid var(--panel-border, #1e293b); border-radius: 6px; color: var(--text, #f8fafc); background: var(--bg, #0b1220); font: 12px/1.6 ui-monospace, monospace; }
#bauify-reader .coverage-notice { padding: 8px 0; color: var(--text-muted, #94a3b8); font-size: 12px; }
#bauify-reader .relationship { margin: 16px 0; }
@media (max-width: 600px) { html[data-bauify="on"] .toolbar #btn-preset, html[data-bauify="on"] .toolbar #btn-present { display: none; } }
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
    red: { name: 'critical', text: 'an error was reported; inspect its evidence and assumptions' },
    amber: { name: 'warning', text: 'eager import cycle (potentially import-order dependent), hub module, crossed architecture boundary, or very complex function' },
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
      : f.code === 'coupling/import-cycle' ? 'Inspect the cited imports and initialization behavior before changing this dependency.'
      : f.code === 'coupling/cycle' ? 'Check which shared responsibility links these modules. A module cycle does not establish a file-level failure.'
      : f.code === 'architecture/boundary' ? 'Check what the cited imports need from the other layer: move it behind an interface in an allowed layer, or update the rule if this dependency is intended.'
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
      ev += '<div class="ev" style="margin-top:4px">' + (isCycle ? 'Imports on the cycle — click one to see the code:' : crossing ? 'Imports that cross the boundary — click one to see the code:' : 'Evidence — click to see the code:') + '</div>';
      f.evidence.imports.slice(0, 8).forEach(function (v) {
        if (crossing) {
          var kind = data.repository.language === 'java' ? 'Java source dependency' : v.typeOnly ? 'type-only import' : (v.lazy || v.conditional) ? 'deferred or conditional import' : 'module-scope import';
          ev += ref(v.file, v.line, '<span>→ ' + esc(short(v.to)) + '</span> <em>· ' + kind + '</em>',
            'This import makes ' + crossing.from + ' depend on ' + crossing.to + ', which the configured rule forbids.' + (v.typeOnly ? ' It is type-only: nothing is loaded at runtime, but the layer still depends on code in the other layer.' : ''), tone);
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
  var GROUPS = { 'coupling/import-cycle': 'Import cycles', 'coupling/cycle': 'Module cycles', 'coupling/hub': 'Hub modules', 'architecture/boundary': 'Boundary violations', 'complexity/function': 'Complex functions' };
  var LANGS = { py: 'Python', ts: 'JS/TS', java: 'Java' };
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function toneOf(severity) { return severity === 'error' ? 'red' : severity === 'warning' ? 'amber' : 'blue'; }
  function modLabel(id) { return moduleInfo[id] ? moduleInfo[id].label : id; }
  function findingTitle(f) {
    var s = f.subject || {};
    if (f.code === 'coupling/import-cycle' && s.files) return 'Import cycle · ' + plural(s.files.length, 'file');
    if (f.code === 'coupling/cycle' && s.modules) return 'Module cycle · ' + plural(s.modules.length, 'module');
    if (f.code === 'coupling/hub' && s.module) return modLabel(s.module) + ' connects many modules';
    if (f.code === 'architecture/boundary' && s.boundary) return s.boundary.from + ' depends on ' + s.boundary.to;
    // Java names carry their parameter types to tell overloads apart.
    if (f.code === 'complexity/function' && s.function) return s.function + (s.function.endsWith(')') ? '' : '()') + ' is complex';
    return f.code;
  }
  function findingWhat(f) {
    var s = f.subject || {};
    if (s.files) return 'Files: ' + s.files.slice(0, 3).map(short).join(', ') + (s.files.length > 3 ? ' …' : '');
    if (s.modules) return 'Modules: ' + s.modules.slice(0, 4).map(modLabel).join(', ') + (s.modules.length > 4 ? ' …' : '');
    if (f.code === 'coupling/hub' && f.evidence) return f.evidence.fanIn + ' modules depend on it; it depends on ' + f.evidence.fanOut + '.';
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
      (r.status === 'accepted' ? '<span class="badge-accepted">accepted</span>' : r.status === 'accepted-changed' ? '<span class="badge-accepted">accepted · evidence changed</span>' : '');
    return '<button type="button" class="bauify-item ' + toneOf(f.severity) + (r.status === 'accepted' ? ' accepted' : '') + '" data-finding="' + esc(id) + '"' + (r.reason ? ' title="Accepted: ' + esc(r.reason) + '"' : '') + '>' + (n ? '<span class="n">' + n + '</span>' : '') +
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
    var verdictText = o.verdict === 'none-found' && acceptedCount ? 'No open findings · ' + acceptedCount + ' accepted in the baseline' : v.text;
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
    } else if (acceptedCount) h += '<div class="ev" style="margin-top:8px">Every finding is accepted in the baseline. New findings, and accepted ones whose code changes, will show up here.</div>';
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
      : f.code === 'architecture/boundary' ? 'These imports break a boundary declared in the analysis config. The rule comes from the config, not from the diagram.'
      : f.code === 'complexity/function' ? 'Cyclomatic complexity counts independent paths through the function. A high count is a maintenance signal, not a defect.' : lvl.text;
    h += '<div class="level"><b>' + esc(lvl.name) + '</b> — ' + esc(findingWhat(f)) + '<br>' + esc(explanation) + '</div>';
    if (f.review && f.review.reason) h += '<p class="ev"><span class="badge-accepted">' + (f.review.status === 'accepted-changed' ? 'accepted · evidence changed' : 'accepted') + '</span> ' + esc(f.review.reason) + (f.review.status === 'accepted-changed' ? ' — the code behind it changed since it was accepted; review it again.' : '') + '</p>';
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
`;
