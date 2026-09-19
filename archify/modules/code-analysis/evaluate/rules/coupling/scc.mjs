// Iterative Tarjan traversal: dependency depth must not consume the JS call stack.
export function cyclicComponents(nodes, edges, includeSelf = false) {
  const out = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) out.get(edge.from).push(edge.to);
  for (const targets of out.values()) targets.sort();
  const indices = new Map(), low = new Map(), active = new Set(), stack = [];
  const components = [];
  let index = 0;
  const enter = (node) => {
    indices.set(node, index); low.set(node, index++);
    active.add(node); stack.push(node);
    return { node, next: 0 };
  };
  for (const start of nodes) {
    if (indices.has(start)) continue;
    const frames = [enter(start)];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const targets = out.get(frame.node);
      if (frame.next < targets.length) {
        const target = targets[frame.next++];
        if (!indices.has(target)) frames.push(enter(target));
        else if (active.has(target)) low.set(frame.node, Math.min(low.get(frame.node), indices.get(target)));
        continue;
      }
      frames.pop();
      if (frames.length) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === indices.get(frame.node)) {
        const component = [];
        let node;
        do { node = stack.pop(); active.delete(node); component.push(node); } while (node !== frame.node);
        if (component.length > 1 || (includeSelf && targets.includes(frame.node))) components.push(component.sort());
      }
    }
  }
  return components.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
