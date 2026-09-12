import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-straight-routes-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const common = { schema_version: 1, meta: { title: 'Direct handoff', quality_profile: 'standard' } };
const cases = {
  lifecycle: {
    document: {
      ...common, diagram_type: 'lifecycle',
      lanes: [{ id: 'main', label: 'Work' }, { id: 'recovery', label: 'Recovery' }],
      states: [
        { id: 'start', type: 'waiting', label: 'Waiting', lane: 'main', col: 1 },
        { id: 'end', type: 'failure', label: 'Failed', lane: 'recovery', col: 1 },
      ],
      transitions: [{ id: 'direct', from: 'start', to: 'end', route: 'straight' }],
    },
    collection: 'transitions', points: '307,157;493,307', d: 'M 307 157 L 493 307',
  },
  dataflow: {
    document: {
      ...common, diagram_type: 'dataflow', stages: [{ label: 'Input' }, { label: 'Output' }],
      nodes: [
        { id: 'start', type: 'frontend', label: 'Client', stage: 0, row: 0 },
        { id: 'end', type: 'database', label: 'Store', stage: 1, row: 1 },
      ],
      flows: [{ id: 'direct', from: 'start', to: 'end', label: 'payload', route: 'straight' }],
    },
    collection: 'flows', points: '156,157;259,271', d: 'M 156 157 L 259 271',
  },
  architecture: {
    document: {
      ...common, diagram_type: 'architecture', meta: { ...common.meta, viewBox: [640, 480] },
      components: [
        { id: 'start', type: 'frontend', label: 'Client', pos: [70, 70], size: [120, 54] },
        { id: 'end', type: 'database', label: 'Store', pos: [350, 230], size: [120, 54] },
      ],
      connections: [{ id: 'direct', from: 'start', to: 'end', route: 'straight' }],
    },
    collection: 'connections', points: '190,97;350,257', d: 'M 190 97 L 350 257',
  },
};

function run(...args) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), ...args], { encoding: 'utf8' });
}
function orthogonalCheck(result) {
  return JSON.parse(result.stdout).checks.find((check) => check.name === 'orthogonal_arrows');
}
function inputFor(name, document) {
  const input = path.join(tmp, `${name}.json`);
  fs.writeFileSync(input, JSON.stringify(document));
  return input;
}
function assertPassed(result) {
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

for (const [type, { document, collection, points, d }] of Object.entries(cases)) {
  for (const quality of ['standard', 'showcase']) {
    test(`${type}: authored straight retains geometry through render, validate, check and deliver (${quality})`, () => {
      const input = inputFor(`${type}-${quality}`, { ...document, meta: { ...document.meta, quality_profile: quality } });
      const output = path.join(tmp, `${type}-${quality}.html`);
      assertPassed(run('render', type, input, output));
      const html = fs.readFileSync(output, 'utf8');
      assert.ok(html.includes(`data-composition-points="${points}" data-composition-route="straight" d="${d}"`));
      assertPassed(run('check', output));
      assertPassed(run('validate', type, input, '--json'));
      assertPassed(run('deliver', type, input, output, '--json'));
      assert.equal(fs.readFileSync(output, 'utf8'), html, 'delivery must retain the rendered geometry');

      fs.writeFileSync(output, html.replace(' data-composition-route="straight"', ''));
      const unmarked = run('check', output);
      assert.equal(unmarked.status, 1);
      assert.equal(orthogonalCheck(unmarked).ok, false, 'same geometry without authored intent must still fail');
    });
  }

  test(`${type}: automatic routes retain orthogonal behavior and explicit sides remain enforced`, () => {
    const automatic = structuredClone(document);
    delete automatic[collection][0].route;
    const input = inputFor(`${type}-auto`, automatic);
    const output = path.join(tmp, `${type}-auto.html`);
    assertPassed(run('render', type, input, output));
    const html = fs.readFileSync(output, 'utf8');
    assert.doesNotMatch(html, /data-composition-route="straight"/);
    assertPassed(run('check', output));

    const pinned = structuredClone(document);
    pinned[collection][0].fromSide = 'right';
    const rejected = run('render', type, inputFor(`${type}-pinned`, pinned), output);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /clean-flow\/endpoint-side-direction/);
  });
}

for (const type of ['lifecycle', 'architecture']) {
  test(`${type}: an empty via preserves the explicitly authored direct straight route`, () => {
    const { document, collection, d } = cases[type];
    const withEmptyVia = structuredClone(document);
    withEmptyVia[collection][0].via = [];
    const output = path.join(tmp, `${type}-empty-via.html`);
    assertPassed(run('deliver', type, inputFor(`${type}-empty-via`, withEmptyVia), output, '--json'));
    assert.ok(fs.readFileSync(output, 'utf8').includes(`data-composition-route="straight" d="${d}"`));
  });
}

test('lifecycle: via overrides straight without granting a direct-route exception', () => {
  const document = structuredClone(cases.lifecycle.document);
  document.transitions[0].via = [[360, 195], [425, 250]];
  const input = inputFor('lifecycle-via', document);
  const output = path.join(tmp, 'lifecycle-via.html');
  assertPassed(run('render', 'lifecycle', input, output));
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-composition-points="307,157;360,195;425,250;493,307"/);
  assert.doesNotMatch(html, /data-composition-route="straight"/);
  const checked = run('check', output);
  assert.equal(checked.status, 1);
  assert.equal(orthogonalCheck(checked).ok, false);
});

test('dataflow: via overrides straight and diagonal via still fails during rendering', () => {
  const document = structuredClone(cases.dataflow.document);
  document.flows[0].via = [[200, 200]];
  const rejected = run('render', 'dataflow', inputFor('dataflow-via', document), path.join(tmp, 'dataflow-via.html'));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /diagonal segment/);
});

test('a straight intent marker cannot exempt bent, curved or unidentified diagonals', () => {
  const paths = [
    'data-edge-from="a" data-edge-to="b" d="M 20 20 L 60 40 L 100 40"',
    'data-edge-from="a" data-edge-to="b" d="M 20 20 L 60 40 Q 80 40 100 70"',
    'd="M 20 20 L 120 80"',
  ];
  for (const [index, attrs] of paths.entries()) {
    const output = path.join(tmp, `stale-marker-${index}.html`);
    fs.writeFileSync(output, `<svg viewBox="0 0 240 160"><path ${attrs} data-composition-route="straight" class="a-default" marker-end="url(#arrowhead)"/></svg>`);
    const checked = run('check', output);
    assert.equal(checked.status, 1);
    const check = orthogonalCheck(checked);
    assert.equal(check.ok, false);
    assert.match(check.details[0], /expected an orthogonal segment or an explicitly authored direct straight route/);
  }
});
