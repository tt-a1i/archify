import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function renderDiagram(mode, doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `archify-${mode}-endpoint-`));
  const input = path.join(tmp, 'input.json');
  const output = path.join(tmp, 'output.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function validateDataflow(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-degenerate-'));
  const input = path.join(tmp, 'input.json');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const result = spawnSync(process.execPath, [
      path.join(skillRoot, 'bin/archify.mjs'),
      'validate',
      'dataflow',
      input,
      '--quality',
      'showcase',
      '--json',
    ], { cwd: skillRoot, encoding: 'utf8' });
    return { status: result.status, receipt: JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function nodeRect(html, id) {
  const match = html.match(new RegExp(
    `<g id="node-${id}"[^>]*>[\\s\\S]*?<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
  ));
  assert.ok(match, `missing rendered node ${id}`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  };
}

function relationshipPoints(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`));
  assert.ok(match, `missing rendered relationship ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

function relationshipPath(html, id) {
  const match = html.match(new RegExp(`<path[^>]+data-edge-id="${id}"[^>]+\\sd="([^"]+)"`));
  assert.ok(match, `missing rendered relationship path ${id}`);
  return match[1];
}

function toolResultLoopDataflow() {
  return {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Tool result loop', quality_profile: 'showcase' },
    stages: [
      { label: 'Context' },
      { label: 'Execution' },
      { label: 'Result' },
    ],
    nodes: [
      { id: 'messages', type: 'database', label: 'Messages', stage: 0, row: 0 },
      { id: 'tools', type: 'backend', label: 'Tools', stage: 1, row: 2 },
      { id: 'results', type: 'messagebus', label: 'Results', stage: 2, row: 2 },
    ],
    flows: [
      { id: 'execute', from: 'tools', to: 'results', label: 'toolResult' },
      { id: 'append-results', from: 'results', to: 'messages', label: 'ordered write-back', route: 'bottom-channel', variant: 'dashed' },
    ],
  };
}

test('dataflow: bottom-channel connects the bottom centers without borrowing side borders or ports', () => {
  const html = renderDiagram('dataflow', toolResultLoopDataflow());
  const execute = relationshipPoints(html, 'execute');
  const writeBack = relationshipPoints(html, 'append-results');

  assert.deepEqual(writeBack, [
    [530, 414],
    [530, 440],
    [100, 440],
    [100, 186],
  ]);
  assert.notDeepEqual(writeBack[0], execute.at(-1));
});

test('lifecycle: named channels resolve to the matching side centers without authored sides', () => {
  const cases = [
    { route: 'bottom-channel', side: 'bottom' },
    { route: 'top-channel', side: 'top' },
    { route: 'right-channel', side: 'right' },
    { route: 'left-channel', side: 'left' },
  ];

  for (const { route, side } of cases) {
    const html = renderDiagram('lifecycle', {
      schema_version: 1,
      diagram_type: 'lifecycle',
      meta: { title: `${route} endpoint defaults`, quality_profile: 'showcase' },
      lanes: [{ id: 'main', label: 'Main' }],
      states: [
        { id: 'source', lane: 'main', col: 3, type: 'active', label: 'Source' },
        { id: 'target', lane: 'main', col: 0, type: 'success', label: 'Target' },
      ],
      transitions: [{ id: 'return', from: 'source', to: 'target', route }],
    });
    const source = nodeRect(html, 'source');
    const target = nodeRect(html, 'target');
    const points = relationshipPoints(html, 'return');
    const centerFor = (rect) => ({
      top: [rect.x + rect.width / 2, rect.y],
      bottom: [rect.x + rect.width / 2, rect.y + rect.height],
      left: [rect.x, rect.y + rect.height / 2],
      right: [rect.x + rect.width, rect.y + rect.height / 2],
    })[side];

    assert.deepEqual(points[0], centerFor(source), `${route} source port`);
    assert.deepEqual(points.at(-1), centerFor(target), `${route} target port`);
  }
});

test('dataflow: aligned automatic flow emits one canonical segment without duplicate endpoint points', () => {
  const html = renderDiagram('dataflow', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Aligned automatic flow', quality_profile: 'showcase' },
    stages: [{ label: 'Messages' }, { label: 'Unused' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'AgentMessage[]', stage: 0, row: 0 },
      { id: 'target', type: 'messagebus', label: 'Tool calls', stage: 0, row: 2 },
    ],
    flows: [{ id: 'tool-calls', from: 'source', to: 'target', label: 'toolCall content block', labelAt: [100, 271] }],
  });

  assert.deepEqual(relationshipPoints(html, 'tool-calls'), [[100, 186], [100, 356]]);
  assert.equal(relationshipPath(html, 'tool-calls'), 'M 100 186 L 100 352.85');
});

test('dataflow: a route collapsed by non-finite endpoint geometry returns a structured diagnostic', () => {
  const result = validateDataflow({
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Degenerate route diagnostic', quality_profile: 'showcase' },
    stages: [{ label: 'Input' }, { label: 'Output' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'target', type: 'database', label: 'Target', stage: 1, row: 5 },
    ],
    flows: [{ id: 'broken-route', from: 'source', to: 'target', label: 'payload', route: 'straight' }],
  });

  assert.equal(result.status, 1);
  assert.equal(result.receipt.stage, 'render');
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'layout/degenerate-route'));
  assert.equal(result.receipt.diagnostics.some((entry) => entry.code === 'internal/unclassified'), false);
  assert.doesNotMatch(result.receipt.error, /Cannot read properties of undefined/);
});

test('dataflow: vertical-channel uses side ports facing its vertical corridor', () => {
  const html = renderDiagram('dataflow', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Vertical corridor endpoint defaults' },
    stages: [{ label: 'Messages' }, { label: 'Unused' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'target', type: 'messagebus', label: 'Target', stage: 0, row: 2 },
    ],
    flows: [{ id: 'channel', from: 'source', to: 'target', label: 'channel', route: 'vertical-channel', channelX: 180 }],
  });
  const source = nodeRect(html, 'source');
  const target = nodeRect(html, 'target');
  const points = relationshipPoints(html, 'channel');
  assert.deepEqual(points[0], [source.x + source.width, source.y + source.height / 2]);
  assert.deepEqual(points.at(-1), [target.x + target.width, target.y + target.height / 2]);
  assert.deepEqual(points.slice(1, -1).map(([x]) => x), [180, 180]);
});

test('explicit collinear via points remain addressable by labelSegment', () => {
  const dataflowHtml = renderDiagram('dataflow', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Authored data-flow route' },
    stages: [{ label: 'Messages' }, { label: 'Unused' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'target', type: 'messagebus', label: 'Target', stage: 0, row: 2 },
    ],
    flows: [{
      id: 'authored',
      from: 'source',
      to: 'target',
      fromSide: 'bottom',
      toSide: 'top',
      via: [[100, 242]],
      label: 'second segment',
      labelSegment: 1,
    }],
  });
  assert.equal(relationshipPoints(dataflowHtml, 'authored').length, 3);

  const lifecycleHtml = renderDiagram('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Authored lifecycle route' },
    lanes: [{ id: 'main', label: 'Main' }, { id: 'waiting', label: 'Waiting' }],
    states: [
      { id: 'source', lane: 'main', col: 2, type: 'active', label: 'Source' },
      { id: 'target', lane: 'waiting', col: 0, type: 'waiting', label: 'Target' },
    ],
    transitions: [{
      id: 'authored',
      from: 'source',
      to: 'target',
      fromSide: 'bottom',
      toSide: 'top',
      via: [[402, 218]],
      label: 'second segment',
      labelSegment: 1,
    }],
  });
  assert.equal(relationshipPoints(lifecycleHtml, 'authored').length, 3);
});

test('lifecycle: drop uses bottom-to-top ports facing its horizontal corridor', () => {
  const html = renderDiagram('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Drop endpoint defaults' },
    lanes: [{ id: 'main', label: 'Main' }, { id: 'waiting', label: 'Waiting' }],
    states: [
      { id: 'source', lane: 'main', col: 3, type: 'active', label: 'Source' },
      { id: 'target', lane: 'waiting', col: 0, type: 'waiting', label: 'Target' },
    ],
    transitions: [{ id: 'drop', from: 'source', to: 'target', route: 'drop' }],
  });
  const source = nodeRect(html, 'source');
  const target = nodeRect(html, 'target');
  const points = relationshipPoints(html, 'drop');
  assert.deepEqual(points[0], [source.x + source.width / 2, source.y + source.height]);
  assert.deepEqual(points.at(-1), [target.x + target.width / 2, target.y]);
});
