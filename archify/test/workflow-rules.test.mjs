import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-rules-'));

function run(args) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function documentWith(rules, facts = {}) {
  const file = path.join(tmp, 'rules-' + Math.random().toString(36).slice(2) + '.workflow.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Rule fixture', quality_profile: 'showcase', rules },
    lanes: [{ id: 'l1', label: 'Lane' }, { id: 'l2', label: 'Other lane' }],
    nodes: [
      { id: 'a', lane: 'l1', col: 0, type: 'frontend', label: 'Start', facts: { hold: 30, ...(facts.a || {}) } },
      { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'End', facts: { hold: 10, ...(facts.b || {}) } },
      { id: 'elsewhere', lane: 'l2', col: 0, type: 'backend', label: 'Elsewhere', facts: { hold: 5 } },
    ],
    edges: [{
      id: 'e1', from: 'a', to: 'b', label: 'go',
      facts: facts.e1 === undefined ? { span: 12 } : facts.e1,
    }],
    cards: [],
  }, null, 2));
  return file;
}

function render(file) {
  const output = path.join(tmp, path.basename(file) + '.html');
  const result = run(['render', 'workflow', file, output, '--quality', 'showcase']);
  assert.equal(result.status, 0, 'render must succeed:\n' + (result.stdout || result.stderr));
  return fs.readFileSync(output, 'utf8');
}

const clockRule = [{
  id: 'chain_clock',
  kind: 'accumulate',
  seeds: { l1: { start: 'a', base: '09:00' } },
  add: { node: 'hold', edge: 'span' },
  render: { edge: '{value} · ' },
  wrap: { at: 1440, label: 'next day ' },
  limit: { max: 1920 },
}];

test('an accumulate rule derives a clock and renders it onto the traversed leg', () => {
  const html = render(documentWith(clockRule));
  // 09:00 + 30 hold + 12 span = 09:42
  assert.match(html, /09:42 · go/);
});

test('an element that declares no fact is skipped, not demanded', () => {
  // e1 authors a different fact, so the leg simply contributes nothing: 09:00 + 30 hold = 09:30.
  const html = render(documentWith(clockRule, { e1: { unrelated: 1 } }));
  assert.match(html, /09:30 · go/);
});

test('strictness is opt-in: missing=error reports the absent fact', () => {
  const strict = [{ ...clockRule[0], missing: 'error' }];
  const result = run(['validate', 'workflow', documentWith(strict, { e1: { unrelated: 1 } }), '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /derive\/missing-fact/);
});

test('a rule limit is enforced by the compiler', () => {
  const bounded = [{ ...clockRule[0], limit: { max: 30 } }];
  const result = run(['validate', 'workflow', documentWith(bounded), '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /derive\/limit-exceeded/);
});

test('a seed outside its lane is rejected', () => {
  const wrongLane = [{ ...clockRule[0], seeds: { l1: { start: 'elsewhere', base: '09:00' } } }];
  const result = run(['validate', 'workflow', documentWith(wrongLane), '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /derive\/seed-outside-lane/);
});

test('two rules cannot write one render slot', () => {
  const first = { ...clockRule[0] };
  const second = { ...clockRule[0], id: 'second_clock', render: { edge: '[{value}] ' } };
  const result = run(['validate', 'workflow', documentWith([first, second]), '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /derive\/render-slot-conflict/);
});

test('a template that repeats a token renders it everywhere', () => {
  const repeated = [{ ...clockRule[0], render: { edge: '{value} · {value} · ' } }];
  const html = render(documentWith(repeated));
  // 09:00 + 30 hold + 12 span = 09:42, in both places.
  assert.match(html, /09:42 · 09:42 · go/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
