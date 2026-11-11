import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cyclicComponents } from '../evaluate/rules/coupling/scc.mjs';
import { run as moduleCycles } from '../evaluate/rules/coupling/cycle.mjs';

// Independent reference: transitive closure, not another DFS implementation.
function reference(nodes, edges, includeSelf) {
  const index = new Map(nodes.map((node, i) => [node, i]));
  const reach = nodes.map((_, i) => nodes.map((_, j) => i === j));
  for (const edge of edges) reach[index.get(edge.from)][index.get(edge.to)] = true;
  for (let k = 0; k < nodes.length; k++) for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) reach[i][j] ||= reach[i][k] && reach[k][j];
  const seen = new Set(), groups = [];
  for (let i = 0; i < nodes.length; i++) {
    if (seen.has(i)) continue;
    const group = [];
    for (let j = 0; j < nodes.length; j++) if (reach[i][j] && reach[j][i]) { seen.add(j); group.push(nodes[j]); }
    if (group.length > 1 || (includeSelf && edges.some(edge => edge.from === group[0] && edge.to === group[0]))) groups.push(group.sort());
  }
  return groups.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

test('SCC partitions agree with transitive closure across graph shapes, IDs and input order', () => {
  const check = (nodes, edges) => {
    for (const self of [false, true]) assert.deepEqual(cyclicComponents(nodes, edges, self), reference(nodes, edges, self));
  };
  for (let n = 0; n <= 3; n++) {
    const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
    for (let mask = 0; mask < 2 ** (n * n); mask++) {
      const edges = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (mask & (1 << (i * n + j))) edges.push({ from: nodes[i], to: nodes[j] });
      check(nodes, edges);
    }
  }
  const ids = ['', '__proto__', 'constructor', 'toString', 'α.py', 'x y', 'a\0b', 'z'];
  let seed = 47;
  for (let n = 4; n <= ids.length; n++) for (let sample = 0; sample < 24; sample++) {
    const nodes = ids.slice(0, n), edges = [];
    for (const from of nodes) for (const to of nodes) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed % 7 < 2) edges.push({ from, to });
    }
    if (edges.length) edges.push({ ...edges[0] });
    check(nodes, edges);
    check([...nodes].reverse(), [...edges].reverse());
    assert.deepEqual(cyclicComponents([...nodes, nodes[0]], edges, true), reference(nodes, edges, true));
  }
});

test('SCC rejects edge endpoints outside the supplied node scope', () => {
  for (const edges of [[{ from: 'missing', to: 'a' }], [{ from: 'a', to: 'missing' }]]) assert.throws(() => cyclicComponents(['a'], edges), TypeError);
});

test('100k-node chains and rings fit a 32 MiB JS heap without recursive traversal', () => {
  const source = `import assert from 'node:assert/strict';
    import { cyclicComponents } from ${JSON.stringify(new URL('../evaluate/rules/coupling/scc.mjs', import.meta.url).href)};
    const nodes = Array.from({ length: 100000 }, (_, i) => 'n' + i);
    const edges = nodes.slice(1).map((to, i) => ({ from: nodes[i], to }));
    assert.deepEqual(cyclicComponents(nodes, edges), []);
    edges.push({ from: nodes.at(-1), to: nodes[0] });
    const groups = cyclicComponents(nodes, edges);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0], [...nodes].sort());
    console.log('chain and ring verified');`;
  const child = spawnSync(process.execPath, ['--max-old-space-size=32', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  assert.equal(child.stdout.trim(), 'chain and ring verified');
});

test('many independent cycles collect their evidence with linear edge visits', () => {
  const visits = pairs => {
    let reads = 0;
    const ids = Array.from({ length: pairs * 2 }, (_, i) => `m${i}`);
    const edge = (from, to) => ({ get from() { reads++; return from; }, to, weight: 1, kinds: { eager: 1 }, evidence: [] });
    const edges = [];
    for (let i = 0; i < ids.length; i += 2) edges.push(edge(ids[i], ids[i + 1]), edge(ids[i + 1], ids[i]));
    const findings = moduleCycles({ graph: { modules: ids.map(id => ({ id, label: id })), edges } });
    assert.equal(findings.length, pairs);
    assert.ok(findings.every(f => f.evidence.totalImports === 2));
    return reads;
  };
  // Four times as many edges may not trigger sixteen times as many visits.
  assert.ok(visits(128) < visits(32) * 8);
});
