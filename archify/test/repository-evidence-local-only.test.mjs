import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { verifyRepositoryEvidence } from '../renderers/shared/repository-evidence.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const repository = 'https://github.com/example/evidence-local-only';
const shapes = [
  ['architecture', 'components', 'web-app.architecture.json'],
  ['workflow', 'nodes', 'agent-tool-call.workflow.json'],
  ['sequence', 'participants', 'cache-miss-request.sequence.json'],
  ['dataflow', 'nodes', 'product-analytics.dataflow.json'],
  ['lifecycle', 'states', 'agent-run.lifecycle.json'],
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-local-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const partial = path.join(root, 'partial');
  fs.mkdirSync(source);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: '0', ARCHIFY_UPDATE_CHECK_DISABLED: '1' });
  const git = (cwd, ...args) => childProcess.execFileSync('git', ['-C', cwd, ...args], {
    env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(source, 'init', '--template=');
  git(source, 'config', 'user.name', 'Archify Tests');
  git(source, 'config', 'user.email', 'archify@example.test');
  git(source, 'config', 'commit.gpgSign', 'false');
  git(source, 'config', 'uploadpack.allowFilter', 'true');
  git(source, 'remote', 'add', 'origin', `${repository}.git`);
  fs.writeFileSync(path.join(source, 'source.js'), 'export const source = 1;\n');
  git(source, 'add', 'source.js');
  git(source, 'commit', '-m', 'fixture');
  const revision = git(source, 'rev-parse', 'HEAD');
  const blob = git(source, 'rev-parse', `${revision}:source.js`);
  git(root, 'clone', '--filter=blob:none', '--no-checkout', '--template=', pathToFileURL(source).href, partial);
  git(partial, 'remote', 'set-url', 'origin', `${repository}.git`);
  git(partial, 'config', 'protocol.https.allow', 'always');
  assert.ok(fs.readdirSync(path.join(partial, '.git', 'objects', 'pack')).some((file) => file.endsWith('.promisor')));
  assert.match(git(partial, 'ls-tree', revision, 'source.js'), new RegExp(blob));

  // 本地桩替代 HTTPS transport：真实 Git 仍解析 promisor 对象，但测试绝不访问远端。
  const helpers = path.join(root, 'helpers');
  const trace = path.join(root, 'remote.trace');
  fs.mkdirSync(helpers);
  fs.writeFileSync(trace, '');
  fs.writeFileSync(path.join(helpers, 'git-remote-https'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ARCHIFY_TEST_REMOTE_TRACE"\nexit 99\n', { mode: 0o755 });
  Object.assign(env, { GIT_EXEC_PATH: helpers, ARCHIFY_TEST_REMOTE_TRACE: trace, GIT_NO_LAZY_FETCH: '0', GIT_ALLOW_PROTOCOL: 'https' });
  const probe = childProcess.spawnSync('git', ['-C', partial, 'cat-file', '-e', blob], { env, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(probe.status, 0);
  assert.match(fs.readFileSync(trace, 'utf8'), /origin https:\/\/github\.com\/example\/evidence-local-only.git/);
  fs.writeFileSync(trace, '');
  const config = fs.readFileSync(path.join(partial, '.git', 'config'));
  const refs = git(partial, 'show-ref');
  const packs = fs.readdirSync(path.join(partial, '.git', 'objects', 'pack')).sort();

  function document([type, collection, example] = shapes[0], { line = true, localOnly = false } = {}) {
    const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    diagram.meta.repository = { url: repository, revision, ...(localOnly ? { link_mode: 'local-only' } : {}) };
    diagram[collection][0].sources = [{ path: 'source.js', ...(line ? { line: 1 } : {}) }];
    return { diagram, type, node: diagram[collection][0] };
  }
  function run(command, data, repo = partial) {
    const input = path.join(root, `input-${data.type}.json`);
    const output = path.join(root, `output-${data.type}.html`);
    fs.writeFileSync(input, JSON.stringify(data.diagram));
    if (command === 'deliver') fs.writeFileSync(output, 'previous artifact');
    const result = childProcess.spawnSync(process.execPath, [cli, command, data.type, input,
      ...(command === 'deliver' ? [output] : []), '--repo-root', repo, '--json'], {
      env, cwd: skillRoot, encoding: 'utf8', timeout: 20000,
    });
    assert.ifError(result.error);
    return { ...result, receipt: JSON.parse(result.stdout), output };
  }
  function assertUnchanged() {
    assert.equal(fs.readFileSync(trace, 'utf8'), '', '证据校验不得启动远端 transport');
    assert.deepEqual(fs.readFileSync(path.join(partial, '.git', 'config')), config);
    assert.equal(git(partial, 'show-ref'), refs);
    assert.deepEqual(fs.readdirSync(path.join(partial, '.git', 'objects', 'pack')).sort(), packs);
  }
  return { root, source, partial, env, git, revision, blob, document, run, assertUnchanged };
}

for (const shape of shapes) {
  test(`${shape[0]} 的 partial clone 来源校验禁止隐式联网`, (t) => {
    const data = fixture(t);
    for (const options of [{ line: true }, { line: false }, { line: true, localOnly: true }]) {
      const result = data.run('validate', data.document(shape, options));
      assert.equal(result.status, 1, result.stdout);
      assert.equal(result.receipt.diagnostics[0].code, 'repository-evidence/file-missing');
      data.assertUnchanged();
      assert.match(result.receipt.diagnostics[0].message, /local/);
      assert.match(result.receipt.diagnostics[0].supportedFixes.join(' '), /fetch.*explicitly|explicitly.*fetch/);
    }
  });
}

test('local-only 交付失败保留旧产物，缺失 commit 也不触发远端读取', (t) => {
  const data = fixture(t);
  const document = data.document(shapes[0], { localOnly: true });
  const delivery = data.run('deliver', document);
  assert.equal(delivery.status, 1);
  assert.equal(delivery.receipt.ok, false);
  assert.equal(fs.readFileSync(delivery.output, 'utf8'), 'previous artifact');
  document.diagram.meta.repository.revision = '0'.repeat(40);
  const missingCommit = data.run('validate', document);
  assert.equal(missingCommit.receipt.diagnostics[0].code, 'repository-evidence/revision-unavailable');
  data.assertUnchanged();
});

test('完整仓库和已显式准备 blob 的 partial clone 保持验证语义', (t) => {
  const data = fixture(t);
  const document = data.document();
  const complete = data.run('validate', document, data.source);
  assert.equal(complete.status, 0, complete.stdout);
  // 显式本地写入对象模拟用户提前准备；校验本身不负责补取。
  assert.equal(data.git(data.partial, 'hash-object', '-w', path.join(data.source, 'source.js')), data.blob);
  const hydrated = data.run('deliver', document);
  assert.equal(hydrated.status, 0, hydrated.stdout);
  assert.equal(hydrated.receipt.evidence.verified, true);
  assert.equal(hydrated.receipt.evidence.revision, data.revision);
  const html = fs.readFileSync(hydrated.output, 'utf8');
  const evidence = JSON.parse(html.match(/id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(evidence.nodes[document.node.id][0].href, `${repository}/blob/${data.revision}/source.js#L1`);
  data.assertUnchanged();
});

function replaceSpawn(t, intercept) {
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => intercept(command, args, options, original);
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawnSync = original; syncBuiltinESMExports(); });
}

test('批量回退与旧 Git 都使用禁止 transport 的子进程环境', (t) => {
  const data = fixture(t);
  const calls = [];
  replaceSpawn(t, (command, args, options, original) => {
    if (command !== 'git') return original(command, args, options);
    assert.ok(!args.includes('--no-lazy-fetch'), '兼容不支持新版全局参数的 Git');
    if (args.includes('cat-file') || args.includes('show')) calls.push(args);
    if (args.includes('--batch-check')) return { status: 1, stdout: Buffer.alloc(0) };
    // 模拟忽略 GIT_NO_LAZY_FETCH 的旧 Git；协议白名单仍必须阻止 transport。
    const env = { ...options.env, GIT_EXEC_PATH: data.env.GIT_EXEC_PATH, ARCHIFY_TEST_REMOTE_TRACE: data.env.ARCHIFY_TEST_REMOTE_TRACE };
    delete env.GIT_NO_LAZY_FETCH;
    return original(command, args, { ...options, env });
  });
  assert.throws(() => verifyRepositoryEvidence('architecture', data.document().diagram, data.partial),
    (error) => error.archifyDiagnostics?.[0].code === 'repository-evidence/file-missing');
  assert.ok(calls.some((args) => args.includes('--batch-check')));
  assert.ok(calls.some((args) => args.includes('-t')));
  data.assertUnchanged();
});

for (const mode of ['revision', '--batch-check', '--batch', 'show']) {
  test(`${mode} 读取超时立即返回专用诊断，不继续重试或建议安装 Git`, (t) => {
    const data = fixture(t);
    const calls = [];
    replaceSpawn(t, (command, args, options, original) => {
      if (command !== 'git') return original(command, args, options);
      calls.push(args);
      if (mode === 'show' && args.includes('--batch')) return { status: 1, stdout: Buffer.alloc(0) };
      const selected = mode === 'revision' ? args.includes('-e') : args.includes(mode);
      if (!selected) return original(command, args, options);
      assert.equal(options.timeout, 10000);
      assert.equal(options.killSignal, 'SIGKILL');
      return { status: null, signal: 'SIGKILL', error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
    });
    assert.throws(() => verifyRepositoryEvidence('architecture', data.document().diagram, data.source), (error) => {
      const diagnostic = error.archifyDiagnostics?.[0];
      assert.equal(diagnostic?.code, 'repository-evidence/git-timeout');
      assert.equal(diagnostic.evidence.timeoutMs, 10000);
      assert.doesNotMatch(diagnostic.supportedFixes.join(' '), /install Git/);
      return true;
    });
    const last = calls.at(-1);
    assert.ok(mode === 'revision' ? last.includes('-e') : last.includes(mode), '超时后不得进入回退读取');
  });
}

test('真实挂起的读取子进程在 10 秒后被强制终止', { timeout: 30000 }, (t) => {
  const data = fixture(t);
  const calls = [];
  let stalled;
  replaceSpawn(t, (command, args, options, original) => {
    if (command !== 'git') return original(command, args, options);
    calls.push(args);
    if (!args.includes('--batch-check')) return original(command, args, options);
    // 原样使用生产读取选项；20 秒自退仅防止移除生产超时时测试永久挂起。
    stalled = original(process.execPath, ['-e', `
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      setTimeout(() => process.exit(88), 20000);
    `], options);
    return stalled;
  });
  assert.throws(() => verifyRepositoryEvidence('architecture', data.document().diagram, data.source),
    (error) => error.archifyDiagnostics?.[0].code === 'repository-evidence/git-timeout');
  assert.equal(stalled.error?.code, 'ETIMEDOUT');
  assert.equal(stalled.signal, 'SIGKILL');
  assert.ok(calls.at(-1).includes('--batch-check'), '真实超时后不得继续逐项读取');
  assert.throws(() => process.kill(stalled.pid, 0), (error) => error.code === 'ESRCH');
});
