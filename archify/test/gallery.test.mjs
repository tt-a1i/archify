import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_RECIPES } from '../recipes/scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-gallery-'));
const generatedRoot = path.join(tmp, 'docs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function normalize(text) {
  return text.replace(/\r\n?/g, '\n');
}

test('generated proof gallery matches its sources, receipts, and checked-in artifacts', () => {
  const output = execFileSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'build-gallery.mjs'),
    generatedRoot,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_INCLUDE_SOURCE: '1' },
  });
  assert.match(output, /gallery 11 artifacts \/ 99 checks/);

  const manifestPath = path.join(generatedRoot, 'gallery', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.archifyVersion, JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'))).version);
  assert.equal(manifest.entryCount, 11);
  assert.equal(manifest.checkCount, 99);
  assert.deepEqual(new Set(manifest.entries.map((entry) => entry.type)), new Set([
    'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle',
  ]));
  assert.deepEqual(
    Object.fromEntries(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'].map((type) => [
      type,
      manifest.entries.filter((entry) => entry.type === type).length,
    ])),
    { architecture: 2, workflow: 3, sequence: 2, dataflow: 2, lifecycle: 2 },
  );
  assert.deepEqual(
    new Set(manifest.entries.map((entry) => entry.id)),
    new Set(SCENARIO_RECIPES.map((recipe) => recipe.proof)),
  );

  const workflow = manifest.entries.find((entry) => entry.id === 'agent-tool-call');
  assert.equal(workflow.view, 'happy-path');
  assert.equal(workflow.viewCount, 3);
  assert.deepEqual(workflow.viewIds, ['happy-path', 'safety-gate', 'evidence-loop']);
  assert.equal(workflow.guidedPlayback, true);

  for (const entry of manifest.entries) {
    const artifact = path.join(generatedRoot, entry.artifact.replace(/^gallery\//, 'gallery/'));
    const source = path.join(generatedRoot, entry.input.replace(/^gallery\//, 'gallery/'));
    assert.ok(fs.existsSync(artifact), `${entry.id}: artifact missing`);
    assert.ok(fs.existsSync(source), `${entry.id}: source missing`);
    assert.doesNotMatch(fs.readFileSync(artifact, 'utf8'), /id="archify-source-capsule"/,
      `${entry.id}: public proof artifact inherited an editable source capsule`);
    assert.equal(sha256(artifact), entry.artifactSha256, `${entry.id}: artifact digest drift`);
    assert.equal(sha256(source), entry.sourceSha256, `${entry.id}: source digest drift`);
    assert.equal(entry.checks.length, 9);
    assert.ok(entry.checks.every((check) => check.ok), `${entry.id}: validation receipt not green`);
    assert.equal(entry.composition.profile, 'showcase', `${entry.id}: expected showcase composition profile`);
    assert.equal(entry.composition.status, 'pass', `${entry.id}: showcase composition is not green`);
    assert.equal(entry.composition.metrics.properCrossings, 0, `${entry.id}: proper crossing debt remains`);
    assert.equal(entry.composition.metrics.ambiguousCorridors, 0, `${entry.id}: ambiguous corridor debt remains`);
    assert.equal(entry.composition.metrics.containerBorderRuns, 0, `${entry.id}: container border-run debt remains`);
    assert.equal(entry.composition.metrics.labelRouteClearanceIssues, 0, `${entry.id}: label-route clearance debt remains`);
    assert.equal(entry.composition.metrics.shortInteriorSegmentCount, 0, `${entry.id}: cramped interior turn remains`);
    assert.equal(entry.composition.metrics.microSegmentCount, 0, `${entry.id}: micro segment remains`);
    assert.equal(entry.viewCount, 3, `${entry.id}: expected a three-step reader story`);
    assert.equal(entry.guidedPlayback, true, `${entry.id}: guided playback missing`);
  }

  const html = fs.readFileSync(path.join(generatedRoot, 'gallery.html'), 'utf8');
  assert.equal((html.match(/class="showcase-card/g) || []).length, 11);
  assert.match(html, /id="gallery-manifest" type="application\/json"/);
  assert.match(html, /data-src-base="gallery\/artifacts\/agent-tool-call\.workflow\.html"/);
  assert.match(html, /agent-tool-call\.workflow\.html\?present=1&amp;play=1#view=happy-path/);
  assert.match(html, /event-stream\.dataflow\.html\?present=1&amp;play=1#view=order-transit/);
  assert.match(html, /id="proof-deployment-lifecycle"/);
  assert.match(html, /Play named chapter/);
  assert.match(html, /3 views · play/);
  assert.match(html, /Proof,<br><em>not promises\.<\/em>/);
  assert.match(html, /Five lenses\. Eleven real stories\./);
  assert.match(html, /Composition<\/span><span class="receipt-value ok" title="0 crossings · 0 border runs · 0 micro segments · 0 cramped turns">SHOWCASE · PASS/);
  assert.match(html, /\.brand \{ min-height: 44px;/);
  assert.match(html, /\.filter-button \{\s+min-height: 44px;/);
  assert.match(html, /\.card-link \{ min-height: 44px;/);

  for (const relative of [
    'gallery.html',
    'gallery/manifest.json',
    ...manifest.entries.flatMap((entry) => [entry.artifact, entry.input]),
  ]) {
    const fresh = path.join(generatedRoot, relative);
    const checked = path.join(repoRoot, 'docs', relative);
    assert.ok(fs.existsSync(checked), `${relative}: checked-in gallery output missing`);
    assert.equal(normalize(fs.readFileSync(fresh, 'utf8')), normalize(fs.readFileSync(checked, 'utf8')),
      `${relative}: checked-in gallery output is stale; run node scripts/build-gallery.mjs`);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
