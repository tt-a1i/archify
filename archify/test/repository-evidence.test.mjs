import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../bin/preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-repo-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'router.js'), 'export function route(input) {\n  return input.kind;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'store.js'), 'export const store = new Map();\n');
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'git@github.com:example/evidence-repo.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  const revision = git(root, 'rev-parse', 'HEAD');

  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  diagram.meta.repository = {
    url: 'https://github.com/example/evidence-repo',
    revision,
  };
  diagram.components[0].sources = [
    { path: 'src/router.js', line: 1, end_line: 3, label: 'Request router' },
    { path: 'src/store.js', line: 1 },
  ];
  const input = path.join(root, 'diagram.architecture.json');
  fs.writeFileSync(input, JSON.stringify(diagram, null, 2));
  return { root, revision, diagram, input };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function evidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'verified evidence payload missing');
  return JSON.parse(match[1]);
}

async function waitForState(url, predicate, timeoutMs = 12000) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < timeoutMs) {
    latest = await (await fetch(new URL('/state', url))).json();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`preview did not settle; latest state: ${JSON.stringify(latest)}`);
}

test('repository evidence is revision-verified, receipt-backed, searchable, and export-clean', () => {
  const data = fixture();
  const output = path.join(data.root, 'verified.html');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.evidence, {
    verified: true,
    repository: 'https://github.com/example/evidence-repo',
    revision: data.revision,
    references: 2,
  });

  const html = fs.readFileSync(output, 'utf8');
  const evidence = evidencePayload(html);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.shortRevision, data.revision.slice(0, 7));
  assert.equal(evidence.nodes.users.length, 2);
  assert.equal(evidence.nodes.users[0].href, `https://github.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-L3`);
  assert.match(html, /Verified source/);
  assert.match(html, /Archify\.sourceEvidence = \(function \(\)/);
  assert.match(html, /var sourceSearch = sources\.map/);
  assert.match(html, /renderSourceEvidence\(id\)/);
  assert.match(html, /referrerPolicy = 'no-referrer'/);

  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /src\/router\.js|github\.com\/example\/evidence-repo|source-evidence/);
});

test('repository evidence is opt-in and never appears in ordinary artifacts', () => {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-no-evidence-')), 'plain.html');
  const input = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const result = run(['render', 'architecture', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(html, /id="archify-source-evidence-data"/);
  assert.match(html, /id="focus-evidence" hidden/);
});

test('evidence fails closed without a root, on wrong origin, missing blobs, or impossible lines', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');

  let result = run(['deliver', 'architecture', data.input, output, '--json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'render');
  assert.match(JSON.parse(result.stdout).error, /Pass --repo-root/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');

  git(data.root, 'remote', 'set-url', 'origin', 'https://github.com/example/other-repo.git');
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /does not match/);
  git(data.root, 'remote', 'set-url', 'origin', 'git@github.com:example/evidence-repo.git');

  data.diagram.components[0].sources = [{ path: '../outside.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /must stay inside the repository/);

  data.diagram.components[0].sources = [{ path: 'src/router.js\n' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /repo-relative POSIX path/);

  data.diagram.components[0].sources = [{ path: 'src/missing.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /does not identify a file/);

  data.diagram.components[0].sources = [{ path: 'src/router.js', line: 99 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /requests line 99/);

  data.diagram.components[0].sources = [{ path: 'src/router.js', line: 4 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /has 3 lines/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('--repo-root stays bounded to architecture and schema limits evidence shape', () => {
  const data = fixture();
  let result = run(['render', 'workflow', path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'), '--repo-root', data.root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /architecture diagrams only/);

  data.diagram.components[0].sources = [
    { path: 'src/router.js' },
    { path: 'src/router.js' },
    { path: 'src/router.js' },
    { path: 'src/router.js' },
  ];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['validate', 'architecture', data.input, '--repo-root', data.root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must NOT have more than 3 items/);
});

test('live preview forwards repo-root and publishes only verified evidence', { timeout: 20000 }, async () => {
  const data = fixture();
  const output = path.join(data.root, 'preview.html');
  const preview = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified');
    assert.equal(state.revision, 1);
    const html = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.equal(evidencePayload(html).repository.revision, data.revision);
  } finally {
    await preview.stop();
  }
});
