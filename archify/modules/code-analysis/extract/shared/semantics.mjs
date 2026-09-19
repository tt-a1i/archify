// Schema validation checks shape; these checks protect graph identity and
// references. Keep errors in the same structured format as AJV diagnostics.
export function semanticErrors(name, data) {
  const errors = [];
  const add = (path, message, params = {}) => errors.push({ path, message, params });
  const unique = (items, key, prefix) => {
    const seen = new Set();
    items.forEach((item, i) => {
      const value = item[key];
      if (seen.has(value)) add(`${prefix}/${i}/${key}`, `must be unique: ${value}`, { value });
      seen.add(value);
    });
    return seen;
  };
  if (name === 'raw-facts') {
    const unresolved = data.imports.filter((edge) => !edge.resolved).length;
    if (Object.values(data.unresolved).reduce((sum, count) => sum + count, 0) !== unresolved) {
      add('/unresolved', 'counter total must match unresolved imports');
    }
    const files = unique(data.files, 'path', '/files');
    data.imports.forEach((edge, i) => {
      if (!files.has(edge.from)) add(`/imports/${i}/from`, 'must reference a recorded file');
      if (edge.resolved && !files.has(edge.to)) add(`/imports/${i}/to`, 'must reference a recorded file');
    });
    data.symbols.forEach((symbol, i) => {
      if (!files.has(symbol.file)) add(`/symbols/${i}/file`, 'must reference a recorded file');
    });
    data.parse_errors?.forEach((error, i) => {
      if (!files.has(error.path)) add(`/parse_errors/${i}/path`, 'must reference a recorded file');
    });
  }
  if (name === 'module-graph') {
    const ids = unique(data.modules, 'id', '/modules');
    const pairs = new Set();
    data.edges.forEach((edge, i) => {
      for (const key of ['from', 'to']) if (!ids.has(edge[key])) add(`/edges/${i}/${key}`, 'must reference an existing module');
      if (edge.from === edge.to) add(`/edges/${i}`, 'must connect two distinct modules');
      const pair = JSON.stringify([edge.from, edge.to]);
      if (pairs.has(pair)) add(`/edges/${i}`, 'must be aggregated into one edge per module pair');
      pairs.add(pair);
    });
    if (data.fileModules) {
      const counts = new Map();
      for (const [file, id] of Object.entries(data.fileModules).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (!ids.has(id)) add('/fileModules', 'must reference an existing module', { file, id });
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      data.modules.forEach((m, i) => {
        if ((counts.get(m.id) || 0) !== m.files) add(`/modules/${i}/files`, 'must match fileModules ownership count');
        if (m.entry.some((file) => data.fileModules[file] !== m.id)) add(`/modules/${i}/entry`, 'must belong to this module');
      });
      data.edges.forEach((e, i) => e.evidence.forEach((v, j) => {
        if (data.fileModules[v.file] !== e.from || data.fileModules[v.to] !== e.to) add(`/edges/${i}/evidence/${j}`, 'must agree with fileModules ownership');
      }));
    }
  }
  return errors;
}
