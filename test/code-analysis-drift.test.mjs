import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { driftFixture } from './helpers/code-analysis-drift-fixture.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareArchitectureDrift } from '../archify/modules/code-analysis/lib/architecture-drift.mjs';

test('custom groups make an omitted path with a misleading directory inconclusive', () => {
  const ir = { components: [{ id: 'app' }, { id: 'ui' }, { id: 'db' }], connections: [] };
  const graph = { repository: { root: '.' }, grouping: { groups: ['app'] }, modules: [
    { id: 'app', path: 'app' }, { id: 'ui', path: 'src/ui' }, { id: 'db', path: 'src/db' },
  ], fileModules: { 'src/app/main.ts': 'app', 'src/ui/other.ts': 'ui', 'src/db/module.ts': 'db', 'src/ui/shared.ts': 'app' } };
  const map = { app: ['app'], ui: ['ui'], db: ['db'] };
  const facts = { repository: { adapter: 'ts', adapterRevision: 1 }, files: [
    { path: 'src/ui/shared.ts', sourceText: "import '../db/module';" },
  ], imports: [], unresolved: 0 };
  const base = { facts, graph, omitted: new Map([['src/ui/shared.ts', 'link']]), resolutionInputs: new Map() };
  const head = { facts: { ...facts, imports: [{ kind: 'static', from: 'src/ui/shared.ts', to: 'src/db/module.ts', resolved: true, line: 1 }] }, graph, omitted: new Map(), resolutionInputs: new Map() };
  const result = compareArchitectureDrift({ base, head, ir, map });
  assert.equal(result.edges[0].state, 'inconclusive');
  assert.ok(result.edges[0].reasons.includes('skipped-tree-entries-changed'));
});

test('CLI compares pinned directed pairs; the authored IR and dirty working tree are unchanged', t => {
  const f = driftFixture(t);
  const { p, out, result } = f.analyze();
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.pins, { base: f.base, head: f.head });
  assert.deepEqual(result.edges.map(({ from, to, state }) => [from, to, state]), [
    ['app', 'db', 'new-undeclared'],
    ['app', 'lib', 'new-declared'],
    ['app', 'ui', 'previously-observed'],
  ]);
  assert.deepEqual(result.edges[0].head.locations.map(x => [x.path, x.line, x.target]), [['src/app/main.ts', 2, 'src/db/module.ts']]);
  assert.match(result.edges[0].head.locations[0].text, /import \{ db \}/);
  assert.ok(!p.stdout.includes('onlyWorkingTree'));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.ir)), f.doc);
  assert.equal(fs.readFileSync(path.join(f.repo, 'src/app/main.ts'), 'utf8'), 'export const onlyWorkingTree = true;\n');
  const report = fs.readFileSync(path.join(out, 'architecture-drift.html'), 'utf8');
  assert.match(report, /data-node-id="app"/);
  assert.match(report, /Architecture drift/);
});

test('pinned PR workbench exposes a new mapped dependency and its head import witness', t => {
  const f = driftFixture(t);
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const out = path.join(f.dir, 'review');
  const run = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', f.repo,
    '--base', f.base, '--head', f.head, '--ir', f.ir, '--map', f.map,
    '--language', 'ts', '--out', out], {
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1', GIT_ALLOW_PROTOCOL: '' },
    encoding: 'utf8', windowsHide: true, timeout: 90000,
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const receipt = JSON.parse(run.stdout);
  const html = fs.readFileSync(receipt.html, 'utf8');
  const data = JSON.parse(html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/u)[1]);
  const { pullRequest: review, snippets } = data;
  assert.deepEqual([review.baseSHA, review.headSHA], [f.base, f.head]);
  const edge = review.componentDrift.edges.find(item => item.from === 'app' && item.to === 'db');
  assert.equal(edge?.state, 'new-undeclared');
  assert.deepEqual(edge.base, []);
  assert.deepEqual(edge.head, [{ path: 'src/app/main.ts', line: 2 }]);
  assert.match(snippets['src/app/main.ts'].lines[1], /import \{ db \}/u);
  assert.match(review.markdown, /Pinned head · src\/app\/main\.ts:2/u);
  assert.doesNotMatch(review.markdown, /import \{ db \}/u);
});

test('cannot treat an affected parse failure or ambiguous component as absence', t => {
  const f = driftFixture(t);
  f.write('src/app/main.ts', 'export const broken = ;\n');
  const broken = f.commit();
  const parse = f.analyze({ b: broken, output: 'parse' });
  assert.equal(parse.p.status, 0, parse.p.stdout + parse.p.stderr);
  assert.equal(parse.result.coverage.base.scopedParseErrors, 1);
  assert.equal(parse.result.summary.newUndeclared, 0);
  assert.ok(parse.result.edges.find(e => e.to === 'db').reasons.includes('affected-parse-errors'));

  fs.writeFileSync(f.map, JSON.stringify({ ...f.mapping, lib: ['src-lib', 'src-db'] }));
  const ambiguous = f.analyze({ output: 'ambiguous' });
  assert.equal(ambiguous.p.status, 0, ambiguous.p.stdout + ambiguous.p.stderr);
  assert.equal(ambiguous.result.summary.newUndeclared, 0);
  assert.equal(ambiguous.result.coverage.head.ambiguousModules, 1);
  assert.ok(ambiguous.result.edges.find(e => e.to === 'db').reasons.includes('unverified-edge-evidence'));
});

test('verify-drift binds the downloaded pair and distinguishes removal from an affected parse failure', t => {
  const f = driftFixture(t);
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const original = f.analyze();
  assert.equal(original.p.status, 0, original.p.stdout);
  const html = fs.readFileSync(path.join(original.out, 'architecture-drift.html'), 'utf8');
  const data = JSON.parse(html.match(/id="architecture-drift-data">([^<]*)<\/script>/u)[1]);
  const task = data.edges.find(edge => edge.from === 'app' && edge.to === 'db').task;
  assert.match(task.id, /^DRIFT-[a-f0-9]{16}$/);
  const taskFile = path.join(f.dir, 'task.json');
  const checksFile = path.join(f.dir, 'checks.json');
  const report = sample => path.join(sample.out, 'architecture-drift.json');
  const verify = (followup, ...args) => {
    const run = spawnSync(process.execPath, [cli, 'code-analysis', 'verify-drift', report(original),
      '--task', taskFile, '--after', report(followup), ...args], { encoding: 'utf8', timeout: 30_000 });
    return { status: run.status, value: JSON.parse(run.stdout) };
  };
  fs.writeFileSync(taskFile, JSON.stringify(task));
  f.write('src/app/main.ts', "import { ui } from '../ui/module.js';\nexport const app = ui;\n");
  const removed = f.analyze({ b: f.head, h: f.commit(), output: 'removed', extra: ['--from-report', report(original)] });
  assert.equal(removed.p.status, 0, removed.p.stdout);
  assert.deepEqual(verify(removed).value.analysis, { outcome: 'not-observed-at-head', reasons: [] });
  const contradictory = { out: path.join(f.dir, 'contradictory') };
  fs.mkdirSync(contradictory.out);
  const badReport = structuredClone(removed.result);
  const stale = badReport.edges.find(edge => edge.from === 'app' && edge.to === 'db');
  stale.head.locations = stale.base.locations;
  fs.writeFileSync(report(contradictory), JSON.stringify(badReport));
  assert.deepEqual(verify(contradictory).value.analysis, { outcome: 'inconclusive', reasons: ['unexpected-followup-observation'] });
  const template = verify(removed, '--checks-template').value;
  fs.writeFileSync(checksFile, JSON.stringify({ ...template, checks: [{ name: 'Unit tests', status: 'passed' }] }));
  assert.deepEqual(verify(removed, '--checks', checksFile).value.projectChecks, {
    status: 'reported-not-independently-verified', checks: [{ name: 'Unit tests', status: 'passed' }],
  });

  f.write('src/app/main.ts', "import { db } from '../db/module.js';\nexport const app = db;\n");
  const retained = f.analyze({ b: f.head, h: f.commit(), output: 'still-observed' });
  assert.equal(retained.p.status, 0, retained.p.stdout);
  assert.equal(verify(retained).value.analysis.outcome, 'still-observed');
  f.write('src/app/additional.ts', 'export const broken = ;\n');
  const partial = f.analyze({ b: f.head, h: f.commit(), output: 'partial' });
  assert.equal(partial.p.status, 0, partial.p.stdout);
  assert.ok(partial.result.edges.find(edge => edge.from === 'app' && edge.to === 'db').head.count > 0);
  assert.deepEqual(verify(partial).value.analysis, { outcome: 'inconclusive', reasons: ['affected-parse-errors'] });

  f.write('src/app/main.ts', 'export const broken = ;\n');
  const broken = f.analyze({ b: f.head, h: f.commit(), output: 'broken' });
  assert.equal(broken.p.status, 0, broken.p.stdout);
  assert.equal(verify(broken).value.analysis.outcome, 'inconclusive');
  assert.ok(verify(broken).value.analysis.reasons.includes('affected-parse-errors'));
  assert.equal(verify(broken, '--checks', checksFile).value.diagnostics[0].code, 'drift-verification/invalid-checks');
  assert.equal(verify(original).value.diagnostics[0].code, 'drift-verification/mismatched-followup');
  fs.writeFileSync(taskFile, JSON.stringify({ ...task, pair: ['app', 'ui'] }));
  assert.equal(verify(removed).value.diagnostics[0].code, 'drift-verification/invalid-task');

  const config = path.join(f.dir, 'changed-config.json');
  fs.writeFileSync(config, JSON.stringify({ exclude: ['**/unrelated/**'] }));
  const wrongConfig = f.analyze({ b: f.head, h: removed.result.pins.head, output: 'different-config',
    extra: ['--from-report', report(original), '--config', config] });
  assert.equal(wrongConfig.p.status, 2, wrongConfig.p.stdout);
  assert.equal(wrongConfig.result.diagnostics[0].code, 'drift-verification/mismatched-followup');
  assert.equal(fs.existsSync(wrongConfig.out), false);
});

test('rejects a noncommit pin, an unrelated IR pin and an existing destination without writing', t => {
  const f = driftFixture(t);
  const invalid = f.analyze({ b: 'HEAD', output: 'unresolved' });
  assert.equal(invalid.p.status, 2);
  assert.equal(invalid.result.diagnostics[0].code, 'drift/invalid-pin');
  assert.ok(!fs.existsSync(invalid.out));
  const existingOut = path.join(f.dir, 'occupied');
  fs.mkdirSync(existingOut);
  const sentinel = path.join(existingOut, 'architecture-drift.html');
  fs.writeFileSync(sentinel, 'unchanged');
  const collision = f.analyze({ output: 'occupied' });
  assert.equal(collision.p.status, 2);
  assert.equal(collision.result.diagnostics[0].code, 'drift/output-invalid');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
  f.doc.meta.repository = { revision: 'f'.repeat(40) };
  fs.writeFileSync(f.ir, JSON.stringify(f.doc));
  const mismatch = f.analyze({ output: 'mismatch' });
  assert.equal(mismatch.p.status, 2);
  assert.equal(mismatch.result.diagnostics[0].code, 'drift/ir-pin-mismatch');
  assert.ok(!fs.existsSync(mismatch.out));
});


test('pinned review marks new drift inconclusive when a skipped symlink changes target', t => {
  const f = driftFixture(t);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', f.repo, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const target = path.join(f.dir, 'link-target');
  fs.writeFileSync(target, '../ui/module.ts');
  const first = git('hash-object', '-w', target);
  git('reset', '--hard', f.base);
  git('update-index', '--add', '--cacheinfo', '120000', first, 'src/app/link');
  git('commit', '-qm', 'base symlink');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(target, '../db/module.ts');
  const second = git('hash-object', '-w', target);
  f.write('src/app/main.ts', "import { db } from '../db/module.js';\nexport const app = db;\n");
  git('add', 'src/app/main.ts');
  git('update-index', '--cacheinfo', '120000', second, 'src/app/link');
  git('commit', '-qm', 'head symlink');
  const head = git('rev-parse', 'HEAD');
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', f.repo, '--base', base, '--head', head, '--ir', f.ir, '--map', f.map, '--language', 'ts', '--out', path.join(f.dir, 'link-review')], { encoding: 'utf8', timeout: 90000, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(JSON.parse(result.stdout).html, 'utf8');
  const data = JSON.parse(html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/u)[1]);
  const edge = data.pullRequest.componentDrift.edges.find(item => item.from === 'app' && item.to === 'db');
  assert.equal(edge.state, 'inconclusive');
  assert.ok(edge.reasons.includes('skipped-tree-entries-changed'));
  assert.notEqual(data.pullRequest.omitted.base[0].oid, data.pullRequest.omitted.head[0].oid);
});


test('pinned diagram delivery disables updates without an ambient offline flag', t => {
  const f = driftFixture(t);
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const preload = path.join(f.dir, 'capture-delivery.cjs');
  const observed = path.join(f.dir, 'delivery-env.txt');
  const requests = path.join(f.dir, 'requests.txt');
  fs.writeFileSync(preload, `const fs = require('node:fs');\nif (process.argv.includes('deliver')) fs.writeFileSync(process.env.TEST_DELIVERY_ENV, String(process.env.ARCHIFY_UPDATE_CHECK_DISABLED));\nglobalThis.fetch = async () => { fs.appendFileSync(process.env.TEST_REQUESTS, 'fetch\\n'); throw new Error('network forbidden'); };\n`);
  const env = { ...process.env, NODE_OPTIONS: `--require="${preload.split(path.sep).join('/')}"`, TEST_DELIVERY_ENV: observed, TEST_REQUESTS: requests, GIT_ALLOW_PROTOCOL: '', HOME: f.dir, USERPROFILE: f.dir, LOCALAPPDATA: f.dir, XDG_CACHE_HOME: f.dir };
  delete env.ARCHIFY_UPDATE_CHECK_DISABLED;
  const run = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', f.repo, '--base', f.base, '--head', f.head, '--ir', f.ir, '--map', f.map, '--language', 'ts', '--out', path.join(f.dir, 'offline-check')], { env, encoding: 'utf8', windowsHide: true, timeout: 90000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(fs.readFileSync(observed, 'utf8'), '1', 'the spawned delivery process itself receives the disabled update flag');
  assert.equal(fs.existsSync(requests), false, 'no fetch is attempted');
});


test('rejecting a nonexistent pinned scope preserves the previously delivered diagram and report', t => {
  const f = driftFixture(t);
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const out = path.join(f.dir, 'scope-retry');
  const prepare = extra => spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', f.repo, '--base', f.base, '--head', f.head, '--ir', f.ir, '--map', f.map, '--language', 'ts', '--out', out, ...extra], { encoding: 'utf8', timeout: 90000, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  const first = prepare([]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const receipt = JSON.parse(first.stdout);
  const diagram = fs.readFileSync(receipt.diagram);
  const report = fs.readFileSync(receipt.html);
  fs.writeFileSync(f.ir, JSON.stringify({ ...f.doc, meta: { ...f.doc.meta, title: 'Changed diagram title' } }));
  const rejected = prepare(['--scope', 'missing-directory']);
  assert.equal(rejected.status, 2, rejected.stdout + rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).diagnostics[0].code, 'pr/scope-invalid');
  assert.deepEqual(fs.readFileSync(receipt.diagram), diagram);
  assert.deepEqual(fs.readFileSync(receipt.html), report);
});


test('a changed skipped link in an unrelated mapped component does not hide a complete new relation', t => {
  const f = driftFixture(t);
  const git = (...args) => { const p = spawnSync('git', ['-C', f.repo, ...args], { encoding: 'utf8' }); assert.equal(p.status, 0, p.stderr); return p.stdout.trim(); };
  const target = path.join(f.dir, 'target');
  fs.writeFileSync(target, '../app/main.ts'); const first = git('hash-object', '-w', target);
  git('reset', '--hard', f.base); git('update-index', '--add', '--cacheinfo', '120000', first, 'src/ui/link'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(target, '../lib/module.ts'); const second = git('hash-object', '-w', target);
  f.write('src/app/main.ts', "import { db } from '../db/module.js';\nexport const app = db;\n");
  git('add', 'src/app/main.ts'); git('update-index', '--cacheinfo', '120000', second, 'src/ui/link'); git('commit', '-qm', 'head');
  const head = git('rev-parse', 'HEAD');
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', f.repo, '--base', base, '--head', head, '--ir', f.ir, '--map', f.map, '--language', 'ts', '--out', path.join(f.dir, 'unrelated-review')], { encoding: 'utf8', timeout: 90000, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(JSON.parse(result.stdout).html, 'utf8');
  const data = JSON.parse(html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/u)[1]);
  const edge = data.pullRequest.componentDrift.edges.find(item => item.from === 'app' && item.to === 'db');
  assert.equal(edge.state, 'new-undeclared');
  assert.ok(!edge.reasons.includes('skipped-tree-entries-changed'));
});
