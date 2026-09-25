import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(skillRoot, '..');
const actionPath = path.join(repoRoot, 'integrations/github-action/action.mjs');
const action = await import(pathToFileURL(actionPath).href);
const examples = path.join(skillRoot, 'examples');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-action-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.email=ci@example.com', '-c', 'user.name=ci', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function copyExample(name, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(examples, name), destination);
}

function runAction(workspace, env) {
  const outputFile = path.join(workspace, '.github-output');
  const summaryFile = path.join(workspace, '.step-summary');
  const result = spawnSync(process.execPath, [actionPath], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      ...env,
    },
  });
  const outputs = fs.existsSync(outputFile)
    ? Object.fromEntries(fs.readFileSync(outputFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }))
    : {};
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  return { ...result, outputs, summary };
}

test('globs match nested sources with **, *, and ? without crossing directories', () => {
  const files = ['docs/a.architecture.json', 'docs/deep/b.architecture.json', 'docs/c.workflow.json', 'a.architecture.json'];
  assert.deepEqual(action.matchFiles(files, ['docs/**/*.architecture.json']), ['docs/a.architecture.json', 'docs/deep/b.architecture.json']);
  assert.deepEqual(action.matchFiles(files, ['docs/*.json']), ['docs/a.architecture.json', 'docs/c.workflow.json']);
  assert.deepEqual(action.matchFiles(files, ['**/?.architecture.json']), ['a.architecture.json', 'docs/a.architecture.json', 'docs/deep/b.architecture.json']);
  assert.deepEqual(action.splitList('a.json,\n b.json \n\n'), ['a.json', 'b.json']);
});

test('deliver mode renders every matching source, reports failures, and fails the step', (t) => {
  const workspace = tempDir(t);
  copyExample('web-app.architecture.json', path.join(workspace, 'docs/web-app.architecture.json'));
  copyExample('release-delivery.workflow.json', path.join(workspace, 'docs/nested/release.workflow.json'));
  fs.writeFileSync(path.join(workspace, 'docs/broken.sequence.json'), '{not json');

  const result = runAction(workspace, { ARCHIFY_FILES: 'docs/**/*.json' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.outputs.ok, 'false');
  assert.equal(result.outputs.delivered, '2');
  assert.equal(result.outputs.failed, '1');
  assert.match(result.summary, /2 of 3 diagram source\(s\) delivered/);
  assert.match(result.summary, /`docs\/broken\.sequence\.json` \| \? \| \*\*fail\*\*/);
  const artifacts = path.join(workspace, 'archify-artifacts');
  assert.ok(fs.existsSync(path.join(artifacts, 'docs__web-app.architecture.html')));
  assert.ok(fs.existsSync(path.join(artifacts, 'docs__nested__release.workflow.html')));
  const receipt = JSON.parse(fs.readFileSync(path.join(artifacts, 'docs__web-app.architecture.receipt.json'), 'utf8'));
  assert.equal(receipt.ok, true);
  assert.equal(fs.readFileSync(path.join(artifacts, 'summary.md'), 'utf8'), result.summary);
});

test('deliver mode passes when every source is valid and fail-on-error can be disabled', (t) => {
  const workspace = tempDir(t);
  copyExample('web-app.architecture.json', path.join(workspace, 'web-app.architecture.json'));
  const passing = runAction(workspace, { ARCHIFY_FILES: '*.architecture.json', ARCHIFY_QUALITY: 'showcase' });
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(passing.outputs.ok, 'true');

  fs.writeFileSync(path.join(workspace, 'bad.architecture.json'), JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: {} }));
  const tolerated = runAction(workspace, { ARCHIFY_FILES: '*.architecture.json', ARCHIFY_FAIL_ON_ERROR: 'false' });
  assert.equal(tolerated.status, 0, tolerated.stderr);
  assert.equal(tolerated.outputs.ok, 'false');
  assert.equal(tolerated.outputs.failed, '1');
});

test('invalid inputs fail clearly before any work', (t) => {
  const workspace = tempDir(t);
  const badMode = runAction(workspace, { ARCHIFY_MODE: 'publish' });
  assert.equal(badMode.status, 1);
  assert.match(badMode.stderr, /::error::unknown mode "publish"/);
  const noFiles = runAction(workspace, {});
  assert.equal(noFiles.status, 1);
  assert.match(noFiles.stderr, /deliver mode needs files/);
  const noBase = runAction(workspace, { ARCHIFY_MODE: 'compare' });
  assert.equal(noBase.status, 1);
  assert.match(noBase.stderr, /needs a base revision/);
});

function comparisonRepository(t) {
  const workspace = tempDir(t);
  git(workspace, 'init', '-q');
  copyExample('checkout-platform.base.architecture.json', path.join(workspace, 'docs/checkout.architecture.json'));
  copyExample('web-app.architecture.json', path.join(workspace, 'docs/retired.architecture.json'));
  copyExample('web-app.architecture.json', path.join(workspace, 'docs/stable.architecture.json'));
  git(workspace, 'add', '-A');
  git(workspace, 'commit', '-q', '-m', 'base');
  const base = git(workspace, 'rev-parse', 'HEAD');
  copyExample('checkout-platform.head.architecture.json', path.join(workspace, 'docs/checkout.architecture.json'));
  fs.rmSync(path.join(workspace, 'docs/retired.architecture.json'));
  copyExample('production-deployment.architecture.json', path.join(workspace, 'docs/added.architecture.json'));
  git(workspace, 'add', '-A');
  git(workspace, 'commit', '-q', '-m', 'head');
  const event = path.join(workspace, '.event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 42, base: { sha: base } } }));
  return { workspace, base, event };
}

test('compare mode summarizes authored changes, new and removed diagrams against the PR base', (t) => {
  const { workspace, base, event } = comparisonRepository(t);
  const result = runAction(workspace, { ARCHIFY_MODE: 'compare', GITHUB_EVENT_PATH: event });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs.ok, 'true');
  assert.equal(result.outputs.comment, 'skipped');
  assert.match(result.summary, new RegExp(`Compared against base \`${base.slice(0, 12)}\``));
  assert.match(result.summary, /`docs\/checkout\.architecture\.json` — 7 authored change\(s\)/);
  assert.match(result.summary, /\| Added \| component \| `Fraud Gate` \|/);
  assert.match(result.summary, /\| Removed \| connection \| `Checkout API → Session Cache` \|/);
  assert.match(result.summary, /`docs\/added\.architecture\.json` — new diagram/);
  assert.match(result.summary, /`docs\/retired\.architecture\.json` — diagram removed/);
  assert.doesNotMatch(result.summary, /stable\.architecture\.json/);
  assert.equal(result.outputs.changes, '9');
  const delta = path.join(workspace, 'archify-artifacts/docs__checkout.architecture.delta.html');
  assert.ok(fs.existsSync(delta));
});

test('geometry-only edits are not reported as review changes', () => {
  const summary = action.summarizeCompareReceipt({
    ok: true,
    changes: {
      components: [
        { id: 'a', headLabel: 'A', status: 'moved', classifications: ['geometry'] },
        { id: 'b', headLabel: 'B', status: 'changed', classifications: ['geometry'] },
        { id: 'c', headLabel: 'C', status: 'changed', classifications: ['semantic', 'geometry'] },
      ],
      connections: [{ id: 'x', head: { from: 'a', to: 'c' }, status: 'added' }],
    },
  }, { a: 'Alpha', c: 'Gamma' });
  assert.deepEqual(summary.rows, [
    { status: 'changed', kind: 'component', name: 'C' },
    { status: 'added', kind: 'connection', name: 'Alpha → Gamma' },
  ]);
});

test('compare mode creates one PR comment and updates it on the next run', async (t) => {
  const { workspace, event } = comparisonRepository(t);
  const comments = [];
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') {
        response.end(JSON.stringify(comments));
      } else if (request.method === 'POST') {
        const comment = { id: comments.length + 1, body: JSON.parse(body).body };
        comments.push(comment);
        response.end(JSON.stringify(comment));
      } else if (request.method === 'PATCH') {
        const id = Number(request.url.split('/').pop());
        comments.find((comment) => comment.id === id).body = JSON.parse(body).body;
        response.end('{}');
      } else {
        response.statusCode = 405;
        response.end('{}');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = {
    ARCHIFY_MODE: 'compare',
    ARCHIFY_COMMENT: 'true',
    ARCHIFY_GITHUB_TOKEN: 'test-token',
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
  };
  // execFile keeps the event loop free so the fake API server can answer.
  const runAsync = () => new Promise((resolve) => {
    const outputFile = path.join(workspace, '.github-output');
    fs.rmSync(outputFile, { force: true });
    execFile(process.execPath, [actionPath], {
      cwd: workspace,
      env: { PATH: process.env.PATH, GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: outputFile, ...env },
    }, (error, _stdout, stderr) => resolve({ error, stderr, outputs: fs.readFileSync(outputFile, 'utf8') }));
  });

  const first = await runAsync();
  assert.equal(first.error, null, first.stderr);
  assert.match(first.outputs, /comment=created/);
  const second = await runAsync();
  assert.equal(second.error, null, second.stderr);
  assert.match(second.outputs, /comment=updated/);

  assert.equal(comments.length, 1);
  assert.ok(comments[0].body.startsWith('<!-- archify-github-action:compare -->'));
  assert.match(comments[0].body, /Fraud Gate/);
  assert.ok(requests.every((request) => request.authorization === 'Bearer test-token'));
  assert.ok(requests.some((request) => request.method === 'POST' && request.url === '/repos/owner/repo/issues/42/comments'));
  assert.ok(requests.some((request) => request.method === 'PATCH' && request.url === '/repos/owner/repo/issues/comments/1'));
});

test('action.yml exposes every input the runtime reads', () => {
  const manifest = fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf8');
  const runtime = fs.readFileSync(actionPath, 'utf8');
  const runtimeVariables = new Set([...runtime.matchAll(/env\.(ARCHIFY_[A-Z_]+)/g)].map((match) => match[1]));
  runtimeVariables.delete('ARCHIFY_CLI');
  for (const variable of runtimeVariables) {
    assert.match(manifest, new RegExp(`${variable}: \\$\\{\\{ inputs\\.`), `${variable} is not wired in action.yml`);
  }
  assert.match(manifest, /using: composite/);
  assert.match(manifest, /\$GITHUB_ACTION_PATH\/integrations\/github-action\/action\.mjs/);
});

test('scan mode drafts an architecture from code and delivers it', (t) => {
  const workspace = tempDir(t);
  fs.mkdirSync(path.join(workspace, 'service/app'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'service/app/__init__.py'), '');
  fs.writeFileSync(path.join(workspace, 'service/app/main.py'), 'from fastapi import FastAPI\nfrom .store import save\napp = FastAPI()\n');
  fs.writeFileSync(path.join(workspace, 'service/app/store.py'), 'import redis\n');
  const result = runAction(workspace, { ARCHIFY_MODE: 'scan', ARCHIFY_SCAN_PATH: 'service', ARCHIFY_SCAN_TITLE: 'Service draft' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs.ok, 'true');
  assert.equal(result.outputs.delivered, '1');
  assert.match(result.summary, /## Archify scan/);
  const draft = path.join(workspace, 'archify-artifacts/scan/service.architecture.json');
  assert.equal(JSON.parse(fs.readFileSync(draft, 'utf8')).meta.title, 'Service draft');
  assert.ok(fs.existsSync(path.join(workspace, 'archify-artifacts/service.architecture.html')));

  const missing = runAction(workspace, { ARCHIFY_MODE: 'scan' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /scan mode needs scan-path/);
});
