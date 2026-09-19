// Module Graph: fold file-level import edges into modules.
// Grouping precedence: explicit `modules.groups` > package boundary (a directory
// holding package.json / pyproject.toml / __init__.py) > directory depth.
// Files whose role is listed in `modules.excludeRoles` (default test, generated)
// are dropped from the graph but counted, so the omission stays visible.
import { matcher } from '../extract/shared/glob.mjs';
import { createHash } from 'node:crypto';

const PACKAGE_MARKERS = ['package.json', 'pyproject.toml', '__init__.py'];

export function buildModuleGraph(facts, config = {}) {
  const options = { depth: 2, excludeRoles: ['test', 'generated'], groups: {}, packageBoundaries: true, ...(config.modules || {}) };
  const excluded = new Set(options.excludeRoles);
  const groupMatchers = Object.entries(options.groups).map(([id, globs]) => [id, matcher(Array.isArray(globs) ? globs : [globs])]);
  const packageDirs = options.packageBoundaries ? collectPackageDirs(facts.files) : [];

  const fileModule = new Map();
  const modules = new Map();
  let excludedFiles = 0;
  for (const file of facts.files) {
    if (excluded.has(file.role)) { excludedFiles += 1; continue; }
    const key = moduleKey(file.path, groupMatchers, packageDirs, options.depth);
    fileModule.set(file.path, key);
    // A root-level file is its own module (main.py, config.py): such files
    // are entry points or shared constants with opposite roles, and folding
    // them together manufactures cycles that the code does not have.
    const label = key.startsWith('file:') ? key.slice(5) : key === '' ? '(root)' : key;
    if (!modules.has(key)) modules.set(key, { id: moduleId(key), label, path: key.startsWith('file:') ? '' : key, files: [], loc: 0, fanIn: 0, fanOut: 0 });
    const mod = modules.get(key);
    mod.files.push(file.path);
    mod.loc += file.loc;
  }

  const ids = uniqueModuleIds([...modules.keys()]);
  for (const [key, mod] of modules) mod.id = ids.get(key);

  const edgeMap = new Map();
  const incoming = new Map(); // file -> count of cross-module incoming edges (entry selection)
  for (const imp of facts.imports) {
    if (!imp.resolved) continue;
    const from = fileModule.get(imp.from);
    const to = fileModule.get(imp.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}\0${to}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { from: ids.get(from), to: ids.get(to), weight: 0, kinds: { eager: 0 }, evidence: [] });
    const edge = edgeMap.get(key);
    edge.weight += 1;
    edge.kinds[imp.kind] = (edge.kinds[imp.kind] || 0) + 1;
    if (imp.lazy) edge.kinds.lazy = (edge.kinds.lazy || 0) + 1;
    for (const flag of ['typeOnly', 'conditional', 'implicit']) if (imp[flag]) edge.kinds[flag] = (edge.kinds[flag] || 0) + 1;
    if (!imp.lazy && !imp.typeOnly && !imp.conditional && !(facts.repository.language === 'ts' && imp.kind === 'dynamic')) edge.kinds.eager = (edge.kinds.eager || 0) + 1;
    if (edge.evidence.length < 5) edge.evidence.push({ file: imp.from, line: imp.line, to: imp.to, ...Object.fromEntries(['lazy', 'typeOnly', 'conditional', 'implicit'].filter((flag) => imp[flag]).map((flag) => [flag, true])), ...(facts.repository.language === 'ts' && imp.kind === 'dynamic' ? { deferred: true } : {}) });
    incoming.set(imp.to, (incoming.get(imp.to) || 0) + 1);
  }

  const byId = new Map([...modules.values()].map((m) => [m.id, m]));
  for (const edge of edgeMap.values()) { byId.get(edge.from).fanOut += 1; byId.get(edge.to).fanIn += 1; }

  const moduleList = [...modules.values()].map((m) => ({
    id: m.id,
    label: m.label,
    path: m.path,
    files: m.files.length,
    loc: m.loc,
    fanIn: m.fanIn,
    fanOut: m.fanOut,
    instability: m.fanIn + m.fanOut === 0 ? null : round(m.fanOut / (m.fanIn + m.fanOut)),
    entry: pickEntries(m.files, incoming),
  })).sort((a, b) => compareText(a.id, b.id));

  const edges = [...edgeMap.values()]
    .map((e) => ({ ...e, kinds: Object.fromEntries(Object.entries(e.kinds).sort()) }))
    .sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));

  return {
    schema_version: 1,
    repository: facts.repository,
    grouping: { depth: options.depth, packageBoundaries: options.packageBoundaries, groups: Object.keys(options.groups).sort() },
    excluded: { roles: [...excluded].sort(), files: excludedFiles },
    modules: moduleList,
    fileModules: Object.fromEntries([...fileModule].sort(([a], [b]) => compareText(a, b)).map(([file, key]) => [file, ids.get(key)])),
    edges,
    unresolved: facts.unresolved,
  };
}

function collectPackageDirs(files) {
  const dirs = new Set();
  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf('/') + 1);
    if (PACKAGE_MARKERS.includes(base)) dirs.add(f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '');
  }
  // Deeper package dirs first so the most specific boundary wins.
  return [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || compareText(a, b));
}

function moduleKey(filePath, groupMatchers, packageDirs, depth) {
  for (const [id, match] of groupMatchers) if (match(filePath)) return id;
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  if (dir === '') return `file:${filePath}`;
  const segments = dir.split('/');
  const byDepth = segments.slice(0, depth).join('/');
  // A package boundary only refines grouping within the depth budget: a package
  // deeper than `depth` folds into its depth-level ancestor like any other dir.
  for (const pkg of packageDirs) {
    if (pkg === '') continue; // the root package would swallow everything
    if ((dir === pkg || dir.startsWith(`${pkg}/`)) && pkg.split('/').length <= depth) return pkg;
  }
  return byDepth;
}

function moduleId(key) {
  if (key === '') return 'root';
  const base = key.startsWith('file:') ? key.slice(5).replace(/\.[^.]+$/, '') : key;
  const slug = base.replace(/[^A-Za-z0-9_]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return !slug ? 'module' : /^[a-z0-9]/.test(slug) ? slug : `module-${slug}`;
}

function uniqueModuleIds(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(moduleId(key), (counts.get(moduleId(key)) || 0) + 1);
  // Reserve every readable base, including names that look like a suffix we
  // might generate. Existing non-colliding maps keep their current IDs.
  const used = new Set(counts.keys());
  const ids = new Map();
  for (const key of [...keys].sort(compareText)) {
    const base = moduleId(key);
    if (counts.get(base) === 1) { ids.set(key, base); continue; }
    const suffix = createHash('sha256').update(key).digest('hex').slice(0, 12);
    let id = `${base}-${suffix}`;
    while (used.has(id)) id += '-x';
    used.add(id); ids.set(key, id);
  }
  return ids;
}

function pickEntries(files, incoming) {
  const score = (f) => {
    const base = f.slice(f.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    const named = /^(index|__init__|main|cli|app)$/.test(base) ? 1 : 0;
    return [(incoming.get(f) || 0), named];
  };
  return [...files]
    .sort((a, b) => { const [ia, na] = score(a); const [ib, nb] = score(b); return ib - ia || nb - na || compareText(a, b); })
    .slice(0, 3);
}

function round(value) { return Math.round(value * 1000) / 1000; }
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
