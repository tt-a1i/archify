import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { preflight, semanticHash, semanticProjection } from './preflight.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'benchmarks/repair-firstpass-20260921/preflight.mjs');

function diagram({ pinned = false, narrow = false } = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Preflight', quality_profile: 'showcase' },
    components: [
      { id: 'a', type: 'backend', label: 'A', sublabel: narrow ? 'A deliberately long sublabel that needs a wider box' : 'entry', pos: [60, 100], size: [narrow ? 120 : 190, 64] },
      { id: 'b', type: 'backend', label: 'B', sublabel: 'exit', pos: [350, 100], size: [160, 64] },
    ],
    connections: [{ id: 'a-b', from: 'a', to: 'b', label: 'calls', ...(pinned ? { via: [[250, 132]] } : {}) }],
  };
}

function run(t, input) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preflight-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source.json');
  const out = path.join(temp, 'candidate.json');
  fs.writeFileSync(source, JSON.stringify(input, null, 2));
  const before = fs.readFileSync(source);
  const result = spawnSync(process.execPath, [script, source, '--out', out, '--repo-root', root, '--allow-reflow', '--json'], { encoding: 'utf8', timeout: 25_000 });
  return { temp, source, out, before, result, report: JSON.parse(result.stdout) };
}

test('valid source returns byte-identical separate candidate and records baseline', t => {
  const fixture = run(t, diagram());
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  assert.equal(fixture.report.status, 'unchanged');
  assert.equal(fixture.report.attempts.length, 1);
  assert.equal(fixture.report.attempts[0].proposal, 'baseline');
  assert.deepEqual(fs.readFileSync(fixture.source), fixture.before);
  assert.deepEqual(fs.readFileSync(fixture.out), fixture.before);
});

test('accepted geometry repair preserves the semantic projection', t => {
  const original = diagram({ narrow: true });
  const fixture = run(t, original);
  assert.equal(fixture.result.status, 0, `${fixture.result.stderr}\n${fixture.result.stdout}`);
  assert.equal(fixture.report.status, 'accepted');
  const candidate = JSON.parse(fs.readFileSync(fixture.out));
  assert.deepEqual(semanticProjection(candidate), semanticProjection(original));
  assert.equal(semanticHash(candidate), semanticHash(original));
  assert.ok(candidate.components[0].size[0] > original.components[0].size[0]);
  assert.deepEqual(fs.readFileSync(fixture.source), fixture.before);
});

test('pinned controls decline without writing an accepted candidate', t => {
  const fixture = run(t, diagram({ pinned: true }));
  assert.equal(fixture.result.status, 1);
  assert.equal(fixture.report.status, 'declined');
  assert.equal(fixture.report.reason, 'unsupported-input');
  assert.equal(fs.existsSync(fixture.out), false);
  assert.deepEqual(fs.readFileSync(fixture.source), fixture.before);
});

test('invalid endpoints decline before proposal search', t => {
  const input = diagram();
  input.connections[0].to = 'missing';
  const fixture = run(t, input);
  assert.equal(fixture.result.status, 1);
  assert.equal(fixture.report.status, 'declined');
  assert.equal(fixture.report.attempts.length, 0);
  assert.equal(fs.existsSync(fixture.out), false);
});

test('null input declines without attempting semantic hashing', t => {
  const fixture = run(t, null);
  assert.equal(fixture.result.status, 1);
  assert.equal(fixture.report.status, 'declined');
  assert.equal(fixture.report.reason, 'unsupported-input');
  assert.equal(fixture.report.attempts.length, 0);
  assert.equal(fs.existsSync(fixture.out), false);
});

test('out path resolving to the source, including through a symlink, is rejected', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preflight-output-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source.json');
  const alias = path.join(temp, 'source-alias.json');
  const before = Buffer.from(JSON.stringify(diagram(), null, 2));
  fs.writeFileSync(source, before);
  fs.symlinkSync(source, alias);
  for (const out of [source, alias]) {
    const result = spawnSync(process.execPath, [script, source, '--out', out, '--repo-root', root, '--allow-reflow', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.reason, 'unsafe-output-path');
    assert.deepEqual(fs.readFileSync(source), before);
  }
});

test('out path resolving through a hard link is rejected before a repair can overwrite source bytes', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preflight-hard-link-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source.json');
  const alias = path.join(temp, 'source-hard-link.json');
  const before = Buffer.from(JSON.stringify(diagram({ narrow: true }), null, 2));
  fs.writeFileSync(source, before);
  fs.linkSync(source, alias);
  const result = spawnSync(process.execPath, [script, source, '--out', alias, '--repo-root', root, '--allow-reflow', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).reason, 'unsafe-output-path');
  assert.deepEqual(fs.readFileSync(source), before);
});

test('an exhausted preflight budget cannot return a candidate', () => {
  const report = preflight(diagram(), { repoRoot: root, started: Date.now() - 20_000 });
  assert.equal(report.status, 'declined');
  assert.equal('candidate' in report, false);
});

test('desktop readability feedback can widen all secondary-text boxes without changing semantics', t => {
  const input = diagram({ narrow: true });
  // An oversized but valid canvas forces normal showcase validation to report
  // a projected-font defect after the layout pass succeeds.
  input.meta.viewBox = [4_000, 800];
  const fixture = run(t, input);
  assert.equal(fixture.result.status, 1);
  assert.equal(fixture.report.status, 'declined');
  const readabilityAttempt = fixture.report.attempts.find((attempt) => (
    attempt.proposal.includes('readable-secondary')
  ));
  assert.ok(readabilityAttempt, JSON.stringify(fixture.report.attempts.map((attempt) => attempt.proposal)));
  assert.deepEqual(fs.readFileSync(fixture.source), fixture.before);
  assert.equal(fs.existsSync(fixture.out), false);
});
