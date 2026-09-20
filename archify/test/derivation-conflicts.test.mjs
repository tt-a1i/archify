import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Openness is only worth having if the closed part holds. Every case here is a
// way a document could contradict itself, and each one must be reported by code
// with a named diagnostic — never absorbed, never silently skipped.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-derivation-conflicts-'));

const BASE_RULE = {
  id: 'clock',
  kind: 'accumulate',
  seeds: { l1: { start: 'a', base: '09:00' } },
  add: { node: 'stay', edge: 'ride' },
  render: { edge: '{value} ' },
};

function document(overrides = {}) {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Conflict fixture',
      quality_profile: 'showcase',
      rules: [BASE_RULE],
      ...(overrides.meta || {}),
    },
    lanes: overrides.lanes || [{ id: 'l1', label: 'Lane' }],
    nodes: overrides.nodes || [
      { id: 'a', lane: 'l1', col: 0, type: 'frontend', label: 'A', width: 120, facts: { stay: 10 } },
      { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'B', width: 120, facts: { stay: 10 } },
    ],
    edges: overrides.edges || [
      { id: 'ab', from: 'a', to: 'b', label: 'go', facts: { ride: 20 } },
    ],
    cards: [],
  };
}

function validate(spec) {
  const file = path.join(tmp, 'case-' + Math.random().toString(36).slice(2) + '.workflow.json');
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'), 'validate', 'workflow', file, '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

function codes(spec) {
  const { output } = validate(spec);
  return [...output.matchAll(/"code": "([^"]+)"/g)].map((match) => match[1]);
}

test('two rules writing one edge label report instead of stacking', () => {
  const spec = document();
  spec.meta.rules = [BASE_RULE, { ...BASE_RULE, id: 'second' }];
  assert.ok(codes(spec).includes('derive/render-slot-conflict'));
});

test('two rules writing one lane title report the same way', () => {
  const spec = document();
  spec.meta.rules = [
    { ...BASE_RULE, render: { lane: '· {value} start' } },
    { ...BASE_RULE, id: 'second', render: { lane: '（{value}）' } },
  ];
  assert.ok(codes(spec).includes('derive/render-slot-conflict'));
});

test('two rules writing one caption report a conflict in either order', () => {
  const first = { ...BASE_RULE, render: { edge: '{value} ', caption: 'FIRST {value}' } };
  const second = { ...BASE_RULE, id: 'second', render: { caption: 'SECOND {value}' } };
  for (const rules of [[first, second], [second, first]]) {
    const spec = document({ meta: { rules } });
    const result = validate(spec);
    assert.notEqual(result.status, 0, 'a claimed caption must not silently discard another rule');
    assert.match(result.output, /derive\/render-slot-conflict/);
    assert.match(result.output, /caption/);
  }
});

test('a missing fact errors only when the rule asks it to', () => {
  // A field exists only once declared: the node simply never declares it.
  const undeclared = (spec) => {
    spec.nodes = spec.nodes.map((node, index) => {
      if (index !== 1) return node;
      const copy = { ...node };
      delete copy.facts;
      return copy;
    });
    return spec;
  };
  const strict = undeclared(document());
  strict.meta.rules = [{ ...BASE_RULE, missing: 'error' }];
  assert.ok(codes(strict).includes('derive/missing-fact'));

  const lenient = undeclared(document());
  assert.equal(validate(lenient).status, 0, 'an undeclared fact means the element takes part in nothing');
});

test('a rule that names something that does not exist reports by name', () => {
  const unknownSeed = document();
  unknownSeed.meta.rules = [{ ...BASE_RULE, seeds: { l1: { start: 'nope', base: '09:00' } } }];
  assert.ok(codes(unknownSeed).includes('derive/unknown-seed'));

  const outsideLane = document();
  outsideLane.lanes = [{ id: 'l1', label: 'Lane' }, { id: 'l2', label: 'Other' }];
  outsideLane.meta.rules = [{ ...BASE_RULE, seeds: { l2: { start: 'a', base: '09:00' } } }];
  assert.ok(codes(outsideLane).includes('derive/seed-outside-lane'));

  const unknownLane = document();
  unknownLane.meta.rules = [{ ...BASE_RULE, seeds: { missing: { start: 'a', base: '09:00' } } }];
  assert.ok(codes(unknownLane).includes('derive/unknown-lane'));
});

test('a chain that runs past its declared ceiling reports at build time', () => {
  const spec = document();
  spec.meta.rules = [{ ...BASE_RULE, limit: { max: 25 } }];
  assert.ok(codes(spec).includes('derive/limit-exceeded'));
});

test('the reader-side seams report a name they cannot resolve', () => {
  const unknownSlot = document({
    meta: {
      reader: {
        slots: [{ id: 'here', kind: 'point' }],
        view: { dim: [{ slot: 'ghost', reach: 'before' }] },
      },
    },
  });
  assert.ok(codes(unknownSlot).includes('workflow/unknown-slot'));

  const unknownRule = document({
    meta: {
      reader: {
        slots: [{ id: 'here', kind: 'point' }, { id: 'at', kind: 'time' }],
        clock: { rule: 'ghost', anchor: 'here', at: 'at' },
      },
    },
  });
  assert.ok(codes(unknownRule).includes('workflow/unknown-rule'));

  const wrongKind = document({
    meta: {
      reader: {
        slots: [{ id: 'here', kind: 'point' }, { id: 'at', kind: 'time' }],
        clock: { rule: 'guard', anchor: 'here', at: 'at' },
      },
      rules: [{ id: 'guard', kind: 'sum', field: 'stay', on: 'node', expect: 20 }],
    },
  });
  assert.ok(codes(wrongKind).includes('workflow/unreplayable-rule'));
});

test('the ceiling travels with the artifact, so a reader cannot pass it unseen', () => {
  const spec = document();
  spec.meta.rules = [{ ...BASE_RULE, limit: { max: 600 } }];
  spec.meta.reader = {
    store: true,
    slots: [{ id: 'here', kind: 'point' }, { id: 'at', kind: 'time' }, { id: 'stay', kind: 'minutes' }],
    clock: { rule: 'clock', anchor: 'here', at: 'at', dwell: 'stay' },
  };
  const file = path.join(tmp, 'ceiling.workflow.json');
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  const output = path.join(tmp, 'ceiling.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'workflow', 'render-workflow.mjs'), file, output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const reader = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    .find((script) => script.includes('archify-reader:'));
  const clock = JSON.parse(reader.match(/var config = (.+);/)[1]).clock;
  assert.equal(clock.data.limit, 600);
  assert.match(reader, /data-reader-over/);
  assert.match(reader, /past the \{time\} ceiling/);
});

test('a line state paints the authored line, never a copy of it', () => {
  const spec = document();
  spec.meta.edgeStates = [{ id: 'over', color: 'amber', label: 'past the ceiling' }];
  spec.edges = [{ id: 'ab', from: 'a', to: 'b', label: 'go', state: 'over', facts: { ride: 20 } }];
  const file = path.join(tmp, 'edge-state.workflow.json');
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  const output = path.join(tmp, 'edge-state.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'workflow', 'render-workflow.mjs'), file, output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .filter((css) => css.includes('data-edge-state="over"'));
  assert.equal(styles.length, 1, 'the declared state must reach the artifact as one style block');
  const rules = [...styles[0].matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((selector) => selector.trim()).filter(Boolean),
    body: match[2].trim(),
  }));
  const authored = rules.filter((rule) => rule.selectors.some((selector) => selector.includes('data-edge-state')));
  const derived = rules.filter((rule) => rule.selectors.some((selector) => selector.includes('data-edge-derived')));
  assert.ok(authored.length && derived.length, 'the declared state must be painted');
  // The viewer clones edge geometry into its own overlays, and a clone keeps the
  // attributes it was not told to drop while its class is replaced. Every state
  // selector therefore names the arrow class the authored line was drawn with:
  // a bare attribute selector would paint a chrome copy of the line too.
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      assert.ok(
        selector.startsWith('svg path.a-') || selector === 'svg text[data-edge-derived="over"]',
        'a state paints the authored line or the words its own replay derived: ' + selector,
      );
    }
  }
  // A leg is a line: filling one would paint the channel it routes through.
  for (const rule of rules.filter((rule) => rule.selectors.some((selector) => selector.startsWith('svg path.')))) {
    assert.doesNotMatch(rule.body, /fill:/);
  }
  // Authored words keep their own accent; only a derived state paints them.
  assert.ok(derived.some((rule) =>
    rule.selectors.includes('svg text[data-edge-derived="over"]')
    && rule.body === 'fill: var(--cloud-stroke) !important;'));
  assert.ok(!authored.some((rule) => rule.selectors.some((selector) => selector.startsWith('svg text'))));
  assert.doesNotMatch(html, /<text[^>]*data-edge-state="over"/);
});

test('a document that contradicts nothing stays quiet', () => {
  assert.deepEqual(codes(document()), []);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
