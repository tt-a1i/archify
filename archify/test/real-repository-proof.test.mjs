import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function evidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'checked-in MCO proof is missing verified repository evidence');
  return JSON.parse(match[1]);
}

function localMcoRoot() {
  const candidates = [
    process.env.ARCHIFY_MCO_REPO_ROOT,
    path.resolve(repoRoot, '..', 'mco'),
  ].filter(Boolean);
  return candidates.find(candidate => {
    if (!fs.existsSync(path.join(candidate, '.git'))) return false;
    const revision = spawnSync('git', ['-C', candidate, 'cat-file', '-e', '9f1a1cf1afdc04d7b5406782b40dfec76d9bc798^{commit}']);
    if (revision.status !== 0) return false;
    const origin = spawnSync('git', ['-C', candidate, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
    return origin.status === 0 && /github\.com[:/]mco-org\/mco(?:\.git)?\/?$/i.test(origin.stdout.trim());
  }) || null;
}

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
  assert.deepEqual(source.meta.repository, {
    url: 'https://github.com/mco-org/mco',
    revision: '9f1a1cf1afdc04d7b5406782b40dfec76d9bc798',
  });
  const references = source.components.reduce((count, component) => count + (component.sources?.length || 0), 0);
  assert.equal(references, 13);
  assert.match(JSON.stringify(source.cards), /main @ 9f1a1cf/);
  assert.match(JSON.stringify(source.cards), /github\.com\/mco-org\/mco/);

  const checkedInHtml = fs.readFileSync(artifactPath, 'utf8');
  const evidence = evidencePayload(checkedInHtml);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.revision, source.meta.repository.revision);
  assert.equal(evidence.referenceCount, references);
  assert.match(checkedInHtml, /Archify\.sourceEvidence\.installBeacons\(\)/);
  execFileSync(process.execPath, [cli, 'check', artifactPath], { encoding: 'utf8' });

  const mcoRoot = localMcoRoot();
  if (mcoRoot) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mco-proof-'));
    const regenerated = path.join(tmp, 'mco-runtime.architecture.html');
    const receipt = JSON.parse(execFileSync(process.execPath, [
      cli,
      'deliver',
      'architecture',
      sourcePath,
      regenerated,
      '--quality',
      'showcase',
      '--repo-root',
      mcoRoot,
      '--json',
    ], { encoding: 'utf8' }));
    assert.equal(receipt.ok, true);
    assert.equal(receipt.validation.errors, 0);
    assert.equal(receipt.validation.warnings, 0);
    assert.deepEqual(receipt.evidence, {
      verified: true,
      repository: source.meta.repository.url,
      revision: source.meta.repository.revision,
      references,
    });
    assert.equal(
      fs.readFileSync(regenerated, 'utf8'),
      checkedInHtml,
      'checked-in MCO artifact drifted from its typed source and verified repository',
    );
  } else {
    const output = path.join(os.tmpdir(), `archify-mco-proof-no-root-${process.pid}.html`);
    const result = spawnSync(process.execPath, [
      cli,
      'deliver',
      'architecture',
      sourcePath,
      output,
      '--quality',
      'showcase',
      '--json',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /Pass --repo-root/);
    assert.equal(fs.existsSync(output), false);
  }

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
