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

test('Python parser matches upstream version gates and unterminated continuation diagnostics', () => {
  // Adapted from Pyright 1.1.414 parser.test.ts: FinallyExit1,
  // TrailingBackslashCRAtEOF, and the Python 3.14 lazy import cases.
  const returning = 'def work():\n    try: pass\n    finally: return 1\n';
  assert.equal(parsePython(returning, '3.13').errors.length, 0);
  assert.equal(parsePython(returning, '3.14').errors.length, 1);
  const trailing = parsePython('"""Comment"""\n\n\\\r');
  assert.ok(trailing.errors.some(error => /unexpected EOF/i.test(error.message)));
  for (const statement of ['lazy import json', 'lazy from json import loads']) {
    assert.equal(parsePython(statement + '\n', '3.14').errors.length, 1);
  }
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

test('Python uses explicit casts and callable-preserving cache declarations with verified imports', t => {
  const text = `from typing import cast as checked
from functools import cache
from cached import work
class Worker:
    def run(self): pass
@cache
def local(): pass
def chosen(value):
    receiver = checked(Worker, value)
    receiver.run()  # site: cast
    work()  # site: imported-cache
    local()  # site: local-cache
def shadowed(checked, value):
    receiver = checked(Worker, value)
    receiver.run()  # site: shadowed-cast
`;
  const cached = 'from functools import cache\n@cache\ndef work(): pass\n';
  const { facts } = fixture(t, { 'entry.py': text, 'cached.py': cached });
  assert.deepEqual(markedTargets(facts, text), {
    cast: 'Worker.run', 'imported-cache': 'work', 'local-cache': 'local', 'shadowed-cast': null,
  });
  const shadowed = fixture(t, { 'entry.py': text, 'cached.py': cached,
    'functools.py': 'def cache(function): return 0\n' });
  assert.deepEqual(markedTargets(shadowed.facts, text), {
    cast: 'Worker.run', 'imported-cache': null, 'local-cache': null, 'shadowed-cast': null,
  });
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

test('Python resolves typed comprehension targets and keeps dominating assert and short-circuit guards', t => {
  // Pyright 1.1.414: comprehension4.py and typeNarrowingAssert1.py.
  const text = `class Work:
    def run(self): pass
class Special(Work):
    def run(self): pass
def chosen(items: list[Work], optional: Work | None):
    assert optional is not None
    optional.run() # site: asserted
    [item.run() for item in items] # site: typed-element
    filtered = [item for item in items if isinstance(item, Special)]
    for item in filtered:
        item.run() # site: filtered-element
def guard(optional: Work | None):
    if optional is not None and optional.run(): # site: right-and
        optional.run() # site: and-body
    if optional is None or optional.run(): # site: right-or
        optional.run() # site: or-body
def nested(items: list[tuple[Work, Special]]):
    [right.run() for left, right in items] # site: unpacked-element
def shadowed(item: Work, values):
    [item.run() for item in values] # site: shadowed
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    asserted: 'Work.run', 'typed-element': 'Work.run', 'filtered-element': 'Special.run',
    'right-and': 'Work.run', 'and-body': 'Work.run', 'right-or': 'Work.run', 'or-body': null,
    'unpacked-element': 'Special.run', shadowed: null,
  });
});

test('Python evaluates assertion messages with the failure condition', t => {
  const text = `class A:
    def run(self): pass
class B:
    def run(self): pass
def ambiguous(value: A | B, flag: bool):
    assert isinstance(value, A) and flag, (
        value.run(), # site: can-fail-either-side
    )
    value.run() # site: assertion-passed
def known_failure(value: A | B):
    assert isinstance(value, A), (
        value.run(), # site: only-b-can-fail
    )
def rebound(value: A | B):
    assert isinstance(value, A), (
        (value := A()),
        value.run() # site: message-rebind
    )
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'can-fail-either-side': null, 'assertion-passed': 'A.run',
    'only-b-can-fail': 'B.run', 'message-rebind': null,
  });
});

test('Python follows standard abstract and cached property declarations and captured base chains', t => {
  const text = `from abc import ABC, abstractmethod
from functools import cached_property
from typing import Generic, TypeVar
T = TypeVar('T')
class Root(Generic[T], ABC):
    @abstractmethod
    def abstract(self): pass
    def work(self): pass
class Middle(Root[int]): pass
class Concrete(Middle):
    @cached_property
    def value(self):
        self.work() # site: cached-self
    def use(self):
        self.abstract() # site: abstract-method
        super().work() # super declaration
def chosen(value: Concrete):
    value.work() # site: base-chain
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'cached-self': 'Root.work', 'abstract-method': 'Root.abstract', 'base-chain': 'Root.work',
  });
  const superLine = text.split('\n').findIndex(line => line.includes('# super declaration')) + 1;
  assert.deepEqual(facts.calls.filter(call => call.line === superLine).map(call => targetName(facts, call)), [undefined, 'Root.work']);
});

test('Python follows diamond inheritance through an explicit builtin object base', t => {
  const text = `class Root(object):
    def run(self): pass
class Left(Root): pass
class Right(Root): pass
class Child(Left, Right): pass
class Last(Left, object): pass
class Inconsistent(object, Left): pass
def chosen(child: Child, last: Last, inconsistent: Inconsistent):
    child.run() # site: inherited-diamond
    last.run() # site: terminal-object
    inconsistent.run() # site: inconsistent-order
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'inherited-diamond': 'Root.run', 'terminal-object': 'Root.run', 'inconsistent-order': null,
  });
});

test('Python resolves tuple-keyed mappings while sequence indices stay scalar', t => {
  const text = `class Work:
    def run(self): pass
def chosen(pairs: dict[tuple[int, int], Work], single: dict[tuple[int], Work], items: list[Work]):
    pairs[1, 2].run() # site: tuple-key
    pairs[(1, 2)].run() # site: parenthesized-key
    single[1,].run() # site: one-element-key
    items[0].run() # site: scalar-index
    items[0,].run() # site: tuple-index
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'tuple-key': 'Work.run', 'parenthesized-key': 'Work.run', 'one-element-key': 'Work.run',
    'scalar-index': 'Work.run', 'tuple-index': null,
  });
});

test('Python follows declarations visible in a branch and stable enclosing functions', t => {
  const text = `def chosen(enabled):
    if enabled:
        from provider import work
        work() # site: branch-import
    work() # site: maybe-import
    def local(): pass
    def invoke():
        local() # site: captured-function
    [local() for i in range(1)]
def shadowed(enabled):
    def local(): pass
    def invoke(local):
        local() # site: shadowed-function
def rebound(enabled):
    if enabled:
        from provider import work
        work() # site: later-rebinding
        work = foreign
try:
    import optional_extension
except ImportError:
    optional = None
else:
    def optional(): pass
def checked():
    optional() # site: only-callable
def reassigned(): pass
reassigned = None
def disabled():
    reassigned() # site: definitely-none
`;
  const { facts } = fixture(t, { 'entry.py': text, 'provider.py': 'def work(): pass\n' });
  assert.deepEqual(markedTargets(facts, text), {
    'branch-import': 'work', 'maybe-import': null, 'captured-function': 'chosen.<locals>.local',
    'shadowed-function': null, 'later-rebinding': null, 'only-callable': 'optional', 'definitely-none': null,
  });
});

test('Python carries standard context, mapping, and iteration element types to source methods', t => {
  const text = `from contextvars import ContextVar
from typing_extensions import Self
from weakref import ref
class Work:
    def run(self): pass
    def __enter__(self) -> Self: return self
    def __exit__(self, a, b, c): pass
    def copy(self) -> Work: return self
current: ContextVar[Work] = ContextVar('current')
def chosen(items: list[Work], mapping: dict[str, Work]):
    with Work() as entry:
        entry.run() # site: self-backport
    for _, obj in enumerate(items):
        obj.run() # site: enumerated
    item = mapping.get('name')
    if item:
        item.run() # site: mapping-get
    item = current.get(None)
    if item is None: return
    item = item.copy()
    def invoke():
        item.run() # site: captured-context
    recent = items.pop()
    recent.run() # site: popped-item
def referenced(work: Work):
    weak = ref(work)
    candidate = weak()
    candidate.run() # site: expired-reference
    if candidate is not None:
        candidate.run() # site: live-reference
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'self-backport': 'Work.run', enumerated: 'Work.run', 'mapping-get': 'Work.run',
    'captured-context': 'Work.run', 'popped-item': 'Work.run', 'expired-reference': null, 'live-reference': 'Work.run',
  });
});

test('Python uses matching module overload signatures for receiver types', t => {
  // Pyright 1.1.414 overloadCall6.py distinguishes literals and ambiguous arguments.
  const text = `from provider import select, shell_type
import provider
def chosen(instruction: str, flag: bool, unknown):
    current = select()
    current.run() # site: default-overload
    current = provider.select(quiet=False)
    current.run() # site: keyword-overload
    current = select(True)
    current.run() # site: literal-overload
    current = select(flag)
    current.run() # site: broad-overload
    current = select(unknown)
    current.run() # site: unknown-overload
    shell, _, _ = instruction.partition('_')
    factory = shell_type(shell)
    if factory is None: return
    shell_object = factory()
    shell_object.run() # site: string-partition
    invalid, _, _ = instruction.partition(None)
    other = shell_type(invalid)
    if other is None: return
    result = other()
    result.run() # site: invalid-partition
`;
  const provider = `from typing import Literal, overload
class Work:
    def run(self): pass
class Special(Work):
    def run(self): pass
@overload
def select(quiet: Literal[False] = False) -> Work: ...
@overload
def select(quiet: Literal[True]) -> Special: ...
@overload
def select(quiet: bool) -> Work | None: ...
def select(quiet: bool = False) -> Work | None:
    return Work()
@overload
def shell_type(name: Literal['special']) -> type[Special]: ...
@overload
def shell_type(name: str) -> type[Work] | None: ...
def shell_type(name: str) -> type[Work] | None:
    return Work
`;
  const { facts } = fixture(t, { 'entry.py': text, 'provider.py': provider });
  assert.deepEqual(markedTargets(facts, text), {
    'default-overload': 'Work.run', 'keyword-overload': 'Work.run', 'literal-overload': 'Special.run',
    'broad-overload': null, 'unknown-overload': null, 'string-partition': 'Work.run', 'invalid-partition': null,
  });
  assert.ok(facts.calls.filter(call => call.line === 4 && call.file === 'entry.py').every(call => !call.target));
});

test('Python uses a verified descriptor and the declaration of an immediate callback parameter', t => {
  // Pyright 1.1.414 lambda13.py exercises parameter types supplied by a Callable.
  const text = `from typing import Callable
from werkzeug.utils import cached_property
class Result:
    def build(self): pass
Callback = Callable[["Result"], None]
class Owner:
    @cached_property
    def result(self):
        self.make() # site: property-receiver
    def make(self): pass
    def record(self, callback: Callback): pass
    def chosen(self, unknown):
        self.record(
            lambda value: value.build() # site: contextual-callback
        )
        self.record(callback=
            lambda value: value.build() # site: keyword-callback
        )
        unknown(
            lambda value: value.build() # site: unknown-callback
        )
`;
  const { facts } = fixture(t, { 'entry.py': text });
  const expected = { 'property-receiver': 'Owner.make', 'contextual-callback': 'Result.build',
    'keyword-callback': 'Result.build', 'unknown-callback': null };
  assert.deepEqual(markedTargets(facts, text), expected);
  const shadowed = fixture(t, { 'entry.py': text, 'werkzeug/utils.py': 'def cached_property(function): return None\n' });
  assert.deepEqual(markedTargets(shadowed.facts, text), { ...expected, 'property-receiver': null });
});

test('Python navigation can use the later same-signature platform declaration', t => {
  const text = `from provider import encode, opaque, different
def chosen():
    from provider import open_terminal as terminal
    terminal() # site: platform-equality
    encode() # site: platform-prefix
    opaque() # site: arbitrary-condition
    different() # site: different-signature
`;
  const provider = `import sys as system
from contextlib import contextmanager
ON_WINDOWS = system.platform.startswith('win')
if system.platform == 'win32':
    @contextmanager
    def open_terminal() -> Iterator[int]: yield -1
else:
    @contextmanager
    def open_terminal() -> Iterator[int]: yield 1
if system.platform.startswith('win') and ON_WINDOWS:
    def encode() -> str: return 'windows'
else:
    def encode() -> str: return 'default'
if feature_enabled:
    def opaque() -> str: return 'one'
else:
    def opaque() -> str: return 'two'
if system.platform == 'win32':
    def different() -> int: return 1
else:
    def different() -> str: return 'two'
`;
  const { facts } = fixture(t, { 'entry.py': text, 'provider.py': provider });
  assert.deepEqual(markedTargets(facts, text), {
    'platform-equality': 'open_terminal', 'platform-prefix': 'encode', 'arbitrary-condition': null, 'different-signature': null,
  });
  assert.deepEqual(facts.calls.filter(call => call.file === 'entry.py').map(call => call.target?.line), [9, 13, undefined, undefined]);
  const shadowed = fixture(t, { 'entry.py': text, 'provider.py': provider.replace('import sys as system', 'from other import system') });
  assert.ok(Object.values(markedTargets(shadowed.facts, text)).every(target => target === null));
});

test('Python isinstance assertions preserve typed subclasses that override the same method', t => {
  const text = `class Base:
    def run(self): pass
    def common(self): pass
class Child(Base):
    def run(self): pass
def chosen(value: Base | Child, specific: Child):
    assert isinstance(value, Base)
    value.run() # site: two-declarations
    value.common() # site: shared-declaration
    assert isinstance(specific, Base)
    specific.run() # site: more-specific
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'two-declarations': null, 'shared-declaration': 'Base.common', 'more-specific': 'Child.run',
  });
});

test('Python follows verified cache and dispatch decorators to their declared function', t => {
  const text = `from functools import lru_cache as cache, singledispatch
@cache
def cached(): pass
@singledispatch
def dispatched(item): pass
@dispatched.register
def registered(item: str): pass
def chosen(item):
    cached() # site: cached
    dispatched(item) # site: dispatch-declaration
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), { cached: 'cached', 'dispatch-declaration': 'dispatched' });
  const shadowed = fixture(t, { 'entry.py': text, 'functools.py': '' });
  assert.deepEqual(markedTargets(shadowed.facts, text), { cached: null, 'dispatch-declaration': null });
});

test('Python follows later declarations after wildcard imports and success-only try bindings', t => {
  const text = `from provider import Work, Overridden
def chosen():
    try:
        value = Work()
    except Exception:
        value = Overridden()
    else:
        value.run() # site: succeeded
    original = Overridden()
    original.run() # site: earlier-than-wildcard
def local(manager):
    with manager:
        def nested(): pass
        nested() # site: reached-in-with
    nested() # site: maybe-unbound
`;
  const provider = `class Overridden:
    def run(self): pass
from foreign import *
class Work:
    def run(self): pass
`;
  const { facts } = fixture(t, { 'entry.py': text, 'provider.py': provider });
  assert.deepEqual(markedTargets(facts, text), {
    succeeded: 'Work.run', 'earlier-than-wildcard': null,
    'reached-in-with': 'local.<locals>.nested', 'maybe-unbound': null,
  });
});

test('Python keeps iterable element declarations across empty fallbacks and constructor mapping', t => {
  const text = `from collections.abc import Iterable, Sequence
class Work:
    def __init__(self, name: str = ''): pass
    def run(self): pass
class Batch:
    def __init__(self, items: Sequence[Work] | None):
        self.items = [] if items is None else list(items)
    @property
    def picks(self) -> list[Work]:
        return self.items
    def chosen(self):
        for item in self.items:
            item.run() # site: typed-conditional-list
        for choice in self.picks or []:
            choice.run() # site: empty-list-fallback
def from_input(items: str | Iterable[Work]):
    if isinstance(items, str):
        result = frozenset(map(Work, [items]))
    else:
        result = frozenset(items)
    for item in result:
        item.run() # site: typed-frozenset
def replaced(items: Sequence[Work] | None, opaque):
    alternate = [] if items is None else opaque
    for item in alternate:
        item.run() # site: unknown-fallback
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'typed-conditional-list': 'Work.run', 'empty-list-fallback': 'Work.run',
    'typed-frozenset': 'Work.run', 'unknown-fallback': null,
  });
});

test('Python follows property anchors and the shared return type of distinct method declarations', t => {
  const text = `from collections.abc import Callable
class Work:
    def run(self): pass
class First:
    def path(self) -> Work: return Work()
class Second:
    def path(self) -> Work: return Work()
class View:
    @property
    def callback(self) -> Callable[[], None]: return lambda: None
    @property
    def work(self) -> Work: return Work()
    def chosen(self, source: First | Second):
        self.callback() # site: property-declaration
        worker = self.work
        worker.run() # site: property-value
        selected = source.path() # site: two-methods
        selected.run() # site: same-return
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), {
    'property-declaration': 'View.callback', 'property-value': 'Work.run',
    'two-methods': null, 'same-return': 'Work.run',
  });
});

test('Python keeps a written Any declaration until a supported type guard', t => {
  const text = `from typing import Any, cast
class Work:
    def run(self): pass
def chosen(arg: str):
    value: Any = arg
    value = cast(Work, value)
    value.run() # site: written-any
    other = cast(Work, arg)
    other.run() # site: cast-inference
    if isinstance(value, Work):
        value.run() # site: guarded
`;
  const { facts } = fixture(t, { 'entry.py': text });
  assert.deepEqual(markedTargets(facts, text), { 'written-any': null, 'cast-inference': 'Work.run', guarded: 'Work.run' });
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
    indexed = items[0,]
    indexed.work() # site: tuple-is-not-scalar-index
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
