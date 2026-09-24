import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// DIAGNOSTIC_MODE in shared/diagnostics.mjs is captured once at module load
// from ARCHIFY_DIAGNOSTIC_FORMAT, so exercising it needs a real subprocess
// with the env var set before archify's modules are ever imported.
const apiUrl = new URL('../renderers/workflow/workflow-api.mjs', import.meta.url).href;
const diagnosticsUrl = new URL('../renderers/shared/diagnostics.mjs', import.meta.url).href;

function workflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Diagnostics isolation', output: 'diagnostics.html', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'frontend', label: 'Input' },
      { id: 'b', lane: 'main', col: 3, type: 'backend', label: 'Output' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }],
  };
}

function runChild(program) {
  const script = `
    import assert from 'node:assert/strict';
    import { renderWorkflow } from ${JSON.stringify(apiUrl)};
    import { installRendererDiagnosticBoundary, recordDiagnostic, throwDiagnosticError } from ${JSON.stringify(diagnosticsUrl)};
    const workflow = ${workflow.toString()};
    ${program}
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });
}

test('a failed renderWorkflow call does not leak diagnostics into a later unrelated CLI failure', () => {
  const result = runChild(`
    // A CLI diagnostic recorded before the library call must survive it.
    recordDiagnostic({ code: 'test/cli-before', message: 'Existing CLI diagnostic' });

    const failed = await renderWorkflow({ workflow: {} });
    assert.equal(failed.ok, false);
    assert.ok(failed.diagnostics.some(({ code }) => code === 'schema/required'));

    const broken = workflow();
    broken.meta.views = [{ id: 'view', label: 'View', focus: ['missing'] }];
    const alsoFailed = await renderWorkflow({ workflow: broken });
    assert.deepEqual(alsoFailed.diagnostics.map(({ code }) => code), ['guided-view/invalid']);

    const ok = await renderWorkflow({ workflow: workflow() });
    assert.equal(ok.ok, true, JSON.stringify(ok.diagnostics));

    // Only now does a real CLI failure happen; its report must contain
    // exactly the CLI's own diagnostics, none of the library call's.
    assert.equal(globalThis[Symbol.for('archify.renderer-diagnostic-boundary')], undefined);
    installRendererDiagnosticBoundary();
    setImmediate(() => throwDiagnosticError('CLI failure', [{ code: 'test/cli-after', message: 'CLI failure' }]));
  `);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.ok, false);
  assert.deepEqual(receipt.diagnostics.map(({ code }) => code), ['test/cli-before', 'test/cli-after']);
});
