import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { verifyRepositoryEvidence } from '../archify/renderers/shared/repository-evidence.mjs';
import { fixture, run, git, cli, evidencePayload } from './helpers/repository-evidence-fixture.mjs';

test('directory references verify the pinned tree and link to folders without claiming descendant or line evidence', () => {
  const data = fixture();
  for (const [url, remote, provider, route] of [
    ['https://github.com/example/evidence-repo', 'git@github.com:example/evidence-repo.git', 'github', 'tree'],
    ['https://gitlab.com/example/evidence-repo', 'git@gitlab.com:example/evidence-repo.git', 'gitlab', '-/tree'],
    ['https://gitee.com/example/evidence-repo', 'git@gitee.com:example/evidence-repo.git', 'gitee', 'tree'],
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    data.diagram.meta.repository = { url, revision: data.revision, provider };
    data.diagram.components[0].sources = [{ path: './src/', label: 'Source directory' }, { path: '.' }];
    const evidence = verifyRepositoryEvidence('architecture', data.diagram, data.root);
    assert.equal(evidence.referenceCount, 2);
    assert.deepEqual(evidence.nodes[data.diagram.components[0].id], [
      { path: 'src', kind: 'directory', label: 'Source directory', href: `${url}/${route}/${data.revision}/src` },
      { path: '.', kind: 'directory', href: `${url}/${route}/${data.revision}` },
    ]);
  }
  data.diagram.meta.repository.link_mode = 'local-only';
  fs.rmSync(path.join(data.root, 'src'), { recursive: true });
  const pinned = verifyRepositoryEvidence('architecture', data.diagram, data.root);
  assert.deepEqual(pinned.nodes[data.diagram.components[0].id][0], { path: 'src', kind: 'directory', label: 'Source directory' }, 'the pinned Git tree is independent of the working directory');
  fs.mkdirSync(path.join(data.root, 'untracked'));
  data.diagram.components[0].sources = [{ path: 'untracked' }];
  assert.throws(() => verifyRepositoryEvidence('architecture', data.diagram, data.root), error => error.archifyDiagnostics.some(d => d.code === 'repository-evidence/file-missing'));
  data.diagram.components[0].sources = [{ path: 'src', line: 1 }];
  assert.throws(() => verifyRepositoryEvidence('architecture', data.diagram, data.root), error => error.archifyDiagnostics.some(d => d.code === 'repository-evidence/directory-line'));
  for (const sourcePath of ['src/../src', 'src//router.js', '.git/config', '../src', 'src/./router.js']) {
    data.diagram.components[0].sources = [{ path: sourcePath }];
    assert.throws(() => verifyRepositoryEvidence('architecture', data.diagram, data.root), error => error.archifyDiagnostics.some(d => d.code === 'repository-evidence/path-escape'));
  }
});

test('one directory-backed IR maps in check and delivers from the public start CLI', { timeout: 30000 }, async t => {
  const data = fixture();
  data.diagram.components[0].sources = [{ path: 'src' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const checked = run(['code-analysis', 'check', data.root, '--language', 'ts', '--ir', data.input, '--fail-on', 'never', '--json']);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal(JSON.parse(checked.stdout).diagram.mappedComponents, 1);
  const delivered = run(['deliver', 'architecture', data.input, path.join(data.root, 'delivered.html'), '--repo-root', data.root, '--json']);
  assert.equal(delivered.status, 0, delivered.stdout + delivered.stderr);
  assert.equal(JSON.parse(delivered.stdout).evidence.verified, true);
  const child = spawn(process.execPath, [cli, 'start', data.root, '--ir', data.input, '--out', path.join(data.root, 'start-output')], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGINT');
    await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref(); });
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const deadline = Date.now() + 20000;
  let url;
  while (Date.now() < deadline) {
    url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(url, output + errors);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const evidence = evidencePayload(await response.text());
  assert.equal(evidence.nodes[data.diagram.components[0].id][0].kind, 'directory');
  assert.equal(evidence.repository.revision, data.revision);
});
