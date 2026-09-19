import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnosticFamily, summarize } from '../../benchmarks/adaptive-workflow-pilot/benchmark.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const benchmark = path.join(repositoryRoot, 'benchmarks', 'adaptive-workflow-pilot', 'benchmark.mjs');

function receipt(configuration, pair, validationRepair, handoffReady, {
  sourceId = 'source', families = [], ok = true, boundedStop = false,
} = {}) {
  return {
    sourceId,
    pair,
    configuration: { id: configuration },
    durationMs: { validationRepair, handoffReady },
    validation: { diagnosticFamilies: families, ok, boundedStop },
  };
}

test('adaptive benchmark diagnostic families remain stable and queryable', () => {
  assert.equal(diagnosticFamily('viewer/viewport-overflow'), 'viewport-containment');
  assert.equal(diagnosticFamily('workflow/viewbox-capacity'), 'viewbox-capacity');
  assert.equal(diagnosticFamily('composition/node-overlap'), 'node-overlap');
  assert.equal(diagnosticFamily('composition/proper-crossing'), 'edge-crossing');
  assert.equal(diagnosticFamily('composition/label-route-clearance'), 'label-clearance');
  assert.equal(diagnosticFamily('composition/desktop-readability'), 'readability');
  assert.equal(diagnosticFamily('language/cjk-coverage'), 'language');
  assert.equal(diagnosticFamily('schema/invalid'), 'semantic');
  assert.equal(diagnosticFamily('viewer/chrome-unavailable'), 'infrastructure');
  assert.equal(diagnosticFamily('workflow/unclassified'), 'other');
});

test('adaptive benchmark derives paired deltas and never relabels machine evidence', () => {
  const receipts = [
    receipt('A', 1, 100, 200, { families: ['viewbox-capacity'] }),
    receipt('B', 1, 60, 170),
    receipt('B', 2, 70, 180),
    receipt('A', 2, 100, 200, { families: ['viewport-containment'] }),
    receipt('A', 3, 120, 220),
    receipt('B', 3, 60, 180),
  ];
  const summary = summarize(receipts, [{ id: 'A' }, { id: 'B' }]);

  assert.equal(summary.pairCount, 3);
  assert.equal(summary.validationRepair.pairedMedianDeltaRatio, -0.4);
  assert.equal(summary.handoffReady.pairedMedianDeltaRatio, -0.15);
  assert.equal(summary.handoffReady.baselineP95Ms, 220);
  assert.equal(summary.handoffReady.candidateP95Ms, 180);
  assert.equal(summary.handoffReady.p95DeltaRatio, -0.182);
  assert.deepEqual(summary.viewportRepair, {
    baselineCount: 2,
    candidateCount: 0,
    reductionRatio: 1,
  });
  assert.deepEqual(summary.firstCandidatePassRate, { A: 1, B: 1 });
  assert.deepEqual(summary.boundedStops, { A: 0, B: 0 });
});

test('adaptive benchmark manifest freezes at least six valid Workflow v2 sources', () => {
  const result = spawnSync(process.execPath, [benchmark, 'check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const checked = JSON.parse(result.stdout);
  assert.equal(checked.ok, true);
  assert.equal(checked.sourceCount, 6);
  assert.equal(checked.sources.every(({ sha256, materializedInputSha256 }) => (
    /^[a-f0-9]{64}$/.test(sha256) && /^[a-f0-9]{64}$/.test(materializedInputSha256)
  )), true);
  const large = checked.sources.find(({ id }) => id === 'large-adaptive-world');
  assert.ok(large.nodes >= 30);
  assert.ok(large.edges >= 40);
  assert.equal(large.views, 5);
});
