// Shared ownership resolution for diagram alignment and pinned comparison.
function normalizeRelPath(rawPath, repoRoot) {
  if (typeof rawPath !== 'string' || !rawPath) return null;
  const norm = rawPath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  const rootPrefix = repoRoot && repoRoot !== '.' ? repoRoot.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '') : '';
  if (!norm || norm === '.') return '';
  if (rootPrefix && norm === rootPrefix) return '';
  return rootPrefix && norm.startsWith(`${rootPrefix}/`) ? norm.slice(rootPrefix.length + 1) : norm;
}

export function resolveMapping(ir, graph, map) {
  const result = new Map();
  const files = new Map(graph.modules.map((m) => [m.id, []]));
  const fileModules = new Map(Object.entries(graph.fileModules || {}));
  for (const [file, id] of fileModules) files.get(id)?.push(file);
  // Historical graph exports lack fileModules; retain their entry-file anchors
  // and directory-path fallback when exact ownership is unavailable.
  for (const m of graph.modules) if (!files.get(m.id).length) {
    files.set(m.id, m.entry || []);
    for (const file of m.entry || []) fileModules.set(file, m.id);
  }
  const prefixes = [];
  const seenPrefix = new Set();
  const addPrefix = (cid, prefix) => {
    const key = `${cid}\0${prefix}`;
    if (seenPrefix.has(key)) return;
    seenPrefix.add(key);
    prefixes.push({ cid, prefix, depth: prefix ? prefix.split('/').length : 0 });
  };
  for (const c of ir.components) {
    if (map && Array.isArray(map[c.id])) { result.set(c.id, [...new Set(map[c.id])]); continue; }
    const ids = new Set();
    for (const s of c.sources || []) {
      const rel = normalizeRelPath(s?.path, graph.repository?.root);
      if (rel === null) continue;
      let id = fileModules.get(rel);
      if (!id && !graph.fileModules && rel) {
        const byDepth = [...graph.modules].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
        const exact = byDepth.find((m) => m.path === rel);
        const hasChildren = byDepth.some((m) => m.path.startsWith(`${rel}/`));
        const enclosing = hasChildren ? null : byDepth.find((m) => m.path && rel.startsWith(`${m.path}/`));
        id = (exact || enclosing)?.id;
      }
      if (id) ids.add(id);
      else addPrefix(c.id, rel);
    }
    // A component with no sources whose id is a module id (the bridge IR, or an IR that reuses
    // module ids on purpose) maps to that module.
    if (!ids.size && !(c.sources || []).length && graph.modules.some((m) => m.id === c.id)) ids.add(c.id);
    for (const id of ids) {
      const p = graph.modules.find((m) => m.id === id);
      if (p?.path && files.get(id).some((file) => file.startsWith(`${p.path}/`))) addPrefix(c.id, p.path);
    }
    result.set(c.id, [...ids]);
  }
  // A file anchor or explicit map claims its whole module. Other modules follow
  // the most specific directory for each captured file. A split module or tied
  // prefixes retain every owner, so component order cannot decide the result.
  const claimed = new Set([...result.values()].flat());
  prefixes.sort((a, b) => b.depth - a.depth);
  for (const m of graph.modules) {
    if (claimed.has(m.id)) continue;
    const owners = new Set();
    for (const file of files.get(m.id)) {
      const matches = prefixes.filter(({ prefix }) => !prefix || file.startsWith(`${prefix}/`));
      for (const match of matches) {
        if (match.depth !== matches[0].depth) break;
        owners.add(match.cid);
      }
    }
    for (const cid of owners) result.get(cid).push(m.id);
  }
  for (const ids of result.values()) ids.sort();
  return result;
}
