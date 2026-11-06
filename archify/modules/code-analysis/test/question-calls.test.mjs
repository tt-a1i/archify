import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { extractFacts } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { measureFunctions } from '../extract/ts/functions.mjs';

function fixture(t, source, entry = 'entry.mjs') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-question-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, entry), source);
  const { facts } = extractFacts(root, { language: 'ts' });
  return { root, entry, facts, question: 'Where should I read next?', symbol: 'chosen' };
}

test('orientation retains exact facts, excludes same-line neighbours, and includes nested source calls without claiming caller identity', (t) => {
  const source = 'function helper() { return () => {}; }\nfunction before() { helper(); } function chosen() { helper()(); function nested() { helper(); } } function after() { helper(); }';
  const args = fixture(t, source); const calls = buildQuestion(args).calls;
  assert.equal(calls.coverage, 'available'); assert.equal(calls.total, 3);
  assert.equal(calls.included, 3); assert.equal(calls.omitted, 0);
  assert.ok(calls.limitations.some((s) => /nested functions and closures/.test(s)));
  assert.deepEqual(calls.records.map((r) => r.fact.resolution), ['same-file-function', 'unresolved', 'same-file-function']);
  const [inner, outer] = calls.records.map((r) => r.fact);
  assert.equal(inner.column, outer.column); assert.ok(inner.endColumn < outer.endColumn);
  assert.equal(outer.reason, 'unsupported-callee'); assert.equal(outer.target, undefined);
  for (const r of calls.records) assert.deepEqual(r.fact, args.facts.calls[r.factIndex]);
  assert.equal(calls.selection.range.column, source.split('\n')[1].indexOf('function chosen') + 1);
  assert.equal(calls.selection.range.endColumn, source.split('\n')[1].indexOf(' function after') + 1);
  const whole = buildQuestion({ ...args, symbol: undefined }).calls;
  assert.equal(whole.total, 5); assert.equal(whole.selection.kind, 'entry-file');
});

test('bounded output counts the selected range and does not confuse omitted unknown calls with absent calls', (t) => {
  const args = fixture(t, 'function helper() {}\nfunction chosen() {\n' + 'helper();\n'.repeat(41) + 'unknown();\n}\nfunction neighbour() { helper(); }');
  const calls = buildQuestion(args).calls;
  assert.equal(calls.total, 42); assert.equal(calls.included, 40); assert.equal(calls.omitted, 2);
  assert.equal(calls.records.length, 40); assert.equal(calls.coverage, 'available');
  assert.ok(calls.limitations.some((s) => /omitted records/.test(s)));
  const empty = fixture(t, 'function chosen() {}', 'empty.cjs');
  const zero = buildQuestion(empty).calls;
  assert.equal(zero.coverage, 'available'); assert.equal(zero.total, 0); assert.equal(zero.omitted, 0);
});

test('missing and unknown call models never report a known zero, even when adapter revisions overlap', (t) => {
  const args = fixture(t, 'function chosen() { missing(); }');
  for (const revision of [6, 1, 2, 7]) {
    for (const model of [undefined, 'unknown-model']) {
      const facts = structuredClone(args.facts);
      facts.repository.adapterRevision = revision;
      facts.calls = [];
      if (model === undefined) delete facts.callModel;
      else facts.callModel = model;
      const calls = buildQuestion({ ...args, facts }).calls;
      assert.equal(calls.coverage, 'unavailable');
      assert.equal(calls.reason, 'unsupported-or-unknown-call-model');
      assert.equal(calls.bindingCoverage, 'unknown');
      assert.equal(calls.total, null); assert.equal(calls.omitted, null); assert.deepEqual(calls.records, []); assert.equal(calls.selection.range, null);
    }
  }
  const facts = structuredClone(args.facts); delete facts.calls;
  assert.equal(buildQuestion({ ...args, facts }).calls.reason, 'calls-not-captured');
  const absent = buildQuestion({ ...args, facts: null }).calls;
  assert.equal(absent.coverage, 'unavailable'); assert.equal(absent.total, null);
});

test('entry freshness and parse errors gate all calls and same-file targets', (t) => {
  const args = fixture(t, 'function helper() {} function chosen() { helper(); }');
  fs.appendFileSync(path.join(args.root, args.entry), '\n// changed');
  let calls = buildQuestion(args).calls;
  assert.equal(calls.reason, 'entry-changed'); assert.equal(calls.selection.range, null); assert.deepEqual(calls.records, []);
  fs.writeFileSync(path.join(args.root, args.entry), 'function chosen() { missing(); }\nfunction broken( {');
  const facts = extractFacts(args.root, { language: 'ts' }).facts;
  calls = buildQuestion({ ...args, facts }).calls;
  assert.equal(calls.reason, 'entry-parse-errors'); assert.equal(calls.total, null); assert.deepEqual(calls.records, []);
});

test('unmatched exact source range is unavailable rather than falling back to captured line span', (t) => {
  const args = fixture(t, 'function chosen() { missing(); }\n// trailing');
  args.facts.functions[0].endLine = 2;
  const calls = buildQuestion(args).calls;
  assert.equal(calls.reason, 'function-range-unavailable'); assert.equal(calls.selection.range, null); assert.deepEqual(calls.records, []);
});

test('optional node observation preserves all default function measurements and naming', () => {
  const source = ts.createSourceFile('names.js', 'const obj = { method() { const f = () => 1; } }; class C { method() {} }\nfunction outer() { function inner() {} }\nrun(() => 1);', ts.ScriptTarget.Latest, true);
  const observed = [];
  const plain = measureFunctions(source, 'names.js');
  const withCallback = measureFunctions(source, 'names.js', (record, node) => observed.push({ record, start: node.getStart(source), end: node.getEnd() }));
  assert.deepEqual(withCallback, plain);
  assert.equal(observed.length, plain.length);
  assert.ok(observed.every((o) => o.start < o.end));
  assert.ok(plain.some((f) => f.qualname === 'outer.<locals>.inner'));
});

test('explicit call models carry binding coverage independently of extraction revision', (t) => {
  const args = fixture(t, 'function declared() {}\nconst arrow = () => {};\nfunction chosen() { declared(); arrow()(); }');
  assert.equal(args.facts.callModel, 'js-ts-lexical-v2');
  args.facts.repository.adapterRevision += 1;
  const current = buildQuestion(args).calls;
  assert.equal(current.coverage, 'available');
  assert.equal(current.provenance.callModel, args.facts.callModel);
  assert.equal(current.bindingCoverage, 'declarations-const-initializers-relative-named-imports-and-default-functions');
  assert.equal(current.records.filter((r) => r.fact.resolution === 'same-file-function-initializer').length, 1);
  const v1 = structuredClone(args.facts); v1.callModel = 'js-ts-lexical-v1'; v1.repository.adapterRevision = 8;
  const compatible = buildQuestion({ ...args, facts: v1 }).calls;
  assert.equal(compatible.coverage, 'available');
  assert.equal(compatible.provenance.callModel, 'js-ts-lexical-v1');
  assert.equal(compatible.bindingCoverage, 'declarations-const-initializers-and-relative-named-imports');
  assert.deepEqual(compatible.records, current.records);
  const older = structuredClone(args.facts); delete older.callModel;
  const historical = buildQuestion({ ...args, facts: older }).calls;
  assert.equal(historical.coverage, 'unavailable'); assert.equal(historical.total, null);
  assert.deepEqual(historical.records, []);
  fs.appendFileSync(path.join(args.root, args.entry), '\n// stale');
  assert.deepEqual(buildQuestion(args).calls.records, []);
  assert.deepEqual(buildQuestion({ ...args, facts: older }).calls.records, []);
});
