import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function fixture(t, sources, exclude = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-import-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const config = loadConfig(null); config.exclude.push(...exclude);
  return { root, facts: extractFacts(root, { language: 'ts', config }).facts, config, entry: 'entry.mjs', symbol: 'chosen', question: 'Where is this imported helper defined?' };
}

test('relative named import aliases bind direct exported declarations and const initializers using checker identity', (t) => {
  const args = fixture(t, {
    'entry.mjs': 'import { declared as alias, arrow, outer } from "./target.mjs";\nexport function chosen() { alias(); arrow(); outer(); }\nfunction shadow(alias) { alias(); }\n{ const alias = () => {}; alias(); }',
    'target.mjs': 'export function declared() {}\nexport const arrow = () => {};\nexport const outer = function inner() {};',
  });
  const calls = args.facts.calls.filter((c) => c.file === 'entry.mjs');
  assert.deepEqual(calls.filter((c) => c.resolution === 'imported-function').map((c) => c.target), [
    { file: 'target.mjs', name: 'declared', line: 1, column: 1 },
    { file: 'target.mjs', name: 'arrow', line: 2, column: 22 },
    { file: 'target.mjs', name: 'inner', line: 3, column: 22 },
  ]);
  assert.equal(calls.find((c) => c.line === 3).resolution, 'unresolved');
  assert.equal(calls.find((c) => c.line === 4).resolution, 'same-file-function-initializer');
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);

});

test('type-only, default, namespace, packages, re-exports and non-exported same-name functions stay unknown', (t) => {
  const { facts } = fixture(t, {
    'entry.ts': [
      'import type { declared as typeClause } from "./target.js"; typeClause();',
      'import { type declared as typeSpecifier } from "./target.js"; typeSpecifier();',
      'import defaultBinding from "./target.js"; defaultBinding();',
      'import { default as namedDefault } from "./target.js"; namedDefault();',
      'import * as namespace from "./target.js"; namespace.declared();',
      'import { declared as reexported } from "./reexport.js"; reexported();',
      'import { declared as starred } from "./star.js"; starred();',
      'import { hidden, mutable, wrapped, localExport } from "./target.js"; hidden(); mutable(); wrapped(); localExport();',
      'import { declared as packageImport } from "package-name"; packageImport();',
      'const { declared } = require("./target.js"); declared();',
      'import("./target.js").then(x => x.declared());',
    ].join('\n'),
    'target.ts': 'export function declared() {}\nexport default function defaultFunction() {}\nfunction hidden() {}\nexport let mutable = () => {};\nexport const wrapped = (() => {});\nfunction localExport() {} export { localExport };',
    'reexport.ts': 'export { declared } from "./target.js";',
    'star.ts': 'export * from "./target.js";',
  });
  assert.ok(facts.calls.filter((c) => c.file === 'entry.ts').every((c) => c.resolution === 'unresolved'));
});

test('excluded, missing, syntactically broken and ambiguous export targets cannot be used', (t) => {
  const { facts } = fixture(t, {
    'entry.mjs': 'import { a } from "./excluded.mjs"; import { b } from "./missing.mjs"; import { c } from "./broken.mjs"; import { d } from "./ambiguous.mjs"; a(); b(); c(); d();',
    'excluded.mjs': 'export function a() {}',
    'broken.mjs': 'export function c() {}\nfunction broken( {',
    'ambiguous.mjs': 'export function d() {} export function d() {}',
  }, ['excluded.mjs']);
  assert.ok(!facts.files.some((f) => f.path === 'excluded.mjs'));
  assert.ok(facts.calls.filter((c) => c.file === 'entry.mjs').every((c) => c.resolution === 'unresolved'));
});

test('imported target schema and references reject missing file, parse errors and absent import edges', (t) => {
  const args = fixture(t, { 'entry.mjs': 'import { helper } from "./target.mjs"; helper();', 'target.mjs': 'export function helper() {}' });
  const bad = (mutate) => { const facts = structuredClone(args.facts); mutate(facts); assert.ok(schemaErrors('raw-facts', facts).length); };
  bad((f) => { delete f.calls[0].target.file; });
  bad((f) => { f.calls[0].target.file = 'absent.mjs'; });
  bad((f) => { f.calls[0].target.line = 999; });
  bad((f) => { f.parse_errors = [{ path: 'target.mjs', message: 'broken' }]; });
  bad((f) => { f.imports = []; });
  bad((f) => { f.calls[0].resolution = 'same-file-function'; });
});
