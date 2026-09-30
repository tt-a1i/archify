import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SaxesParser } from 'saxes';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');
const hiddenLegends = [
  ['hidden', { mode: 'hidden' }],
  ['all entries hidden', { entries: { default: { visible: false } } }],
];

function sequence(legend) {
  return {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Timeline capacity', output: 'diagram.html', column_fit: 'spread', quality_profile: 'showcase', ...(legend ? { legend } : {}) },
    participants: [
      { id: 'client', type: 'external', label: 'Client' },
      { id: 'api', type: 'backend', label: 'API' },
    ],
    messages: [{ id: 'request', from: 'client', to: 'api', y: 200, label: 'request' }],
  };
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  return result;
}

function render(t, document, command = 'render') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-content-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'diagram.html');
  const authored = JSON.stringify(document);
  fs.writeFileSync(input, authored);
  const result = run([command, 'sequence', input, output, ...(command === 'deliver' ? ['--json'] : [])]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(input, 'utf8'), authored);
  const html = fs.readFileSync(output, 'utf8');
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg);
  const elements = [];
  const parser = new SaxesParser();
  parser.on('opentag', (node) => elements.push({ name: node.name, ...node.attributes }));
  parser.write(svg).close();
  const [, , width, height] = elements[0].viewBox.split(' ').map(Number);
  const checked = run(['validate', 'sequence', input, '--json']);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  return { input, output, elements, width, height, result };
}

const contentCases = [
  ['activation', 1265, (doc) => {
    doc.activations = [
      { participant: 'client', from: 170, to: 250 },
      { participant: 'api', from: 180, to: 1200 },
    ];
  }],
  ['message', 1283, (doc) => { doc.messages[0].y = 1200; }],
  ['message note', 1287, (doc) => { doc.messages[0].y = 1200; doc.messages[0].note = 'keep this note'; }],
  ['segment', 1265, (doc) => { doc.segments = [{ from: 1000, to: 1200, label: 'Later phase' }]; }],
];

for (const [legendName, legend] of hiddenLegends) {
  for (const [kind, expectedHeight, amend] of contentCases) {
    test(`automatic canvas contains late ${kind} with ${legendName} legend`, (t) => {
      const document = sequence(legend);
      amend(document);
      const rendered = render(t, document, kind === 'activation' ? 'deliver' : 'render');
      assert.equal(rendered.width, 920);
      assert.equal(rendered.height, expectedHeight);
      assert.ok(!rendered.elements.some((node) => node['data-legend-kind']));
      const message = rendered.elements.find((node) => node['data-composition-edge-id'] === 'request');
      const points = message['data-composition-points'].split(';').map((point) => point.split(',').map(Number));
      assert.ok(points.every(([, y]) => y === document.messages[0].y), 'authored message time must not move');
      assert.ok(document.messages[0].y <= rendered.height - 83, 'message remains within the readable timeline');
      for (const activation of document.activations || []) {
        const bars = rendered.elements.filter((node) => node.name === 'rect' && node.width === '10'
          && Number(node.y) === activation.from && Number(node.height) === activation.to - activation.from);
        assert.equal(bars.length, 2);
        assert.ok(activation.to <= rendered.height - 65);
      }
      for (const segment of document.segments || []) {
        const frame = rendered.elements.find((node) => node['data-composition-frame-kind'] === 'segment');
        assert.equal(Number(frame.y), segment.from);
        assert.equal(Number(frame.height), segment.to - segment.from);
        assert.ok(segment.to <= rendered.height - 45);
      }
      if (document.messages[0].note) {
        assert.ok(rendered.elements.some((node) => node.name === 'text' && node['data-detail'] === 'fine' && Number(node.y) === 1218));
      }
    });
  }
}

for (const [description, amend, height] of [
  ['short hidden timeline', () => {}, 760],
  ['activation at the default lifeline endpoint', (doc) => { doc.activations = [{ participant: 'api', from: 180, to: 695 }]; }, 760],
  ['activation one pixel after the default lifeline endpoint', (doc) => { doc.activations = [{ participant: 'api', from: 180, to: 696 }]; }, 761],
  ['message at its default upper bound', (doc) => { doc.messages[0].y = 677; }, 760],
  ['message one pixel after its default upper bound', (doc) => { doc.messages[0].y = 678; }, 761],
]) {
  test(`automatic height uses the existing timeline margin for ${description}`, (t) => {
    const document = sequence({ mode: 'hidden' });
    amend(document);
    assert.equal(render(t, document).height, height);
  });
}

test('visible legend retains its existing height and explicit viewBox remains authoritative', (t) => {
  const document = sequence();
  document.activations = [{ participant: 'api', from: 180, to: 1200 }];
  assert.equal(render(t, document).height, 1298);
  document.meta.legend = { mode: 'hidden' };
  document.meta.viewBox = [960, 1500];
  const explicit = render(t, document);
  assert.deepEqual([explicit.width, explicit.height], [960, 1500]);
  // This fix does not introduce a new explicit-activation acceptance rule.
  document.meta.viewBox = [960, 760];
  assert.equal(render(t, document).height, 760);
});

test('explicitly undersized message timelines still fail and preserve existing output', (t) => {
  const document = sequence({ mode: 'hidden' });
  const initial = render(t, document);
  const previous = fs.readFileSync(initial.output);
  document.meta.viewBox = [920, 760];
  document.messages[0].y = 1200;
  fs.writeFileSync(initial.input, JSON.stringify(document));
  for (const command of ['validate', 'render', 'deliver']) {
    const result = run([command, 'sequence', initial.input, ...(command === 'validate' ? [] : [initial.output]), ...(command === 'render' ? [] : ['--json'])]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /outside the readable timeline/);
    assert.deepEqual(fs.readFileSync(initial.output), previous);
  }
});
