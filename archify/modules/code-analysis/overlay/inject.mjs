// Overlay: layer Bauify's module facts onto an Archify-delivered HTML.
//
// The delivered artifact is never modified; a new file is written next to it.
// The overlay adds one toolbar button ("Code analysis"). When it is on, the
// authored diagram and guided views recede and every mapped component gets a
// status ring around its box: pulsing red for an error (a circular dependency),
// amber when a rule warns (deferred cycle, hub, complex function), blue when only
// informational facts exist, green when nothing fired, grey when no code maps to it.
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
import { fail } from '../core/index.mjs';
import { sourceChanges } from './source-changes.mjs';
import { buildOverview } from './overview.mjs';
import { buildTaskPayloads } from '../lib/task.mjs';
import { buildAtlas, ATLAS_CSS, ATLAS_JS } from './atlas.mjs';
import { clientAsset } from './client-assets.mjs';

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

  // Indicators and the diagram rings show open findings: a warning or info
  // accepted in the baseline (with unchanged evidence) stays listed but does not
  // colour the diagram. An accepted error keeps its red ring: the baseline stops
  // it from failing CI, it does not make the structure sound.
  const accepted = new Set(Object.entries(run.review ? run.review.findings : {}).filter(([, r]) => r.status === 'accepted').map(([id]) => id));
  const openFindings = findings.filter((f) => !accepted.has(f.id) || f.severity === 'error');
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
  if (f.code === 'organization/folder-roles') for (const file of f.evidenceDigest?.files || []) if (fileModule.has(file)) ids.add(fileModule.get(file));
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
  if (f.code === 'organization/folder-roles' && filePaths && (f.evidenceDigest?.files || []).some((file) => filePaths.has(file))) return true;
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
  // The colour follows the highest reported severity among the cycles here
  // (module-scope and Java cycles are errors, deferred ones warnings, Rust
  // ones info); the text follows the kind of cycle. Neither a deferred cycle
  // nor a missing finding establishes import safety.
  const fileCycles = findings.filter((f) => f.code === 'coupling/import-cycle' && f.subject.files.some((p) => filePaths.has(p)));
  const eagerFileCycles = fileCycles.filter((f) => f.evidence.kind === 'eager');
  const structuralFileCycles = fileCycles.filter((f) => f.evidence.kind === 'structural');
  const lazyFileCycles = fileCycles.filter((f) => !['eager', 'structural'].includes(f.evidence.kind));
  const cycles = findings.filter((f) => f.code === 'coupling/cycle' && f.subject.modules.some((m) => set.has(m)));
  const partners = new Set();
  for (const f of cycles) for (const m of f.subject.modules) if (!set.has(m)) partners.add(owner.get(m) ? `component:${owner.get(m)}` : `module:${m}`);
  const internalOnly = cycles.length > 0 && partners.size === 0;
  const worst = ['error', 'warning', 'info'].find((level) => [...fileCycles, ...cycles].some((f) => f.severity === level));
  const cycleStatus = worst ? { error: 'red', warning: 'amber', info: 'blue' }[worst] : 'green';
  const rustCycle = structuralFileCycles.some((f) => /^Rust /.test(f.evidence.risk?.loadingNote || ''));
  const cycleValue = eagerFileCycles.length
      ? `module-scope import cycle (${eagerFileCycles.map((f) => f.subject.files.length).join(', ')} files); load-time behavior unverified`
      : structuralFileCycles.length
        ? `structural ${rustCycle ? 'Rust' : 'Java'} dependency cycle (${structuralFileCycles.map(f => f.subject.files.length).join(', ')} files); ${rustCycle ? 'runtime loading order not implied' : 'class initialization not assessed'}`
      : lazyFileCycles.length
        ? `cycle with deferred or conditional imports (${lazyFileCycles.map((f) => f.subject.files.length).join(', ')} files); initialization behavior not proven`
        : cycles.length
          ? (internalOnly ? 'package-level cycle inside this component; no file cycles' : `package-level cycle with ${partners.size} other${partners.size === 1 ? '' : 's'}; no file cycles`)
          : 'none';
  const hubs = findings.filter((f) => f.code === 'coupling/hub' && set.has(f.subject.module));
  // Only present when the rule reported a module or file here.
  const concentrated = findings.filter((f) => f.code === 'coupling/concentration' && (set.has(f.subject.module) || filePaths.has(f.subject.file)));
  // Only present when boundaries are configured and one is crossed here: an
  // unconfigured check must not show up as a green "no violations".
  const boundaries = findings.filter((f) => f.code === 'architecture/boundary' && boundaryFiles(f).some((p) => filePaths.has(p)));
  // Only present when the rule reported other modules reaching inside one of these modules.
  const leaks = findings.filter((f) => f.code === 'coupling/internal-leak' && set.has(f.subject.module));
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
    ...(concentrated.length ? [{
      key: 'concentration', label: 'Concentration',
      status: concentrated.some((f) => f.severity === 'warning') ? 'amber' : 'blue',
      value: concentrated.map((f) => f.subject.file
        ? `${f.subject.file}: ${f.evidence.loc} lines`
        : `${f.subject.module}: ${[f.evidence.reach ? `${f.evidence.reach.dependents} of ${f.evidence.reach.modules} other modules depend on it` : null, f.evidence.size ? `${Math.round(f.evidence.size.share * 100)}% of the analyzed lines` : null].filter(Boolean).join(', ')}`).join('; '),
      detail: [],
      findings: concentrated.map((f) => f.id).filter(Boolean),
    }] : []),
    ...(boundaries.length ? [{
      key: 'boundary', label: 'Architecture boundary',
      status: boundaries.some((f) => f.severity === 'error') ? 'red' : 'amber',
      value: boundaries.map((f) => `${f.subject.boundary.from} → ${f.subject.boundary.to} (${f.evidence.totalImports} import${f.evidence.totalImports === 1 ? '' : 's'})`).join(', ') + ' cross a configured boundary',
      detail: [],
      findings: boundaries.map((f) => f.id).filter(Boolean),
    }] : []),
    ...(leaks.length ? [{
      key: 'entry', label: 'Entry point',
      status: leaks.some((f) => f.severity === 'warning') ? 'amber' : 'blue',
      value: leaks.map((f) => `${f.subject.module}: ${f.evidence.consumers.length} module${f.evidence.consumers.length === 1 ? '' : 's'} import ${f.evidence.internalFiles.length} internal file${f.evidence.internalFiles.length === 1 ? '' : 's'}${f.evidence.entries.length ? ', bypassing its entry point' : ', no entry file'}`).join('; '),
      detail: [],
      findings: leaks.map((f) => f.id).filter(Boolean),
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
    if (f.code === 'organization/folder-roles') for (const file of f.evidenceDigest?.files || []) wanted.add(file);
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

const CSS = clientAsset('overlay.css');

const JS = clientAsset('overlay.js');
