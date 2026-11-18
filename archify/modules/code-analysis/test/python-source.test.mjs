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
const markedTargets = (facts, text) => Object.fromEntries(text.split('\n').flatMap((line, index) => {
  const marker = /# site: ([\w-]+)/.exec(line);
  if (!marker) return [];
  const calls = facts.calls.filter(call => call.file === 'entry.py' && call.line === index + 1);
  assert.equal(calls.length, 1, marker[1]);
  return [[marker[1], targetName(facts, calls[0]) || null]];
}));

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
  facts.repository.adapter = 'pyright-parser@1.1.414/python-3.14'; facts.repository.adapterRevision = 11; facts.callModel = 'python-source-v1';
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const historical = buildQuestion({ root, facts, entry: 'entry.py', symbol: 'chosen', question: 'where?' }).calls;
  assert.equal(historical.bindingCoverage, 'captured-python-declarations-with-bounded-receiver-and-signature-types');
  assert.ok(historical.limitations.every(text => !text.includes('python-source-v2')));
});

test('Python properties, qualified contextlib decorators and bound legacy self types preserve declaration anchors', t => {
  const text = `import contextlib as ctx
import typing as ty
T = ty.TypeVar("T", bound="Client")
class Item:
    def work(self): pass
class Client:
    def __init__(self): self._item = Item()
    @property
    def item(self) -> Item: ...
    @item.setter
    def item(self, value):
        self.prepare() # site: setter
    def prepare(self): pass
    def __enter__(self: T) -> T:
        self.prepare() # site: bound-self
        return self
    def __exit__(self, *args): pass
    @ctx.contextmanager
    def stream(self) -> ty.Iterator[Item]:
        yield self._item
@ctx.contextmanager
def opened() -> ty.Iterator[Item]: yield Item()
def chosen(client: Client):
    client.item.work() # site: property
    with client as current:
        current.prepare() # site: entered
    with opened() as item:
        item.work() # site: generator-context
    with client.stream() as item:
        item.work() # site: method-context
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), { setter: 'Client.prepare', 'bound-self': 'Client.prepare', property: 'Item.work', entered: 'Client.prepare', 'generator-context': 'Item.work', 'method-context': 'Item.work' });
  assert.equal(facts.calls.filter(call => targetName(facts, call) === 'opened').length, 1);
});

test('Python reaching definitions join branches, retain loop stores and invalidate unsupported stores', t => {
  const text = `class Item:
    def work(self): pass
class Other:
    def work(self): pass
def chosen(item: Item, flag, value):
    item.work() # site: before
    item = Other()
    item.work() # site: replaced
    if flag:
        local = Item()
        local.work() # site: branch-local
    local.work() # site: maybe-unbound
    if flag: item = Item()
    item.work() # site: conflicting-join
    item = Item()
    if flag: item = Item()
    item.work() # site: agreeing-join
    while flag:
        item.work() # site: carried
        item = Other()
    match value:
        case 1: item = Other()
    item.work() # site: match-store
def guarded(item: Item | Other):
    if not isinstance(item, Item): return
    item.work() # site: early-exit
    item = Other()
    item.work() # site: guard-invalidated
def walrus(item: Item, flag):
    if flag and (item := Other()): pass
    item.work() # site: conditional-walrus
def shadow(ctx):
    @ctx.contextmanager
    def opaque() -> Item: ...
    value = opaque()
    value.work() # site: decorator-shadow
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), { before: 'Item.work', replaced: 'Other.work', 'branch-local': 'Item.work', 'maybe-unbound': null,
    'conflicting-join': null, 'agreeing-join': 'Item.work', carried: null, 'match-store': null, 'early-exit': 'Item.work', 'guard-invalidated': 'Other.work', 'conditional-walrus': null, 'decorator-shadow': null });
});

test('Python typed iteration, generator send, awaited returns and source super calls retain their static declarations', t => {
  const text = `from typing import Generator, Sequence, AsyncIterator
class Item:
    def work(self): pass
    def copy(self) -> Item: return self
class Base:
    def prepare(self): pass
class Child(Base):
    def prepare(self):
        super().prepare()
def flow(item: Item) -> Generator[Item, Item, None]:
    response = yield item
    response.work() # site: yielded-send
async def create() -> Item: ...
async def chosen(items: Sequence[Item], mapping: dict[Item, Item | None], item: Item):
    for child in list(reversed(items)):
        child.work() # site: sequence
    for key, value in mapping.items():
        key.work() # site: mapping-key
        value.work() # site: optional
        if value is not None:
            value.work() # site: not-none
    gen = flow(item)
    result = next(gen)
    result.work() # site: next
    result = gen.send(item)
    result.work() # site: send
    pending = create()
    pending.work() # site: coroutine
    result = await pending
    result.work() # site: awaited
class Recursive:
    def __init__(self, value):
        if isinstance(value, Recursive): self.child = value.child.copy()
        else: self.child = Item()
class Conflicting:
    def __init__(self, value):
        self.child = Item()
        self.child = value
def fields(value: Conflicting, recursive: Recursive):
    value.child.work() # site: unknown-field-write
    recursive.child.work() # site: recursive-field
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), { 'yielded-send': 'Item.work', sequence: 'Item.work', 'mapping-key': 'Item.work', optional: null, 'not-none': 'Item.work', next: 'Item.work', send: 'Item.work', coroutine: null, awaited: 'Item.work', 'unknown-field-write': null, 'recursive-field': 'Item.work' });
  assert.equal(facts.calls.filter(call => targetName(facts, call) === 'Base.prepare').length, 1);
});

test('Python protocol shapes preserve slices, next defaults, sync/async context boundaries and suppressed stores', t => {
  const text = `from typing import Iterator, AsyncIterator
from contextlib import asynccontextmanager
class Item:
    def work(self): pass
class Other:
    def work(self): pass
@asynccontextmanager
async def opened() -> AsyncIterator[Item]: yield Item()
def chosen(items: list[Item], gen: Iterator[Item], ctx, item: Item):
    sliced = items[1:]
    sliced.work() # site: slice-is-container
    value = next(gen, Other())
    value.work() # site: default-conflict
    invalid = items.send(None)
    invalid.work() # site: list-not-generator
    with opened() as value:
        value.work() # site: wrong-context-protocol
    with ctx:
        can_raise()
        item = Other()
    item.work() # site: suppressed-store
    while item.work():
        item = Other()
def missing_import(items: Sequence[Item]):
    for child in items:
        child.work() # site: missing-protocol-import
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.ok(Object.values(markedTargets(facts, text)).every(value => value === null));
  const condition = facts.calls.find(call => call.line === text.split('\n').findIndex(line => line.includes('while item.work')) + 1);
  assert.equal(targetName(facts, condition), undefined);
});

test('Python annotations can use stable type-only imports without treating them as runtime bindings', t => {
  const model = `class Job:
    def run(self): pass
    @staticmethod
    def start(): pass
`;
  const text = `from typing import TYPE_CHECKING as checking
if checking:
    from model import Job as TypeOnly
    import model as types
if checking and flag:
    from model import Job as Maybe
def chosen(job: "TypeOnly", other: types.Job, maybe: "Maybe", value):
    TypeOnly = unknown
    job.run() # site: annotation-scope
    other.run() # site: qualified-type
    maybe.run() # site: conditional-import
    types.Job.start() # site: runtime-module
    if isinstance(value, types.Job):
        value.run() # site: runtime-guard
`;
  const { facts } = fixture(t, { 'entry.py': text, 'model.py': model });
  assert.deepEqual(markedTargets(facts, text), {
    'annotation-scope': 'Job.run', 'qualified-type': 'Job.run', 'conditional-import': null,
    'runtime-module': null, 'runtime-guard': null,
  });
  const shadow = fixture(t, { 'entry.py': text, 'model.py': model, 'typing.py': 'TYPE_CHECKING = False\n' });
  assert.ok(Object.values(markedTargets(shadow.facts, text)).every(target => target === null));
});

test('Python captured callable-preserving decorator signatures recover the method and its receiver', t => {
  const text = `from hooks import preserve as checked, untyped, differently_typed
@checked
def __helper(): pass
class Service:
    @checked
    def execute(self):
        self.prepare() # site: decorated-receiver
    def prepare(self): pass
    @untyped
    def unknown(self): pass
    @differently_typed
    def replacement(self): pass
    def hidden(self):
        __helper() # site: mangled-helper
def chosen(service: Service):
    __helper() # site: decorated-function
    service.execute() # site: decorated-method
    service.unknown() # site: untyped
    service.replacement() # site: replacement
class BeforeImport:
    @late
    def execute(self): pass
from hooks import preserve as late
def earlier(value: BeforeImport):
    value.execute() # site: late-decorator
`;
  const hooks = `from typing import Callable, TypeVar
F = TypeVar("F", bound=Callable[..., object])
G = TypeVar("G", bound=Callable[..., object])
def preserve(f: F) -> F: return f
def untyped(f): return f
def differently_typed(f: F) -> G: ...
`;
  const { facts } = fixture(t, { 'entry.py': text, 'hooks.py': hooks });
  assert.deepEqual(markedTargets(facts, text), {
    'decorated-receiver': 'Service.prepare', 'mangled-helper': null, 'decorated-function': '__helper',
    'decorated-method': 'Service.execute', untyped: null, replacement: null, 'late-decorator': null,
  });
});

test('Python dependency declarations specialize class factories and keep dependency files out of project facts', t => {
  const text = `from dependency import Context
class Job:
    def run(self): pass
class Other:
    def run(self): pass
def chosen(ctx: Context, job_type: type[Job]):
    first = ctx.build(Job) # site: external-factory
    first.run() # site: positional
    second = ctx.build(kind=job_type)
    second.run() # site: keyword-class-object
    invalid = ctx.build(Job())
    invalid.run() # site: instance-is-not-class
    uncertain = ctx.match(Job, Other)
    uncertain.run() # site: conflicting-types
`;
  const declarations = {
    'decls/__init__.pyi': 'from .factory import Context as Context\n',
    'decls/factory.pyi': `from typing import Type, TypeVar
T = TypeVar("T")
class Context:
    def build(self, kind: Type[T]) -> T: ...
    def match(self, first: Type[T], second: Type[T]) -> T: ...
`,
  };
  const { root, capture, facts } = fixture(t, { 'entry.py': text, ...declarations }, { declarations: { dependency: 'decls' } });
  assert.deepEqual(markedTargets(facts, text), {
    'external-factory': null, positional: 'Job.run', 'keyword-class-object': 'Job.run', 'instance-is-not-class': null, 'conflicting-types': null,
  });
  assert.deepEqual(facts.files.map(file => file.path), ['entry.py']);
  assert.equal(facts.functions.some(fn => fn.name === 'build'), false);
  assert.deepEqual(facts.imports.map(edge => [edge.specifier, edge.resolved]), [['dependency', false]]);
  assert.deepEqual(Object.keys(facts.languageScope.declarations[0].files[0]).sort(), ['file', 'sha256']);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);

  const question = buildQuestion({ root, facts, entry: 'entry.py', symbol: 'chosen', question: 'where?' });
  assert.equal(question.calls.coverage, 'available');
  assert.equal(question.calls.records.filter(record => record.targetNavigation.status === 'valid').length, 2);
  const implicit = extractFacts(root, { language: 'py' }).facts;
  assert.ok(Object.values(markedTargets(implicit, text)).every(target => target === null));

  fs.writeFileSync(path.join(root, 'decls/factory.pyi'), declarations['decls/factory.pyi'].replace('kind: Type[T]) -> T', 'kind: Type[T]) -> object'));
  const changed = capture();
  assert.notEqual(changed.repository.snapshotId, facts.repository.snapshotId);
  assert.equal(markedTargets(changed, text).positional, null);
});
