// JS/TS function positions are captured source coordinates. They locate an
// implementation; they do not choose which function runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from '../vendor/typescript.cjs';
import { measureFunctions } from '../extract/ts/functions.mjs';
import { REVISION } from '../extract/ts/index.mjs';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildGraph } from '../lib/analysis.mjs';
import { buildAtlas } from '../overlay/atlas.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { rangeText } from '../core/source-range.mjs';

const VUE = {
  base: '38aadf5e7e0ba9daf13889655b129a6a7a8cadd7',
  head: '2a4fc32d1561125582a7fe3b9bf2815d6974c814',
};

function sourceFile(name, text) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

test('JS/TS source ranges record the Vue prefix implementation without changing outer measurements', () => {
  for (const [side, commit, expected] of [
    ['base', VUE.base, { line: 21, endLine: 26, complexity: 2, nesting: 0, outer: 22 }],
    ['head', VUE.head, { line: 21, endLine: 33, complexity: 6, nesting: 2, outer: 22 }],
  ]) {
    const text = fs.readFileSync(new URL(`./fixtures/vue-2532-${side}-processExpression.ts`, import.meta.url), 'utf8');
    const records = measureFunctions(sourceFile('transformExpression.ts', text), 'transformExpression.ts');
    const prefix = records.find(record => record.qualname === 'processExpression.<locals>.prefix');
    const outer = records.find(record => record.qualname === 'processExpression');
    assert.equal(prefix.complexity, expected.complexity, commit);
    assert.equal(prefix.nesting, expected.nesting);
    assert.equal(outer.complexity, expected.outer);
    assert.deepEqual(
      { line: prefix.sourceRange.line, endLine: prefix.sourceRange.endLine },
      { line: expected.line, endLine: expected.endLine },
    );
    const slice = text.slice(
      text.split(/\n/).slice(0, prefix.line - 1).join('\n').length + 1 + prefix.sourceRange.column - 1,
      text.split(/\n/).slice(0, prefix.endLine - 1).join('\n').length + 1 + prefix.sourceRange.endColumn - 1,
    );
    assert.equal(createHash('sha256').update(slice).digest('hex'), prefix.sourceRange.sha256);
  }
});

test('JS/TS ranges use UTF-16 columns and retain CRLF bytes in the decoded source hash', () => {
  const outerText = 'export function outer() {\r\n  const inner = () => "🧭"; return inner();\r\n}';
  const text = '// header 😀\r\nconst icon = "😀"; ' + outerText + '\r\n';
  const records = measureFunctions(sourceFile('unicode.ts', text), 'unicode.ts');
  const outer = records.find(fn => fn.name === 'outer');
  const inner = records.find(fn => fn.name === 'inner');
  assert.deepEqual(outer.sourceRange, {
    line: 2, column: 20, endLine: 4, endColumn: 2,
    sha256: createHash('sha256').update(outerText).digest('hex'),
  });
  assert.deepEqual(inner.sourceRange, {
    line: 3, column: 17, endLine: 3, endColumn: 27,
    sha256: createHash('sha256').update('() => "🧭"').digest('hex'),
  });
});

test('same names stay separate, bodiless overloads are omitted, and dynamic calls have no target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-function-range-'));
  const text = [
    'export function run(flag: boolean) { return flag ? 1 : 2; }',
    'export const run = (flag: boolean) => { return flag ? 1 : 0; };',
    'export function overloaded(value: string): string;',
    'export function overloaded(value: number): number;',
    'export function overloaded(value: string | number) { return value; }',
    'declare const callbacks: Record<string, () => number>;',
    'export function outer(name: string) { return callbacks[name](); }',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'sample.ts'), text);
  try {
    const { facts } = extractFacts(dir, { language: 'ts', config: loadConfig(null) });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    assert.equal(facts.repository.adapterRevision, REVISION);
    const named = facts.functions.filter(fn => fn.name === 'run');
    assert.equal(named.length, 2);
    assert.deepEqual(named.map(fn => fn.line), [1, 2]);
    assert.equal(facts.functions.some(fn => fn.name === 'overloaded' && fn.line < 5), false);
    const implementation = facts.functions.find(fn => fn.name === 'overloaded');
    assert.equal(implementation.line, 5);
    assert.equal(facts.calls.some(call => call.resolution !== 'unresolved' && call.line === 7), false);
    const atlas = buildAtlas({ facts, graph: buildGraph(facts), findings: [] });
    const shown = atlas.functions.find(fn => fn[1] === 'run' && fn[2] === 1);
    assert.equal(shown[7].column, 1);
    assert.equal(shown[7].endColumn, text.split('\n')[0].length + 1);
    const legacy = structuredClone(facts);
    legacy.repository.adapterRevision = 23;
    legacy.callModel = 'js-ts-lexical-v5';
    delete legacy.languageScope;
    for (const fn of legacy.functions) delete fn.syntaxKind;
    assert.deepEqual(schemaErrors('raw-facts', legacy), [], 'revision 23 facts from dev predate SDK and syntax-kind provenance');
    for (const fn of legacy.functions) delete fn.sourceRange;
    assert.ok(schemaErrors('raw-facts', legacy).some(error => error.path === '/functions/0/sourceRange'),
      'revision 23 must reject functions without a captured range');
    legacy.repository.adapterRevision = 22;
    assert.deepEqual(schemaErrors('raw-facts', legacy), [], 'old facts remain schema-valid');
    const oldAtlas = buildAtlas({ facts: legacy, graph: buildGraph(legacy), findings: [] });
    assert.deepEqual(oldAtlas.functions.map(fn => fn.slice(0, 7)), atlas.functions.map(fn => fn.slice(0, 7)));
    assert.ok(oldAtlas.functions.every(fn => fn[7] === null), 'old records remain readable without column metadata');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('JS/TS facts with Unicode line separators pass captured-range validation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-unicode-lines-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, separator] of [['line', '\u2028'], ['paragraph', '\u2029']]) {
    fs.writeFileSync(path.join(dir, name + '.ts'), 'const x = 1;' + separator + 'export function f() { return 1; }');
  }
  const { facts } = extractFacts(dir, { language: 'ts', config: loadConfig(null) });
  assert.deepEqual(facts.functions.map(fn => fn.sourceRange.line), [2, 2]);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const text = 'x\u2028fn', range = { line: 2, column: 1, endLine: 2, endColumn: 3 };
  assert.equal(rangeText(text, range, 'ts'), 'fn');
  assert.equal(rangeText(text, range, 'py'), null, 'TS separators do not change Python line policy or reuse its cache');
  assert.equal(rangeText(text, range, 'ts'), 'fn');
});
