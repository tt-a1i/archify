import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
const base = process.env.ARCHIFY_CALL_TEST_MODULE;
const load = relative => import(base ? pathToFileURL(path.join(base, relative)) : new URL(`../${relative}`, import.meta.url));
const { extractFacts } = await load('lib/analysis.mjs');
const { buildQuestion } = await load('lib/explain.mjs');
const { schemaErrors } = await load('extract/shared/schema.mjs');
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-python-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text);
  }
  return { root, facts: extractFacts(root, { language: 'py' }).facts, entry: 'entry.py', question: 'Where is the source definition?' };
}
const selected = args => buildQuestion({ ...args, symbol: 'chosen' }).calls;

test('Python call inventory, direct alias targets, async definition and known zero', t => {
  const args = fixture(t, { 'entry.py': 'from helper import work as alias\ndef local(): pass\nasync def task(): pass\ndef chosen():\n    local()\n    alias()\n    task()\n    obj.method()\n    factory()()\n', 'helper.py': 'def work(): pass\n' });
  assert.equal(args.facts.callModel, 'python-lexical-v1'); assert.equal(args.facts.repository.adapterRevision, 9);
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
  const calls = selected(args); assert.equal(calls.coverage, 'available'); assert.equal(calls.total, 6);
  assert.deepEqual(calls.records.map(r => r.fact.resolution), ['same-file-function', 'imported-function', 'same-file-function', ...Array(3).fill('unresolved')]);
  assert.deepEqual(calls.records[1].targetNavigation.location, { file: 'helper.py', name: 'work', line: 1, column: 1 });
  assert.ok(calls.records.every(r => JSON.stringify(r.fact) === JSON.stringify(args.facts.calls[r.factIndex])));
  const zero = buildQuestion({ ...args, symbol: 'local' }).calls; assert.equal(zero.coverage, 'available'); assert.equal(zero.total, 0);
});

test('Python unsupported/rebound/conditional/decorated/reexport/class targets stay inventoried', t => {
  const args = fixture(t, { 'entry.py': `from helper import work as alias
from reexport import work as indirect
if enabled:
    from helper import work as conditional
@deco
def decorated(): pass
def changed(): pass
changed = other
def duplicate(): pass
def duplicate(): pass
class Target: pass
def chosen():
    alias()
    indirect()
    conditional()
    decorated()
    changed()
    duplicate()
    Target()
    obj.method()
`, 'helper.py': 'def work(): pass\n', 'reexport.py': 'from helper import work\n' });
  assert.deepEqual(selected(args).records.map(r => r.fact.resolution), ['imported-function', ...Array(7).fill('unresolved')]);
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
  const star = fixture(t, { 'entry.py': 'from helper import *\ndef helper(): pass\ndef chosen(): helper()\n', 'helper.py': 'def work(): pass\n' });
  assert.equal(selected(star).records[0].fact.resolution, 'unresolved');
});

test('Python class/comprehension/header/nested scopes use their actual lexical contexts', t => {
  const args = fixture(t, { 'entry.py': `def helper(): pass
class C:
    helper = 1
    helper()
    def method(self): helper()
    values = [helper() for x in xs]
def header(x=helper()):
    helper = 2
    helper()
def nested():
    def inside(): helper()
def comps():
    [helper() for helper in xs]
    [x for x in helper()]
    [helper() for x in xs]
def annotated(x: helper()): pass
` });
  const calls = new Map(args.facts.calls.map(c => [c.line, c]));
  for (const line of [4, 9, 13, 16]) assert.equal(calls.get(line).resolution, 'unresolved', `line ${line}`);
  for (const line of [5, 6, 7, 11, 14, 15]) assert.equal(calls.get(line).resolution, 'same-file-function', `line ${line}`);
  assert.equal(buildQuestion({ ...args, symbol: 'nested' }).calls.total, 1);
});

test('Python scope bindings are collected before resolving parameter/store/import/catch/match/walrus/nonlocal uses', t => {
  const args = fixture(t, { 'entry.py': `def helper(): pass
def parameter(helper): helper()
def later():
    helper()
    helper = 1
def augmented():
    helper()
    helper += 1
def deletion():
    helper()
    del helper
def imported():
    helper()
    import helper
def caught():
    helper()
    try: pass
    except Error as helper: pass
def matched(x):
    helper()
    match x:
        case {'x': helper}: pass
def walrus():
    helper()
    [x for x in xs if (helper := x)]
def outer():
    helper = 1
    def inner():
        nonlocal helper
        helper()
def globals_case():
    global helper
    helper()
` });
  assert.equal(args.facts.calls.length, 10); assert.ok(args.facts.calls.every(c => c.resolution === 'unresolved'));
});

test('Python UTF-16 and exact span hashes preserve BMP/astral text, CRLF and encoded sources', t => {
  const source = '# coding: utf-8\r\ndef helper(): pass\r\ndef chosen():\r\n    "é😀"; helper(\r\n        "x"\r\n    )\r\n';
  const args = fixture(t, { 'entry.py': source }); const call = args.facts.calls[0];
  assert.equal(call.line, 4); assert.equal(call.column, 12); assert.equal(call.endLine, 6); assert.equal(call.endColumn, 6);
  const fn = args.facts.functions.find(f => f.name === 'chosen');
  assert.equal(fn.sourceRange.sha256, createHash('sha256').update(source.slice(source.indexOf('def chosen'), source.lastIndexOf(')') + 1)).digest('hex'));
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []); assert.equal(selected(args).total, 1);
  const encoded = fixture(t, { 'entry.py': Buffer.from('# coding: latin-1\ndef chosen():\n    "é"; unknown()\n', 'latin1') });
  assert.equal(selected(encoded).total, 1);
});

test('Python saved range proof and imported navigation have independent freshness guards', t => {
  const args = fixture(t, { 'entry.py': 'from helper import work\ndef chosen(): work()\n', 'helper.py': 'def work(): pass\n' });
  assert.equal(selected(args).records[0].targetNavigation.status, 'valid');
  fs.appendFileSync(path.join(args.root, 'helper.py'), '# changed\n'); assert.equal(selected(args).records[0].targetNavigation.status, 'changed');
  fs.rmSync(path.join(args.root, 'helper.py')); assert.notEqual(selected(args).records[0].targetNavigation.status, 'valid');
  const fn = args.facts.functions[0], saved = structuredClone(fn.sourceRange);
  for (const change of [{ sha256: '0'.repeat(64) }, { column: 999 }, { endLine: 999 }, { endColumn: 1 }]) {
    fn.sourceRange = { ...saved, ...change }; assert.equal(selected(args).reason, 'function-range-unavailable'); assert.ok(schemaErrors('raw-facts', args.facts).length);
  }
  delete fn.sourceRange; assert.equal(selected(args).reason, 'function-range-unavailable'); fn.sourceRange = saved;
  fs.appendFileSync(path.join(args.root, 'entry.py'), '# changed\n'); assert.equal(selected(args).reason, 'entry-changed');
});

test('Python old/unknown/spoofed call models and parse failures cannot claim known zero', async t => {
  const args = fixture(t, { 'entry.py': 'def chosen(): pass\n' });
  for (const model of [undefined, 'python-future', 'js-ts-lexical-v2']) {
    args.facts.callModel = model; assert.equal(selected(args).coverage, 'unavailable'); assert.equal(selected(args).total, null);
  }
  args.facts.callModel = 'python-lexical-v1'; args.facts.repository.language = 'java'; args.facts.repository.adapter = 'java-parser@3';
  const { questionCalls } = await load('lib/question-calls.mjs');
  assert.equal(questionCalls({ facts: args.facts, entry: { file: 'entry.py', factsStatus: 'valid', parseErrors: [] } }).coverage, 'unavailable');
  const broken = fixture(t, { 'entry.py': 'def chosen(:\n    missing()\n' }); assert.deepEqual(broken.facts.calls, []); assert.equal(buildQuestion(broken).calls.reason, 'entry-parse-errors');
});

test('Python definition ranges exclude decorator calls but include physically contained defaults and nested source', t => {
  const args = fixture(t, { 'entry.py': 'def helper(): pass\n@helper()\ndef chosen(x=helper()):\n    def nested(y=helper()): helper()\n' });
  assert.equal(args.facts.calls.length, 4);
  const calls = selected(args); assert.equal(calls.total, 3); assert.equal(calls.selection.range.line, 3);
  assert.ok(calls.records.every(r => r.fact.target?.name === 'helper'));
});

test('Python target coordinates and parse errors cannot yield trusted navigation', t => {
  const args = fixture(t, { 'entry.py': 'from helper import work\ndef chosen(): work()\n', 'helper.py': 'def work(): pass\n' });
  args.facts.calls[0].target.column += 1;
  assert.ok(schemaErrors('raw-facts', args.facts).length);
  assert.equal(selected(args).records[0].targetNavigation.reason, 'target-range-unavailable');
  args.facts.calls[0].target.column -= 1;
  args.facts.parse_errors = [{ path: 'helper.py', message: 'captured parse error' }];
  assert.equal(selected(args).records[0].targetNavigation.status, 'parse-error');
  const broken = fixture(t, { 'entry.py': 'from helper import work\ndef chosen(): work()\n', 'helper.py': 'def work(: pass\n' });
  assert.equal(selected(broken).records[0].fact.resolution, 'unresolved');
});

test('Python class global writers, implicit class cells and private name mangling cannot invent module targets', t => {
  const args = fixture(t, { 'entry.py': `def helper(): pass
def __private(): pass
def __class__(): pass
class C:
    global helper
    helper = other
    def method(self):
        helper()
        __private()
        __class__()
def chosen(): helper()
` });
  assert.equal(args.facts.calls.length, 4); assert.ok(args.facts.calls.every(call => call.resolution === 'unresolved'));
});

test('Python import names use only captured own definitions', t => {
  const args = fixture(t, { 'entry.py': 'from helper import constructor, toString, __proto__\ndef chosen():\n    constructor()\n    toString()\n    __proto__()\n', 'helper.py': 'def __proto__(): pass\n' });
  assert.deepEqual(selected(args).records.map(r => r.fact.resolution), ['unresolved', 'unresolved', 'imported-function']);
});

test('Python external from-import calls stay unresolved and normal check succeeds', t => {
  const args = fixture(t, { 'entry.py': 'from os import getcwd\ndef chosen():\n    return getcwd()\n' });
  assert.equal(args.facts.imports[0].resolved, false);
  const calls = selected(args); assert.equal(calls.total, 1);
  assert.equal(calls.records[0].fact.resolution, 'unresolved'); assert.equal(calls.records[0].fact.target, undefined);
  const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
  const output = path.join(args.root, 'analysis');
  const run = spawnSync(process.execPath, [cli, 'code-analysis', 'check', args.root, '--language', 'py', '--out', output, '--fail-on', 'never', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const captured = JSON.parse(fs.readFileSync(path.join(output, 'raw-facts.json'), 'utf8'));
  assert.equal(captured.calls[0].resolution, 'unresolved'); assert.equal(captured.callModel, 'python-lexical-v1');
});

test('Python captured package and namespace module direct imports use the analyzed directories', t => {
  const args = fixture(t, { 'entry.py': 'from pkg import packaged\nfrom ns.helper import work as alias\ndef chosen():\n    packaged()\n    alias()\n', 'pkg/__init__.py': 'def packaged(): pass\n', 'ns/helper.py': 'def work(): pass\n' });
  assert.deepEqual(selected(args).records.map(r => r.targetNavigation.location), [
    { file: 'pkg/__init__.py', name: 'packaged', line: 1, column: 1 },
    { file: 'ns/helper.py', name: 'work', line: 1, column: 1 },
  ]);
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
});

test('Python generic class bases and keywords use unsupported annotation scope while decorators stay outer', t => {
  const args = fixture(t, { 'entry.py': 'def helper(): return object\n@helper()\nclass Generic[helper](helper(), metaclass=helper()): pass\nclass Ordinary(helper(), metaclass=helper()): pass\n' });
  const [, major, minor] = /^python@(\d+)\.(\d+)/.exec(args.facts.repository.adapter);
  if (+major === 3 && +minor < 12) return t.skip('type parameter syntax requires Python 3.12+');
  assert.deepEqual(args.facts.parse_errors || [], []);
  assert.equal(args.facts.calls.length, 5);
  assert.deepEqual(args.facts.calls.map(call => call.resolution), ['same-file-function', 'unresolved', 'unresolved', 'same-file-function', 'same-file-function']);
});

test('Python function-local explicit imports bind only unique preceding imports in the calling block', t => {
  const args = fixture(t, { 'entry.py': `from helper import handler as top
def chosen():
    from helper import handler as run
    run()
def direct():
    from helper import handler
    handler()
def same_line():
    from helper import handler as run; run()
def parameter(top): top()
def imported_parameter(run):
    from helper import handler as run
    run()
def rebound():
    from helper import handler as run
    run = other
    run()
def later_write():
    from helper import handler as run
    run()
    run = other
def before():
    run()
    from helper import handler as run
def conditional():
    if enabled:
        from helper import handler as run
    run()
def guarded_call():
    from helper import handler as run
    if enabled:
        run()
def closure():
    from helper import handler as run
    def inner(): run()
def header(run=top()):
    from helper import handler as top
    top()
class C:
    from helper import handler as run
    run()
    def method(self):
        from helper import handler as run
        run()
`, 'helper.py': 'def handler(): pass\n' });
  const imported = args.facts.calls.filter(c => c.resolution === 'imported-function');
  assert.deepEqual(imported.map(c => c.line), [4, 7, 9, 32, 36, 38, 44]);
  assert.ok(imported.every(c => JSON.stringify(c.target) === JSON.stringify({ file: 'helper.py', name: 'handler', line: 1, column: 1 })));
  assert.ok(args.facts.calls.filter(c => !imported.includes(c)).every(c => c.resolution === 'unresolved' && !c.target));
  assert.deepEqual(selected(args).records[0].targetNavigation.location, { file: 'helper.py', name: 'handler', line: 1, column: 1 });
  assert.equal(selected(args).records[0].targetNavigation.status, 'valid');
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
});
