import { tarjanLabels } from '../../../vendor/graphty/scc.mjs';

// Adapt source IDs to the two CSR arrays read by the vendored Tarjan kernel.
export function cyclicComponents(nodes, edges, includeSelf = false) {
  const index = new Map();
  for (const node of nodes) if (!index.has(node)) index.set(node, index.size);
  if (index.size !== nodes.length) nodes = [...index.keys()];
  const rowPtr = new Uint32Array(nodes.length + 1);
  const self = includeSelf ? new Set() : null;
  for (const edge of edges) {
    const from = index.get(edge.from), to = index.get(edge.to);
    if (from === undefined || to === undefined) throw new TypeError('SCC edge endpoint is outside the node scope');
    rowPtr[from + 1]++;
    if (self && from === to) self.add(edge.from);
  }
  for (let i = 1; i < rowPtr.length; i++) rowPtr[i] += rowPtr[i - 1];
  const cursor = rowPtr.slice(0, nodes.length), colIdx = new Uint32Array(edges.length);
  for (const edge of edges) colIdx[cursor[index.get(edge.from)]++] = index.get(edge.to);
  const { labels, count } = tarjanLabels({ nodeCount: nodes.length, rowPtr, colIdx });

  // Most DAG components are singletons; do not allocate groups to discard.
  const sizes = new Uint32Array(count), groups = new Array(count);
  for (const label of labels) sizes[label]++;
  for (let i = 0; i < nodes.length; i++) {
    const label = labels[i], node = nodes[i];
    if (sizes[label] > 1 || self?.has(node)) (groups[label] ||= []).push(node);
  }
  return groups.filter(Boolean).map(group => group.sort())
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
