import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'archify');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const normalize = text => text.replace(/\r\n?/g, '\n');

test('generated Gallery artifacts match the current renderer output', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-derived-gallery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-gallery.mjs'), directory], { stdio: 'inherit' });

  for (const relative of ['gallery.html', 'gallery/manifest.json']) {
    const generated = path.join(directory, relative);
    const checked = path.join(root, 'docs', relative);
    assert.equal(normalize(fs.readFileSync(generated, 'utf8')), normalize(fs.readFileSync(checked, 'utf8')),
      `${relative} is stale; run node scripts/build-gallery.mjs docs`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'gallery/manifest.json'), 'utf8'));
  for (const entry of manifest.entries) {
    for (const relative of [entry.artifact, entry.input]) {
      const generated = path.join(directory, relative);
      const checked = path.join(root, 'docs', relative);
      assert.equal(normalize(fs.readFileSync(generated, 'utf8')), normalize(fs.readFileSync(checked, 'utf8')),
        `${relative} is stale; run node scripts/build-gallery.mjs docs`);
    }
  }
});

test('generated checkout delta matches its authoritative inputs', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-derived-delta-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const html = path.join(directory, 'checkout-platform-delta.html');
  const receipt = path.join(directory, 'checkout-platform-delta.receipt.json');
  const result = spawnSync(process.execPath, [
    path.join(skill, 'bin/archify.mjs'), 'compare', 'architecture',
    path.join(skill, 'examples/checkout-platform.base.architecture.json'),
    path.join(skill, 'examples/checkout-platform.head.architecture.json'),
    html, '--receipt', receipt, '--quality', 'showcase', '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(html, 'utf8'), fs.readFileSync(path.join(root, 'examples/checkout-platform-delta.html'), 'utf8'),
    'examples/checkout-platform-delta.html is stale; rerun the public compare command');
  assert.deepEqual(JSON.parse(fs.readFileSync(receipt, 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'examples/checkout-platform-delta.receipt.json'), 'utf8')),
  'examples/checkout-platform-delta.receipt.json is stale; rerun the public compare command');
});

test('README Showcase receipt remains bound to the checked-in Gallery artifacts', () => {
  const receiptPath = path.join(root, 'docs/assets/archify-live-proof.json');
  const gifPath = path.join(root, 'docs/assets/archify-live-proof.gif');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.sha256, sha256(gifPath), 'README Showcase GIF and receipt differ; rebuild it with node scripts/build-readme-showcase.mjs');
  assert.equal(receipt.bytes, fs.statSync(gifPath).size, 'README Showcase GIF size and receipt differ; rebuild it with node scripts/build-readme-showcase.mjs');
  for (const scene of receipt.scenes) {
    const artifact = path.join(root, scene.artifact);
    assert.equal(scene.artifactSha256, sha256(artifact),
      `${scene.id} Gallery artifact changed; rebuild the README Showcase with node scripts/build-readme-showcase.mjs`);
  }
});
