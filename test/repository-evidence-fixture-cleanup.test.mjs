import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const helper = new URL('./helpers/repository-evidence-fixture.mjs', import.meta.url).href;

test('repository evidence fixtures clean successful and partially initialized repositories', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fixture-cleanup-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import test from 'node:test';
    import { fixture } from ${JSON.stringify(helper)};
    test('successful fixture remains usable during the test', () => {
      const data = fixture();
      assert.ok(fs.existsSync(data.input));
      assert.equal(data.revision.length, 40);
    });
    test('failed fixture initialization', (t) => {
      const write = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (file, ...args) => {
        if (String(file).endsWith('router.js')) throw new Error('fixture write failed');
        return write(file, ...args);
      });
      assert.throws(() => fixture(), /fixture write failed/);
    });
  `], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: temporaryRoot, TEMP: temporaryRoot, TMP: temporaryRoot },
  });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.deepEqual(fs.readdirSync(temporaryRoot), [], 'fixture-owned Git directories must not outlive their suite');
});
