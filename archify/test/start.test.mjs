import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../bin/archify.mjs', import.meta.url));
test('unified start documents optional output and rejects missing architecture input', () => {
  const help = spawnSync(process.execPath, [cli, 'start', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /archify start/);
  assert.match(help.stdout, /\[--out/);
  const invalid = spawnSync(process.execPath, [cli, 'start', '.'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /requires --ir/);
});
