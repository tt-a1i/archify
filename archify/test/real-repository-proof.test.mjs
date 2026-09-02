import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRepositoryEvidence } from '../renderers/shared/repository-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const sourcePath = path.join(repoRoot, 'docs', 'cases', 'mco-runtime.architecture.json');
const artifactPath = path.join(repoRoot, 'docs', 'cases', 'mco-runtime.architecture.html');
const shareCardPath = path.join(repoRoot, 'docs', 'assets', 'mco-runtime-share-card.png');
const experimentSourcePath = path.join(repoRoot, 'experiments', 'mco-showcase', 'mco-runtime.architecture.json');
const experimentArtifactPath = path.join(repoRoot, 'experiments', 'mco-showcase', 'mco-runtime.html');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const pinnedSource = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const pinnedRepository = pinnedSource.meta.repository;

function evidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'checked-in MCO proof is missing verified repository evidence');
  return JSON.parse(match[1]);
}

function connectionLabelGeometry(html) {
  return Object.fromEntries([...html.matchAll(
    /<g data-detail="context"[^>]*data-edge-id="([^"]+)"[^>]*>[\s\S]*?<text x="([^"]+)" y="([^"]+)"/g,
  )].map((match) => [match[1], { x: Number(match[2]), y: Number(match[3]) }]));
}

function automaticMcoRoot() {
  const candidate = path.resolve(repoRoot, '..', 'mco');
  if (!fs.existsSync(path.join(candidate, '.git'))) return null;
  try {
    verifyRepositoryEvidence('architecture', pinnedSource, candidate);
    return candidate;
  } catch {
    return null;
  }
}

const pinnedMcoRoot = process.env.ARCHIFY_MCO_REPO_ROOT
  ? path.resolve(process.env.ARCHIFY_MCO_REPO_ROOT)
  : automaticMcoRoot();

test('MCO showcase preserves checked-in connection-label geometry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mco-showcase-layout-'));
  try {
    const source = JSON.parse(fs.readFileSync(experimentSourcePath, 'utf8'));
    assert.deepEqual(
      source.meta.repository,
      pinnedRepository,
      'MCO case and experiment must pin the same repository revision',
    );
    delete source.meta.repository;
    for (const component of source.components) delete component.sources;
    const input = path.join(tmp, 'mco-runtime.architecture.json');
    const output = path.join(tmp, 'mco-runtime.html');
    fs.writeFileSync(input, `${JSON.stringify(source, null, 2)}\n`);

    const rendered = spawnSync(process.execPath, [
      cli,
      'render',
      'architecture',
      input,
      output,
      '--quality',
      'showcase',
    ], { encoding: 'utf8' });
    assert.equal(rendered.status, 0, `${rendered.stdout}\n${rendered.stderr}`);

    const renderedHtml = fs.readFileSync(output, 'utf8');
    const checkedInHtml = fs.readFileSync(experimentArtifactPath, 'utf8');
    const renderedLabels = connectionLabelGeometry(renderedHtml);
    assert.ok(Object.keys(renderedLabels).length >= 8, 'expected the authored MCO connection labels');
    assert.deepEqual(
      connectionLabelGeometry(checkedInHtml),
      renderedLabels,
      'checked-in MCO connection-label geometry drifted from its typed source',
    );

  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('checked-in MCO artifacts are byte-reproducible from the pinned repository revision', {
  skip: pinnedMcoRoot
    ? false
    : `Set ARCHIFY_MCO_REPO_ROOT to a matching ${pinnedRepository.url} clone containing revision ${pinnedRepository.revision.slice(0, 7)}.`,
}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mco-byte-reproduction-'));
  try {
    const experimentOutput = path.join(tmp, 'mco-runtime.experiment.html');
    const experiment = spawnSync(process.execPath, [
      cli,
      'render',
      'architecture',
      experimentSourcePath,
      experimentOutput,
      '--quality',
      'showcase',
      '--repo-root',
      pinnedMcoRoot,
    ], { encoding: 'utf8' });
    assert.equal(experiment.status, 0, `${experiment.stdout}\n${experiment.stderr}`);
    assert.equal(
      fs.readFileSync(experimentOutput, 'utf8'),
      fs.readFileSync(experimentArtifactPath, 'utf8'),
      'checked-in MCO showcase drifted from its typed source and verified repository',
    );

    const caseOutput = path.join(tmp, 'mco-runtime.case.html');
    const delivered = spawnSync(process.execPath, [
      cli,
      'deliver',
      'architecture',
      sourcePath,
      caseOutput,
      '--quality',
      'showcase',
      '--repo-root',
      pinnedMcoRoot,
      '--json',
    ], { encoding: 'utf8' });
    assert.equal(delivered.status, 0, `${delivered.stdout}\n${delivered.stderr}`);
    assert.equal(JSON.parse(delivered.stdout).ok, true);
    assert.equal(
      fs.readFileSync(caseOutput, 'utf8'),
      fs.readFileSync(artifactPath, 'utf8'),
      'checked-in MCO case drifted from its typed source and verified repository',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('MCO public proof is source-backed, valid, and linked from every README', () => {
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
  assert.match(source.components.find((component) => component.id === 'router')?.sublabel || '', /\bdoctor\b/);
  assert.match(source.components.find((component) => component.id === 'adapters')?.sublabel || '', /\bdetect\b/);
  assert.match(source.meta.repository.url, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  assert.match(source.meta.repository.revision, /^[0-9a-f]{40}$/);
  const references = source.components.reduce((count, component) => count + (component.sources?.length || 0), 0);
  assert.equal(references, 13);
  const cardCopy = JSON.stringify(source.cards);
  assert.ok(cardCopy.includes(`main @ ${source.meta.repository.revision.slice(0, 7)}`));
  assert.ok(cardCopy.includes(new URL(source.meta.repository.url).host + new URL(source.meta.repository.url).pathname));

  const checkedInHtml = fs.readFileSync(artifactPath, 'utf8');
  const evidence = evidencePayload(checkedInHtml);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.url, source.meta.repository.url);
  assert.equal(evidence.repository.revision, source.meta.repository.revision);
  assert.equal(evidence.repository.shortRevision, source.meta.repository.revision.slice(0, 7));
  assert.equal(evidence.referenceCount, references);
  assert.match(checkedInHtml, /Archify\.sourceEvidence\.installBeacons\(\)/);
  execFileSync(process.execPath, [cli, 'check', artifactPath], { encoding: 'utf8' });

  const noRootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mco-proof-no-root-'));
  try {
    const output = path.join(noRootTmp, 'mco-runtime.html');
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
  } finally {
    fs.rmSync(noRootTmp, { recursive: true, force: true });
  }

  const png = fs.readFileSync(shareCardPath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.byteLength > 20_000, 'MCO Share Card is unexpectedly small');

  const repositorySlug = new URL(source.meta.repository.url).pathname.replace(/^\/|\/$/g, '');
  const shortRevision = source.meta.repository.revision.slice(0, 7);
  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    assert.match(readme, /docs\/assets\/mco-runtime-share-card\.png/);
    assert.match(readme, /cases\/mco-runtime\.architecture\.html\?theme=dark&present=1#view=dispatch-path/);
    assert.match(readme, /docs\/cases\/mco-runtime\.architecture\.json/);
    assert.ok(readme.includes(`[\`${repositorySlug}\`](${source.meta.repository.url})`), `${filename}: repository link drifted`);
    assert.ok(readme.includes(`\`${shortRevision}\``), `${filename}: repository revision drifted`);
  }
});
