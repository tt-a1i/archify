// A component's first member uniquely keys its disjoint partition. Equal
// all/eager memberships can therefore share a key without sharing arrays.
export function partitionEdges(components, edges) {
  const owners = new Map(), parts = new Map();
  for (const component of components) {
    parts.set(component[0], []);
    for (const node of component) owners.set(node, component[0]);
  }
  for (const edge of edges) {
    const component = owners.get(edge.from);
    if (component !== undefined && component === owners.get(edge.to)) parts.get(component).push(edge);
  }
  return parts;
}

// A path cites the first canonical eager edge, otherwise the first edge.
export function indexPathEdges(edges, eager = null) {
  const out = new Map();
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, new Map());
    const row = out.get(edge.from), previous = row.get(edge.to);
    if (!previous || (eager && !eager.has(previous) && eager.has(edge))) row.set(edge.to, edge);
  }
  return out;
}

// Callers supply ordered neighbors inside the same component.
export function shortestCycle(start, targetsOf) {
  const previous = new Map([[start, null]]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const target of targetsOf(node)) {
      if (target === start) {
        const path = [];
        for (let at = node; at !== null; at = previous.get(at)) path.push(at);
        return path.reverse();
      }
      if (!previous.has(target)) { previous.set(target, node); queue.push(target); }
    }
  }
  return [start];
}
