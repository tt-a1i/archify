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
const { extractFacts, loadConfig, mergeConfig } = await load('lib/analysis.mjs');
const { buildQuestion } = await load('lib/explain.mjs');
const { schemaErrors } = await load('extract/shared/schema.mjs');
function fixture(t, files, config = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-python-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text);
  }
  return { root, facts: extractFacts(root, { language: 'py', config }).facts, entry: 'entry.py', question: 'Where is the source definition?' };
}
const selected = args => buildQuestion({ ...args, symbol: 'chosen' }).calls;

test('Python BOM decoding keeps fresh entry and imported target coordinates aligned', t => {
  const args = fixture(t, { 'entry.py': '\ufefffrom helper import work\ndef chosen(): return work()\n', 'helper.py': '\ufeffdef work(): return 1\n' });
  const calls = selected(args); assert.equal(calls.coverage, 'available');
  assert.deepEqual(calls.records[0].targetNavigation.location, { file: 'helper.py', name: 'work', line: 1, column: 1 });
  fs.writeFileSync(path.join(args.root, 'helper.py'), '\ufeffdef work(): return 2\n');
  const changed = selected(args).records[0].targetNavigation;
  assert.equal(changed.status, 'changed'); assert.equal(changed.location, null);
});

test('Python call inventory, direct alias targets, async definition and known zero', t => {
  const args = fixture(t, { 'entry.py': 'from helper import work as alias\ndef local(): pass\nasync def task(): pass\ndef chosen():\n    local()\n    alias()\n    task()\n    obj.method()\n    factory()()\n', 'helper.py': 'def work(): pass\n' });
  assert.equal(args.facts.callModel, 'python-lexical-v2'); assert.equal(args.facts.repository.adapterRevision, 13);
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
  const calls = selected(args); assert.equal(calls.coverage, 'available'); assert.equal(calls.total, 6);
  assert.deepEqual(calls.records.map(r => r.fact.resolution), ['same-file-function', 'imported-function', 'same-file-function', ...Array(3).fill('unresolved')]);
  assert.deepEqual(calls.records[1].targetNavigation.location, { file: 'helper.py', name: 'work', line: 1, column: 1 });
  assert.ok(calls.records.every(r => JSON.stringify(r.fact) === JSON.stringify(args.facts.calls[r.factIndex])));
  const zero = buildQuestion({ ...args, symbol: 'local' }).calls; assert.equal(zero.coverage, 'available'); assert.equal(zero.total, 0);
});

test('Python measures an if inside else deeper than elif', t => {
  const { facts } = fixture(t, { 'entry.py': `def nested(a, b):
    if a: return 1
    else:
        if b: return 2
def sibling(a, b):
    if a: return 1
    elif b: return 2
` });
  assert.deepEqual(facts.functions.map(f => [f.name, f.nesting]), [['nested', 2], ['sibling', 1]]);
});

test('Python Jedi fills captured declaration targets while retaining lexical and parse coverage', {
  skip: process.env.ARCHIFY_TEST_PYTHON_JEDI !== '1' && 'set ARCHIFY_TEST_PYTHON_JEDI=1 with Jedi in BAUIFY_PYTHON',
}, t => {
  const config = mergeConfig(loadConfig(), { python: { jedi: true }, exclude: ['**/hidden.py'] });
  const args = fixture(t, {
    'entry.py': `from forwarded import helper
from models import Worker
from hidden import Hidden
def local(): pass
def chosen(worker: Worker, hidden: Hidden):
    local()
    helper()
    "😀"; worker.run()
    hidden.run()
    Worker()
`,
    'forwarded.py': 'from base import helper\n',
    'base.py': 'def helper(): pass\n',
    'models.py': 'class Worker:\n    async def run(self): pass\n',
    'hidden.py': 'from models import Worker as Hidden\n',
    'fallback.py': `from models import Worker
def local(): pass
def chosen(worker: Worker, value):
    match value:
        case 0: local()
    worker.run()
def unaffected(worker: Worker):
    worker.run()
`,
    'module-match.py': `from models import Worker
match 0:
    case 0: pass
def unaffected(worker: Worker):
    worker.run()
`,
    'pattern-shadow.py': `from models import Worker
def chosen(worker: Worker, value):
    match value:
        case worker:
            worker.run()
`,
  }, config);
  assert.equal(args.facts.callModel, 'python-lexical-v3');
  assert.match(args.facts.repository.adapter, /\+jedi@[^+]+\+parso@/);
  assert.equal(args.facts.parse_errors, undefined);
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
  const calls = selected(args);
  assert.equal(calls.coverage, 'available');
  assert.deepEqual(calls.records.map(r => r.fact.resolution), [
    'same-file-function', 'imported-function', 'python-jedi-declaration', 'unresolved', 'unresolved',
  ]);
  assert.deepEqual(calls.records[2].targetNavigation.location, { file: 'models.py', name: 'run', line: 2, column: 5 });
  assert.deepEqual(args.facts.calls.filter(c => c.file === 'fallback.py').map(c => c.resolution), [
    'same-file-function', 'python-jedi-declaration', 'python-jedi-declaration',
  ]);
  assert.equal(args.facts.calls.find(c => c.file === 'module-match.py').target.file, 'models.py');
  assert.equal(args.facts.calls.find(c => c.file === 'pattern-shadow.py').resolution, 'unresolved');
  assert.ok(schemaErrors('raw-facts', { ...args.facts, callModel: 'python-lexical-v2' })
    .some(e => e.message.includes('Python Jedi source model')));
  fs.writeFileSync(path.join(args.root, 'models.py'), 'class Worker:\n    async def run(self): return 1\n');
  assert.equal(selected(args).records[2].targetNavigation.status, 'changed');
});

test('Python Jedi recovers enum class method declarations without treating enum members as functions', {
  skip: process.env.ARCHIFY_TEST_PYTHON_JEDI !== '1' && 'set ARCHIFY_TEST_PYTHON_JEDI=1 with Jedi in BAUIFY_PYTHON',
}, t => {
  const config = mergeConfig(loadConfig(), { python: { jedi: true } });
  const { facts } = fixture(t, {
    'entry.py': `import status
def chosen():
    status.Status.accepts(200)
    status.Status.OK()
`,
    'status.py': `from enum import IntEnum
class Status(IntEnum):
    OK = 200
    @classmethod
    def accepts(cls, code: int) -> bool: return code == 200
`,
  }, config);
  const calls = facts.calls.filter(c => c.file === 'entry.py');
  assert.deepEqual(calls.map(c => c.target), [
    { file: 'status.py', name: 'accepts', line: 5, column: 5 },
    undefined,
  ]);
});

test('Python Jedi follows unique cross-module callable exports', {
  skip: process.env.ARCHIFY_TEST_PYTHON_JEDI !== '1' && 'set ARCHIFY_TEST_PYTHON_JEDI=1 with Jedi in BAUIFY_PYTHON',
}, t => {
  // Pyright findDefinitions.functions covers both an alias and a factory export.
  const config = mergeConfig(loadConfig(), { python: { jedi: true } });
  const { facts } = fixture(t, {
    'entry.py': `import api
def chosen(holder: api.Holder):
    api.direct()
    api.created()
    api.ambiguous()
    holder.direct()
`,
    'api.py': `import impl
import other
direct = impl.direct
created = impl.make()
def choose(flag: bool):
    return impl.ambiguous if flag else other.ambiguous
ambiguous = choose(unknown)
class Holder:
    def __init__(self):
        self.direct = impl.direct
`,
    'impl.py': `def direct(): pass
def make():
    def created(): pass
    return created
def ambiguous(): pass
`,
    'other.py': 'def ambiguous(): pass\n',
  }, config);
  assert.deepEqual(facts.calls.filter(c => c.file === 'entry.py').map(c => c.target), [
    { file: 'impl.py', name: 'direct', line: 1, column: 1 },
    { file: 'impl.py', name: 'created', line: 3, column: 5 },
    undefined,
    undefined,
  ]);
});

test('Python snapshots type inputs and retains project source targets', {
  skip: process.env.ARCHIFY_TEST_PYTHON_JEDI !== '1' && 'set ARCHIFY_TEST_PYTHON_JEDI=1 with Jedi in BAUIFY_PYTHON',
}, t => {
  const config = mergeConfig(loadConfig(), {
    python: { jedi: true, extraPaths: ['components'], declarations: { dependency: 'inputs/dependency.pyi' } },
    exclude: ['**/inputs/**'],
  });
  const { root, facts } = fixture(t, {
    'entry.py': `import factory
import dependency
from extras import Extra
def chosen(extra: Extra):
    factory.build("Worker").run()
    dependency.build().run()
    extra.run()
`,
    'model.py': 'class Worker:\n    def run(self): pass\n',
    'factory.py': 'import importlib\ndef build(name): return getattr(importlib.import_module("model"), name)()\n',
    'factory.pyi': 'from model import Worker\ndef build(name: str) -> Worker: ...\n',
    'inputs/dependency.pyi': 'from model import Worker\ndef build() -> Worker: ...\n',
    'components/extras.py': 'class Extra:\n    def run(self): pass\n',
  }, config);
  const targets = facts.calls.filter(c => c.file === 'entry.py' && c.target?.name === 'run').map(c => c.target);
  assert.deepEqual(targets, [
    { file: 'model.py', name: 'run', line: 2, column: 5 },
    { file: 'model.py', name: 'run', line: 2, column: 5 },
    { file: 'components/extras.py', name: 'run', line: 2, column: 5 },
  ]);
  assert.deepEqual(facts.languageScope.stubs.map(s => s.file), ['factory.pyi']);
  assert.deepEqual(facts.languageScope.declarations.map(s => s.file), ['dependency.pyi']);
  assert.ok(facts.files.every(f => f.path.endsWith('.py')));
  fs.appendFileSync(path.join(root, 'inputs', 'dependency.pyi'), '# Updated declaration input\n');
  const after = extractFacts(root, { language: 'py', config }).facts;
  assert.notEqual(after.repository.snapshotId, facts.repository.snapshotId);
  assert.deepEqual(after.calls, facts.calls);
});

test('Python target profile selects platform declarations and checks grammar version', {
  skip: process.env.ARCHIFY_TEST_PYTHON_JEDI !== '1' && 'set ARCHIFY_TEST_PYTHON_JEDI=1 with Jedi in BAUIFY_PYTHON',
}, t => {
  const config = mergeConfig(loadConfig(), { python: { jedi: true, targetPlatform: 'Windows', targetVersion: '3.8' } });
  const { root, facts } = fixture(t, {
    'entry.py': `import sys
if sys.platform == "win32":
    def platform_work(): return "windows"
else:
    def platform_work(): return "posix"
def chosen(): return platform_work()
if unknown:
    def optional_work(): return 1
else:
    optional_work = None
def optional(): return optional_work()
`,
    'version.py': 'def newer(value):\n    match value:\n        case 0: return 0\n',
  }, config);
  assert.equal(facts.calls.find(c => c.file === 'entry.py').target.line, 3);
  assert.equal(facts.calls.find(c => c.file === 'entry.py' && c.line === 11).target.name, 'optional_work');
  assert.equal(facts.parse_errors[0].path, 'version.py');
  assert.match(facts.files.find(f => f.path === 'entry.py').sourceText, /sys\.platform/);
  const linux = extractFacts(root, { language: 'py', config: mergeConfig(config, { python: { targetPlatform: 'Linux' } }) }).facts;
  assert.equal(linux.calls.find(c => c.file === 'entry.py').target.line, 5);
});

test('Python resolves receiver evidence while preserving ambiguity and shadowed guards', {
  skip: process.env.ARCHIFY_TEST_PYTHON_JEDI !== '1' && 'set ARCHIFY_TEST_PYTHON_JEDI=1 with Jedi in BAUIFY_PYTHON',
}, t => {
  const config = mergeConfig(loadConfig(), { python: { jedi: true } });
  const { facts } = fixture(t, { 'entry.py': `from typing import Callable, Generator
class Base:
    def run(self): pass
class Task(Base):
    def run(self): pass
class Recorder:
    def record(self, callback: Callable[[Task], None]): pass
    def add(self): self.record(lambda task: task.run())
def from_yield() -> Generator[int, Task, None]:
    task = yield 1
    task.run()
def narrowed(items: list[Base]):
    selected = [item for item in items if isinstance(item, Task)]
    return [item.run() for item in selected]
def shadowed(value: Base, *, isinstance):
    if isinstance(value, Task):
        value.run()
def rebound(value: Base):
    if isinstance(value, Task):
        value = Base(); value.run()
def ambiguous(value: Base | Task):
    value.run()
` }, config);
  const methods = facts.calls.filter(c => c.target?.name === 'run');
  assert.deepEqual(methods.map(c => [c.line, c.target.line]), [[8, 5], [11, 5], [14, 5], [17, 3], [20, 3]]);
});

test('Python unsupported/rebound/conditional/decorated/long-reexport/class targets stay inventoried', t => {
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
`, 'helper.py': 'def work(): pass\n', 'reexport.py': 'from forwarded import work\n', 'forwarded.py': 'from helper import work\n' });
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
  assert.equal(captured.calls[0].resolution, 'unresolved'); assert.equal(captured.callModel, 'python-lexical-v2');
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

test('Python one-hop explicit package reexports navigate implementation and retain guards', t => {
  const args = fixture(t, {
    'entry.py': `from api import exposed as alias
from blocked import conditional, rebound, decorated, repeated, deep
from cyclic import loop
from back import work as returned
from star import exposed as wildcard

def chosen():
    alias()
    conditional()
    rebound()
    decorated()
    repeated()
    deep()
    loop()
    returned()
    wildcard()
`,
    'api/__init__.py': 'from impl import work as exposed\n',
    'impl.py': 'def work(): pass\n@decorate\ndef decorated(): pass\n',
    'blocked.py': `if enabled:
    from impl import work as conditional
from impl import work as rebound
rebound = replacement
from impl import decorated
from impl import work as repeated
from impl import work as repeated
from api import exposed as deep
`,
    'cyclic.py': 'from cyclic import loop\n',
    'back.py': 'from entry import chosen as work\n',
    'star.py': 'from impl import work as exposed\nfrom external import *\n',
  });
  const calls = selected(args);
  assert.equal(calls.records[0].fact.resolution, 'imported-function');
  assert.deepEqual(calls.records[0].targetNavigation.location, { file: 'impl.py', name: 'work', line: 1, column: 1 });
  assert.equal(calls.records[0].targetNavigation.status, 'valid');
  assert.ok(calls.records.slice(1).every(r => r.fact.resolution === 'unresolved'));
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
});
