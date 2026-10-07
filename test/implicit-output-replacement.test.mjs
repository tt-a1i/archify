import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../archify/bin/preview.mjs';
import { resolveOutputPath } from '../archify/renderers/shared/output-path.mjs';

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');
const unrelated = '<!DOCTYPE html><html><body>Keep this unrelated page.</body></html>';

function fixture(t, authored = true) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replacement-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'input.json');
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  diagram.meta.title = `Replacement <fixture> & "quoted" 'test'`;
  if (authored) diagram.meta.output = 'result.html';
  else delete diagram.meta.output;
  fs.writeFileSync(input, JSON.stringify(diagram));
  return { cwd, input, diagram, output: path.join(cwd, authored ? 'result.html' : 'architecture.html') };
}

function run(command, f, explicit = false) {
  return spawnSync(process.execPath, [cli, command, f.type || 'architecture', f.input,
    ...(explicit ? [f.output] : []), ...(command === 'deliver' ? ['--json'] : [])], {
    cwd: f.cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1', ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });
}

for (const command of ['render', 'deliver']) {
  test(`${command} preserves unrelated meta.output HTML and accepts explicit replacement`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, unrelated);
    const denied = run(command, f);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stdout + denied.stderr, /output\/replacement-required/);
    assert.equal(fs.readFileSync(f.output, 'utf8'), unrelated);
    assert.deepEqual(fs.readdirSync(f.cwd).sort(), [path.basename(f.output), 'input.json'].sort());
    const allowed = run(command, f, true);
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    assert.match(fs.readFileSync(f.output, 'utf8'), /archify-diagram-title/);
  });
  test(`${command} creates output and regenerates matching diagrams without changing artifact bytes`, t => {
    const f = fixture(t);
    let result = run(command, f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const before = fs.readFileSync(f.output);
    result = run(command, f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(fs.readFileSync(f.output), before);
    f.diagram.components[0].label = 'Updated node';
    fs.writeFileSync(f.input, JSON.stringify(f.diagram));
    result = run(command, f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(fs.readFileSync(f.output, 'utf8'), /Updated node/);
  });
  test(`${command} preserves a different-title Archify artifact until replacement is explicit`, t => {
    const f = fixture(t);
    assert.equal(run(command, f).status, 0);
    const before = fs.readFileSync(f.output);
    const metadata = fs.readdirSync(f.cwd).filter(name => name !== 'input.json' && name !== 'result.html')
      .map(name => [name, fs.readFileSync(path.join(f.cwd, name))]);
    f.diagram.meta.title = 'Different diagram';
    fs.writeFileSync(f.input, JSON.stringify(f.diagram));
    const denied = run(command, f);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stdout + denied.stderr, /output\/replacement-required/);
    assert.deepEqual(fs.readFileSync(f.output), before);
    for (const [name, bytes] of metadata) assert.deepEqual(fs.readFileSync(path.join(f.cwd, name)), bytes);
    assert.equal(run(command, f, true).status, 0);
  });
}

for (const [type, example] of [
  ['architecture', 'web-app.architecture.json'],
  ['workflow', 'agent-tool-call.workflow.json'],
  ['sequence', 'cache-miss-request.sequence.json'],
  ['dataflow', 'product-analytics.dataflow.json'],
  ['lifecycle', 'agent-run.lifecycle.json'],
  ['erd', 'orders.erd.json'],
  ['tree', 'payment-platform.tree.json'],
  ['class', 'payments.class.json'],
  ['timeline', 'payment-incident.timeline.json'],
  ['waterfall', 'checkout-request.waterfall.json'],
]) {
  test(`${type} recognizes its maintained output for implicit regeneration`, t => {
    const f = fixture(t);
    f.type = type;
    f.diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    f.diagram.meta.output = 'result.html';
    fs.writeFileSync(f.input, JSON.stringify(f.diagram));
    let result = run('render', f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const before = fs.readFileSync(f.output);
    result = run('render', f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(fs.readFileSync(f.output), before);
  });
}

test('default output selection uses the same replacement guard', t => {
  const f = fixture(t, false);
  const request = { defaultOutput: 'architecture.html', cwd: f.cwd, regeneration: { title: f.diagram.meta.title } };
  assert.equal(resolveOutputPath(request).source, 'default');
  fs.writeFileSync(f.output, unrelated);
  assert.throws(() => resolveOutputPath(request), error => error.archifyDiagnostics?.[0]?.code === 'output/replacement-required');
  assert.equal(fs.readFileSync(f.output, 'utf8'), unrelated);
  assert.equal(resolveOutputPath({ ...request, requestedOutput: f.output }).source, 'cli');
});

test('marker text inside comments or scripts does not identify an Archify output', t => {
  const f = fixture(t);
  assert.equal(run('render', f).status, 0);
  const generated = fs.readFileSync(f.output, 'utf8');
  for (const disguise of [`<!-- ${generated} -->`, `<script type="text/plain">${generated}</script>`]) {
    const content = unrelated + disguise;
    fs.writeFileSync(f.output, content);
    assert.notEqual(run('deliver', f).status, 0);
    assert.equal(fs.readFileSync(f.output, 'utf8'), content);
  }
});

async function waitFor(preview, predicate) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const state = preview.state();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(JSON.stringify(preview.state()));
}

test('preview rejects unrelated implicit output before creating staging and can replace explicitly', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.output, unrelated);
  await assert.rejects(startPreview({ type: 'architecture', input: f.input, cwd: f.cwd, open: false }).then(async unexpected => {
    await unexpected.stop();
    return unexpected;
  }), error => {
    assert.equal(error.archifyDiagnostics?.[0]?.code, 'output/replacement-required');
    return true;
  });
  assert.equal(fs.readFileSync(f.output, 'utf8'), unrelated);
  assert.deepEqual(fs.readdirSync(f.cwd).sort(), ['input.json', 'result.html']);
  const preview = await startPreview({ type: 'architecture', input: f.input, output: f.output, cwd: f.cwd, open: false });
  try { await waitFor(preview, state => state.status === 'verified'); }
  finally { await preview.stop(); }
  assert.notEqual(fs.readFileSync(f.output, 'utf8'), unrelated);
});

test('preview regenerates matching output and keeps working after an authored title edit', async t => {
  const f = fixture(t);
  assert.equal(run('render', f).status, 0);
  const preview = await startPreview({ type: 'architecture', input: f.input, cwd: f.cwd, open: false, pollMs: 50, debounceMs: 20 });
  try {
    await waitFor(preview, state => state.status === 'verified');
    f.diagram.meta.title = 'Edited during preview';
    fs.writeFileSync(f.input, JSON.stringify(f.diagram));
    await waitFor(preview, state => state.status === 'verified' && state.revision >= 2);
    f.diagram.meta.subtitle = 'One more edit';
    fs.writeFileSync(f.input, JSON.stringify(f.diagram));
    await waitFor(preview, state => state.status === 'verified' && state.revision >= 3);
  } finally { await preview.stop(); }
  assert.match(fs.readFileSync(f.output, 'utf8'), /One more edit/);
});

test('preview preserves unrelated content placed at its output between generations', async t => {
  const f = fixture(t);
  const preview = await startPreview({ type: 'architecture', input: f.input, cwd: f.cwd, open: false, pollMs: 50, debounceMs: 20 });
  try {
    await waitFor(preview, state => state.status === 'verified');
    fs.writeFileSync(f.output, unrelated);
    f.diagram.meta.subtitle = 'Trigger another generation';
    fs.writeFileSync(f.input, JSON.stringify(f.diagram));
    const failure = await waitFor(preview, state => state.status === 'needs-fix');
    assert.equal(failure.failure.code, 'output/replacement-required');
    assert.equal(fs.readFileSync(f.output, 'utf8'), unrelated);
  } finally { await preview.stop(); }
});
