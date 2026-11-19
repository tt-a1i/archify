import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { driftFixture } from './helpers/code-analysis-drift-fixture.mjs';

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
