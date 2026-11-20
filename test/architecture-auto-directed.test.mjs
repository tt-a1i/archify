import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

test('automatic architecture placement honors explicit straight directions on a chain', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-auto-directed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const pin = [680, 440];
  const components = ['caller', 'service', 'store', 'fixed'].map((id, index) => ({
    id, type: 'backend', label: id, size: [125 + index * 10, 60 + index * 4],
    ...(id === 'fixed' ? { pos: pin } : {}),
  }));

  for (const [fromSide, toSide, axis, sign] of [
    ['bottom', 'top', 1, 1], ['top', 'bottom', 1, -1],
    ['right', 'left', 0, 1], ['left', 'right', 0, -1],
  ]) {
    fs.writeFileSync(input, JSON.stringify({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Request chain', output: 'diagram.html', quality_profile: 'showcase' },
      layout: { mode: 'auto' },
      components,
      connections: [['caller', 'service'], ['service', 'store']].map(([from, to]) => ({
        from, to, fromSide, toSide, route: 'straight',
      })),
    }));

    const result = spawnSync(process.execPath, [cli, 'inspect', 'architecture', input, '--json'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${fromSide} to ${toSide}: ${result.stderr || result.stdout}`);
    const report = JSON.parse(result.stdout);
    const fixed = report.components.find((component) => component.id === 'fixed');
    assert.deepEqual([fixed.x, fixed.y], pin);
    for (const { points } of report.connections) {
      assert.equal(points.length, 2);
      const [start, end] = points;
      assert.equal(start[1 - axis], end[1 - axis]);
      assert.ok((end[axis] - start[axis]) * sign > 0, `${fromSide} to ${toSide}: ${JSON.stringify(points)}`);
    }
  }
});
