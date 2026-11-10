// A2: the CLI summary repeats the coverage the overview already records.
// A parse failure or a file in another language must be visible in both the
// text and the JSON receipt. Showing it does not change the gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatText } from '../bin/check.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check.mjs');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-check-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

function check(root, args) {
  return spawnSync(process.execPath, [CHECK, root, ...args], { encoding: 'utf8', timeout: 60000 });
}

test('check: the summary shows a parse failure and a language that was not analyzed', (t) => {
  const root = fixture(t, {
    'src/ok.py': 'value = 1\n',
    'src/broken.py': 'value = 1\0\n',
    'src/Note.java': 'class Note {}',
  });
  const out = path.join(root, 'out');

  const json = check(root, ['--language', 'py', '--out', out, '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.deepEqual(receipt.coverage.parseErrors, ['src/broken.py']);
  assert.deepEqual(receipt.coverage.otherLanguages, [{ adapter: 'java', files: 1 }]);

  const overview = JSON.parse(fs.readFileSync(path.join(out, 'overview.json'), 'utf8'));
  assert.deepEqual(receipt.coverage.parseErrors, overview.coverage.files.parseErrors);
  assert.deepEqual(receipt.coverage.otherLanguages, overview.coverage.otherLanguages);

  const text = check(root, ['--language', 'py']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /Not analyzed, parse failed: src\/broken\.py/);
  assert.match(text.stdout, /Not analyzed, other language: 1 java/);
});

test('check: a clean run says nothing about coverage and the gate is unchanged', (t) => {
  const root = fixture(t, { 'src/ok.py': 'value = 1\n' });
  const json = check(root, ['--language', 'py', '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.deepEqual(receipt.coverage, { parseErrors: [], otherLanguages: [] });
  assert.equal(receipt.status, 'ok');

  const text = check(root, ['--language', 'py']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.doesNotMatch(text.stdout, /Not analyzed/);
});

test('check: threshold errors stay errors and partial coverage does not change the finding gate', (t) => {
  const root = fixture(t, {
    'src/ok.py': 'def answer():\n    return 42\n',
    'src/broken.py': 'value = 1\0\n',
    'src/Note.java': 'class Note {}',
  });
  const config = path.join(root, 'analysis.json');
  const configure = (complexity) => fs.writeFileSync(config, JSON.stringify({
    rules: { complexity: { function: { warning: { complexity } } } },
  }));
  const args = ['--language', 'py', '--config', config, '--json'];
  configure('oops');
  const invalid = check(root, [...args, '--fail-on', 'never']);
  assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr);
  const error = JSON.parse(invalid.stdout);
  assert.equal(error.status, 'error');
  assert.equal(error.diagnostics[0].code, 'config/threshold-invalid');

  configure(0);
  for (const [failOn, exit] of [['warning', 1], ['never', 0]]) {
    const result = check(root, [...args, '--fail-on', failOn]);
    assert.equal(result.status, exit, result.stdout + result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.ok(receipt.counts.warning > 0, 'the valid zero threshold still reports the function');
    assert.deepEqual(receipt.coverage, {
      parseErrors: ['src/broken.py'],
      otherLanguages: [{ adapter: 'java', files: 1 }],
    });
  }
});

function textWithParseError(parseError) {
  return formatText({
    verdict: 'ok',
    counts: { findings: 0, error: 0, warning: 0, info: 0, accepted: 0 },
    language: 'py',
    files: 1,
    rules: [],
    coverage: { parseErrors: [parseError], otherLanguages: [] },
    review: {},
    staleBaseline: [],
    status: 'ok',
    gate: { failOn: 'warning', newOnly: false, failing: [] },
  });
}

test('check: the text summary escapes control characters in parse-failure paths', () => {
  const text = textWithParseError('src/\u001b[2Jbroken.py');
  assert.match(text, /src\/\\u001b\[2Jbroken\.py/);
  assert.doesNotMatch(text, /\u001b/);
});

test('check: parse paths with literal escapes remain distinct from control characters', () => {
  const controlCharacter = textWithParseError('src/bad\n.py');
  const literalEscape = textWithParseError('src/bad\\u000a.py');
  assert.match(controlCharacter, /src\/bad\\u000a\.py/);
  assert.match(literalEscape, /src\/bad\\\\u000a\.py/);
  assert.notEqual(controlCharacter, literalEscape);
});
