import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function validate(example) {
  const input = path.join(skillRoot, 'examples', example);
  const result = spawnSync(process.execPath, [
    cli, 'validate', 'lifecycle', input,
    '--quality', 'showcase',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('validate reports a certain desktop overflow only as informational projection', () => {
  const receipt = validate('deployment-release.lifecycle.json');

  assert.equal(receipt.ok, true);
  assert.equal(receipt.candidateFrozen, true);
  assert.equal(receipt.composition.summary.errors, 0);
  assert.equal(receipt.viewportProjection.status, 'certain-overflow');
  assert.deepEqual(receipt.viewportProjection.targetViewport, { width: 1440, height: 900 });
  assert.deepEqual(receipt.viewportProjection.viewBox, { width: 980, height: 680 });
  assert.equal(receipt.viewportProjection.readerFit, null);
  assert.equal(receipt.viewportProjection.browserMeasured, false);
  assert.equal(receipt.viewportProjection.cardsIncluded, false);
  assert.equal(receipt.viewportProjection.guidedViewsIncluded, true);
  assert.equal(receipt.viewportProjection.svgWidthPx, 1346);
  assert.equal(receipt.viewportProjection.svgHeightPx, 934);
  assert.equal(receipt.viewportProjection.fixedChromePx, 187);
  assert.equal(receipt.viewportProjection.pageHeightLowerBoundPx, 1121);
  assert.equal(receipt.viewportProjection.overflowLowerBoundPx, 221);
  assert.match(receipt.viewportProjection.guidance, /certain visual-check failure/);
  assert.match(receipt.viewportProjection.guidance, /before cards/);
});

test('validate reports undetermined when static Reader rules cannot prove first-screen fit', () => {
  const receipt = validate('agent-run.lifecycle.json');

  assert.equal(receipt.ok, true);
  assert.equal(receipt.candidateFrozen, true);
  assert.equal(receipt.viewportProjection.status, 'undetermined');
  assert.deepEqual(receipt.viewportProjection.viewBox, { width: 1030, height: 630 });
  assert.equal(receipt.viewportProjection.browserMeasured, false);
  assert.equal(receipt.viewportProjection.cardsIncluded, false);
  assert.equal('pageHeightLowerBoundPx' in receipt.viewportProjection, false);
  assert.match(receipt.viewportProjection.guidance, /does not prove whole-page fit/);
  assert.match(receipt.viewportProjection.guidance, /run visual-check/);
});
