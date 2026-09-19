import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceRoot = path.join(repoRoot, 'benchmarks/hybrid-large-world-viewer-pilot/artifacts');

function load(id, type) {
  const stem = `${id}.${type}`;
  const artifact = fs.readFileSync(path.join(evidenceRoot, `${stem}.html`));
  const receipt = JSON.parse(fs.readFileSync(path.join(evidenceRoot, `${stem}.visual-check.json`), 'utf8'));
  return { artifact, receipt };
}

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function viewportKey(entry) {
  return `${entry.width}x${entry.height}:${entry.theme}`;
}

test('checked-in large-world browser evidence is artifact-bound and complete', () => {
  for (const type of ['workflow', 'architecture']) {
    for (const size of [30, 100, 300]) {
      const { artifact, receipt } = load(`${type}-${size}`, type);
      assert.equal(receipt.schemaVersion, 3, `${type}-${size} receipt schema`);
      assert.equal(receipt.artifact.sha256, sha256(artifact), `${type}-${size} artifact hash`);
      assert.equal(receipt.artifact.bytes, artifact.byteLength, `${type}-${size} artifact bytes`);
      assert.equal(receipt.status, 'pass', `${type}-${size} visual-check`);
      assert.equal(receipt.containment.status, 'pass');
      assert.equal(receipt.readability.status, 'pass');
      assert.equal(receipt.viewerChrome.status, 'pass');
      assert.equal(receipt.worldReachability.status, 'pass');
      assert.equal(receipt.exportCompleteness.status, 'pass');
      assert.equal(receipt.worldReachability.nodeCount, size);
      assert.equal(receipt.worldReachability.staticallyProvedNodeCount, size);
      assert.equal(receipt.worldReachability.navigatedNodeCount, size === 30 ? size : 12);
      assert.equal(receipt.worldReachability.reachedNodeCount, size === 30 ? size : 12);
      assert.equal(
        receipt.worldReachability.staticallyProvedEdgeCount,
        receipt.worldReachability.edgeCount,
      );
      assert.equal(
        receipt.worldReachability.navigatedEdgeCount,
        size === 30 ? receipt.worldReachability.edgeCount : 12,
      );
      assert.equal(
        receipt.worldReachability.reachedEdgeCount,
        receipt.worldReachability.navigatedEdgeCount,
      );
      assert.equal(
        receipt.worldReachability.reachedGuidedViewCount,
        receipt.worldReachability.guidedViewCount,
      );
      assert.equal(receipt.worldReachability.worldPointCount, 5);
      assert.equal(receipt.worldReachability.reachedWorldPointCount, 5);
      assert.deepEqual(receipt.worldReachability.missingNodeIds, []);
      assert.deepEqual(receipt.worldReachability.missingEdgeIds, []);
      assert.deepEqual(receipt.worldReachability.missingGuidedViewIds, []);
      assert.deepEqual(receipt.worldReachability.missingWorldPoints, []);
      assert.equal(receipt.exportCompleteness.sourceNodeCount, size);
      assert.equal(receipt.exportCompleteness.exportedNodeCount, size);
      assert.ok(receipt.containment.viewports.every((entry) => !entry.overflowX && !entry.overflowY));
      const expectedProfile = size === 30 ? 'small' : 'large';
      assert.ok(receipt.readability.viewports.every((entry) => entry.worldProfile === expectedProfile));
      if (expectedProfile === 'large') {
        assert.ok(receipt.readability.viewports.every((entry) => entry.overviewProjectedNodeTextPx < 6));
        assert.ok(receipt.readability.viewports.every((entry) => entry.minimumProjectedNodeTextPx >= 6 - 0.000001));
      } else {
        assert.ok(receipt.readability.viewports.every((entry) => entry.overviewProjectedNodeTextPx >= 6));
      }
    }
  }
});

test('100/300 large-world stages are independent of canonical world dimensions', () => {
  for (const type of ['workflow', 'architecture']) {
    const smaller = load(`${type}-100`, type).receipt.readability.viewports;
    const larger = new Map(load(`${type}-300`, type).receipt.readability.viewports.map((entry) => [viewportKey(entry), entry]));
    for (const entry of smaller) {
      const peer = larger.get(viewportKey(entry));
      assert.ok(peer, `${type} ${viewportKey(entry)} peer`);
      assert.ok(Math.abs(entry.stageWidth - peer.stageWidth) <= 1, `${type} ${viewportKey(entry)} stage width`);
      assert.ok(Math.abs(entry.stageHeight - peer.stageHeight) <= 1, `${type} ${viewportKey(entry)} stage height`);
      assert.ok(Math.abs(entry.stageHeight - entry.expectedStageHeight) <= 2, `${type} ${viewportKey(entry)} expected height`);
      assert.ok(Math.abs(peer.stageHeight - peer.expectedStageHeight) <= 2, `${type} ${viewportKey(entry)} peer expected height`);
    }
  }
});

test('300-node evidence proves the dynamic zoom cap is materially above the legacy 3x limit', () => {
  for (const type of ['workflow', 'architecture']) {
    const viewports = load(`${type}-300`, type).receipt.readability.viewports;
    assert.ok(viewports.some((entry) => entry.cameraScale > 3), `${type} dynamic scale`);
    assert.ok(viewports.every((entry) => Number.isFinite(entry.cameraScale) && entry.cameraScale <= 32));
  }
});
