import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const sourcePath = path.join(repoRoot, 'docs', 'cases', 'mco-runtime.architecture.json');
const artifactPath = path.join(repoRoot, 'docs', 'cases', 'mco-runtime.architecture.html');
const shareCardPath = path.join(repoRoot, 'docs', 'assets', 'mco-runtime-share-card.png');

test('MCO proof is source-backed, reproducible, and linked from every README', () => {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  assert.equal(source.meta.title, 'MCO Runtime Architecture');
  assert.equal(source.meta.quality_profile, 'showcase');
  assert.equal(source.meta.animation, 'trace');
  assert.deepEqual(source.meta.views.map(view => view.id), [
    'dispatch-path',
    'answer-evidence',
    'durable-sessions',
  ]);
  assert.equal(source.components.length, 13);
  assert.equal(source.connections.length, 12);
  assert.match(JSON.stringify(source.cards), /main @ 9f1a1cf/);
  assert.match(JSON.stringify(source.cards), /github\.com\/mco-org\/mco/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mco-proof-'));
  const regenerated = path.join(tmp, 'mco-runtime.architecture.html');
  const receipt = JSON.parse(execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'deliver',
    'architecture',
    sourcePath,
    regenerated,
    '--quality',
    'showcase',
    '--json',
  ], { encoding: 'utf8' }));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.validation.errors, 0);
  assert.equal(receipt.validation.warnings, 0);
  assert.equal(
    fs.readFileSync(regenerated, 'utf8'),
    fs.readFileSync(artifactPath, 'utf8'),
    'checked-in MCO artifact drifted from its typed source',
  );

  const png = fs.readFileSync(shareCardPath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.byteLength > 20_000, 'MCO Share Card is unexpectedly small');

  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    assert.match(readme, /docs\/assets\/mco-runtime-share-card\.png/);
    assert.match(readme, /cases\/mco-runtime\.architecture\.html\?theme=dark&present=1#view=dispatch-path/);
    assert.match(readme, /docs\/cases\/mco-runtime\.architecture\.json/);
  }
});
