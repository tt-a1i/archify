import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { changeReviewFor, changeLegendEntries, CHANGE_STATES } from '../archify/renderers/shared/change-marks.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { extractSvgs, parseXml } from './helpers/xml.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const scratch = createScratchDirectory(path.join(os.tmpdir(), 'archify-change-marks-'));

const EXAMPLES = {
  architecture: 'brand-aware-delivery.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'drilldown-api.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
  erd: 'orders.erd.json',
};

function example(type) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[type]), 'utf8'));
}

function render(type, document, name) {
  const input = path.join(scratch, `${name}.json`);
  const output = path.join(scratch, `${name}.html`);
  fs.writeFileSync(input, JSON.stringify({ ...document, meta: { ...document.meta, output: path.basename(output) } }));
  const result = spawnSync(process.execPath, [cli, 'render', type, input, output], { cwd: scratch, encoding: 'utf8' });
  assert.equal(result.status, 0, `${type} render failed:\n${result.stdout}\n${result.stderr}`);
  const html = fs.readFileSync(output, 'utf8');
  const [svg] = extractSvgs(html).direct;
  assert.doesNotThrow(() => parseXml(svg), `${type} SVG stays well-formed XML`);
  return { html, svg };
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

const nodeCollection = { architecture: 'components', workflow: 'nodes', sequence: 'participants', dataflow: 'nodes', lifecycle: 'states', erd: 'entities' };
const edgeCollection = { architecture: 'connections', workflow: 'edges', sequence: 'messages', dataflow: 'flows', lifecycle: 'transitions', erd: 'relationships' };

function markedExample(type) {
  const document = example(type);
  const nodes = document[nodeCollection[type]];
  const edges = document[edgeCollection[type]];
  const stableNode = type === 'lifecycle' ? 1 : 0;
  nodes[stableNode].change = 'added';
  nodes[stableNode + 1].change = 'modified';
  nodes[stableNode + 1].emphasis = true;
  nodes.at(-1).change = 'removed';
  edges[0].change = 'added';
  edges[1].change = 'removed';
  return document;
}

test('changeReviewFor stays inert without marks and derives 1-hop context from marks', () => {
  const inert = changeReviewFor({ nodes: [{ id: 'a' }, { id: 'b', change: 'unchanged' }], edges: [{ from: 'a', to: 'b' }] });
  assert.equal(inert.active, false);
  assert.equal(inert.nodeContext({ id: 'a' }), null);
  assert.deepEqual(changeLegendEntries(inert, undefined, 'en'), []);

  const review = changeReviewFor({
    nodes: [{ id: 'a', change: 'modified' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'c', to: 'd', change: 'removed' }],
    frames: [{ wraps: ['d'] }],
  });
  assert.equal(review.active, true);
  assert.equal(review.nodeContext({ id: 'a', change: 'modified' }), null);
  assert.equal(review.nodeContext({ id: 'b' }), 'neighbour');
  assert.equal(review.nodeContext({ id: 'c' }), 'neighbour', 'an endpoint of a removed edge is context');
  assert.equal(review.edgeContext({ from: 'a', to: 'b' }), 'neighbour');
  assert.equal(review.frameContext({ wraps: ['d'] }), 'subdued');
  assert.equal(review.frameContext({ wraps: ['a', 'd'] }), 'neighbour');
  const legend = changeLegendEntries(review, undefined, 'en');
  assert.deepEqual(legend.map((entry) => entry.kind), CHANGE_STATES.map((state) => `change-${state}`));
  assert.ok(legend.every((entry) => entry.interactive === false));
  assert.deepEqual(changeLegendEntries(review, { mode: 'hidden' }, 'en'), []);
});

for (const type of Object.keys(EXAMPLES)) {
  test(`${type}: examples without change marks render no change markup`, () => {
    const { svg } = render(type, example(type), `${type}-plain`);
    assert.doesNotMatch(svg, /data-change(?:-context|-badge)?=/);
    assert.doesNotMatch(svg, /legend-semantic-kind="change-/);
    assert.doesNotMatch(svg, /arrowhead-change-|-change-(?:added|modified|removed)"/);
  });

  test(`${type}: authored change marks render states, badges, ghosts, context, markers and legend`, () => {
    const document = markedExample(type);
    if (type === 'dataflow') document.meta.viewBox = [1400, 520];
    const { svg, html } = render(type, document, `${type}-marked`);
    for (const state of ['added', 'modified', 'removed']) {
      assert.ok(count(svg, new RegExp(`data-change="${state}"`, 'g')) >= 1, `${type} marks ${state}`);
      assert.match(svg, new RegExp(`data-change-badge="${state}"`), `${type} badges ${state}`);
      assert.match(svg, new RegExp(`data-legend-semantic-kind="change-${state}"`), `${type} legend lists ${state}`);
    }
    assert.match(svg, /data-legend-semantic-kind="change-unchanged"/);
    assert.match(svg, /data-emphasis=""/);
    assert.ok(count(svg, /data-change-context="(?:neighbour|subdued)"/g) >= 1, `${type} subdues untouched context`);
    assert.match(svg, /marker-(?:end|start)="url\(#[a-z-]*change-added[a-z-]*\)"/, `${type} added edges use change markers`);
    assert.match(svg, /marker-(?:end|start)="url\(#[a-z-]*change-removed[a-z-]*\)"/);
    assert.doesNotMatch(svg, /style="[^"]*#[0-9a-fA-F]{3,8}/, 'change marks use theme variables, not inline colours');
    assert.doesNotMatch(html, /\b(SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/);
    const removedNodes = [...svg.matchAll(/<g [^>]*data-node-id="([^"]+)"[^>]*data-change="removed"/g)];
    assert.ok(removedNodes.length >= 1, `${type} keeps removed nodes as ghosts at their position`);
  });
}

test('erd: column marks render the type change in the type slot and strike removed columns', () => {
  const document = example('erd');
  const [first] = document.entities;
  first.attributes[1].change = 'modified';
  first.attributes[1].previousType = 'int';
  first.attributes[1].type = 'bigint';
  first.attributes.push({ name: 'legacy_flag', type: 'bool', change: 'removed' });
  const { svg } = render('erd', document, 'erd-columns');
  assert.match(svg, /data-er-type-change=""[^>]*>int → bigint<\/text>/);
  assert.match(svg, /<g data-detail="context" data-er-row="\d+" data-change="removed">[\s\S]*?>legacy_flag<\/text>/);
  assert.match(svg, /data-er-row="\d+" data-change="removed">[\s\S]*?data-change-badge="removed"/);
  assert.match(svg, new RegExp(`data-node-id="${first.id}"[^>]*data-change-context="neighbour"`), 'a table with changed columns is review context, not subdued');
  assert.match(svg, /data-legend-semantic-kind="change-modified"/);
});

test('schema: change, emphasis, previousType and payload are optional and validated', () => {
  const document = markedExample('sequence');
  document.messages[0].payload = { summary: 'order', contentType: 'application/json', before: { total: 1 }, after: { total: 2 } };
  const input = path.join(scratch, 'schema-valid.json');
  fs.writeFileSync(input, JSON.stringify(document));
  const valid = spawnSync(process.execPath, [cli, 'validate', 'sequence', input, '--json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  document.messages[0].change = 'renamed';
  fs.writeFileSync(input, JSON.stringify(document));
  const invalid = spawnSync(process.execPath, [cli, 'validate', 'sequence', input, '--json'], { cwd: scratch, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /change/);
});

for (const type of ['sequence', 'dataflow']) {
  test(`${type}: payloads ship only in the reader-side JSON block and never in the SVG`, () => {
    const document = example(type);
    const edges = document[edgeCollection[type]];
    edges[0].id = edges[0].id || 'flow-first';
    edges[1].id = edges[1].id || 'flow-second';
    const plain = render(type, document, `${type}-payload-none`);
    assert.doesNotMatch(plain.html, /<script id="archify-payloads-data"/, 'no payloads means no payload block');

    edges[0].payload = { summary: 'Secret-free review sample', contentType: 'application/json', before: { token: 'legacy-before-value' }, after: { token: 'rotated-after-value' } };
    edges[1].payload = { sample: { marker: 'sample-only-marker' } };
    const withPayload = render(type, document, `${type}-payload-some`);
    const block = withPayload.html.match(/<script id="archify-payloads-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(block, 'payload block is emitted once payloads exist');
    const payloads = JSON.parse(block[1]);
    assert.deepEqual(Object.keys(payloads).sort(), [edges[0].id, edges[1].id].sort());
    assert.equal(payloads[edges[0].id].role, type === 'dataflow' ? 'flow' : 'request');
    assert.equal(payloads[edges[0].id].after.token, 'rotated-after-value');
    for (const marker of ['legacy-before-value', 'rotated-after-value', 'sample-only-marker', 'Secret-free review sample']) {
      assert.doesNotMatch(withPayload.svg, new RegExp(marker), `${marker} stays out of the canonical SVG`);
    }
    assert.ok(withPayload.svg.includes(`data-edge-id="${edges[0].id}"`), 'the SVG edge carries the authored id the Viewer resolves');

    delete edges[0].id;
    const input = path.join(scratch, `${type}-payload-noid.json`);
    fs.writeFileSync(input, JSON.stringify(document));
    const rejected = spawnSync(process.execPath, [cli, 'render', type, input, path.join(scratch, `${type}-payload-noid.html`)], { cwd: scratch, encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stdout + rejected.stderr, /payload\/missing-id/);
  });
}

for (const type of ['sequence', 'dataflow', 'lifecycle']) {
  test(`${type}: validate --layout-json reports deterministic node boxes and edge routes`, () => {
    const input = path.join(skillRoot, 'examples', EXAMPLES[type]);
    const run = () => spawnSync(process.execPath, [cli, 'validate', type, input, '--layout-json'], { cwd: skillRoot, encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const report = JSON.parse(first.stdout);
    assert.equal(report.contract, `archify-${type}-layout-v1`);
    assert.equal(report.diagram_type, type);
    assert.equal(report.viewBox.length, 2);
    assert.ok(report.nodes.length >= 2 && report.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.width)));
    assert.ok(report.edges.length >= 1 && report.edges.every((edge) => edge.points.length >= 2 && edge.points.every((point) => point.length === 2)));
    assert.equal(run().stdout, first.stdout, 'layout evidence is deterministic');
  });
}
