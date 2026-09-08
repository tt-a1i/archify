import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { CLI } from './helpers.mjs';
import { describeRepository } from '../extract/shared/git.mjs';
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-extract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
function extract(root, extra = [], env = process.env) {
  return spawnSync(process.execPath, [CLI, 'extract', root, ...extra], { encoding: 'utf8', timeout: 10000, env });
}
test('extract preserves import-equals and ignores locally bound require calls', (t) => {
  const root = fixture(t, {
    'dep.ts': 'export const value = 1;\n',
    'entry.ts': `import dep = require('./dep');
require('./dep');
function parameter(require: (s: string) => string) { require('./dep'); }
function local() { require('./dep'); var require = (s: string) => s; }
{ const { require } = { require: (s: string) => s }; require('./dep'); }
try {} catch (require) { require('./dep'); }
export {};
`,
    'loader.mjs': `import { createRequire as makeRequire } from 'node:module';
const require = makeRequire(import.meta.url);
require('./dep');`,
    'other-base.mjs': `import { createRequire } from 'node:module';
const require = createRequire('/another/project/entry.mjs');
require('./dep');`,
    'arrow.ts': `export const f = (require: (s: string) => string) => require('./dep');`,
  });
  const result = extract(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).imports.map(({ from, line, to, kind }) => ({ from, line, to, kind })), [
    { from: 'entry.ts', line: 1, to: 'dep.ts', kind: 'require' },
    { from: 'entry.ts', line: 2, to: 'dep.ts', kind: 'require' },
    { from: 'loader.mjs', line: 1, to: undefined, kind: 'static' },
    { from: 'loader.mjs', line: 3, to: 'dep.ts', kind: 'require' },
    { from: 'other-base.mjs', line: 1, to: undefined, kind: 'static' },
  ]);
});
test('extract rejects an unmatched configured brace without hanging or writing output', (t) => {
  const root = fixture(t, { 'index.ts': 'export {};', 'config.json': JSON.stringify({ include: ['**/*.{ts,js'] }) });
  const out = path.join(root, 'facts.json');
  const result = extract(root, ['--config', path.join(root, 'config.json'), '--out', out, '--json']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'cli/config-invalid');
  assert.equal(fs.existsSync(out), false);
});
test('extract bytes do not depend on locale for Unicode paths', (t) => {
  const root = fixture(t, { 'ä/entry.mjs': "import 'node:fs';", 'z/entry.mjs': "import 'node:fs';" });
  const a = extract(root, [], { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' });
  const b = extract(root, [], { ...process.env, LANG: 'sv_SE.UTF-8', LC_ALL: 'sv_SE.UTF-8' });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.deepEqual(JSON.parse(a.stdout).imports.map((i) => i.from), ['z/entry.mjs', 'ä/entry.mjs']);
});
test('repository roots are relative to Git through directory aliases', (t) => {
  const root = fixture(t, { 'repo/sub/entry.ts': 'export {};' });
  const repo = path.join(root, 'repo');
  const init = spawnSync('git', ['init', repo], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(describeRepository(alias).root, '.');
  assert.equal(describeRepository(path.join(alias, 'sub')).root, 'sub');
});
