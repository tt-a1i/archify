import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWorkflow } from '../renderers/workflow/workflow-api.mjs';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const BOUNDARY_KEY = Symbol.for('archify.renderer-diagnostic-boundary');

function workflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Agent handoff',
      output: 'agent-handoff.html',
      locale: 'en',
      quality_profile: 'standard',
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'frontend', label: 'Input' },
      { id: 'b', lane: 'main', col: 3, type: 'backend', label: 'Output' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'request' }],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('renderWorkflow requires a parsed document object, not argv or a path', async () => {
  await assert.rejects(() => renderWorkflow({ workflow: '/some/path.json' }), TypeError);
  await assert.rejects(() => renderWorkflow({ workflow: null }), TypeError);
});

test('renderWorkflow returns rendered output and matches the compiler used underneath', async () => {
  const input = deepFreeze(workflow());
  const result = await renderWorkflow({ workflow: input, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.match(result.html, /<svg/);
  assert.equal(result.html.includes(result.svg.trim().slice(0, 40)), true);

  const compiled = compileWorkflow({ workflow: structuredClone(input), qualityProfile: 'showcase' });
  assert.equal(result.svg, compiled.svg);
});

test('renderWorkflow never mutates the caller\'s document and stays independent across repeated/concurrent calls', async () => {
  const input = deepFreeze(workflow());
  const before = structuredClone(input);

  const [first, second, third] = await Promise.all([
    renderWorkflow({ workflow: input, qualityProfile: 'showcase' }),
    renderWorkflow({ workflow: input, qualityProfile: 'standard' }),
    renderWorkflow({ workflow: input, qualityProfile: 'showcase' }),
  ]);

  assert.deepEqual(input, before);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.deepEqual(first, third);
  assert.notEqual(first.svg, second.svg);
  assert.match(second.svg, /data-quality-profile="standard"/);
  assert.match(first.svg, /data-quality-profile="showcase"/);
});

test('renderWorkflow never installs the CLI-only process-level diagnostics boundary', async () => {
  assert.equal(globalThis[BOUNDARY_KEY], undefined);
  await renderWorkflow({ workflow: workflow() });
  assert.equal(globalThis[BOUNDARY_KEY], undefined);

  const broken = workflow();
  broken.edges.push({ id: 'ab', from: 'b', to: 'a' });
  const result = await renderWorkflow({ workflow: broken });
  assert.equal(result.ok, false);
  assert.equal(globalThis[BOUNDARY_KEY], undefined);
});

test('renderWorkflow enforces guided-view and relationship-id contracts', async () => {
  const duplicateEdgeIds = workflow();
  duplicateEdgeIds.edges.push({ id: 'ab', from: 'b', to: 'a', label: 'reply' });
  const viaLibrary = await renderWorkflow({ workflow: duplicateEdgeIds });
  assert.equal(viaLibrary.ok, false);
  assert.deepEqual(viaLibrary.diagnostics.map((entry) => entry.code), ['relationship/duplicate-id']);

  const unknownFocus = workflow();
  unknownFocus.meta.views = [{ id: 'view-1', label: 'View 1', focus: ['does-not-exist'] }];
  const result = await renderWorkflow({ workflow: unknownFocus });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code), ['guided-view/invalid']);
});

test('renderWorkflow reports a compiler-level failure as data, not an exception', async () => {
  const invalid = workflow();
  invalid.semanticChecks = { requiredEdges: [{ from: 'b', to: 'a' }] };
  const result = await renderWorkflow({ workflow: invalid });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code), ['workflow/required-edge']);
  assert.equal(result.html, undefined);
});
