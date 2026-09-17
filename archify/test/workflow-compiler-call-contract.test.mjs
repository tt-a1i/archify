import assert from 'node:assert/strict';
import test from 'node:test';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

function workflow(version, locale = 'en') {
  return {
    schema_version: version,
    diagram_type: 'workflow',
    meta: { title: `Workflow ${version}`, locale, quality_profile: 'standard', legend: { mode: 'hidden' } },
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

for (const version of [1, 2]) {
  test(`workflow v${version}: A/B/A compilation preserves frozen inputs and earlier results`, () => {
    const input = workflow(version);
    const before = structuredClone(input);
    deepFreeze(input);
    const first = compileWorkflow({ workflow: input, qualityProfile: 'showcase' });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const snapshot = structuredClone(first);
    deepFreeze(first);

    const other = workflow(version === 1 ? 2 : 1, 'zh-CN');
    other.meta.title = 'Another workflow';
    other.nodes[1].col = 4;
    const different = compileWorkflow({ workflow: deepFreeze(other), qualityProfile: 'standard' });
    assert.equal(different.ok, true, JSON.stringify(different.diagnostics));
    assert.notEqual(different.svg, first.svg);
    assert.notEqual(different.receipt.contract, first.receipt.contract);
    assert.match(different.svg, /lang="zh-CN"/);
    assert.match(different.svg, /data-quality-profile="standard"/);

    const repeated = compileWorkflow({ workflow: input, qualityProfile: 'showcase' });
    assert.deepEqual(repeated, snapshot);
    assert.deepEqual(first, snapshot);
    assert.deepEqual(input, before);
    assert.match(repeated.svg, /lang="en"/);
    assert.match(repeated.svg, /data-quality-profile="showcase"/);
  });

  test(`workflow v${version}: failure/success calls retain independent result diagnostics`, () => {
    const input = deepFreeze(workflow(version));
    const expected = compileWorkflow({ workflow: input, qualityProfile: 'standard' });
    assert.equal(expected.ok, true, JSON.stringify(expected.diagnostics));

    const schemaFailure = compileWorkflow({ workflow: deepFreeze({}) });
    assert.equal(schemaFailure.ok, false);
    assert.ok(schemaFailure.diagnostics.length > 0);
    assert.ok(schemaFailure.diagnostics.every(entry => entry.code === 'schema/required'));
    assert.equal(schemaFailure.svg, undefined);
    const snapshot = structuredClone(schemaFailure);
    deepFreeze(schemaFailure);
    assert.deepEqual(compileWorkflow({ workflow: input, qualityProfile: 'standard' }), expected);

    const invalid = workflow(version);
    invalid.semanticChecks = { requiredEdges: [{ from: 'b', to: 'a' }] };
    const semanticFailure = compileWorkflow({ workflow: deepFreeze(invalid), qualityProfile: 'standard' });
    assert.equal(semanticFailure.ok, false);
    assert.deepEqual(semanticFailure.diagnostics.map(entry => entry.code), ['workflow/required-edge']);
    assert.deepEqual(semanticFailure.receipt.diagnostics, semanticFailure.diagnostics);
    assert.equal(semanticFailure.svg, undefined);
    assert.deepEqual(compileWorkflow({ workflow: input, qualityProfile: 'standard' }), expected);
    assert.deepEqual(compileWorkflow({ workflow: {} }), snapshot);
    assert.deepEqual(schemaFailure, snapshot);
    assert.deepEqual(expected.receipt.diagnostics, []);
  });
}
