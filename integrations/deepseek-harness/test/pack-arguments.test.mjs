import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const integrationRoot = fileURLToPath(new URL('../', import.meta.url));
const pack = path.join(integrationRoot, 'scripts/pack.mjs');

test('DSH pack rejects missing output values before allocating a stage', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify pack arguments '));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const preload = path.join(scratch, 'no-staging.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
fs.mkdtempSync = () => { throw new Error('STAGING_STARTED'); };
`);
  const run = (args) => spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, pack, ...args], {
    cwd: scratch, encoding: 'utf8',
  });
  for (const args of [['--out'], ['--out', '--json'], ['--out', '']]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--out requires a path value/, args.join(' '));
    assert.doesNotMatch(result.stderr, /STAGING_STARTED/);
    assert.deepEqual(fs.readdirSync(scratch), ['no-staging.mjs']);
  }
  // Omission retains its existing default and an explicit path remains valid.
  // This probe deliberately stops before any packing, installation, or network.
  for (const args of [[], ['--out', path.join(scratch, 'package.tgz'), '--json']]) {
    const result = run(args);
    assert.match(result.stderr, /STAGING_STARTED/);
    assert.doesNotMatch(result.stderr, /--out requires a path value/);
  }
});
