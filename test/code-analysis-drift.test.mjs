import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { driftFixture } from './helpers/code-analysis-drift-fixture.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
