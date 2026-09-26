import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serializeOuter } from 'parse5';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variants = ['default', 'emphasis', 'security', 'dashed'];
const attr = (node, name) => node.attrs?.find((entry) => entry.name === name)?.value;
function descendants(node) {
  return [node, ...(node.childNodes || []).flatMap(descendants)];
}
function svgIn(document) {
  const svg = descendants(document).find((node) => node.tagName === 'svg');
  assert.ok(svg, 'expected an SVG');
  return svg;
}
function edgePaths(svg) {
  return descendants(svg).filter((node) => node.tagName === 'path' && attr(node, 'data-edge-id'));
}
function markerId(node) {
  const value = attr(node, 'marker-end');
  assert.match(value || '', /^url\(#[^)]+\)$/);
  return value.slice(5, -1);
}
function markerMap(svg) {
  return new Map(descendants(svg).filter((node) => node.tagName === 'marker').map((node) => [attr(node, 'id'), node]));
}
function assertResolved(svg) {
  const nodes = descendants(svg);
  const ids = nodes.map((node) => attr(node, 'id')).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'SVG IDs must be unique');
  const markers = markerMap(svg);
  const missing = [];
  for (const node of nodes) {
    for (const name of ['marker-start', 'marker-mid', 'marker-end']) {
      const value = attr(node, name);
      if (!value) continue;
      const match = value.match(/^url\(#([^)]+)\)$/);
      assert.ok(match, `expected a local marker reference: ${value}`);
      if (!markers.has(match[1])) missing.push(`${attr(node, 'data-edge-id') || node.tagName}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'every arrowhead must resolve within its own SVG');
}
function markerShape(marker) {
  // Compare geometry and paint semantics independently of namespaced IDs.
  return serializeOuter(marker).replace(/\sid="[^"]+"/, '');
}
function compare(t, base, head) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delta-markers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputs = [base, head].map((value, index) => {
    if (typeof value === 'string') return value;
    const file = path.join(root, `${index}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  });
  const output = path.join(root, 'delta.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin/archify.mjs'), 'compare', 'architecture', ...inputs,
    output, '--quality', 'standard', '--json',
  ], { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  const document = parse(html);
  const section = descendants(document).find((node) => node.tagName === 'section' && attr(node, 'data-view') === 'delta');
  assert.ok(section);
  const frames = descendants(document).filter((node) => node.tagName === 'iframe');
  assert.equal(frames.length, 2);
  const snapshots = frames.map((frame) => svgIn(parse(attr(frame, 'srcdoc'))));
  snapshots.forEach(assertResolved);
  return { html, delta: svgIn(section), base: snapshots[0], head: snapshots[1] };
}
function assertPreserved(artifact, expectedOld) {
  const paths = edgePaths(artifact.delta);
  const oldPaths = paths.filter((node) => ['removed', 'moved-from'].includes(attr(node, 'data-delta-state')));
  assert.equal(oldPaths.length, expectedOld);
  for (const side of ['base', 'head']) {
    const sourcePaths = edgePaths(artifact[side]);
    const sourceMarkers = markerMap(artifact[side]);
    const candidates = side === 'base' ? oldPaths : paths.filter((node) => !oldPaths.includes(node));
    for (const candidate of candidates) {
      const original = sourcePaths.find((node) => attr(node, 'data-edge-id') === attr(candidate, 'data-edge-id'));
      assert.ok(original, 'Delta path must correspond to its source snapshot');
      assert.equal(attr(candidate, 'd'), attr(original, 'd'), 'authored path geometry must survive composition');
      assert.equal(attr(candidate, 'data-composition-points'), attr(original, 'data-composition-points'));
      const marker = markerMap(artifact.delta).get(markerId(candidate));
      assert.ok(marker, `${side} edge ${attr(candidate, 'data-edge-id')} has no arrowhead definition`);
      assert.equal(markerShape(marker), markerShape(sourceMarkers.get(markerId(original))), `${side} arrowhead variant changed`);
    }
  }
}

test('checkout compare resolves all three baseline arrowheads and keeps snapshot markers', { timeout: 40000 }, (t) => {
  const artifact = compare(t,
    path.join(skillRoot, 'examples/checkout-platform.base.architecture.json'),
    path.join(skillRoot, 'examples/checkout-platform.head.architecture.json'));
  assertResolved(artifact.delta);
  assertPreserved(artifact, 3);
});

function variantFixture(operation) {
  const base = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Marker variants', output: 'marker-variants-base.html' },
    components: [],
    connections: [],
  };
  for (const [index, variant] of variants.entries()) {
    const y = 100 + index * 260;
    for (const [column, suffix] of ['a', 'b', 'c'].entries()) {
      base.components.push({ id: `${variant}-${suffix}`, type: 'backend', label: `${variant} ${suffix}`, pos: [100 + column * 300, y], size: [140, 60] });
    }
    base.connections.push({ id: variant, from: `${variant}-a`, to: `${variant}-b`, variant });
  }
  const head = structuredClone(base);
  head.meta.output = 'marker-variants-head.html';
  if (operation === 'removed') head.connections = [];
  else head.connections.forEach((edge, index) => {
    const y = 200 + index * 260;
    if (operation === 'topology') edge.to = `${edge.id}-c`;
    edge.fromSide = 'bottom';
    edge.toSide = 'bottom';
    edge.via = [[170, y], [operation === 'topology' ? 770 : 470, y]];
  });
  return [base, head];
}

for (const operation of ['removed', 'rerouted', 'topology']) {
  test(`compare preserves all four marker variants for ${operation} relationships`, { timeout: 40000 }, (t) => {
    const artifact = compare(t, ...variantFixture(operation));
    assertResolved(artifact.delta);
    assertPreserved(artifact, 4);
    const old = edgePaths(artifact.delta).filter((node) => ['removed', 'moved-from'].includes(attr(node, 'data-delta-state')));
    assert.deepEqual(old.map((node) => attr(node, 'data-edge-id')).sort(), [...variants].sort());
    assert.ok(old.every((node) => attr(node, 'data-delta-state') === (operation === 'rerouted' ? 'moved-from' : 'removed')));
  });
}
