// Atlas: a second way to read the same analysis. The Classic view reads the
// result against the authored architecture diagram and opens source evidence;
// the Atlas draws the whole analyzed tree at file and function level so the
// shape of the problems is visible at once:
//
// - modules are arcs around a circle (a thicker arc is a reported hub);
// - files are ticks just inside the arcs, grouped by module;
// - every resolved in-tree dependency between two files is a curve, bundled
//   through its modules so dense coupling reads as thick strands;
// - every measured function is a spike outside its file whose length is its
//   cyclomatic complexity; reported functions carry a dot in their severity colour;
// - a selected finding (import cycle path, module cycle, hub, boundary imports,
//   imports reaching inside a module, complex function) is drawn over everything else;
// - a focused module marks the files other modules import, so its public
//   surface (or the lack of one) shows without any rule having to fire.
//
// Nothing here is new analysis: the payload is a projection of raw facts, the
// module graph and the findings already shown in the Classic view. Unresolved
// dependency records draw no curve, so a missing curve is not proof of absent
// coupling; the side panel states the unresolved counts. Source text stays in
// the Classic view, which the Atlas links to for any finding's evidence.
import { clientAsset } from './client-assets.mjs';

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Shortest unambiguous label for each module: the fewest trailing path
// segments that no other module shares (`executor`, `cache/decorators`).
// The full path stays available for tooltips.
export function moduleLabels(paths) {
  const split = paths.map((p) => (p ? p.split('/') : []));
  return split.map((segs, i) => {
    if (!segs.length) return '.';
    for (let n = 1; n <= segs.length; n += 1) {
      const tail = segs.slice(-n).join('/');
      if (split.every((other, j) => j === i || other.slice(-n).join('/') !== tail)) return tail;
    }
    return paths[i];
  });
}

function fileModuleOf(graph) {
  if (graph.fileModules) return new Map(Object.entries(graph.fileModules));
  // Graphs written before fileModules existed: the deepest module path containing the file.
  const byDepth = [...graph.modules].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  return {
    get: (file) => (byDepth.find((m) => m.path && (file === m.path || file.startsWith(`${m.path}/`))) || {}).id,
    has() { return true; },
  };
}

function title(f, labelOf) {
  const s = f.subject || {};
  if (f.code === 'complexity/function' && s.function) return s.function + (s.function.endsWith(')') ? '' : '()');
  if (f.code === 'coupling/import-cycle' && s.files) return `Import cycle · ${s.files.length} files`;
  if (f.code === 'coupling/cycle' && s.modules) return `Module cycle · ${s.modules.length} modules`;
  if (f.code === 'coupling/hub' && s.module) return `Hub · ${labelOf(s.module)}`;
  if (f.code === 'coupling/concentration') return s.file ? `Large file · ${s.file.split('/').pop()}` : `Concentration · ${labelOf(s.module)}`;
  if (f.code === 'redundancy/duplicate-block' && f.evidence) return `Duplicate · ${f.evidence.lines} lines × ${f.evidence.totalOccurrences}`;
  if (f.code === 'coupling/internal-leak' && s.module) return `Internal imports · ${labelOf(s.module)}`;
  if (f.code === 'architecture/boundary' && s.boundary) return `${s.boundary.from} → ${s.boundary.to}`;
  return f.code;
}

// The Atlas payload: compact arrays indexed by position. Returns null without
// raw facts, since files, dependencies and functions all come from them.
export function buildAtlas({ graph, facts, findings = [], review = null }) {
  if (!facts || !graph) return null;
  const fileModule = fileModuleOf(graph);
  const graphModules = [...graph.modules].sort((a, b) => compareText(a.path, b.path) || compareText(a.id, b.id));
  const analyzed = facts.files.filter((f) => !(graph.excluded?.roles || []).includes(f.role) && fileModule.get(f.path));
  const byModule = new Map();
  for (const f of analyzed) {
    const id = fileModule.get(f.path);
    (byModule.get(id) || byModule.set(id, []).get(id)).push(f);
  }
  const modules = graphModules.filter((m) => byModule.has(m.id));
  const labels = moduleLabels(modules.map((m) => m.path));
  const moduleIndex = new Map(modules.map((m, i) => [m.id, i]));
  const labelOf = (id) => (moduleIndex.has(id) ? labels[moduleIndex.get(id)] : id);

  const files = [];
  const fileIndex = new Map();
  modules.forEach((m, mi) => {
    for (const f of byModule.get(m.id).sort((a, b) => compareText(a.path, b.path))) {
      fileIndex.set(f.path, files.length);
      files.push({ path: f.path, module: mi, loc: f.loc });
    }
  });

  const pairs = new Set();
  let resolved = 0;
  for (const i of facts.imports) {
    if (!i.resolved) continue;
    resolved += 1;
    if (!fileIndex.has(i.from) || !fileIndex.has(i.to) || i.from === i.to) continue;
    pairs.add(`${fileIndex.get(i.from)}>${fileIndex.get(i.to)}`);
  }
  const edges = [...pairs].map((k) => k.split('>').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const accepted = new Set(Object.entries(review?.findings || {}).filter(([, r]) => r.status === 'accepted').map(([id]) => id));
  const listed = [];
  const functionFinding = new Map();
  for (const f of findings) {
    const s = f.subject || {};
    const entry = { id: f.id, code: f.code, severity: f.severity, title: title(f, labelOf), accepted: accepted.has(f.id) };
    if (f.code === 'complexity/function' && fileIndex.has(s.file)) {
      entry.kind = 'function';
      functionFinding.set(`${s.file}\u0000${s.function}`, listed.length);
    } else if (f.code === 'coupling/import-cycle' && Array.isArray(s.files)) {
      entry.kind = 'cycle';
      entry.files = s.files.filter((p) => fileIndex.has(p)).map((p) => fileIndex.get(p));
      const path = (f.evidence?.path || []).filter((p) => fileIndex.has(p)).map((p) => fileIndex.get(p));
      entry.path = path.length > 1 ? path : entry.files;
    } else if (f.code === 'coupling/cycle' && Array.isArray(s.modules)) {
      entry.kind = 'modules';
      entry.modules = s.modules.filter((id) => moduleIndex.has(id)).map((id) => moduleIndex.get(id));
    } else if (f.code === 'coupling/hub' && moduleIndex.has(s.module)) {
      entry.kind = 'module';
      entry.module = moduleIndex.get(s.module);
    } else if (f.code === 'coupling/concentration' && moduleIndex.has(s.module)) {
      // Highlights the module like a hub, without being counted as one.
      entry.kind = 'area';
      entry.module = moduleIndex.get(s.module);
    } else if (f.code === 'coupling/concentration' && fileIndex.has(s.file)) {
      entry.kind = 'file';
      entry.file = fileIndex.get(s.file);
    } else if (f.code === 'redundancy/duplicate-block' && Array.isArray(s.files)) {
      entry.kind = 'files';
      entry.files = s.files.filter((p) => fileIndex.has(p)).map((p) => fileIndex.get(p));
    } else if (f.code === 'coupling/internal-leak' && moduleIndex.has(s.module)) {
      // Drawn like a boundary finding (the cited imports), plus the module whose
      // internals they reach and its entry files, if it has any.
      entry.kind = 'edges';
      entry.module = moduleIndex.get(s.module);
      entry.edges = (f.evidence?.imports || []).filter((i) => fileIndex.has(i.file) && fileIndex.has(i.to)).map((i) => [fileIndex.get(i.file), fileIndex.get(i.to)]);
      entry.entries = (f.evidence?.entries || []).filter((p) => fileIndex.has(p)).map((p) => fileIndex.get(p));
    } else if (f.code === 'architecture/boundary') {
      entry.kind = 'edges';
      entry.edges = (f.evidence?.imports || []).filter((i) => fileIndex.has(i.file) && fileIndex.has(i.to)).map((i) => [fileIndex.get(i.file), fileIndex.get(i.to)]);
    } else entry.kind = 'other';
    listed.push(entry);
  }

  // [file, name, line, complexity, nesting, length, finding index or -1]
  const functions = (facts.functions || [])
    .filter((fn) => fileIndex.has(fn.file))
    .map((fn) => [fileIndex.get(fn.file), fn.qualname || fn.name, fn.line, fn.complexity, fn.nesting ?? 0, (fn.endLine ?? fn.line) - fn.line + 1,
      functionFinding.has(`${fn.file}\u0000${fn.qualname}`) ? functionFinding.get(`${fn.file}\u0000${fn.qualname}`) : -1])
    .sort((a, b) => a[0] - b[0] || a[2] - b[2] || compareText(a[1], b[1]));
  for (const [i, fn] of functions.entries()) if (fn[6] !== -1) listed[fn[6]].fn = i;

  const unresolved = facts.unresolved || graph.unresolved || {};
  return {
    language: facts.repository?.language ?? null,
    measured: Array.isArray(facts.functions),
    modules: modules.map((m, i) => ({ id: m.id, label: labels[i], path: m.path, fanIn: m.fanIn, fanOut: m.fanOut })),
    files: files.map((f) => [f.path, f.module, f.loc]),
    edges,
    functions,
    findings: listed,
    coverage: {
      records: facts.imports.length,
      resolved,
      external: unresolved.external || 0,
      unknown: (unresolved.unknown || 0) + (unresolved.opaque || 0),
      outside: unresolved.outside || 0,
      parseErrors: (facts.parse_errors || []).length,
      excluded: graph.excluded?.files || 0,
    },
  };
}

export const ATLAS_CSS = clientAsset('atlas.css');

export const ATLAS_JS = clientAsset('atlas.js');
