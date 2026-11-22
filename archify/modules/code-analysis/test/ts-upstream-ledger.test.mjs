import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PROJECT_CASES, MODULE_CASES, SYNTAX_CASES, DEFINITION_CASES } from './ts-official-cases.mjs';

test('selected upstream observations have a unique reviewed status and executable projection', () => {
  const ledger = JSON.parse(fs.readFileSync(new URL('./ts-upstream-cases.json', import.meta.url), 'utf8'));
  const tests = fs.readFileSync(new URL('./ts-upstream-alignment.test.mjs', import.meta.url), 'utf8');
  assert.match(ledger.upstreamCommit, /^[0-9a-f]{40}$/);
  const ids = new Set(), counts = { 匹配: 0, 待修复: 0, 有意保留差异: 0, 不涉及产品: 0 };
  for (const item of ledger.cases) {
    assert.ok(!ids.has(item.id), `duplicate upstream observation ${item.id}`);
    ids.add(item.id);
    assert.ok(item.upstream && item.options && item.field && item.expected);
    assert.ok(Object.hasOwn(counts, item.status), `unreviewed upstream observation ${item.id}`);
    assert.ok(tests.includes(`test('${item.test}'`), `missing executable projection ${item.id}`);
    counts[item.status] += 1;
  }
  assert.equal(counts.待修复, 0);
  process.stdout.write(`# TypeScript upstream selected observations: ${ids.size}; ${JSON.stringify(counts)}; unreviewed: 0\n`);
});

test('official engine differential probes have unique independent observations', () => {
  const observations = [...PROJECT_CASES, ...MODULE_CASES, ...SYNTAX_CASES, ...DEFINITION_CASES];
  assert.equal(new Set(observations.map(item => item.id)).size, observations.length);
  process.stdout.write(`# TypeScript official peer scenarios: projects ${PROJECT_CASES.length}, modules ${MODULE_CASES.length}, syntax ${SYNTAX_CASES.length}, definitions ${DEFINITION_CASES.length}; total ${observations.length}\n`);
});

test('upstream syntax probe rejects missing fixture directories and empty projections', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-empty-upstream-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runner = fileURLToPath(new URL('./ts-upstream-syntax-probe.mjs', import.meta.url));
  const report = path.join(root, 'report.json');
  const run = () => spawnSync(process.execPath, [runner, root, report], { encoding: 'utf8' });
  fs.mkdirSync(path.join(root, 'tests/cases/compiler'), { recursive: true });
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing required upstream fixture directory: tests\/cases\/conformance/);

  fs.mkdirSync(path.join(root, 'tests/cases/conformance'));
  fs.writeFileSync(path.join(root, 'tests/cases/compiler/types-only.ts'), 'type Example = string;');
  const empty = run();
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No upstream fixtures projected to JavaScript cases/);
  assert.equal(fs.existsSync(report), false);
});
