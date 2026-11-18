import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assessPrMateriality, classifyPrFile, preflightPrPack, resolvePrPolicy } from '../archify/pr/preflight.mjs';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preflight-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function repository(t) {
  const root = path.join(scratch(t), process.platform === 'win32' ? 'repo' : 'repo ');
  fs.mkdirSync(root);
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Preflight test');
  git(root, 'config', 'user.email', 'preflight@example.invalid');
  fs.writeFileSync(path.join(root, 'source.js'), 'export const value = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  return root;
}
function commit(root) {
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'changes');
  return git(root, 'rev-parse', 'HEAD');
}
const isolated = { globalRulesFile: false };

test('preflight: uses merge-base and committed head, excluding base-only and dirty changes', (t) => {
  const root = repository(t);
  const original = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(root, 'source.js'), Array.from({ length: 45 }, (_, i) => `export const n${i} = ${i};`).join('\n') + '\n');
  const head = commit(root);
  git(root, 'checkout', 'main');
  fs.writeFileSync(path.join(root, 'base-only.js'), 'base side only\n');
  commit(root);
  git(root, 'checkout', 'feature');
  fs.writeFileSync(path.join(root, 'dirty.js'), 'not committed\n');
  const receipt = preflightPrPack({ repoRoot: root, base: 'main', ...isolated });
  assert.equal(receipt.baseSha, original);
  assert.equal(receipt.headSha, head);
  assert.deepEqual(receipt.stats, { filesChanged: 1, additions: 45, deletions: 1 });
  assert.deepEqual(receipt.files.map((file) => file.path), ['source.js']);
  assert.equal(receipt.materiality.shouldOffer, true);
  assert.deepEqual(receipt.policy, { mode: 'ask', target: 'body', source: 'default' });
});

test('preflight: discovers origin HEAD first, then main/dev/master fallbacks, and fails clearly without a base', (t) => {
  const root = repository(t);
  const options = { repoRoot: root, ...isolated };
  assert.throws(() => preflightPrPack(options), { code: 'pr-preflight/base-required' });
  for (const branch of ['master', 'dev', 'main']) {
    git(root, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
    assert.equal(preflightPrPack(options).baseRef, `origin/${branch}`);
  }
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev');
  assert.equal(preflightPrPack(options).baseRef, 'refs/remotes/origin/dev');
  assert.equal(preflightPrPack(options).materiality.shouldOffer, false);
  assert.throws(() => preflightPrPack({ ...options, head: '--help' }), { code: 'pr-preflight/ref-unavailable' });
});

test('preflight: preserves renamed paths, tabs/newlines, and binary file counts', (t) => {
  const root = repository(t);
  const base = git(root, 'rev-parse', 'HEAD');
  const unusual = process.platform === 'win32' ? 'renamed file.js' : 'renamed\tfile\n.js';
  fs.renameSync(path.join(root, 'source.js'), path.join(root, unusual));
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
  commit(root);
  const receipt = preflightPrPack({ repoRoot: root, base, ...isolated });
  const rename = receipt.files.find((file) => file.path === unusual);
  assert.equal(rename.basePath, 'source.js');
  assert.equal(receipt.files.find((file) => file.path === 'binary.bin').binary, true);
  assert.deepEqual(receipt.stats, { filesChanged: 2, additions: 0, deletions: 0 });
  assert.equal(receipt.materiality.shouldOffer, true, 'unknown binary size must not count as a tiny text change');
});

test('preflight: deterministic classification and materiality thresholds', () => {
  const expected = {
    'docs/guide.md': 'docs', 'README.md': 'docs', 'pnpm-lock.yaml': 'lockfile', 'Cargo.lock': 'lockfile',
    '.github/workflows/test.yml': 'config', 'package.json': 'config', 'vite.config.ts': 'config',
    'test/foo.test.mjs': 'test', 'src/foo.spec.ts': 'test', 'schemas/pack.json': 'schema',
    'protocol.proto': 'schema', 'src/server.ts': 'code',
  };
  for (const [file, category] of Object.entries(expected)) assert.equal(classifyPrFile(file), category, file);
  const assess = (categories, lines, binary = false) => assessPrMateriality(categories.map((category) => ({ category, binary })), { additions: lines, deletions: 0 });
  assert.equal(assess(['docs', 'lockfile'], 1000).shouldOffer, false);
  assert.equal(assess(['test'], 1000).shouldOffer, false);
  assert.equal(assess(['config', 'docs', 'lockfile'], 1000).shouldOffer, false);
  const renames = Array.from({ length: 3 }, () => ({ category: 'code', basePath: 'old.js', binary: false, additions: 0, deletions: 0 }));
  assert.equal(assessPrMateriality(renames, { additions: 0, deletions: 0 }).shouldOffer, false);
  assert.equal(assessPrMateriality(renames.map((file) => ({ ...file, binary: true })), { additions: 0, deletions: 0 }).shouldOffer, true);
  assert.equal(assess(['code', 'code'], 39).shouldOffer, false);
  assert.equal(assess(['code', 'code'], 40).shouldOffer, true);
  assert.equal(assess(['code', 'code', 'code'], 3).shouldOffer, true);
  assert.equal(assess(['schema'], 40).shouldOffer, true);
  assert.equal(assess(['schema'], 1).shouldOffer, true);
  assert.equal(assess(['schema', 'test'], 2).shouldOffer, true);
  assert.equal(assessPrMateriality([{ category: 'schema', basePath: 'old.sql', binary: false, additions: 0, deletions: 0 }, { category: 'docs', additions: 1, deletions: 0 }], { additions: 1, deletions: 0 }).shouldOffer, false);
  assert.equal(assess(['code'], 0, true).shouldOffer, true);
});

test('preflight: policy sources obey explicit field overrides and repository proactive cap', (t) => {
  const root = scratch(t);
  const global = path.join(scratch(t), 'AGENTS.md');
  fs.writeFileSync(path.join(root, 'CONTRIBUTING.md'), '[archify pr: on-demand, target=comment]\n');
  const repoAgents = path.join(root, 'AGENTS.md');
  fs.writeFileSync(repoAgents, '[archify pr: proactive]\n');
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, ...isolated }), { mode: 'ask', target: 'comment', source: repoAgents });
  fs.writeFileSync(global, '[archify pr: proactive, target=body]\n');
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, globalRulesFile: global }), { mode: 'proactive', target: 'body', source: global });
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, globalRulesFile: global, target: 'comment' }), { mode: 'proactive', target: 'comment', source: 'cli' });
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, globalRulesFile: global, mode: 'on-demand' }), { mode: 'on-demand', target: 'body', source: 'cli' });
  assert.equal(resolvePrPolicy({ repoRoot: root, ...isolated, mode: 'proactive' }).mode, 'proactive');
  assert.equal(resolvePrPolicy({ repoRoot: root, globalRulesFile: repoAgents }).mode, 'ask');
  const symlink = path.join(path.dirname(global), 'linked.md');
  if (process.platform !== 'win32') {
    fs.symlinkSync(repoAgents, symlink);
    assert.equal(resolvePrPolicy({ repoRoot: root, globalRulesFile: symlink }).mode, 'ask');
  }
  assert.throws(() => resolvePrPolicy({ repoRoot: root, mode: 'automatic' }), { code: 'pr-preflight/invalid-policy' });
  assert.throws(() => resolvePrPolicy({ repoRoot: root, target: 'issue' }), { code: 'pr-preflight/invalid-policy' });
});

test('preflight: initialization pins revisions and stats without overwriting existing content', (t) => {
  const root = repository(t);
  const output = path.join(scratch(t), 'nested', 'draft');
  const receipt = preflightPrPack({ repoRoot: root, base: 'main', init: output, ...isolated });
  const draft = JSON.parse(fs.readFileSync(receipt.initialized.manifest, 'utf8'));
  for (const key of ['baseRef', 'headRef', 'baseSha', 'headSha', 'stats']) assert.deepEqual(draft[key], receipt[key]);
  assert.equal(receipt.initialized.requiresAuthoring, true);
  assert.deepEqual(draft.views, []);
  const before = fs.readFileSync(receipt.initialized.manifest);
  assert.throws(() => preflightPrPack({ repoRoot: root, base: 'main', init: output, ...isolated }), { code: 'pr-preflight/init-exists' });
  assert.deepEqual(fs.readFileSync(receipt.initialized.manifest), before);
});

test('preflight: policy examples cannot grant proactive consent', (t) => {
  const root = scratch(t);
  const global = path.join(scratch(t), 'personal.md');
  fs.writeFileSync(global, [
    'Example: [archify pr: proactive]',
    '```md', '[archify pr: proactive]', '```',
    '~~~', '[archify pr: proactive, target=comment]', '~~~',
    '`[archify pr: proactive]`',
    '<!--', '[archify pr: proactive]', '-->',
    '    [archify pr: proactive]', '\t[archify pr: proactive]',
    '<!--', '```', '-->',
    '```', '<!--', '[archify pr: proactive]', '```',
    '<!-- hidden ``` -->',
    '~~~', '<!--', '~~~',
    '```<!-- example info', '[archify pr: proactive]', '```',
    '<!-- unclosed comment', '[archify pr: proactive]', '-->',
  ].join('\n'));
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, globalRulesFile: global }), { mode: 'ask', target: 'body', source: 'default' });
  fs.appendFileSync(global, '\n[archify pr: on-demand, target=comment]\n');
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, globalRulesFile: global }), { mode: 'on-demand', target: 'comment', source: global });
  assert.equal(classifyPrFile('db/schema.sql'), 'schema');
  assert.equal(classifyPrFile('db/migrations/001.sql'), 'schema');
});

test('preflight: discovers personal rules for each host and HOME or USERPROFILE', (t) => {
  const root = scratch(t);
  const home = scratch(t);
  const locations = {
    codex: ['.codex', 'AGENTS.md'], claude: ['.claude', 'CLAUDE.md'],
    cursor: ['.cursor', 'AGENTS.md'], devin: ['.config', 'devin', 'AGENTS.md'],
  };
  for (const [host, parts] of Object.entries(locations)) {
    const file = path.join(home, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[archify pr: proactive, target=comment]\n');
    for (const homeVariable of ['HOME', 'USERPROFILE']) {
      const policy = resolvePrPolicy({ repoRoot: root, env: { [homeVariable]: home, ARCHIFY_AGENT: host } });
      assert.deepEqual(policy, { mode: 'proactive', target: 'comment', source: file });
    }
  }
  for (const [host, marker] of Object.entries({ codex: 'CODEX_THREAD_ID', claude: 'CLAUDECODE', cursor: 'CURSOR_AGENT', devin: 'DEVIN_SESSION_ID' })) {
    assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home, [marker]: 'test' } }).source, path.join(home, ...locations[host]));
  }
  assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home } }).mode, 'ask', 'unknown host must not borrow proactive consent');
});

test('preflight: selected host wins conflicts; missing host policy respects other on-demand rules', (t) => {
  const root = scratch(t);
  const home = scratch(t);
  const codex = path.join(home, '.codex', 'AGENTS.md');
  const claude = path.join(home, '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.mkdirSync(path.dirname(claude), { recursive: true });
  fs.writeFileSync(codex, '[archify pr: proactive, target=body]\n');
  fs.writeFileSync(claude, '[archify pr: on-demand, target=comment]\n');
  assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home, ARCHIFY_AGENT: 'codex' } }).mode, 'proactive');
  assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home } }).mode, 'on-demand');
  assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home, ARCHIFY_AGENT: 'cursor' } }).mode, 'on-demand');
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, globalRulesFile: claude, env: { HOME: home, ARCHIFY_AGENT: 'codex' } }), { mode: 'on-demand', target: 'comment', source: claude });
  assert.equal(resolvePrPolicy({ repoRoot: root, mode: 'ask', env: { HOME: home } }).mode, 'ask');
  fs.writeFileSync(claude, '[archify pr: ask, target=comment]\n');
  assert.deepEqual(resolvePrPolicy({ repoRoot: root, env: { HOME: home } }), { mode: 'ask', target: 'body', source: 'global-conflict' });
  fs.writeFileSync(codex, 'No PR policy here.\n');
  fs.writeFileSync(claude, '[archify pr: on-demand]\n');
  assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home, ARCHIFY_AGENT: 'codex' } }).mode, 'on-demand');
});

test('preflight: custom agent configuration directories are honored', (t) => {
  const root = scratch(t);
  const home = scratch(t);
  for (const [host, variable, parts] of [
    ['codex', 'CODEX_HOME', ['AGENTS.md']],
    ['claude', 'CLAUDE_CONFIG_DIR', ['CLAUDE.md']],
    ['devin', 'XDG_CONFIG_HOME', ['devin', 'AGENTS.md']],
  ]) {
    const directory = scratch(t);
    const file = path.join(directory, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[archify pr: on-demand]\n');
    assert.equal(resolvePrPolicy({ repoRoot: root, env: { HOME: home, ARCHIFY_AGENT: host, [variable]: directory } }).source, file);
  }
});

test('preflight: fallback targets resolve within the winning mode after proactive is capped', (t) => {
  const root = scratch(t);
  const home = scratch(t);
  const codex = path.join(home, '.codex', 'AGENTS.md');
  const claude = path.join(home, '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.mkdirSync(path.dirname(claude), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '[archify pr: ask, target=comment]\n');
  const resolve = () => resolvePrPolicy({ repoRoot: root, env: { HOME: home } });
  fs.writeFileSync(codex, '[archify pr: proactive, target=comment]\n');
  fs.writeFileSync(claude, '[archify pr: ask, target=comment]\n');
  assert.deepEqual(resolve(), { mode: 'ask', target: 'comment', source: codex });
  fs.writeFileSync(codex, '[archify pr: proactive, target=body]\n');
  assert.deepEqual(resolve(), { mode: 'ask', target: 'body', source: 'global-conflict' });
  fs.writeFileSync(codex, '[archify pr: on-demand]\n');
  assert.deepEqual(resolve(), { mode: 'on-demand', target: 'comment', source: codex }, 'losing ask target must not override inherited repository target');
  fs.writeFileSync(claude, '[archify pr: on-demand, target=body]\n');
  assert.deepEqual(resolve(), { mode: 'on-demand', target: 'body', source: codex }, 'explicit target wins over an unspecified target');
  fs.writeFileSync(codex, '[archify pr: on-demand, target=comment]\n');
  assert.deepEqual(resolve(), { mode: 'on-demand', target: 'body', source: 'global-conflict' });
  fs.writeFileSync(codex, '[archify pr: ask]\n');
  fs.writeFileSync(claude, '[archify pr: proactive]\n');
  assert.deepEqual(resolve(), { mode: 'ask', target: 'comment', source: codex });
});
