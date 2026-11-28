import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, extractFacts } from '../lib/analysis.mjs';

const config = () => ({ ...loadConfig(), include: ['**/*.kt'] });
function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-kotlin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('kotlin: an unqualified fixed-arity call binds to the unique same-scope function', t => {
  const root = fixture(t, {
    'p1/Service.kt': `package p1
class Service {
  fun run() {
    validate()
  }
  fun validate() {
    check(true)
  }
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const bound = facts.calls.filter(call => call.resolution === 'kotlin-scope-function');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].target.name, 'validate');
  assert.equal(bound[0].file, 'p1/Service.kt');
});

test('kotlin: fixed-arity overloads bind by exact arity, since no defaults or varargs apply', t => {
  const root = fixture(t, {
    'p1/Overloaded.kt': `package p1
class Overloaded {
  fun run() {
    pick()
  }
  fun pick() {}
  fun pick(input: Int) {}
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const bound = facts.calls.filter(call => call.resolution === 'kotlin-scope-function');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].target.line, 6);
});

test('kotlin: defaults and vararg candidates never bind', t => {
  const root = fixture(t, {
    'p1/Defaults.kt': `package p1
class Defaults {
  fun run() {
    pick()
    spread()
  }
  fun pick(input: Int = 1) {}
  fun spread(vararg items: Int) {}
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.calls.some(call => call.resolution === 'kotlin-scope-function'));
});

test('kotlin: constructor invocations are type references, never calls', t => {
  const root = fixture(t, {
    'p1/Thing.kt': 'package p1\nclass Thing\n',
    'p1/Make.kt': `package p1
class Make {
  fun run() {
    val thing = Thing()
  }
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.calls.some(call => call.resolution === 'kotlin-scope-function' && call.target?.name === 'Thing'));
  assert.ok(facts.imports.some(imp => imp.from === 'p1/Make.kt' && imp.specifier === 'Thing' && imp.resolved));
});

test('kotlin: receiver-qualified calls stay unresolved with supported reasons', t => {
  const root = fixture(t, {
    'p1/Chain.kt': `package p1
class Chain {
  fun run(other: Chain) {
    other.validate()
    this.helper()
  }
  fun validate() {}
  fun helper() {}
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.calls.some(call => call.resolution === 'kotlin-scope-function'));
  assert.ok(facts.calls.length >= 2);
});

test('kotlin: imported same-name functions win over scope binding', t => {
  const root = fixture(t, {
    'p1/helpers.kt': 'package p1\nfun helper() {}\n',
    'p2/Use.kt': `package p2
import p1.helper
class Use {
  fun run() {
    helper()
  }
  fun helper() {}
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.calls.some(call => call.resolution === 'kotlin-scope-function'));
});

test('kotlin: classes with supertypes produce no scope bindings', t => {
  const root = fixture(t, {
    'p1/Base.kt': 'package p1\nopen class Base\n',
    'p1/Derived.kt': `package p1
class Derived : Base() {
  fun run() {
    helper()
  }
  fun helper() {}
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.calls.some(call => call.resolution === 'kotlin-scope-function'));
});

test('kotlin: top-level functions bind within their file', t => {
  const root = fixture(t, {
    'p1/util.kt': `package p1
fun main() {
  helper()
}
fun helper() {}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const bound = facts.calls.filter(call => call.resolution === 'kotlin-scope-function');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].target.name, 'helper');
});
