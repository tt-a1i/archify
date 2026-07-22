import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function render(mode, doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-port-spread-'));
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

function connectionPoints(html, id) {
  const pattern = new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`);
  const match = html.match(pattern);
  assert.ok(match, `missing rendered connection ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

function fanOutArchitecture(connections) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Automatic port spread' },
    components: [
      { id: 'hub', type: 'backend', label: 'Hub', pos: [100, 280], size: [120, 60] },
      { id: 'upper', type: 'external', label: 'Upper', pos: [500, 100], size: [120, 60] },
      { id: 'middle', type: 'database', label: 'Middle', pos: [500, 280], size: [120, 60] },
      { id: 'lower', type: 'cloud', label: 'Lower', pos: [500, 460], size: [120, 60] },
    ],
    connections,
  };
}

test('architecture: automatic fan-out uses distinct symmetric ports with corner clearance', () => {
  const html = render('architecture', fanOutArchitecture([
    { id: 'to-upper', from: 'hub', to: 'upper' },
    { id: 'to-middle', from: 'hub', to: 'middle' },
    { id: 'to-lower', from: 'hub', to: 'lower' },
  ]));

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [220, 296]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [220, 310]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [220, 324]);
});

test('architecture: automatic port assignment is stable when relationship input order changes', () => {
  const connections = [
    { id: 'to-upper', from: 'hub', to: 'upper' },
    { id: 'to-middle', from: 'hub', to: 'middle' },
    { id: 'to-lower', from: 'hub', to: 'lower' },
  ];
  const forward = render('architecture', fanOutArchitecture(connections));
  const reversed = render('architecture', fanOutArchitecture([...connections].reverse()));

  for (const connection of connections) {
    assert.deepEqual(
      connectionPoints(forward, connection.id),
      connectionPoints(reversed, connection.id),
      `${connection.id} moved after input reordering`,
    );
  }
});

test('architecture: single and explicitly positioned relationships keep legacy anchors', () => {
  const doc = fanOutArchitecture([
    { id: 'single', from: 'hub', to: 'middle' },
    { id: 'via', from: 'hub', to: 'upper', via: [[300, 310], [300, 130]] },
    { id: 'fixed-route', from: 'hub', to: 'lower', route: 'orthogonal-h' },
    { id: 'fixed-label', from: 'hub', to: 'upper', label: 'contract', labelAt: [360, 200] },
  ]);
  const html = render('architecture', doc);

  assert.deepEqual(connectionPoints(html, 'single'), [[220, 310], [500, 310]]);
  assert.deepEqual(connectionPoints(html, 'via'), [[220, 310], [300, 310], [300, 130], [500, 130]]);
  assert.deepEqual(connectionPoints(html, 'fixed-route'), [[220, 310], [360, 310], [360, 490], [500, 490]]);
  assert.deepEqual(connectionPoints(html, 'fixed-label'), [[220, 310], [360, 310], [360, 130], [500, 130]]);
});

test('workflow: automatic cross-lane fan-out spreads the shared source port', () => {
  const html = render('workflow', {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Workflow port spread' },
    lanes: [
      { id: 'upper-lane', label: 'Upper' },
      { id: 'hub-lane', label: 'Hub' },
      { id: 'lower-lane', label: 'Lower' },
    ],
    nodes: [
      { id: 'hub', lane: 'hub-lane', col: 0, type: 'backend', label: 'Hub' },
      { id: 'upper', lane: 'upper-lane', col: 3, type: 'external', label: 'Upper' },
      { id: 'middle', lane: 'hub-lane', col: 3, type: 'database', label: 'Middle' },
      { id: 'lower', lane: 'lower-lane', col: 3, type: 'cloud', label: 'Lower' },
    ],
    edges: [
      { id: 'to-upper', from: 'hub', to: 'upper' },
      { id: 'to-middle', from: 'hub', to: 'middle' },
      { id: 'to-lower', from: 'hub', to: 'lower' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [134, 233]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [134, 243]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [134, 253]);
});

test('dataflow: automatic fan-out spreads flows without changing their authored topology', () => {
  const html = render('dataflow', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Data-flow port spread' },
    stages: [{ label: 'Source' }, { label: 'Transform' }, { label: 'Sinks' }],
    nodes: [
      { id: 'hub', type: 'backend', label: 'Hub', stage: 0, row: 2 },
      { id: 'upper', type: 'external', label: 'Upper', stage: 2, row: 0 },
      { id: 'middle', type: 'database', label: 'Middle', stage: 2, row: 2 },
      { id: 'lower', type: 'cloud', label: 'Lower', stage: 2, row: 4 },
    ],
    flows: [
      { id: 'to-upper', from: 'hub', to: 'upper', label: 'upper feed' },
      { id: 'to-middle', from: 'hub', to: 'middle', label: 'middle feed' },
      { id: 'to-lower', from: 'hub', to: 'lower', label: 'lower feed' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [156, 372]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [156, 385]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [156, 398]);
});

test('lifecycle: automatic fan-out spreads transitions across lifecycle bands', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Lifecycle port spread' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'event', label: 'Events' },
      { id: 'terminal', label: 'Outcomes' },
    ],
    states: [
      { id: 'hub', type: 'active', label: 'Hub', lane: 'event', col: 0 },
      { id: 'upper', type: 'waiting', label: 'Upper', lane: 'main', col: 4 },
      { id: 'middle', type: 'success', label: 'Middle', lane: 'event', col: 2 },
      { id: 'lower', type: 'failure', label: 'Lower', lane: 'terminal', col: 2 },
    ],
    transitions: [
      { id: 'to-upper', from: 'hub', to: 'upper' },
      { id: 'to-middle', from: 'hub', to: 'middle' },
      { id: 'to-lower', from: 'hub', to: 'lower' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [465, 294]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [465, 307]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [465, 320]);
});

test('lifecycle: same-band port spread remains orthogonal', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Orthogonal same-band spread' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'hub', type: 'active', label: 'Hub', lane: 'main', col: 0 },
      { id: 'upper', type: 'waiting', label: 'Upper', lane: 'main', col: 2, yOffset: -50 },
      { id: 'lower', type: 'success', label: 'Lower', lane: 'main', col: 4, yOffset: 50 },
    ],
    transitions: [
      { id: 'to-upper', from: 'hub', to: 'upper' },
      { id: 'to-lower', from: 'hub', to: 'lower' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper'), [
    [153, 150], [248, 150], [248, 107], [343, 107],
  ]);
  assert.deepEqual(connectionPoints(html, 'to-lower'), [
    [153, 164], [402, 164], [402, 207], [651, 207],
  ]);
});

test('skill and READMEs describe automatic port spread as bounded default behavior', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /Automatic Port Spread is a default renderer behavior/);
  assert.match(skill, /single relationship|single relationships/);
  assert.match(skill, /explicit `via`.*`channelX`.*`channelY`.*`labelAt`/);

  const repoRoot = path.resolve(skillRoot, '..');
  for (const file of ['README.md', 'README_EN.md']) {
    assert.match(fs.readFileSync(path.join(repoRoot, file), 'utf8'), /shared automatic endpoints spread deterministically/);
  }
  assert.match(fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8'), /共享的自动端点会确定性展开/);
});
