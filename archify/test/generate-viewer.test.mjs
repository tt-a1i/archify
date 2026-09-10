import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const marker = '/* ARCHIFY:READER_LAYOUT */';
const cleanupMarker = '/* ARCHIFY:EXPORT_CLEANUP */';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-viewer-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'archify/assets'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'viewer'), path.join(root, 'viewer'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'scripts/generate-viewer.mjs'), path.join(root, 'scripts/generate-viewer.mjs'));
  const output = path.join(root, 'archify/assets/template.html');
  fs.copyFileSync(path.join(repoRoot, 'archify/assets/template.html'), output);
  return {
    root, output,
    shell: path.join(root, 'viewer/template.source.html'),
    reader: path.join(root, 'viewer/reader-layout.js'),
    cleanup: path.join(root, 'viewer/export-cleanup.js'),
    run: (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/generate-viewer.mjs'), ...args], {
      cwd: os.tmpdir(), encoding: 'utf8',
    }),
  };
}

test('the committed Viewer rebuilds deterministically outside the repository working directory', (t) => {
  const f = fixture(t);
  const baseline = fs.readFileSync(f.output);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generated = f.run();
    assert.equal(generated.status, 0, generated.stderr);
    assert.deepEqual(fs.readFileSync(f.output), baseline);
  }
  const beforeCheck = fs.statSync(f.output).mtimeMs;
  const checked = f.run('--check');
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(fs.statSync(f.output).mtimeMs, beforeCheck, '--check must not rewrite output');
});

test('editing any authoritative source requires explicit regeneration', (t) => {
  const f = fixture(t);
  for (const input of [f.shell, f.reader, f.cleanup]) {
    const previous = fs.readFileSync(f.output);
    fs.appendFileSync(input, '\n/* source change */\n');
    const stale = f.run('--check');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /stale.*generate:viewer/);
    assert.deepEqual(fs.readFileSync(f.output), previous);
    assert.equal(f.run().status, 0);
    assert.equal(f.run('--check').status, 0);
    assert.notDeepEqual(fs.readFileSync(f.output), previous);
  }
});

test('a missing generated template is stale and can be regenerated', (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.output);
  assert.equal(f.run('--check').status, 1);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(f.run().status, 0);
  assert.equal(f.run('--check').status, 0);
});

for (const fragment of ['reader', 'cleanup']) {
  for (const failure of ['missing shell', 'missing fragment', 'missing marker', 'duplicate marker', 'empty fragment', 'own marker', 'other marker']) {
    test(`assembly rejects ${fragment}: ${failure} without overwriting a valid artifact`, (t) => {
      const f = fixture(t);
      const slot = fragment === 'reader' ? marker : cleanupMarker;
      const otherSlot = fragment === 'reader' ? cleanupMarker : marker;
      const previous = fs.readFileSync(f.output);
      if (failure === 'missing shell') fs.unlinkSync(f.shell);
      if (failure === 'missing fragment') fs.unlinkSync(f[fragment]);
      if (failure === 'missing marker') fs.writeFileSync(f.shell, fs.readFileSync(f.shell, 'utf8').replace(slot, ''));
      if (failure === 'duplicate marker') fs.appendFileSync(f.shell, slot);
      if (failure === 'empty fragment') fs.writeFileSync(f[fragment], ' \n');
      if (failure === 'own marker') fs.appendFileSync(f[fragment], slot);
      if (failure === 'other marker') fs.appendFileSync(f[fragment], otherSlot);
      for (const args of [[], ['--check']]) {
        const result = f.run(...args);
        assert.equal(result.status, 1, failure);
        assert.match(result.stderr, /ENOENT|marker|empty/);
        assert.deepEqual(fs.readFileSync(f.output), previous);
        assert.deepEqual(fs.readdirSync(path.dirname(f.output)), ['template.html']);
      }
    });
  }
}

test('assembly preserves literal replacement tokens, Unicode and source line endings', (t) => {
  const f = fixture(t);
  const reader = '// $& $\' $` $$ 中文 \u{1f5fa}\r\n(function () {})();\r\n';
  fs.writeFileSync(f.shell, `<script>\r\n${cleanupMarker}${marker}</script>\n`);
  fs.writeFileSync(f.cleanup, reader);
  fs.writeFileSync(f.reader, reader);
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(f.output, 'utf8'), `<script>\r\n${reader}${reader}</script>\n`);
  assert.equal(f.run('--check').status, 0);
});

test('an invalid invocation cannot silently regenerate the template', (t) => {
  const f = fixture(t);
  const previous = fs.readFileSync(f.output);
  const result = f.run('--chek');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
  assert.deepEqual(fs.readFileSync(f.output), previous);
});
