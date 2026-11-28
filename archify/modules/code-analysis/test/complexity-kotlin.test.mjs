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

test('kotlin: when branches, loops, catch and elvis count toward complexity', t => {
  const root = fixture(t, {
    'Demo.kt': `class Demo {
  fun score(value: Int): Int {
    var total = 0
    when {
      value < 0 -> total = -1
      value == 0 -> total = 0
      else -> total = value
    }
    for (i in 0 until value) {
      if (i % 2 == 0) total += 1 else total += 2
    }
    try {
      total = total / (value ?: 1)
    } catch (error: Exception) {
      total = -1
    }
    while (total > 10) total -= 1
    val maybe = if (total > 0) total else null
    return maybe?.plus(0) ?: total
  }
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const score = facts.functions.find(fn => fn.name === 'score');
  assert.ok(score, 'score measured');
  assert.ok(score.complexity >= 10, `complexity ${score.complexity} counts when/loops/catch/elvis/if`);
  assert.ok(score.nesting >= 2);
});

test('kotlin: lambdas inside a property initializer are measured under the property name', t => {
  const root = fixture(t, {
    'Ops.kt': `class Ops {
  val transform = { input: Int ->
    if (input > 0) input else -input
  }
  fun plain() = 1
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const transform = facts.functions.find(fn => fn.name === 'transform');
  assert.ok(transform, 'property initializer measured');
  assert.ok(transform.complexity >= 2);
  assert.equal(transform.definition.kind, 'KtProperty');
  const plain = facts.functions.find(fn => fn.name === 'plain');
  assert.equal(plain.complexity, 1, 'expression body without branches measures at base complexity');
});

test('kotlin: constructors, init blocks and accessors are measured with kotlin kinds', t => {
  const root = fixture(t, {
    'Shape.kt': `class Shape(val sides: Int) {
  init {
    if (sides < 3) throw IllegalArgumentException()
  }
  constructor() : this(4) {
    if (sides == 4) println("square")
  }
  var area: Int = 0
    get() = if (field > 0) field else 0
    set(value) {
      if (value >= 0) field = value
    }
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const init = facts.functions.find(fn => fn.definition.kind === 'KtClassInitializer');
  assert.ok(init, 'init block measured');
  const secondary = facts.functions.find(fn => fn.definition.kind === 'KtSecondaryConstructor');
  assert.ok(secondary, 'secondary constructor measured');
  const getter = facts.functions.find(fn => fn.name === 'get');
  assert.ok(getter, 'accessor measured');
});

test('kotlin: nested local functions are measured under <locals>', t => {
  const root = fixture(t, {
    'Outer.kt': `class Outer {
  fun run() {
    fun helper(input: Int): Int {
      return if (input > 1) input else 0
    }
    helper(2)
  }
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const helper = facts.functions.find(fn => fn.name === 'helper');
  assert.ok(helper, 'local function measured');
  assert.ok(helper.qualname.includes('<locals>'), `qualname ${helper.qualname} carries <locals>`);
  const run = facts.functions.find(fn => fn.name === 'run');
  assert.ok(run, 'outer function measured');
});

test('kotlin: exact source ranges carry digests that validate', t => {
  const root = fixture(t, {
    'Exact.kt': 'class Exact {\n  fun run(): Int {\n    if (true) return 1\n    return 0\n  }\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const run = facts.functions.find(fn => fn.name === 'run');
  assert.ok(run.sourceRange.sha256.length === 64);
  assert.equal(run.definition.sourceRange.endLine, run.endLine);
});
