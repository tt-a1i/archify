import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startPreview } from '../archify/bin/preview.mjs';
import { verifyRepositoryEvidence } from '../archify/renderers/shared/repository-evidence.mjs';
import { skillRoot, cli, git, fixture, run, evidencePayload } from './helpers/repository-evidence-fixture.mjs';

// Address variants exercise the same real Git verifier. Keep representative
// CLI paths to prove that the verified payload reaches HTML and delivery receipts,
// instead of rendering the same diagram again for every spelling of its origin.
function verifyRemoteEvidence(data, output, { cli: throughCli = false, command = 'deliver' } = {}) {
  if (!throughCli) {
    const evidence = verifyRepositoryEvidence('architecture', data.diagram, data.root);
    assert.equal(evidence.verified, true);
    return evidence;
  }
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const args = [command, 'architecture', data.input, output, '--repo-root', data.root];
  if (command === 'deliver') args.push('--json');
  const result = run(args);
  assert.equal(result.status, 0, `${data.diagram.meta.repository.url}: ${result.stderr || result.stdout}`);
  const html = fs.readFileSync(output, 'utf8');
  const evidence = evidencePayload(html);
  assert.equal(evidence.verified, true);
  assert.doesNotMatch(html, /SYNTHETIC_TOKEN|not-a-real-token/);
  if (command === 'deliver') {
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.evidence.verified, true);
    assert.equal(receipt.evidence.linkMode, evidence.repository.linkMode);
  }
  return evidence;
}

test('evidence prefetch preserves the first source diagnostic in JSON output', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  data.diagram.components[0].sources = [{ path: 'src/missing.js' }, { path: '../escape' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.diagnostics.map(({ code, subject }) => [code, subject.path]), [
    ['repository-evidence/file-missing', '/components/0/sources/0/path'],
  ]);
});

test('path-only evidence verifies types without reading blob contents', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  data.diagram.components[0].sources = [{ path: 'src/router.js' }, { path: 'src/store.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const trace = path.join(data.root, 'git.trace');
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', data.input, '--repo-root', data.root, '--json'], {
    cwd: skillRoot, encoding: 'utf8', env: { ...process.env, GIT_TRACE: trace },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(fs.readFileSync(trace, 'utf8'), /cat-file --batch(?:\s|$)|\bshow\s/);
});

test('line evidence retains the per-file read limit after batch prefetch', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(data.root, 'large.txt'), Buffer.alloc(17 * 1024 * 1024, 'x'));
  git(data.root, 'add', 'large.txt');
  git(data.root, 'commit', '-m', 'large source');
  data.diagram.meta.repository.revision = git(data.root, 'rev-parse', 'HEAD');
  data.diagram.components[0].sources = [{ path: 'large.txt', line: 1 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'repository-evidence/git-unavailable');
});

test('repository root accepts a different spelling of the same physical Git top-level', (t) => {
  const data = fixture();
  const alias = `${data.root}-alias`;
  fs.symlinkSync(data.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rmSync(alias, { recursive: true, force: true }));

  // Windows APIs and Git can report the same directory with different case or
  // long/short spellings. Preserve the authored alias for the first lookup so
  // this test exercises physical identity instead of string equality.
  const realpathSync = fs.realpathSync;
  let preservedAlias = false;
  t.mock.method(fs, 'realpathSync', (target, ...args) => {
    if (!preservedAlias && path.resolve(String(target)) === path.resolve(alias)) {
      preservedAlias = true;
      return alias;
    }
    return Reflect.apply(realpathSync, fs, [target, ...args]);
  });

  const evidence = verifyRepositoryEvidence('architecture', data.diagram, alias);
  assert.equal(preservedAlias, true);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.revision, data.revision);
});

test('repository root rejects a different physical directory inside the repository', () => {
  const data = fixture();
  assert.throws(
    () => verifyRepositoryEvidence('architecture', data.diagram, path.join(data.root, 'src')),
    (error) => error?.archifyDiagnostics?.some(({ code }) => code === 'repository-evidence/root-not-top-level'),
  );
});

test('repository url carrying a local path names the origin-discovery fix', () => {
  const data = fixture();
  data.diagram.meta.repository.url = data.root;
  assert.throws(
    () => verifyRepositoryEvidence('architecture', data.diagram, data.root),
    (error) => {
      const diagnostic = error?.archifyDiagnostics?.find(({ code }) => code === 'repository-evidence/url-invalid');
      assert.ok(diagnostic);
      assert.equal(diagnostic.evidence.authoredValueLooksLike, 'local filesystem path; the expected value is the remote origin address');
      assert.ok(diagnostic.supportedFixes.some((fix) => fix.includes('git remote get-url origin')));
      assert.equal(JSON.stringify(diagnostic).includes(data.root), false, 'the authored value must not be echoed into diagnostics');
      return true;
    },
  );

  data.diagram.meta.repository.url = 'not a url at all';
  assert.throws(
    () => verifyRepositoryEvidence('architecture', data.diagram, data.root),
    (error) => {
      const diagnostic = error?.archifyDiagnostics?.find(({ code }) => code === 'repository-evidence/url-invalid');
      assert.ok(diagnostic);
      assert.equal(diagnostic.evidence.authoredValueLooksLike, undefined);
      return true;
    },
  );
});

test('repository URL diagnostics identify Windows local paths without echoing them', () => {
  const data = fixture();
  for (const localPath of [String.raw`\\server\share\repo`, String.raw`C:\work\repo`, String.raw`.\repo`, String.raw`..\repo`]) {
    data.diagram.meta.repository.url = localPath;
    assert.throws(
      () => verifyRepositoryEvidence('architecture', data.diagram, data.root),
      (error) => {
        const diagnostic = error?.archifyDiagnostics?.find(({ code }) => code === 'repository-evidence/url-invalid');
        assert.ok(diagnostic);
        assert.match(diagnostic.evidence.authoredValueLooksLike, /local filesystem path/);
        assert.ok(diagnostic.supportedFixes.some((fix) => fix.includes('git remote get-url origin')));
        assert.equal(JSON.stringify(diagnostic).includes(JSON.stringify(localPath).slice(1, -1)), false);
        return true;
      },
    );
  }
});

test('repository root fails closed when physical identity is indeterminate', (t) => {
  const data = fixture();
  const inaccessible = Object.assign(new Error('synthetic identity failure'), { code: 'EACCES' });
  t.mock.method(fs, 'statSync', () => { throw inaccessible; });

  assert.throws(
    () => verifyRepositoryEvidence('architecture', data.diagram, data.root),
    (error) => {
      const diagnostic = error?.archifyDiagnostics?.find(
        ({ code }) => code === 'repository-evidence/root-identity-indeterminate',
      );
      assert.ok(diagnostic);
      assert.equal(diagnostic.evidence.relation.code, 'root-resolution-failed');
      assert.equal(diagnostic.evidence.relation.systemCode, 'EACCES');
      return true;
    },
  );
});

test('Gitee evidence generates provider-specific revision and line links', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  data.diagram.meta.repository.url = 'https://gitee.com/example/evidence-repo';
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const output = path.join(data.root, 'gitee.html');
  for (const [index, remote] of [
    'https://gitee.com/example/evidence-repo.git/',
    'git@gitee.com:example/evidence-repo.git',
    'ssh://git@gitee.com/example/evidence-repo.git',
  ].entries()) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const evidence = verifyRemoteEvidence(data, output, { cli: index === 0 });
    assert.equal(evidence.repository.href, `https://gitee.com/example/evidence-repo/tree/${data.revision}`);
    assert.equal(evidence.nodes.users[0].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-3`);
    assert.equal(evidence.nodes.users[1].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/store.js#L1`);
  }
});

test('GitLab evidence links nested groups and accepts SSH, HTTPS, suffix and case variants', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(data.root, 'docs'));
  fs.writeFileSync(path.join(data.root, 'docs', 'guide.md'), '# Guide\n\nRoute requests.\n');
  git(data.root, 'add', '.');
  git(data.root, 'commit', '-m', 'guide');
  const revision = git(data.root, 'rev-parse', 'HEAD');
  data.diagram.meta.repository = { url: 'https://gitlab.com/example/platform/evidence-repo', revision };
  data.diagram.components[1].sources = [{ path: 'docs/guide.md', line: 1, end_line: 3 }, { path: 'docs/guide.md' }];
  const docsNode = data.diagram.components[1].id;
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const output = path.join(data.root, 'gitlab.html');
  const base = 'https://gitlab.com/example/platform/evidence-repo';
  for (const [index, remote] of [
    'https://gitlab.com/example/platform/evidence-repo.git/',
    'https://oauth2:not-a-real-token@gitlab.com/example/platform/evidence-repo.git',
    'git@gitlab.com:example/platform/evidence-repo.git',
    'ssh://git@gitlab.com/example/platform/evidence-repo',
    'git@gitlab.com:Example/Platform/evidence-repo.git',
  ].entries()) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const evidence = verifyRemoteEvidence(data, output, { cli: index === 1 || index === 2 });
    assert.equal(evidence.repository.href, `${base}/-/tree/${revision}`);
    assert.deepEqual(evidence.nodes.users.map((source) => source.href), [
      `${base}/-/blob/${revision}/src/router.js#L1-3`,
      `${base}/-/blob/${revision}/src/store.js#L1`,
    ]);
    assert.deepEqual(evidence.nodes[docsNode].map((source) => source.href), [
      `${base}/-/blob/${revision}/docs/guide.md?plain=1#L1-3`,
      `${base}/-/blob/${revision}/docs/guide.md`,
    ]);
  }
});

test('self-managed GitLab links require an explicit provider and keep endpoint identity', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const url = 'https://git.example.internal/Platform/Services/evidence-repo';
  const output = path.join(data.root, 'self-managed.html');
  for (const [index, remote] of [url, 'git@git.example.internal:Platform/Services/evidence-repo.git'].entries()) {
    data.diagram.meta.repository = { url, revision: data.revision, provider: 'gitlab' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const evidence = verifyRemoteEvidence(data, output, { cli: index === 0 });
    assert.equal(evidence.repository.href, `${url}/-/tree/${data.revision}`);
    assert.equal(evidence.nodes.users[0].href, `${url}/-/blob/${data.revision}/src/router.js#L1-3`);
  }
  for (const [repository, remote, code] of [
    [{ url }, url, 'repository-evidence/links-unsupported'],
    // Inherited object keys are not forge hosts.
    [{ url: 'https://constructor/Platform/evidence-repo' }, 'https://constructor/Platform/evidence-repo', 'repository-evidence/links-unsupported'],
    [{ url: 'https://__proto__/Platform/evidence-repo' }, 'https://__proto__/Platform/evidence-repo', 'repository-evidence/links-unsupported'],
    [{ url: 'https://github.com/example/evidence-repo', provider: 'gitlab' }, 'https://github.com/example/evidence-repo', 'repository-evidence/provider-invalid'],
    [{ url: 'http://git.example.internal/Platform/evidence-repo', provider: 'gitlab' }, 'http://git.example.internal/Platform/evidence-repo', 'repository-evidence/links-unsupported'],
    [{ url, provider: 'gitlab' }, 'ssh://git@git.example.internal:2222/Platform/Services/evidence-repo.git', 'repository-evidence/origin-mismatch'],
    [{ url, provider: 'gitlab' }, 'git@ssh.example.internal:Platform/Services/evidence-repo.git', 'repository-evidence/origin-mismatch'],
  ]) {
    data.diagram.meta.repository = { revision: data.revision, ...repository };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, `${JSON.stringify(repository)} with ${remote}`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some((diagnostic) => diagnostic.code === code), `${JSON.stringify(repository)}: ${result.stdout}`);
  }
});

test('local-only evidence verifies HTTP self-hosted origins without generating links', () => {
  const data = fixture();
  data.diagram.meta.repository = {
    url: 'http://git.example.internal:3000/Platform/Services/evidence-repo',
    revision: data.revision,
    link_mode: 'local-only',
  };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  git(data.root, 'remote', 'set-url', 'origin', data.diagram.meta.repository.url);
  // Evidence is read from the pinned commit, not from the current working file.
  fs.writeFileSync(path.join(data.root, 'src/router.js'), 'changed\n');
  const output = path.join(data.root, 'local.html');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).evidence.linkMode, 'local-only');
  const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.href, undefined);
  assert.equal(evidence.repository.linkMode, 'local-only');
  assert.equal(evidence.nodes.users[0].endLine, 3);
  assert.ok(evidence.nodes.users.every((source) => !Object.hasOwn(source, 'href')));
});

test('local-only supports nested HTTPS and Git SSH identities with bounded port equivalence', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const output = path.join(data.root, 'portable.html');
  for (const [index, [url, remote]] of [
    ['https://git.internal/Platform/Services/repo.git', 'https://git.internal:443/Platform/Services/repo.git'],
    ['ssh://git@git.internal/Platform/Services/repo', 'ssh://git@git.internal:22/Platform/Services/repo'],
    ['ssh://git@git.internal:2222/Platform/repo.git', 'ssh://git@git.internal:2222/Platform/repo.git'],
    ['git@git.internal:Platform/repo', 'git@git.internal:Platform/repo'],
    ['git@git.internal:/Platform/repo', 'ssh://git@git.internal/Platform/repo'],
    ['http://git.internal:3000/Platform/repo.git', 'http://user:SYNTHETIC_TOKEN@git.internal:3000/Platform/repo.git'],
    ['https://git.internal/Platform/repo.git', 'https://user:SYNTHETIC_TOKEN@git.internal/Platform/repo.git'],
    ['git@git.internal:Platform/repo%41', 'git@git.internal:Platform/repo%41'],
    ['ssh://git@git.internal/Platform/repo%41', 'ssh://git@git.internal/Platform/repoA'],
  ].entries()) {
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const evidence = verifyRemoteEvidence(data, output, { cli: index === 1 || index === 5, command: 'render' });
    assert.doesNotMatch(JSON.stringify(evidence), /SYNTHETIC_TOKEN/);
    assert.equal(evidence.repository.href, undefined);
  }
});

for (const [name, url, origin] of [
  ['relative versus absolute SSH paths', 'ssh://git@git.internal/Team/repo', 'git@git.internal:Team/repo'],
  ['literal percent escapes in SCP paths', 'git@git.internal:Team/repoA', 'git@git.internal:Team/repo%41'],
]) {
  test(`local-only rejects ${name} before replacing a trusted artifact`, () => {
    const data = fixture();
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', origin);
    const output = path.join(data.root, 'trusted.html');
    fs.writeFileSync(output, 'trusted previous artifact');
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, 'different Git paths must not verify as the declared repository');
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/origin-mismatch'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  });
}

test('local-only rejects different hosts, paths, path case, endpoints and guessed prefixes', () => {
  const data = fixture();
  const output = path.join(data.root, 'trusted.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  for (const [url, remote] of [
    ['https://git.internal/Team/repo', 'https://other.internal/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/Team/other'],
    ['https://git.internal/Team/repo', 'https://git.internal/team/repo'],
    ['https://git.internal/Team/repo', 'http://git.internal/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal:8443/Team/repo'],
    ['ssh://git@git.internal:2222/Team/repo', 'ssh://git@git.internal:2223/Team/repo'],
    ['https://git.internal:2222/Team/repo', 'ssh://git@git.internal:2222/Team/repo'],
    ['https://git.internal/Team/repo', 'git@ssh-alias:Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/scm/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/Team/ignored/../repo'],
    ['https://git.internal/Team/repo', 'git@git.internal:Team/repo'],
    ['https://git.internal/Team/repo', 'ssh://git@git.internal/Team/repo'],
    ['git@git.internal:Team/repo', 'git@git.internal:Team/repo.git'],
    ['http://git.internal/Team/repo', 'http://git.internal/Team/repo.git'],
  ]) {
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, `${url} must differ from ${remote}`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/origin-mismatch'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
});

test('local-only preserves root, origin, commit, blob, path and line checks', () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'http://git.internal/team/repo';
  data.diagram.meta.repository.link_mode = 'local-only';
  git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal/team/repo');
  const output = path.join(data.root, 'trusted.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  const original = structuredClone(data.diagram);
  const cases = [
    ['repository-evidence/root-required', () => {}, []],
    ['repository-evidence/revision-unavailable', (diagram) => { diagram.meta.repository.revision = '0'.repeat(40); }],
    ['repository-evidence/file-missing', (diagram) => { diagram.components[0].sources = [{ path: 'src/missing.js' }]; }],
    ['repository-evidence/file-missing', (diagram) => { diagram.components[0].sources = [{ path: 'src' }]; }],
    ['repository-evidence/path-escape', (diagram) => { diagram.components[0].sources = [{ path: '../outside.js' }]; }],
    ['repository-evidence/path-escape', (diagram) => { diagram.components[0].sources = [{ path: '.git/config' }]; }],
    ['repository-evidence/line-out-of-range', (diagram) => { diagram.components[0].sources = [{ path: 'src/router.js', line: 4 }]; }],
    ['repository-evidence/line-range-invalid', (diagram) => { diagram.components[0].sources = [{ path: 'src/router.js', line: 3, end_line: 1 }]; }],
  ];
  for (const [expectedCode, change, roots = ['--repo-root', data.root]] of cases) {
    const diagram = structuredClone(original);
    change(diagram);
    fs.writeFileSync(data.input, JSON.stringify(diagram));
    const result = run(['deliver', 'architecture', data.input, output, ...roots, '--json']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === expectedCode), result.stdout);
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
  fs.writeFileSync(data.input, JSON.stringify(original));
  git(data.root, 'remote', 'remove', 'origin');
  const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /must have an origin/);
});

test('unsupported web providers and invalid authored addresses fail without exposing credentials', () => {
  const data = fixture();
  for (const repository of [
    { url: 'https://git.internal/team/repo' },
    { url: 'https://gitee.com/team/repo', provider: 'github' },
    { url: 'https://git.internal/team/repo', provider: 'gitee' },
    { url: 'https://user:SYNTHETIC_TOKEN@gitee.com/team/repo' },
    { url: 'https://gitee.com/team/repo?token=SYNTHETIC_TOKEN' },
    { url: 'https://gitee.com/team/repo#SYNTHETIC_TOKEN' },
    { url: 'https://gitee.com/team/%2e%2e/repo' },
    { url: 'https://gitee.com/team%2Frepo' },
    { url: 'file:///tmp/repo', link_mode: 'local-only' },
    { url: 'javascript:alert(1)', link_mode: 'local-only' },
    { link_mode: 'local-only' },
  ]) {
    data.diagram.meta.repository = { revision: data.revision, ...repository };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, JSON.stringify(repository));
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_TOKEN/);
  }
});

test('portable origin failures redact HTTP credentials and query tokens', () => {
  const data = fixture();
  data.diagram.meta.repository = { url: 'http://git.internal/Team/repo', revision: data.revision, link_mode: 'local-only' };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  for (const origin of [
    'http://user:SYNTHETIC_TOKEN@git.internal/Team/other',
    'http://git.internal/Team/repo?token=SYNTHETIC_TOKEN',
    'https://user:SYNTHETIC_TOKEN@git.internal/Team/repo',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', origin);
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_TOKEN/);
  }
});

test('explicit providers retain GitHub links and encode Gitee source paths', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.root, 'src', '中文 # router.js'), 'one\ntwo\n');
  git(data.root, 'add', 'src');
  git(data.root, 'commit', '-m', 'encoded source path');
  const revision = git(data.root, 'rev-parse', 'HEAD');
  data.diagram.components[0].sources = [{ path: 'src/中文 # router.js', line: 1, end_line: 2 }];
  for (const provider of ['github', 'gitee']) {
    data.diagram.meta.repository = { url: `https://${provider}.com/example/evidence-repo.git/`, revision, provider };
    git(data.root, 'remote', 'set-url', 'origin', `git@${provider}.com:example/evidence-repo.git`);
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const output = path.join(data.root, `${provider}.html`);
    const result = run(['render', 'architecture', data.input, output, '--repo-root', data.root]);
    assert.equal(result.status, 0, result.stderr);
    const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.nodes.users[0].href, `https://${provider}.com/example/evidence-repo/blob/${revision}/src/${encodeURIComponent('中文 # router.js')}#L1-${provider === 'github' ? 'L' : ''}2`);
  }
});

test('local-only preview and compare publish only revision-verified evidence', { timeout: 20000 }, async () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'http://git.internal/Team/repo';
  data.diagram.meta.repository.link_mode = 'local-only';
  git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal/Team/repo');
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const head = path.join(data.root, 'head.architecture.json');
  fs.writeFileSync(head, JSON.stringify(data.diagram));
  const compared = path.join(data.root, 'compared.html');
  const result = run(['compare', 'architecture', data.input, head, compared, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).proofLevel, 'revision-pinned');
  assert.match(fs.readFileSync(compared, 'utf8'), /local-only/);
  const preview = await startPreview({ type: 'architecture', input: data.input, output: path.join(data.root, 'preview-local.html'), repoRoot: data.root, open: false, debounceMs: 30, pollMs: 60 });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified');
    const before = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.equal(evidencePayload(before).repository.href, undefined);
    data.diagram.components[0].sources[0].line = 999;
    delete data.diagram.components[0].sources[0].end_line;
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const failed = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix');
    assert.equal(failed.revision, state.revision);
    assert.equal(await (await fetch(new URL('/artifact.html', preview.url))).text(), before);
  } finally { await preview.stop(); }
});

test('repository evidence accepts canonical HTTPS and common SSH remotes', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const output = path.join(data.root, 'remote-form.html');
  for (const [index, remote] of [
    'https://github.com/example/evidence-repo.git/',
    'https://x-access-token:not-a-real-token@github.com/example/evidence-repo.git',
    'https://oauth2:not-a-real-token@github.com/example/evidence-repo',
    'git@github.com:example/evidence-repo.git',
    'ssh://git@github.com/example/evidence-repo.git',
  ].entries()) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const evidence = verifyRemoteEvidence(data, output, { cli: index === 1 || index === 3 });
    assert.equal(evidence.repository.href, `https://github.com/example/evidence-repo/tree/${data.revision}`);
    assert.equal(evidence.nodes.users[0].href, `https://github.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-L3`);
  }
});

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
  assert.doesNotMatch(html, /Archify\.sourceEvidence\.installBeacons\(\)|classList\.add\('source-evidence-beacon'\)/);
  assert.match(html, /querySelectorAll\('\[data-source-evidence-beacon\]'\)/);
  assert.match(html, /data-source-evidence-original-label/);

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
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /source-evidence-beacon|data-source-evidence-count/);
});


test('origin-mismatch diagnostics redact HTTPS remote userinfo', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  git(data.root, 'remote', 'set-url', 'origin', 'https://user:not-a-real-token@github.com/example/other-repo.git');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /not-a-real-token/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /not-a-real-token/);
  assert.match(diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@github\.com\/example\/other-repo\.git$/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('origin-mismatch diagnostics redact HTTP remote userinfo', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  git(data.root, 'remote', 'set-url', 'origin', 'http://user:FAKE_SECRET@github.com/example/other');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /FAKE_SECRET/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /FAKE_SECRET/);
  assert.match(diagnostic.evidence.localOrigin, /^http:\/\/REDACTED@github\.com\/example\/other$/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('validate accepts credentialed HTTPS remotes and redacts mismatch diagnostics', () => {
  const data = fixture();
  git(data.root, 'remote', 'set-url', 'origin', 'https://x-access-token:not-a-real-token@github.com/example/evidence-repo.git');
  let result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);

  git(data.root, 'remote', 'set-url', 'origin', 'https://user:VALIDATE_SECRET@github.com/example/other-repo.git');
  result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /VALIDATE_SECRET/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /VALIDATE_SECRET/);
  assert.doesNotMatch(result.stderr, /VALIDATE_SECRET/);
  assert.match(diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@github\.com\/example\/other-repo\.git$/);
});

test('preview accepts credentialed HTTPS remotes and redacts mismatch diagnostics', { timeout: 20000 }, async () => {
  const data = fixture();
  const output = path.join(data.root, 'preview-credential.html');
  git(data.root, 'remote', 'set-url', 'origin', 'https://oauth2:not-a-real-token@github.com/example/evidence-repo');
  const matched = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(matched.url, (candidate) => candidate.status === 'verified');
    assert.equal(state.revision, 1);
    const html = await (await fetch(new URL('/artifact.html', matched.url))).text();
    assert.equal(evidencePayload(html).repository.revision, data.revision);
  } finally {
    await matched.stop();
  }

  git(data.root, 'remote', 'set-url', 'origin', 'https://user:PREVIEW_SECRET@github.com/example/other-repo.git');
  const mismatched = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(mismatched.url, (candidate) => candidate.status === 'needs-fix');
    assert.equal(state.failure?.stage, 'render');
    assert.match(state.failure?.message || '', /repository-evidence\/origin-mismatch/);
    assert.doesNotMatch(JSON.stringify(state), /PREVIEW_SECRET/);
  } finally {
    await mismatched.stop();
  }
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

test('--repo-root reaches every typed renderer and schema limits evidence shape', () => {
  const data = fixture();
  const workflowOutput = path.join(data.root, 'workflow.html');
  let result = run(['render', 'workflow', path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'), workflowOutput, '--repo-root', data.root]);
  assert.equal(result.status, 0, result.stderr);

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
