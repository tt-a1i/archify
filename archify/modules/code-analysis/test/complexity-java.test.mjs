import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lexAndParse } from 'java-parser';
import { measureFunctions } from '../extract/java/functions.mjs';

function measure(sourceText) {
  return measureFunctions({ file: 'Example.java', sourceText, ...lexAndParse(sourceText) });
}

test('java complexity: method and constructor overloads have distinct stable names; signatures without bodies are skipped', () => {
  const records = measure(`abstract class Example {
  Example() {}
  Example(int x) { if (x > 0) {} }
  void run(String value, int... xs) {}
  void run(String value[]) {}
  abstract void missing();
  class Inner { void run() {} }
}
interface Default { default void run() {} void missing(); }
record Point(int x) { Point { if (x < 0) throw new IllegalArgumentException(); } }`);
  assert.deepEqual(records.map(r => [r.qualname, r.complexity]), [
    ['Example.Example()', 1], ['Example.Example(int)', 2], ['Example.run(String,int...)', 1],
    ['Example.run(String[])', 1], ['Example.Inner.run()', 1], ['Default.run()', 1], ['Point.Point(int)', 2],
  ]);
});

test('java complexity: hand-counted branches, operators, loops and catch are measured with source evidence', () => {
  const [fn] = measure(`class Example {
  int run(int x, boolean a, boolean b) {
    if (a && b) {
      for (int i = 0; i < x; i++) {
        while (a || b) { x--; }
      }
    } else if (b) { x++; }
    try { x++; } catch (RuntimeException e) { x--; }
    return a ? x : 0;
  }
}`);
  // base + two ifs + for + while + && + || + catch + ternary = 9.
  assert.equal(fn.complexity, 9);
  assert.equal(fn.nesting, 3);
  assert.equal(fn.deepestLine, 5);
  assert.equal(fn.line, 2);
  assert.equal(fn.endLine, 10);
});

test('java complexity: switch labels, guards, enhanced for and do loops are counted once', () => {
  const records = measure(`class Example {
  int select(Object o) { return switch(o) { case String s when !s.isEmpty() -> 1; case null -> 0; default -> -1; }; }
  void loop(int[] xs) { for (int x : xs) { do { if (x > 0) {} } while(false); } }
  void resources() { try (var r = open()) {} catch (Exception e) { if (true) {} } }
}`);
  assert.deepEqual(records.map(r => [r.complexity, r.nesting]), [[4, 1], [4, 3], [3, 2]]);
});

test('java complexity: lambda branches belong to the method; local and anonymous methods are separate', () => {
  const records = measure(`class Example {
  void run() {
    Runnable callback = () -> { if (true) {} };
    class Local { void work() { if (true) { if (false) {} } } }
    Object o = new Object() { void work() { if (true) {} } };
  }
}`);
  assert.equal(records[0].qualname, 'Example.run()');
  assert.equal(records[0].complexity, 2);
  assert.equal(records[0].nesting, 1);
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map(r => r.qualname)).size, 3);
  assert.deepEqual(records.slice(1).map(r => r.complexity), [3, 2]);
});

test('java complexity: initializer blocks and lambda fields are measured on their own', () => {
  const records = measure(`class Registry {
  static final java.util.function.IntPredicate CHECK = k -> k > 0 && k < 10 || k == 42;
  static final int PLAIN = 1 > 0 ? 1 : 2;
  static { if (PLAIN > 0) { for (int i = 0; i < 3; i++) {} } }
  static { int x = 0; }
  { Runnable r = () -> { if (CHECK.test(1)) {} }; }
  Object anon = new Object() { int f(boolean b) { return b ? 1 : 0; } };
}
interface Api { java.util.function.Function<String, String> TRIM = s -> s == null ? "" : s.trim(); }`);
  assert.deepEqual(records.map(r => [r.qualname, r.complexity, r.nesting]), [
    ['Registry.CHECK', 3, 0],
    ['Registry.<static initializer>', 3, 2],
    ['Registry.<static initializer>#2', 1, 0],
    ['Registry.<instance initializer>', 2, 1],
    ['Registry.<anonymous#1>.f(boolean)', 2, 0],
    ['Api.TRIM', 2, 0],
  ]);
});

test('java complexity: enum constant bodies keep separate method identities', () => {
  const records = measure('enum Mode { A { void run() { if (true) {} } }, B { void run() {} }; abstract void run(); }');
  assert.deepEqual(records.map(r => [r.qualname, r.complexity]), [['Mode.A.run()', 2], ['Mode.B.run()', 1]]);
});
