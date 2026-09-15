// Python adapter: hand-verified fixture (see the derivation comments in the
// fixture files' imports) plus adapter-selection behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BAUIFY_ROOT, runExtract } from './helpers.mjs';

const FIXTURE = path.join(BAUIFY_ROOT, 'test', 'fixtures', 'py-basic');
const MIXED = path.join(BAUIFY_ROOT, 'test', 'fixtures', 'mixed');
const OUT = path.join(process.env.TMPDIR || os.tmpdir(), 'bauify-py-fixture.json');

test('py: fixture yields hand-verified files, imports, unresolved counts, and parse errors', () => {
  const result = runExtract([FIXTURE, '--json', '--out', OUT]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.adapter, 'py');
  const facts = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
  assert.deepEqual(facts.files, expected.files);
  assert.deepEqual(facts.imports, expected.imports);
  assert.deepEqual(facts.unresolved, expected.unresolved);
  assert.deepEqual(facts.parse_errors, expected.parse_errors);
  assert.equal(facts.repository.language, 'py');
  // Module-scope bindings, in the order they become bound: what a partial-init proof needs.
  const core = facts.symbols.filter((s) => s.file === 'app/core.py');
  assert.deepEqual(core.map((s) => [s.name, s.kind, s.line]), [['os', 'import', 1], ['clean', 'import', 2], ['x', 'import', 3], ['run', 'function', 6]]);
  assert.ok(!facts.symbols.some((s) => s.file === 'broken.py'), 'unparsable files contribute no symbols');
  assert.match(facts.repository.adapter, /^python@3\.\d+\.\d+$/);
});

test('py: a `from pkg import sub` edge lands on the submodule, not only the package', () => {
  const facts = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const fromInit = facts.imports.filter((i) => i.from === 'app/__init__.py');
  assert.deepEqual(fromInit.map((i) => i.to), ['app/core.py', 'app/core.py']);
  const attribute = facts.imports.find((i) => i.from === 'app/util/text.py' && i.specifier === '.');
  assert.equal(attribute.to, 'app/util/__init__.py', 'an attribute import resolves to the package itself');
});

test('py: output is byte-for-byte deterministic', () => {
  const a = runExtract([FIXTURE]).stdout;
  const b = runExtract([FIXTURE]).stdout;
  assert.equal(a, b);
});

test('adapter selection: mixed trees must name a language; --language settles it', () => {
  const ambiguous = runExtract([MIXED, '--json']);
  assert.equal(ambiguous.status, 1);
  assert.equal(ambiguous.json.diagnostics[0].code, 'extract/adapter-ambiguous');
  assert.deepEqual(ambiguous.json.diagnostics[0].evidence.detected, ['ts', 'py']);
  const py = runExtract([MIXED, '--language', 'py', '--json']);
  assert.equal(py.status, 0);
  assert.equal(py.json.files, 1);
});

test('py: a PEP 420 namespace directory resolves submodule imports and rejects attributes', () => {
  const facts = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const ns = facts.imports.filter((i) => i.from === 'sibling.py' && i.specifier.startsWith('ns.'));
  assert.deepEqual(ns.map((i) => [i.specifier, i.resolved, i.to]), [
    ['ns.mod', true, 'ns/mod.py'],
    ['ns.nope', false, undefined],
  ]);
});

test('py: an import inside a function body is marked lazy; module-scope imports are not', () => {
  const facts = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const text = facts.imports.filter((i) => i.from === 'app/util/text.py');
  const lazy = text.find((i) => i.specifier === 'app.core' && i.kind === 'static');
  assert.equal(lazy.lazy, true);
  assert.equal(lazy.to, 'app/core.py');
  assert.ok(text.filter((i) => i.line <= 4).every((i) => i.lazy === undefined), 'top-of-file imports carry no lazy flag');
});
