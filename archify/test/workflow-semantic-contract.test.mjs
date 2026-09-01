import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

function document(semanticChecks) {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Workflow semantic contract fixture',
      legend: { mode: 'hidden' },
    },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'recovery', label: 'Recovery' },
    ],
    nodes: [
      { id: 'input', lane: 'main', col: 0, type: 'external', label: 'Input' },
      { id: 'process', lane: 'main', col: 2, type: 'backend', label: 'Process' },
      { id: 'result', lane: 'main', col: 4, type: 'frontend', label: 'Result' },
      { id: 'ledger', lane: 'recovery', col: 4, type: 'database', label: 'Ledger' },
      { id: 'resume', lane: 'recovery', col: 1, type: 'backend', label: 'Resume' },
    ],
    edges: [
      { id: 'start', from: 'input', to: 'process' },
      { id: 'finish', from: 'process', to: 'result' },
      { id: 'record', from: 'process', to: 'ledger' },
    ],
    ...(semanticChecks ? { semanticChecks } : {}),
  };
}

test('semanticChecks rejects an undeclared root instead of accepting an orphan recovery node', () => {
  const workflow = document({
    allowedRoots: ['input'],
  });

  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => (
      diagnostic.code === 'workflow/unexpected-root'
      && diagnostic.subject?.node === 'resume'
    )),
    JSON.stringify(result.diagnostics, null, 2),
  );
});

test('semanticChecks rejects a missing required edge with its exact endpoints', () => {
  const workflow = document({
    requiredEdges: [{ from: 'ledger', to: 'resume' }],
  });

  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => (
      diagnostic.code === 'workflow/required-edge'
      && diagnostic.subject?.from === 'ledger'
      && diagnostic.subject?.to === 'resume'
    )),
    JSON.stringify(result.diagnostics, null, 2),
  );
});

test('semanticChecks accepts required reachability through intermediate nodes without changing SVG bytes', () => {
  const baseline = document();
  const constrained = document({
    allowedRoots: ['input', 'resume'],
    allowedTerminals: ['result', 'ledger', 'resume'],
    requiredEdges: [{ from: 'process', to: 'ledger' }],
    requiredPaths: [{ from: 'input', to: 'result' }],
  });

  const baselineResult = compileWorkflow({ workflow: baseline, qualityProfile: 'standard' });
  const constrainedResult = compileWorkflow({ workflow: constrained, qualityProfile: 'standard' });

  assert.equal(baselineResult.ok, true, JSON.stringify(baselineResult.diagnostics, null, 2));
  assert.equal(constrainedResult.ok, true, JSON.stringify(constrainedResult.diagnostics, null, 2));
  assert.equal(constrainedResult.svg, baselineResult.svg);
  assert.deepEqual(constrainedResult.receipt, baselineResult.receipt);
});

test('semanticChecks rejects a required path that is not reachable in authored direction', () => {
  const workflow = document({
    requiredPaths: [{ from: 'ledger', to: 'resume' }],
  });

  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === 'workflow/required-path'),
    JSON.stringify(result.diagnostics, null, 2),
  );
});

test('semanticChecks rejects an undeclared terminal', () => {
  const workflow = document({
    allowedTerminals: ['result', 'ledger'],
  });

  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => (
      diagnostic.code === 'workflow/unexpected-terminal'
      && diagnostic.subject?.node === 'resume'
    )),
    JSON.stringify(result.diagnostics, null, 2),
  );
});

test('semanticChecks reports unknown contract node ids before graph analysis', () => {
  const workflow = document({
    requiredEdges: [{ from: 'missing', to: 'resume' }],
  });

  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ['workflow/semantic-node-reference'],
  );
  assert.equal(result.diagnostics[0].subject.path, '/semanticChecks/requiredEdges/0/from');
});
