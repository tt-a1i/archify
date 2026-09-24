import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { reduceCrossings } from '../bin/route-repair.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(root, '..', 'bin', 'archify.mjs');

test('searched endpoint sides remove a crossing without touching authored routes', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-crossing.json'), 'utf8'));
  const result = await reduceCrossings({ cliPath, candidate, env: process.env });
  assert.ok(result);
  assert.ok(result.record.crossings[1] < result.record.crossings[0]);
  for (const { id } of result.record.pinned) {
    const before = candidate.connections.find((edge) => edge.id === id);
    assert.ok(!before.fromSide && !before.toSide && !before.via);
  }
  assert.deepEqual(result.candidate.components, candidate.components);
});
