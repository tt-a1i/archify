import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderWorkflow } from '../renderers/workflow/workflow-api.mjs';
import { prepareDiagramBrandMarks } from '../renderers/shared/brand-marks.mjs';

const renderer = fileURLToPath(new URL('../renderers/workflow/render-workflow.mjs', import.meta.url));

function workflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Branded workflow', output: 'caller-owned.html', locale: 'en', quality_profile: 'standard', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'frontend', label: 'Input', brand: 'openai' },
      { id: 'b', lane: 'main', col: 3, type: 'backend', label: 'Output', brand: 'github' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'request' }],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function runRenderer(t, document) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-brands-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'input.json');
  const output = path.join(root, 'output.html');
  fs.writeFileSync(input, JSON.stringify(document));
  const env = { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' };
  delete env.ARCHIFY_QUALITY_PROFILE;
  delete env.ARCHIFY_REPO_ROOT;
  const result = spawnSync(process.execPath, [renderer, input, output], {
    cwd: root, encoding: 'utf8', timeout: 30000, env,
  });
  assert.ifError(result.error);
  return { ...result, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : undefined };
}

// The removed draft option must not let an existing caller silently drop
// authored brands or bypass brand validation.
for (const [label, options] of [['default options', {}], ['removed skip option', { prepareBrandMarks: false }]]) {
  test(`renderWorkflow preserves brands and matches CLI HTML with ${label}`, async t => {
    const document = deepFreeze(workflow());
    const before = structuredClone(document);
    const result = await renderWorkflow({ workflow: document, ...options });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.match(result.svg, /data-brand-mark="openai"/);
    assert.match(result.svg, /data-brand-mark="github"/);
    assert.deepEqual(document, before);
    const cli = runRenderer(t, document);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(result.html, cli.html);
  });

  test(`renderWorkflow returns brand failures matching CLI diagnostics with ${label}`, async t => {
    const document = workflow();
    document.nodes[0].brand = 'not-a-real-brand';
    const before = structuredClone(document);
    const result = await renderWorkflow({ workflow: deepFreeze(document), ...options });
    assert.equal(result.ok, false);
    assert.equal(result.html, undefined);
    assert.equal(result.svg, undefined);
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['brand/unknown']);
    assert.deepEqual(document, before);
    const cli = runRenderer(t, document);
    assert.equal(cli.status, 1, cli.stderr);
    assert.equal(cli.stdout, '');
    assert.equal(cli.html, undefined);
    assert.deepEqual(JSON.parse(cli.stderr).diagnostics, result.diagnostics);
  });
}

test('renderWorkflow prepares its own clone even when the caller already prepared brands', async () => {
  const document = workflow();
  await prepareDiagramBrandMarks('workflow', document);
  const before = JSON.stringify(document);
  const result = await renderWorkflow({ workflow: deepFreeze(document), prepareBrandMarks: false });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.match(result.svg, /data-brand-mark="openai"/);
  assert.match(result.svg, /data-brand-mark="github"/);
  assert.equal(JSON.stringify(document), before);
});

test('branded renders remain independent across repeated, concurrent and failed calls', async () => {
  const document = deepFreeze(workflow());
  const before = structuredClone(document);
  const unbranded = workflow();
  delete unbranded.nodes[0].brand;
  delete unbranded.nodes[1].brand;
  const invalid = workflow();
  invalid.nodes[0].brand = 'not-a-real-brand';
  const [first, plain, failed, repeated] = await Promise.all([
    renderWorkflow({ workflow: document }),
    renderWorkflow({ workflow: deepFreeze(unbranded) }),
    renderWorkflow({ workflow: deepFreeze(invalid) }),
    renderWorkflow({ workflow: document }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(plain.ok, true);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.diagnostics.map(entry => entry.code), ['brand/unknown']);
  assert.match(first.svg, /data-brand-mark="openai"/);
  assert.doesNotMatch(plain.svg, /data-brand-mark=/);
  assert.deepEqual(first, repeated);
  assert.deepEqual(await renderWorkflow({ workflow: document }), first);
  assert.deepEqual(document, before);
});
