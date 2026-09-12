import assert from 'node:assert/strict';
import test from 'node:test';
import { svgRootAttrs } from '../renderers/shared/cli.mjs';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const polluted = [
  process.execPath,
  'render-architecture.mjs',
  'in.json',
  'out.html',
  '--bundle-id', 'polluted',
  '--bundle-role', 'entry',
  '--bundle-spec-sha256', 'a'.repeat(64),
];

function workflowDoc() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Bundle attrs' },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'start', lane: 'main', col: 0, type: 'frontend', label: 'Start' },
      { id: 'end', lane: 'main', col: 1, type: 'backend', label: 'End' },
    ],
    edges: [{ id: 'start-end', from: 'start', to: 'end' }],
  };
}

test('svgRootAttrs ignores a polluted process.argv when no bundle option is passed', () => {
  const previous = process.argv;
  process.argv = polluted;
  try {
    const attrs = svgRootAttrs({ title: 'Map' });
    assert.doesNotMatch(attrs, /data-bundle-/);
    const empty = svgRootAttrs({ title: 'Map' }, {});
    assert.doesNotMatch(empty, /data-bundle-/);
  } finally {
    process.argv = previous;
  }
});

test('compileWorkflow without bundle options ignores a polluted process.argv', () => {
  const previous = process.argv;
  process.argv = polluted;
  try {
    const result = compileWorkflow({ workflow: workflowDoc(), qualityProfile: 'standard' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.doesNotMatch(result.svg, /data-bundle-/);
  } finally {
    process.argv = previous;
  }
});
