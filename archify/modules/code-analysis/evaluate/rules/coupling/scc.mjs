// Iterative Tarjan traversal over integer IDs: dependency depth must not
// consume the JS call stack or allocate a frame object for every node.
export function cyclicComponents(nodes, edges, includeSelf = false) {
  const ids = new Map();
  for (const node of nodes) if (!ids.has(node)) ids.set(node, ids.size);
  if (ids.size !== nodes.length) nodes = [...ids.keys()];
  const rowPtr = new Uint32Array(nodes.length + 1);
  const self = includeSelf ? new Uint8Array(nodes.length) : null;
  for (const edge of edges) {
    const from = ids.get(edge.from), to = ids.get(edge.to);
    if (from === undefined || to === undefined) throw new TypeError('SCC edge endpoint is outside the node scope');
    rowPtr[from + 1]++;
    if (self && from === to) self[from] = 1;
  }
  for (let i = 1; i < rowPtr.length; i++) rowPtr[i] += rowPtr[i - 1];
  const cursor = rowPtr.slice(0, nodes.length), colIdx = new Uint32Array(edges.length);
  for (const edge of edges) colIdx[cursor[ids.get(edge.from)]++] = ids.get(edge.to);
  const indices = new Uint32Array(nodes.length), low = new Uint32Array(nodes.length);
  const active = new Uint8Array(nodes.length), stack = new Uint32Array(nodes.length);
  const frames = new Uint32Array(nodes.length), components = [];
  let index = 0, stackSize = 0, depth = 0;
  const enter = (node) => {
    // Zero is unvisited; discovery numbers start at one.
    indices[node] = low[node] = ++index;
    // Reuse the fill cursor as this frame's next-edge position.
    cursor[node] = rowPtr[node];
    active[node] = 1; stack[stackSize++] = node;
    frames[depth++] = node;
  };
  for (let start = 0; start < nodes.length; start++) {
    if (indices[start]) continue;
    enter(start);
    while (depth) {
      const node = frames[depth - 1];
      if (cursor[node] < rowPtr[node + 1]) {
        const target = colIdx[cursor[node]++];
        if (!indices[target]) enter(target);
        else if (active[target]) low[node] = Math.min(low[node], indices[target]);
        continue;
      }
      depth--;
      if (depth) {
        const parent = frames[depth - 1];
        low[parent] = Math.min(low[parent], low[node]);
      }
      if (low[node] === indices[node]) {
        const end = stackSize;
        let member;
        do { member = stack[--stackSize]; active[member] = 0; } while (member !== node);
        // Popped IDs remain in the buffer until the next entry. Materialize
        // only reported cycles, avoiding a temporary array for every DAG node.
        if (end - stackSize > 1 || self?.[node]) {
          const component = [];
          for (let at = stackSize; at < end; at++) component.push(nodes[stack[at]]);
          components.push(component.sort());
        }
      }
    }
  }
  return components.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
