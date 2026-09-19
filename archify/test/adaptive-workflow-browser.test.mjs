import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChrome, runVisualCheck, VISUAL_CHECK_VIEWPORTS } from '../bin/visual-check.mjs';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';
import { largeAdaptiveWorkflow } from './fixtures/large-adaptive-workflow.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('adaptive Workflow world is reachable and exports canonically at every desktop viewport and theme', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run the real-browser adaptive Workflow checks.',
  timeout: 120000,
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-adaptive-workflow-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'large-adaptive.workflow.json');
  const artifact = path.join(scratch, 'large-adaptive.workflow.html');
  const workflow = largeAdaptiveWorkflow();
  fs.writeFileSync(input, `${JSON.stringify(workflow, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/workflow/render-workflow.mjs'), input, artifact,
  ]);

  const compiled = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(compiled.ok, true);
  const before = sha256(artifact);
  const result = await runVisualCheck({ artifactPath: artifact, chromePath: chrome });

  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt.diagnostics, null, 2));
  assert.equal(result.receipt.containment.viewports.length, VISUAL_CHECK_VIEWPORTS.length * 2);
  assert.equal(result.receipt.containment.viewports.every(({ ok }) => ok), true);
  assert.equal(result.receipt.readability.viewports.every(({ readabilityOk }) => readabilityOk), true);
  assert.equal(result.receipt.viewerChrome.viewports.every(({ viewerChromeOk }) => viewerChromeOk), true);
  assert.deepEqual(result.receipt.worldReachability, {
    status: 'pass',
    auditMode: 'exhaustive-navigation',
    sampleSeed: 'archify-large-world-v1',
    nodeCount: 30,
    staticallyProvedNodeCount: 30,
    navigatedNodeCount: 30,
    reachedNodeCount: 30,
    edgeCount: 50,
    staticallyProvedEdgeCount: 50,
    navigatedEdgeCount: 50,
    reachedEdgeCount: 50,
    guidedViewCount: 5,
    reachedGuidedViewCount: 5,
    worldPointCount: 5,
    reachedWorldPointCount: 5,
    missingNodeIds: [],
    missingEdgeIds: [],
    missingGuidedViewIds: [],
    missingWorldPoints: [],
    cameraStateRestored: true,
    canonicalViewBoxUnchanged: true,
    canonicalGeometryUnchanged: true,
  });
  assert.equal(result.receipt.exportCompleteness.status, 'pass');
  assert.equal(result.receipt.exportCompleteness.sourceNodeCount, 30);
  assert.equal(result.receipt.exportCompleteness.exportedNodeCount, 30);
  assert.equal(result.receipt.exportCompleteness.sourceEdgeCount, 50);
  assert.equal(result.receipt.exportCompleteness.exportedEdgeCount, 50);
  assert.equal(result.receipt.exportCompleteness.canonicalBytesStableAfterCamera, true);
  assert.equal(result.receipt.exportCompleteness.cameraStateClean, true);
  assert.equal(result.receipt.artifact.sha256, before);
  assert.equal(sha256(artifact), before, 'browser inspection must not mutate the delivered artifact');
  assert.deepEqual(compiled.receipt.bounds.canonicalFrame, [0, 0, ...compiled.receipt.viewBox]);
});
