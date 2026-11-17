import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { extractFacts, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { parsePython } from '../extract/py/analyze.mjs';
import { schemaErrors } from '../schemas/index.mjs';

function fixture(t, files, python) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-python-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
  const capture = () => extractFacts(root, { language: 'py', config: mergeConfig(loadConfig(), python ? { python } : {}) }).facts;
  return { root, capture, facts: capture() };
}
const targetName = (facts, call) => {
  const target = call.target;
  return target && facts.functions.find(fn => fn.file === (target.file || call.file) && fn.line === target.line && fn.sourceRange.column === target.column)?.qualname;
};

test('Python parser uses the chosen language version without any Python executable', t => {
  const { root } = fixture(t, { 'entry.py': 'class Box[T = int]:\n    def read(self):\n        return t"value {1}"\n' });
  const script = `import {extractFacts} from ${JSON.stringify(new URL('../lib/analysis.mjs', import.meta.url).href)}; console.log(JSON.stringify(extractFacts(process.argv[1],{language:'py'}).facts));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8', env: { ...process.env, PATH: '', BAUIFY_PYTHON: '/no-such-python' } });
  assert.equal(run.status, 0, run.stderr);
  const facts = JSON.parse(run.stdout);
  assert.equal(facts.repository.adapter, 'pyright-parser@1.1.414/python-3.14');
  assert.equal(facts.functions[0].qualname, 'Box.read'); assert.equal(facts.parse_errors, undefined);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

const syntax = [
  ['3.8', 'if (n := 1):\n    print(n)\n'],
  ['3.9', 'with (open("a") as a, open("b") as b): pass\n'],
  ['3.10', 'match value:\n    case 1: pass\n'],
  ['3.11', 'try: pass\nexcept* ValueError: pass\n'],
  ['3.12', 'class Box[T]: pass\n'],
  ['3.12', 'type Pair[T] = tuple[T, T]\n'],
  ['3.12', 'data = {"a": 1}\nresult = f"{data["a"]}"\n'],
  ['3.13', 'class Box[T = int]: pass\n'],
  ['3.14', 'result = t"hello {name}"\n'],
  ['3.14', 'try: pass\nexcept ValueError, TypeError: pass\n'],
];
test('Python 3.8–3.14 syntax gates follow language targets, including PEP 701 checker rules', () => {
  for (let minor = 8; minor <= 14; minor++) for (const [minimum, code] of syntax)
    assert.equal(parsePython(code, `3.${minor}`).errors.length > 0, minor < Number(minimum.split('.')[1]), `target 3.${minor}, feature ${minimum}: ${code}`);
  assert.ok(parsePython('result = f"{\'a\\nb\'}"', '3.11').errors.length);
  assert.equal(parsePython('result = f"{\'a\\nb\'}"', '3.12').errors.length, 0);
});
test('Python target selection is recorded and invalid configuration fails before extraction', t => {
  const current = fixture(t, { 'entry.py': 'class Box[T]: pass\n' });
  const older = extractFacts(current.root, { language: 'py', config: mergeConfig(loadConfig(), { python: { targetVersion: '3.11' } }) }).facts;
  assert.ok(older.parse_errors.length); assert.notEqual(older.repository.adapter, current.facts.repository.adapter);
  for (const value of ['3.15', '2.7', 3.14, 'latest']) assert.throws(() => extractFacts(current.root, { language: 'py', config: mergeConfig(loadConfig(), { python: { targetVersion: value } }) }), error => error.diagnostics[0].code === 'extract/python-target-version');
});

test('Python type comments are not executable calls and byte loader arguments remain opaque', t => {
  const { facts } = fixture(t, { 'entry.py': `import importlib
value = 1 # type: helper()
def chosen(value): # type: (helper()) -> helper()
    return importlib.import_module(b"dep")
`, 'dep.py': '' });
  assert.equal(facts.calls.length, 1);
  assert.equal(facts.imports.filter(edge => edge.kind === 'dynamic').length, 1);
  assert.equal(facts.imports.find(edge => edge.kind === 'dynamic').specifier, '<computed>');
});

test('Python long arithmetic and boolean chains retain import guards without exhausting the JS stack', t => {
  const { facts } = fixture(t, { 'entry.py': `def arithmetic(value):\n    return ${Array(3500).fill('value').join(' + ')}\ndef chosen(value):\n    return __import__("first") and ${Array(3500).fill('value').join(' and ')} and __import__("last")\n` });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(facts.functions.find(fn => fn.name === 'arithmetic').complexity, 1);
  assert.equal(facts.functions.find(fn => fn.name === 'chosen').complexity, 3502);
  assert.deepEqual(facts.imports.map(edge => [edge.specifier, edge.lazy, Boolean(edge.conditional)]), [['first', true, false], ['last', true, true]]);
  assert.equal(facts.calls.length, 2);
});

test('Python narrowing requires a visible builtin with two ordinary arguments', t => {
  const { facts } = fixture(t, { 'entry.py': `class Item:
    def work(self): pass
class Other:
    def work(self): pass
def malformed(value: Item | Other):
    if isinstance(value): value.work()
def outer(isinstance):
    def chosen(value: Item | Other):
        if isinstance(value, Item): value.work()
` });
  assert.ok(facts.calls.every(call => call.resolution === 'unresolved'));
});

test('Python member declarations follow receiver annotations, C3 order and declaration modules', t => {
  const { root, facts } = fixture(t, {
    'models.py': `class Base:
    def work(self): pass
class Left(Base): pass
class Right(Base):
    def work(self): pass
class Diamond(Left, Right): pass
class Derived(Base):
    def work(self): pass
def create() -> Derived: return Derived()
`,
    'entry.py': `import models as mod
from models import Base, Derived, Diamond, create
class Local(Base):
    def run(self): self.work()
def chosen(x: Derived, base: Base, diamond: Diamond):
    x.work()
    base.work()
    diamond.work()
    Derived().work()
    create().work()
    mod.create().work()
`,
  });
  const methods = facts.calls.filter(call => call.resolution === 'python-source-declaration');
  assert.deepEqual(methods.map(call => targetName(facts, call)), ['Base.work', 'Derived.work', 'Base.work', 'Right.work', 'Derived.work', 'Derived.work', 'create', 'Derived.work']);
  const question = buildQuestion({ root, facts, entry: 'entry.py', symbol: 'chosen', question: 'where are its calls?' });
  assert.equal(question.calls.coverage, 'available');
  assert.ok(question.calls.records.filter(record => record.fact.target).every(record => record.targetNavigation.status === 'valid'));
  const spoofed = structuredClone(facts); spoofed.callModel = 'python-lexical-v2';
  assert.ok(schemaErrors('raw-facts', spoofed).some(error => error.path.endsWith('/resolution')));
});

test('Python generic returns, properties, annotated fields and positive narrowing preserve source anchors', t => {
  const { facts } = fixture(t, { 'entry.py': `from dataclasses import dataclass
class Item:
    def work(self): pass
class Other:
    def work(self): pass
class Box[T]:
    def get(self) -> T: ...
def identity[T](value: T) -> T: return value
class Holder:
    @property
    def child(self) -> Item: ...
@dataclass
class Record:
    item: Item
def chosen(box: Box[Item], item: Item, holder: Holder, record: Record, union: Item | Other):
    box.get().work()
    identity(item).work()
    holder.child.work()
    record.item.work()
    union.work()
    if isinstance(union, Item):
        union.work()
` });
  const calls = facts.calls.filter(call => call.file === 'entry.py' && call.line >= 16);
  assert.deepEqual(calls.map(call => targetName(facts, call) || null), ['Box.get', 'Item.work', 'identity', 'Item.work', 'Item.work', 'Item.work', null, null, 'Item.work']);
});

test('Python receiver shadows, callable fields, unknown decorators and incomplete hierarchies stay unknown', t => {
  const { facts } = fixture(t, { 'entry.py': `class Base:
    def work(self): pass
class Rebound:
    def work(self): pass
    def run(self):
        self = unknown
        self.work()
class Field:
    def work(self): pass
    def __init__(self): self.work = callback
    def run(self): self.work()
class Decorated:
    @unknown
    def work(self): pass
    def run(self): self.work()
class Static:
    def work(self): pass
    @staticmethod
    def run(self): self.work()
class Incomplete(Unknown, Base):
    def run(self): self.work()
class A(B): pass
class B(A): pass
def chosen(a: A, callback):
    a.work()
    callback()
` });
  assert.equal(facts.calls.length, 7);
  assert.ok(facts.calls.every(call => call.resolution === 'unresolved'));
});

test('Python inherited direct declarations survive external tail bases and transparent contextlib decorators', t => {
  const { facts } = fixture(t, { 'entry.py': `from contextlib import contextmanager
class Base(External):
    def work(self): pass
class Child(Base, OtherExternal):
    @contextmanager
    def run(self):
        self.work()
        yield
` });
  assert.equal(targetName(facts, facts.calls[0]), 'Base.work');
});

test('Python source declaration model still reads historical lexical captures without expanding them', t => {
  const { root, facts } = fixture(t, { 'entry.py': 'def work(): pass\ndef chosen(): work()\n' });
  facts.repository.adapter = 'python@3.14.3'; facts.repository.adapterRevision = 10; facts.callModel = 'python-lexical-v2';
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const question = buildQuestion({ root, facts, entry: 'entry.py', symbol: 'chosen', question: 'where?' });
  assert.equal(question.calls.coverage, 'available'); assert.equal(question.calls.records[0].targetNavigation.status, 'valid');
});
