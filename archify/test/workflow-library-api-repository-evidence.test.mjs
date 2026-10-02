import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderWorkflow } from '../renderers/workflow/workflow-api.mjs';

const cliPath = fileURLToPath(new URL('../bin/archify.mjs', import.meta.url));
const repository = 'https://github.com/example/workflow-evidence';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('config', 'core.autocrlf', 'false');
  git('remote', 'add', 'origin', 'git@github.com:example/workflow-evidence.git');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'route.js'), 'export function route() {\n  return "ready";\n}\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
  const revision = git('rev-parse', 'HEAD');
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Repository-backed workflow', output: 'caller-owned.html', locale: 'en',
      quality_profile: 'standard', legend: { mode: 'hidden' },
      repository: { url: repository, revision },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'frontend', label: 'Input', sources: [
        { path: 'src/route.js', line: 1, end_line: 3, label: 'Request route' },
      ] },
      { id: 'b', lane: 'main', col: 3, type: 'backend', label: 'Output' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'request' }],
  };
  return { root, revision, workflow };
}

test('renderWorkflow returns pinned repository evidence in both its result and CLI-equivalent HTML', async t => {
  const { root, revision, workflow } = fixture(t);
  // Verification must use the pinned blob, not these newer working-tree bytes.
  fs.writeFileSync(path.join(root, 'src', 'route.js'), 'changed locally\n');
  const before = structuredClone(workflow);
  const result = await renderWorkflow({ workflow, repoRoot: root });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const evidence = result.sourceEvidence;
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.url, repository);
  assert.equal(evidence.repository.revision, revision);
  assert.equal(evidence.referenceCount, 1);
  assert.deepEqual(Object.keys(evidence.nodes), ['a']);
  assert.deepEqual(evidence.nodes.a, [{
    path: 'src/route.js', line: 1, endLine: 3, label: 'Request route',
    href: `${repository}/blob/${revision}/src/route.js#L1-L3`,
  }]);
  const payload = result.html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(payload, 'rendered HTML must include verified repository evidence');
  // JSON preserves the payload values, not the null prototype of the node map.
  assert.deepEqual(JSON.parse(payload[1]), JSON.parse(JSON.stringify(evidence)));
  assert.deepEqual(workflow, before);

  const input = path.join(root, 'input.json');
  const output = path.join(root, 'cli.html');
  fs.writeFileSync(input, JSON.stringify(workflow));
  const env = { ...process.env };
  delete env.ARCHIFY_QUALITY_PROFILE;
  delete env.ARCHIFY_REPO_ROOT;
  const cli = spawnSync(process.execPath, [cliPath, 'render', 'workflow', input, output, '--repo-root', root], {
    cwd: root, encoding: 'utf8', timeout: 30000, env,
  });
  assert.ifError(cli.error);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(result.html, fs.readFileSync(output, 'utf8'));
});

test('renderWorkflow classifies a missing repoRoot for authored repository evidence', async t => {
  const { workflow } = fixture(t);
  const before = structuredClone(workflow);
  const result = await renderWorkflow({ workflow });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map(entry => entry.code), ['repository-evidence/root-required']);
  assert.equal(result.html, undefined);
  assert.equal(result.sourceEvidence, undefined);
  assert.deepEqual(workflow, before);
});

test('renderWorkflow rejects a source absent from the pinned commit even when it exists locally', async t => {
  const { root, revision, workflow } = fixture(t);
  fs.writeFileSync(path.join(root, 'src', 'untracked.js'), 'export const later = true;\n');
  workflow.nodes[0].sources = [{ path: 'src/untracked.js', line: 1 }];
  const before = structuredClone(workflow);
  const exitCode = process.exitCode;
  const result = await renderWorkflow({ workflow, repoRoot: root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map(entry => entry.code), ['repository-evidence/file-missing']);
  assert.equal(result.diagnostics[0].subject.nodeId, 'a');
  assert.equal(result.diagnostics[0].evidence.sourcePath, 'src/untracked.js');
  assert.equal(result.diagnostics[0].evidence.revision, revision);
  assert.equal(result.html, undefined);
  assert.equal(result.svg, undefined);
  assert.equal(result.sourceEvidence, undefined);
  assert.equal(process.exitCode, exitCode);
  assert.deepEqual(workflow, before);
});
