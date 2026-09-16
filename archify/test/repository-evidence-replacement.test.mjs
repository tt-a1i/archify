import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const repositoryUrl = 'https://github.com/example/evidence-replacement';
const shortFile = 'first\n';
const longFile = 'first\nsecond\nthird\n';
const cases = [
  { name: 'commit replacement adds a missing file', kind: 'commit', original: null, replacement: longFile, code: 'file-missing' },
  { name: 'commit replacement adds out-of-range lines', kind: 'commit', original: shortFile, replacement: longFile, code: 'line-out-of-range' },
  { name: 'commit replacement removes a valid file', kind: 'commit', original: longFile, replacement: null },
  { name: 'commit replacement shortens valid lines', kind: 'commit', original: longFile, replacement: shortFile },
  { name: 'blob replacement adds out-of-range lines', kind: 'blob', original: shortFile, replacement: longFile, code: 'line-out-of-range' },
  { name: 'blob replacement shortens valid lines', kind: 'blob', original: longFile, replacement: shortFile },
  { name: 'custom replacement namespace adds out-of-range lines', kind: 'commit', original: shortFile, replacement: longFile, code: 'line-out-of-range', refBase: 'refs/test-replacements/' },
];

function fixture(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-replacement-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  // 隔离调用者的 Git 环境与配置，不改动真实 HOME 或全局配置。
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0',
    ...(scenario.refBase ? { GIT_REPLACE_REF_BASE: scenario.refBase } : {}),
  });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '--template=');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('remote', 'add', 'origin', `${repositoryUrl}.git`);
  fs.writeFileSync(path.join(repo, 'anchor.txt'), 'keep the repository nonempty\n');
  const source = path.join(repo, 'source.js');
  if (scenario.original !== null) fs.writeFileSync(source, scenario.original);
  git('add', 'anchor.txt', ...(scenario.original === null ? [] : ['source.js']));
  git('commit', '-m', 'original evidence');
  const revision = git('rev-parse', 'HEAD');

  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  diagram.meta.repository = { url: repositoryUrl, revision };
  diagram.components[0].sources = [{ path: 'source.js', line: 2, end_line: 3 }];
  const input = path.join(root, 'diagram.json');
  const output = path.join(root, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const run = (command) => spawnSync(process.execPath, [
    cli, command, 'architecture', input, ...(command === 'deliver' ? [output] : []),
    '--repo-root', repo, '--json',
  ], { env, cwd: skillRoot, encoding: 'utf8', timeout: 20000 });

  function installReplacement() {
    let replaced = revision;
    let replacement;
    if (scenario.kind === 'blob') {
      replaced = git('rev-parse', `${revision}:source.js`);
      const blob = path.join(root, 'replacement-blob');
      fs.writeFileSync(blob, scenario.replacement);
      replacement = git('hash-object', '-w', blob);
    } else {
      if (scenario.replacement === null) fs.unlinkSync(source);
      else fs.writeFileSync(source, scenario.replacement);
      git('add', '-A');
      git('commit', '-m', 'replacement evidence');
      replacement = git('rev-parse', 'HEAD');
    }
    git('replace', replaced, replacement);
    const ref = `${scenario.refBase || 'refs/replace/'}${replaced}`;
    assert.equal(git('rev-parse', ref), replacement);
    // 证明夹具确实改变 Git 读取结果，而非只创建无效的 replacement ref。
    if (scenario.replacement === null) {
      assert.throws(() => git('show', `${revision}:source.js`));
    } else {
      assert.equal(git('show', `${revision}:source.js`), scenario.replacement.trim());
    }
    return () => assert.equal(git('rev-parse', ref), replacement, 'CLI must preserve replacement refs');
  }
  return { root, source, revision, output, run, installReplacement, nodeId: diagram.components[0].id };
}

function checkEvidence(data, scenario, checkRefs = () => {}) {
  for (const command of ['validate', 'deliver']) {
    fs.writeFileSync(data.output, 'trusted previous artifact');
    const result = data.run(command);
    checkRefs();
    assert.ifError(result.error);
    assert.equal(result.status, scenario.code ? 1 : 0, `${command}: ${result.stderr || result.stdout}`);
    const receipt = JSON.parse(result.stdout);
    if (scenario.code) {
      assert.ok(receipt.diagnostics.some(({ code }) => code === `repository-evidence/${scenario.code}`), JSON.stringify(receipt));
      assert.equal(fs.readFileSync(data.output, 'utf8'), 'trusted previous artifact');
    } else if (command === 'deliver') {
      assert.equal(receipt.evidence.revision, data.revision);
      assert.equal(receipt.evidence.verified, true);
      const html = fs.readFileSync(data.output, 'utf8');
      const payload = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
      assert.ok(payload, 'verified evidence payload missing');
      const evidence = JSON.parse(payload[1]);
      assert.equal(evidence.repository.revision, data.revision);
      assert.equal(evidence.verified, true);
      const [source] = evidence.nodes[data.nodeId];
      assert.equal(source.line, 2);
      assert.equal(source.endLine, 3);
      assert.equal(source.href, `${repositoryUrl}/blob/${data.revision}/source.js#L2-L3`);
    }
  }
}

for (const scenario of cases) {
  test(`pinned evidence ignores ${scenario.name}`, { timeout: 60000 }, (t) => {
    const data = fixture(t, scenario);
    checkEvidence(data, scenario);
    const checkRefs = data.installReplacement();
    checkEvidence(data, scenario, checkRefs);
  });
}

test('pinned evidence ignores dirty working files without replacement refs', { timeout: 60000 }, (t) => {
  const scenario = { original: longFile };
  const data = fixture(t, scenario);
  checkEvidence(data, scenario);
  fs.writeFileSync(data.source, shortFile);
  checkEvidence(data, scenario);
});
