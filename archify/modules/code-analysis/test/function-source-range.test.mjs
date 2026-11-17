// JS/TS function positions are captured source coordinates. They locate an
// implementation; they do not choose which function runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { measureFunctions } from '../extract/ts/functions.mjs';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildGraph } from '../lib/analysis.mjs';
import { buildAtlas } from '../overlay/atlas.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const VUE = {
  base: '38aadf5e7e0ba9daf13889655b129a6a7a8cadd7',
  head: '2a4fc32d1561125582a7fe3b9bf2815d6974c814',
};

function sourceFile(name, text) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function contains(range, line, column) {
  const afterStart = line > range.line || (line === range.line && column >= range.column);
  const beforeEnd = line < range.endLine || (line === range.endLine && column < range.endColumn);
  return afterStart && beforeEnd;
}

function ownerAt(records, line, column) {
  return records.filter(record => contains(record.sourceRange, line, column))
    .sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
}

test('JS/TS source ranges locate the Vue prefix implementation without claiming runtime dispatch', () => {
  for (const [side, commit, expected] of [
    ['base', VUE.base, { line: 21, endLine: 26, complexity: 2, nesting: 0, outer: 22 }],
    ['head', VUE.head, { line: 21, endLine: 33, complexity: 6, nesting: 2, outer: 22 }],
  ]) {
    const file = path.join(os.tmpdir(), `archify-vue-${side}.ts`);
    const text = fs.readFileSync(new URL(`./fixtures/vue-2532-${side}-processExpression.ts`, import.meta.url), 'utf8');
    fs.writeFileSync(file, text);
    const records = measureFunctions(sourceFile(file, text), 'transformExpression.ts');
    const prefix = records.find(record => record.qualname === 'processExpression.<locals>.prefix');
    const outer = records.find(record => record.qualname === 'processExpression');
    assert.equal(prefix.complexity, expected.complexity, commit);
    assert.equal(prefix.nesting, expected.nesting);
    assert.equal(outer.complexity, expected.outer);
    assert.deepEqual(
      { line: prefix.sourceRange.line, endLine: prefix.sourceRange.endLine },
      { line: expected.line, endLine: expected.endLine },
    );
    const body = text.split(/\n/).findIndex(line => line.includes('hasOwn(bindingMetadata, raw)'));
    const bodyColumn = text.split(/\n/)[body].indexOf('hasOwn') + 1;
    const after = text.split(/\n/).findIndex(line => line.includes('bail on parens'));
    assert.equal(ownerAt(records, body + 1, bodyColumn).qualname, prefix.qualname);
    assert.equal(ownerAt(records, after + 1, 3).qualname, outer.qualname);
    const slice = text.slice(
      text.split(/\n/).slice(0, prefix.line - 1).join('\n').length + 1 + prefix.sourceRange.column - 1,
      text.split(/\n/).slice(0, prefix.endLine - 1).join('\n').length + 1 + prefix.sourceRange.endColumn - 1,
    );
    assert.equal(createHash('sha256').update(slice).digest('hex'), prefix.sourceRange.sha256);
    fs.rmSync(file, { force: true });
  }
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
    assert.equal(facts.repository.adapterRevision, 23);
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
