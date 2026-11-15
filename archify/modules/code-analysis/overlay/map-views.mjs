// Offline projections of the captured analysis. No extraction or layout dependency.
import { clientAsset } from './client-assets.mjs';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Iterative strongly-connected components keep deep repository graphs stack safe.
export function dependencyLayers(ids, edges) {
  const next = new Map(ids.map(id => [id, []])), prev = new Map(ids.map(id => [id, []]));
  for (const e of edges) if (next.has(e.from) && next.has(e.to)) { next.get(e.from).push(e.to); prev.get(e.to).push(e.from); }
  const seen = new Set(), order = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id); const stack = [[id, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1], children = next.get(frame[0]);
      if (frame[1] < children.length) { const child = children[frame[1]++]; if (!seen.has(child)) { seen.add(child); stack.push([child, 0]); } }
      else { order.push(frame[0]); stack.pop(); }
    }
  }
  const group = new Map(), groups = [];
  for (const id of order.reverse()) {
    if (group.has(id)) continue;
    const index = groups.length, members = [], stack = [id]; group.set(id, index);
    while (stack.length) { const node = stack.pop(); members.push(node); for (const child of prev.get(node)) if (!group.has(child)) { group.set(child, index); stack.push(child); } }
    groups.push(members.sort(compare));
  }
  const outs = groups.map(() => new Set()), indegree = groups.map(() => 0), levels = groups.map(() => 0);
  for (const e of edges) { const a = group.get(e.from), b = group.get(e.to); if (a !== b && a != null && b != null && !outs[a].has(b)) { outs[a].add(b); indegree[b]++; } }
  const queue = indegree.flatMap((n, i) => n ? [] : [i]);
  for (let head = 0; head < queue.length; head++) { const a = queue[head]; for (const b of outs[a]) { levels[b] = Math.max(levels[b], levels[a] + 1); if (--indegree[b] === 0) queue.push(b); } }
  return { group, groups, layers: new Map(ids.map(id => [id, levels[group.get(id)]])) };
}

export function buildMapViews({ graph, facts = null, findings = [], review = null }) {
  const ordered = [...graph.modules].sort((a, b) => compare(a.id, b.id));
  const ids = ordered.map(m => m.id), allowed = new Set(ids);
  const topology = dependencyLayers(ids, graph.edges);
  const owners = new Map(Object.entries(graph.fileModules || {}));
  const byPath = [...ordered].sort((a, b) => b.path.length - a.path.length);
  if (!graph.fileModules) for (const f of facts?.files || []) {
    const m = byPath.find(m => m.path && (m.path === f.path || f.path.startsWith(m.path + '/'))); if (m) owners.set(f.path, m.id);
  }
  const related = new Map(ids.map(id => [id, []]));
  const projected = findings.map(f => {
    const s = f.subject || {}, moduleIds = new Set(f.moduleIds || []);
    if (s.module) moduleIds.add(s.module);
    for (const id of s.modules || []) moduleIds.add(id);
    const locations = [s.file, ...(s.files || []), ...(s.locations || []).map(l => l.file), ...(f.external?.locations || []).map(l => l.file), ...(f.evidence?.imports || []).flatMap(i => [i.file, i.to])];
    for (const file of locations) if (owners.has(file)) moduleIds.add(owners.get(file));
    const p = { id: f.id, code: f.code, severity: f.severity, title: f.title || f.message || f.code, moduleIds: [...moduleIds].filter(id => allowed.has(id)).sort(compare), accepted: (f.review || review?.findings?.[f.id])?.status === 'accepted' };
    for (const id of p.moduleIds) related.get(id).push(p);
    return p;
  });
  const modules = ordered.map(m => {
    const reports = related.get(m.id), open = reports.filter(f => !f.accepted || f.severity === 'error');
    return { ...m, layer: topology.layers.get(m.id), cycle: topology.groups[topology.group.get(m.id)].length > 1, findings: reports.map(f => f.id), health: ['error', 'warning', 'info'].find(level => open.some(f => f.severity === level)) || 'clear', weight: Math.sqrt(m.loc + 1) + m.fanIn * 3 };
  });
  const edges = graph.edges.filter(e => allowed.has(e.from) && allowed.has(e.to)).map(e => ({ from: e.from, to: e.to, weight: e.weight, evidence: e.evidence, cycle: topology.group.get(e.from) === topology.group.get(e.to), backward: topology.layers.get(e.from) >= topology.layers.get(e.to) }));
  const files = (facts?.files || []).filter(f => allowed.has(owners.get(f.path))).map(f => ({ path: f.path, moduleId: owners.get(f.path), loc: f.loc || 0 }));
  const fileSet = new Set(files.map(f => f.path)), internal = [];
  for (const i of facts?.imports || []) if (i.resolved && fileSet.has(i.from) && fileSet.has(i.to)) internal.push({ from: i.from, to: i.to, line: i.line, kind: 'import' });
  for (const c of facts?.calls || []) if (c.target && c.resolution !== 'unresolved' && fileSet.has(c.file) && fileSet.has(c.target.file || c.file)) internal.push({ from: c.file, to: c.target.file || c.file, line: c.line, targetLine: c.target.line, name: c.target.name, kind: 'call' });
  return { modules, edges, files, internal, findings: projected, hasFacts: Boolean(facts), callModel: facts?.callModel || null };
}
export const MAP_VIEWS_CSS = clientAsset('map-views.css');
export const MAP_VIEWS_JS = clientAsset('map-views.js');
