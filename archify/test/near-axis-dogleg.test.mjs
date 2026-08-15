import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cleanNearAxisDoglegProblems,
  collectNearAxisDoglegs,
} from '../renderers/shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const relation = { id: 'api-db', from: 'api', to: 'db' };

function doglegPoints() {
  return [[560, 340], [560, 229], [570, 229], [570, 118]];
}

test('geometry identifies only bent facing routes inside the near-axis threshold', () => {
  const doglegs = collectNearAxisDoglegs({
    routedRelations: [{
      relation,
      relationIndex: 0,
      fromSide: 'top',
      toSide: 'bottom',
      points: doglegPoints(),
    }],
  });
  assert.equal(doglegs.length, 1);
  assert.equal(doglegs[0].axisDelta, 10);

  assert.deepEqual(collectNearAxisDoglegs({
    routedRelations: [{
      relation,
      fromSide: 'top',
      toSide: 'bottom',
      points: [[560, 340], [560, 118]],
    }],
  }), []);
  assert.deepEqual(collectNearAxisDoglegs({
    routedRelations: [{
      relation,
      fromSide: 'top',
      toSide: 'bottom',
      points: [[560, 340], [560, 229], [660, 229], [660, 118]],
    }],
  }), []);
});

test('near-axis showcase diagnostic preserves explicit author routing controls', () => {
  const common = {
    relations: [relation],
    endpointIds: new Set(['api', 'db']),
    pathFor: () => ({ points: doglegPoints() }),
    fromSideFor: () => 'top',
    toSideFor: () => 'bottom',
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'showcase',
  };
  assert.equal(cleanNearAxisDoglegProblems(common).length, 1);
  assert.deepEqual(cleanNearAxisDoglegProblems({
    ...common,
    relations: [{ ...relation, via: [[560, 229], [570, 229]] }],
  }), []);
  assert.deepEqual(cleanNearAxisDoglegProblems({ ...common, profile: 'standard' }), []);
});

test('architecture validate exposes a structured near-axis dogleg diagnostic', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-near-axis-dogleg-'));
  const input = path.join(tmp, 'input.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Near-axis dogleg', quality_profile: 'showcase', viewBox: [900, 600] },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [500, 340], size: [120, 60] },
      { id: 'db', type: 'database', label: 'Database', pos: [510, 100], size: [120, 60] },
    ],
    boundaries: [],
    connections: [
      { id: 'api-db', from: 'api', to: 'db', fromSide: 'top', toSide: 'bottom' },
    ],
    cards: [],
  }));

  try {
    const result = spawnSync('node', [
      path.join(skillRoot, 'bin/archify.mjs'),
      'validate',
      'architecture',
      input,
      '--quality',
      'showcase',
      '--json',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, false);
    const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'composition/near-axis-dogleg');
    assert.ok(diagnostic);
    assert.equal(diagnostic.evidence.axisDeltaPx, 10);
    assert.equal(diagnostic.subject.collection, 'connections');
    assert.ok(diagnostic.supportedFixes.length > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
