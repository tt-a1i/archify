import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-reader-'));

const CLOCK_RULE = {
  id: 'lane_clock',
  kind: 'accumulate',
  seeds: { l1: { start: 'a', base: '09:00' }, l2: { start: 'd', base: '10:00' } },
  add: { node: 'dwell_minutes', edge: 'minutes' },
  render: { edge: '{value} ', lane: '· {value} 出发' },
};

function fixture(reader, labels, rules) {
  const file = path.join(tmp, 'reader-' + Math.random().toString(36).slice(2) + '.workflow.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Reader fixture',
      quality_profile: 'showcase',
      ...(reader ? { reader } : {}),
      ...(labels ? { labels } : {}),
      ...(rules ? { rules } : {}),
    },
    lanes: [{ id: 'l1', label: 'Lane one' }, { id: 'l2', label: 'Lane two' }],
    nodes: [
      { id: 'a', lane: 'l1', col: 0, type: 'frontend', label: 'Start', width: 120, facts: { dwell_minutes: 15 } },
      { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'Middle', width: 120, facts: { dwell_minutes: 20 } },
      { id: 'c', lane: 'l1', col: 2, type: 'database', label: 'End', width: 120, facts: { dwell_minutes: 10 } },
      { id: 'd', lane: 'l2', col: 1, type: 'cloud', label: 'Other', width: 120, facts: { dwell_minutes: 5 } },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', label: 'one', facts: { minutes: 30 } },
      { id: 'e2', from: 'b', to: 'c', label: 'two', facts: { minutes: 30 } },
    ],
    cards: [],
  }, null, 2));
  return file;
}

function render(file) {
  const output = path.join(tmp, path.basename(file) + '.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'workflow', 'render-workflow.mjs'), file, output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, 'render must succeed:\n' + (result.stdout || result.stderr));
  return fs.readFileSync(output, 'utf8');
}

function readerScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  return scripts.find((script) => script.includes('archify-reader:')) || null;
}

function configOf(html) {
  return JSON.parse(readerScript(html).match(/var config = (.+);/)[1]);
}

function validate(file) {
  return spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'), 'validate', 'workflow', file, '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
}

const SLOTS = [
  { id: 'seen', kind: 'flag', label: 'Seen' },
  { id: 'here', kind: 'point', label: 'Here' },
  { id: 'at', kind: 'time', label: 'At' },
  { id: 'stay', kind: 'minutes', label: 'Stay' },
  { id: 'note', kind: 'text', label: 'Note', maxLength: 40 },
];

test('a workflow without a reader declaration carries no reader runtime', () => {
  const html = render(fixture(null));
  assert.equal(readerScript(html), null);
  assert.doesNotMatch(html, /<g [^>]*data-reader-slot="/);
  assert.doesNotMatch(html, /<g [^>]*data-node-lane="/);
  assert.doesNotMatch(html, /reader-bar/);
  assert.doesNotMatch(html, /semantic-passport-reader/);
});

test('declared slots stay off the diagram and join the viewer passport', () => {
  const html = render(fixture({ slots: SLOTS }));
  assert.doesNotMatch(html, /<g [^>]*data-reader-slot="/);
  assert.doesNotMatch(html, /<g [^>]*data-node-lane="/);
  assert.doesNotMatch(html, /data-composition-frame-kind="lane"[^>]*data-lane-id="/);
  const script = readerScript(html);
  assert.match(script, /semantic-passport-reader/);
  assert.match(script, /relationship-lens-copy/);
  assert.match(script, /Archify\.focus\.active/);
  const config = configOf(html);
  assert.deepEqual(config.slots.map((slot) => [slot.id, slot.kind, slot.cue]), [
    ['seen', 'flag', '✓'],
    ['here', 'point', '◎'],
    ['at', 'time', '◔'],
    ['stay', 'minutes', '⏱'],
    ['note', 'text', '✎'],
  ]);
  assert.equal(config.slots[4].maxLength, 40);
  assert.equal(config.store, false);
  assert.deepEqual(config.view, { dim: [], stow: [], solo: false });
  assert.equal(config.clock, null);
});

test('a view may only name slots the document declares', () => {
  const result = validate(fixture({ slots: SLOTS, view: { dim: ['seen'], stow: ['forgotten'] } }));
  assert.notEqual(result.status, 0, 'an undeclared view slot must not validate');
  assert.match(result.stdout + result.stderr, /workflow\/unknown-slot/);
});

test('everything behind the anchor is a view target, not a hand-kept set', () => {
  const html = render(fixture({
    slots: SLOTS,
    view: { dim: [{ slot: 'here', reach: 'before' }], stow: [{ slot: 'here', reach: 'before' }], solo: true },
    clock: { rule: 'lane_clock', anchor: 'here', at: 'at', dwell: 'stay' },
  }, null, [CLOCK_RULE]));
  const config = configOf(html);
  assert.deepEqual(config.view.dim, [{ slot: 'here', reach: 'before' }]);
  assert.equal((html.match(/data-node-lane="/g) || []).length, 4);
  assert.equal((html.match(/data-lane-label="/g) || []).length, 2);
  assert.match(readerScript(html), /function behind\(/);
});

test('a declared clock carries the rule inputs the browser replays', () => {
  const html = render(fixture({
    store: true,
    slots: SLOTS,
    clock: { rule: 'lane_clock', anchor: 'here', at: 'at', dwell: 'stay' },
  }, null, [CLOCK_RULE]));
  const { clock } = configOf(html);
  assert.equal(clock.rule, 'lane_clock');
  assert.deepEqual(clock.data.lanes, { l1: { start: 'a', base: 540 }, l2: { start: 'd', base: 600 } });
  assert.equal(clock.data.nodes.b, 20);
  assert.equal(clock.data.edges['a b'], 30);
  assert.deepEqual(clock.data.routes, { l1: { 'a b': 30, 'b c': 30 }, l2: {} });
  assert.equal(clock.data.edgeLabels['a b'], 'one');
  assert.equal(clock.data.edgeFormat, '{value} ');
  assert.equal(clock.data.clock, true);
  const script = readerScript(html);
  assert.match(script, /function renderClock\(/);
});

test('a clock pointing at a rule that cannot be replayed reports instead of guessing', () => {
  const unknown = validate(fixture({
    slots: SLOTS,
    clock: { rule: 'missing_rule', anchor: 'here', at: 'at' },
  }));
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout + unknown.stderr, /workflow\/unknown-rule/);

  const wrongKind = validate(fixture({
    slots: SLOTS,
    clock: { rule: 'guard', anchor: 'here', at: 'at' },
  }, null, [{ id: 'guard', kind: 'sum', field: 'dwell_minutes', on: 'node', expect: 50 }]));
  assert.notEqual(wrongKind.status, 0);
  assert.match(wrongKind.stdout + wrongKind.stderr, /workflow\/unreplayable-rule/);
});

test('reader labels restate the reader copy without touching the defaults', () => {
  const html = render(fixture(
    { store: true, slots: SLOTS, view: { stow: ['seen'] } },
    { 'reader.all': '全部', 'reader.stow': '收起走过的', 'reader.save': '另存一份', 'reader.anchor': '我到这了' },
  ));
  const config = configOf(html);
  assert.equal(config.labels.all, '全部');
  assert.equal(config.labels.stow, '收起走过的');
  assert.equal(config.labels.save, '另存一份');
  assert.equal(config.labels.anchor, '我到这了');
  assert.equal(config.labels.restore, 'Show visited');
  assert.equal(config.store, true);
});

test('a store keeps an opaque state block and saves a copy of itself', () => {
  const html = render(fixture({ store: true, slots: SLOTS, view: { dim: ['seen'] } }));
  const script = readerScript(html);
  assert.match(script, /archify-reader-state/);
  assert.match(script, /snapshot\(envelope\)/);
  assert.match(script, /cloneNode\(true\)/);
  assert.match(script, /data-reader-known/);
});

test('the runtime keeps authored links clickable and the past a prefix of the day', () => {
  const html = render(fixture({
    slots: SLOTS,
    view: { dim: [{ slot: 'here', reach: 'before' }], stow: [{ slot: 'here', reach: 'before' }] },
    clock: { rule: 'lane_clock', anchor: 'here', at: 'at', dwell: 'stay' },
  }, null, [CLOCK_RULE]));
  const script = readerScript(html);
  // At zoom the diagram pans on pointerdown; a link stops that one event first,
  // for both kinds of authored link.
  assert.match(script, /a\[data-edge-link-target\], a\[data-edge-link\]/);
  assert.match(script, /stopPropagation\(\);/);
  // A day that returns to its base still has a beginning: the past is the
  // prefix of the day's own walk, never every edge that points here.
  assert.match(script, /is the prefix of the day's own walk/);
  assert.match(script, /while \(current && current !== anchor && guard < 64\)/);
});

test('the emitted reader runtime is valid JavaScript', () => {
  for (const reader of [
    { slots: SLOTS },
    { slots: SLOTS, view: { dim: ['seen'] } },
    { slots: SLOTS, view: { stow: ['seen'], solo: true } },
    { store: true, slots: SLOTS, view: { dim: [{ slot: 'here', reach: 'before' }] }, clock: { rule: 'lane_clock', anchor: 'here', at: 'at', dwell: 'stay' } },
  ]) {
    const html = render(fixture(reader, null, [CLOCK_RULE]));
    const file = path.join(tmp, 'runtime-' + Math.random().toString(36).slice(2) + '.js');
    fs.writeFileSync(file, readerScript(html));
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, JSON.stringify(reader) + ' must emit parseable JavaScript:\n' + check.stderr);
  }
});

test('a reader slot kind outside the closed set is rejected by the schema', () => {
  const result = validate(fixture({ slots: [{ id: 'weird', kind: 'colour' }] }));
  assert.notEqual(result.status, 0, 'an unknown slot kind must not validate');
  assert.match(result.stdout + result.stderr, /kind|enum/i);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
