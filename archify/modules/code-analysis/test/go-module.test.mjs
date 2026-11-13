import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function fixture(t, moduleText, source = 'package app\nfunc Work() {}\nfunc Entry() { Work() }\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-module-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'go.mod'), moduleText);
  fs.writeFileSync(path.join(root, 'entry.go'), source);
  return root;
}
const capture = (root, stdlib = false) => extractFacts(root, { language: 'go', config: mergeConfig(loadConfig(), { go: { stdlib } }) }).facts;

test('Go SDK module parsing handles blocks, comments, quoted paths and Go escapes without loading dependencies', t => {
  for (const moduleText of [
    'module (\n "example.org/\\x61pp" // Go hex escape, not JSON\n)\n\ngo 1.18\n',
    'module "example.org/\\141pp"\ngo 1.18\n',
    'module example.org/app // module example.org/wrong\ngo 1.18\n',
  ]) {
    const root = fixture(t, moduleText + 'require example.invalid/not-loaded v1.0.0\nreplace example.invalid/not-loaded => ../outside\n',
      'package app\nimport "example.org/app/lib"\nfunc Entry() { lib.Work() }\n');
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'lib/work.go'), 'package lib\nfunc Work() {}\n');
    const facts = capture(root);
    assert.equal(facts.languageScope.module, 'example.org/app');
    assert.equal(facts.calls[0].target.name, 'Work');
    assert.equal(facts.calls[0].target.file, 'lib/work.go');
    assert.equal(facts.languageScope.build.languageVersion, '1.18');
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    assert.equal(fs.readFileSync(path.join(root, 'go.mod'), 'utf8'), moduleText + 'require example.invalid/not-loaded v1.0.0\nreplace example.invalid/not-loaded => ../outside\n');
    assert.deepEqual(fs.readdirSync(root).sort(), ['entry.go', 'go.mod', 'lib']);
    const question = buildQuestion({ root, facts, entry: 'entry.go', symbol: 'Entry', question: 'Where is Work?' });
    assert.equal(question.calls.records[0].targetNavigation.status, 'valid');
  }
});

test('Go both SDK-typed and captured-only modes report declared and implicit language-version errors', t => {
  const source = 'package app\nfunc Work[T any](x T) T { return x }\n';
  for (const stdlib of [true, false]) {
    for (const [directive, version] of [['go 1.17\n', '1.17'], ['', '1.16']]) {
      const root = fixture(t, 'module example.org/app\n' + directive, source);
      const facts = capture(root, stdlib);
      assert.equal(facts.languageScope.build.languageVersion, version);
      assert.equal(facts.functions[0].name, 'Work');
      assert.ok(facts.languageScope.typing.errors.some(error => /go1\.18/.test(error)), JSON.stringify(facts.languageScope.typing));
    }
  }
  const allowed = capture(fixture(t, 'module example.org/app\ngo 1.18\n', source));
  assert.equal(allowed.languageScope.typing.errorCount, 0);
});

test('Go malformed or duplicate module directives fail visibly instead of selecting a plausible path', t => {
  for (const text of ['module example.org/app\nmodule example.org/wrong\ngo 1.18\n', 'module "unterminated\ngo 1.18\n']) {
    const root = fixture(t, text);
    assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/go-module-invalid');
  }
});
