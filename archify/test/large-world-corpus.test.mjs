import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const benchmarkRoot = path.join(repoRoot, 'benchmarks/hybrid-large-world-viewer-pilot');
const manifestPath = path.join(benchmarkRoot, 'manifest.json');

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function largestConnectedComponent(ids, edges) {
  const neighbors = new Map(ids.map((id) => [id, new Set()]));
  for (const edge of edges) {
    assert.ok(neighbors.has(edge.from), `unknown edge source ${edge.from}`);
    assert.ok(neighbors.has(edge.to), `unknown edge target ${edge.to}`);
    neighbors.get(edge.from).add(edge.to);
    neighbors.get(edge.to).add(edge.from);
  }
  const remaining = new Set(ids);
  let largest = 0;
  while (remaining.size) {
    const queue = [remaining.values().next().value];
    remaining.delete(queue[0]);
    let count = 0;
    while (queue.length) {
      const current = queue.shift();
      count += 1;
      for (const next of neighbors.get(current)) {
        if (!remaining.delete(next)) continue;
        queue.push(next);
      }
    }
    largest = Math.max(largest, count);
  }
  return largest;
}

function cjkLength(value) {
  return [...String(value || '')].filter((character) => /\p{Script=Han}/u.test(character)).length;
}

function renderedFrame(entry) {
  const artifact = path.join(
    benchmarkRoot,
    'artifacts',
    `${entry.id}.${entry.type}.html`,
  );
  const html = fs.readFileSync(artifact, 'utf8');
  const match = html.match(/<svg viewBox="([^"]+)" role="img"/);
  assert.ok(match, `${entry.id} canonical SVG viewBox`);
  const values = match[1].trim().split(/\s+/).map(Number);
  assert.equal(values.length, 4);
  assert.ok(values.every(Number.isFinite));
  return { width: values[2], height: values[3] };
}

test('large-world corpus is deterministic, dense, connected, and semantically varied', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entries.length, 6);
  assert.deepEqual(manifest.entries.map(({ id }) => id), [
    'workflow-30', 'workflow-100', 'workflow-300',
    'architecture-30', 'architecture-100', 'architecture-300',
  ]);

  for (const entry of manifest.entries) {
    const source = fs.readFileSync(path.join(benchmarkRoot, entry.filename), 'utf8');
    const document = JSON.parse(source);
    const nodes = entry.type === 'workflow' ? document.nodes : document.components;
    const edges = entry.type === 'workflow' ? document.edges : document.connections;
    assert.equal(sha256(source), entry.sourceSha256, `${entry.id} source hash`);
    assert.equal(nodes.length, entry.nodes, `${entry.id} nodes`);
    assert.equal(edges.length, entry.edges, `${entry.id} edges`);
    assert.equal(edges.length / nodes.length, entry.edgeDensity, `${entry.id} density receipt`);
    assert.ok(entry.edgeDensity >= 1.5 && entry.edgeDensity <= 2.5, `${entry.id} density`);
    assert.ok(largestConnectedComponent(nodes.map(({ id }) => id), edges) / nodes.length >= 0.9, `${entry.id} connectivity`);
    assert.ok(nodes.some(({ id }) => id === entry.validEntry), `${entry.id} readable entry`);

    if (entry.id === 'workflow-30') continue;
    const longLabels = nodes.filter((node) => Math.max(cjkLength(node.label), cjkLength(node.sublabel)) >= 12);
    assert.ok(longLabels.length / nodes.length >= 0.2, `${entry.id} long labels`);
    assert.equal(longLabels.length, entry.longLabelNodes, `${entry.id} long-label receipt`);
    assert.ok(entry.cards >= 2, `${entry.id} cards`);

    if (entry.type === 'workflow') {
      const laneByNode = new Map(nodes.map((node) => [node.id, node.lane]));
      const crossLane = edges.filter((edge) => laneByNode.get(edge.from) !== laneByNode.get(edge.to));
      assert.ok(document.lanes.length >= 3, `${entry.id} lanes`);
      assert.ok(document.phases.length >= 3, `${entry.id} phases`);
      assert.ok(edges.some((edge) => edge.route === 'return-left'), `${entry.id} feedback route`);
      assert.ok(crossLane.length / edges.length >= 0.1, `${entry.id} cross-lane edges`);
    } else {
      const boundaryByNode = new Map();
      document.boundaries.forEach((boundary, index) => boundary.wraps.forEach((id) => boundaryByNode.set(id, index)));
      const crossBoundary = edges.filter((edge) => boundaryByNode.get(edge.from) !== boundaryByNode.get(edge.to));
      assert.ok(document.boundaries.length >= 4, `${entry.id} boundaries`);
      assert.ok(crossBoundary.length / edges.length >= 0.1, `${entry.id} cross-boundary edges`);
    }
  }
});

test('100/300 pairs differ materially while retaining the same cards', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const type of ['workflow', 'architecture']) {
    const entries = [100, 300].map((size) => manifest.entries.find((entry) => entry.id === `${type}-${size}`));
    const documents = entries.map((entry) => JSON.parse(fs.readFileSync(path.join(benchmarkRoot, entry.filename), 'utf8')));
    assert.deepEqual(documents[0].cards, documents[1].cards, `${type} cards`);
    const frames = entries.map(renderedFrame);
    const ratios = frames.map((frame) => frame.width / frame.height);
    const areas = frames.map((frame) => frame.width * frame.height);
    assert.ok(Math.abs(ratios[1] / ratios[0] - 1) >= 0.2, `${type} aspect-ratio difference`);
    assert.ok(Math.max(...areas) / Math.min(...areas) >= 2, `${type} area difference`);
  }
});

test('corpus generator reproduces the frozen manifest and sources byte-for-byte', () => {
  const tracked = [
    manifestPath,
    ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')).entries.map((entry) => path.join(benchmarkRoot, entry.filename)),
  ];
  const before = new Map(tracked.map((file) => [file, fs.readFileSync(file)]));
  const result = spawnSync(process.execPath, [path.join(benchmarkRoot, 'generate-corpus.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const file of tracked) assert.deepEqual(fs.readFileSync(file), before.get(file), path.basename(file));
});
