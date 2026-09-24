import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
const text = (node) => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

function document(transition) {
  return {
    schema_version: 1, diagram_type: 'lifecycle',
    meta: { title: 'Approval lifecycle', output: 'review.html', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Work' }],
    states: [
      { id: 'review', type: 'active', label: 'Review', lane: 'main', col: 0 },
      { id: 'approved', type: 'success', label: 'Approved', lane: 'main', col: 2 },
    ],
    transitions: [{ id: 'approval', from: 'review', to: 'approved', ...transition }],
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-note-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { input: path.join(root, 'input.json'), output: path.join(root, 'review.html') };
}

function run(data, command, value) {
  fs.writeFileSync(data.input, JSON.stringify(value));
  const result = spawnSync(process.execPath, [
    cli, command, 'lifecycle', data.input,
    ...(command === 'deliver' ? [data.output] : []), '--json',
  ], { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  return { ...result, receipt: JSON.parse(result.stdout) };
}

function svg(data) {
  const root = walk(parse(fs.readFileSync(data.output, 'utf8'))).find((node) => node.tagName === 'svg');
  assert.ok(root, 'delivery must contain an SVG');
  return root;
}

function edgeGeometry(root, id = 'approval') {
  const node = walk(root).find((item) => item.tagName === 'path' && attr(item, 'data-edge-id') === id);
  assert.ok(node, 'semantic transition path must exist');
  return { d: attr(node, 'd'), points: attr(node, 'data-composition-points') };
}

function edgeTexts(root, id = 'approval') {
  const group = walk(root).find((node) => node.tagName === 'g' && attr(node, 'data-edge-id') === id);
  return group ? walk(group).filter((node) => node.tagName === 'text').map(text) : [];
}

for (const [name, transition] of [
  ['omitted label with automatic routing', { note: 'manager sign-off' }],
  ['empty label with automatic routing', { label: '', note: 'manager sign-off' }],
  ['explicit straight route', { route: 'straight', note: 'manager sign-off' }],
  ['explicit pinned label', { route: 'straight', labelAt: [300, 220], note: 'manager sign-off' }],
  ['escaped CJK and special characters', { note: '审批 <通过> & "复核"' }],
]) {
  test(`lifecycle preserves note-only text: ${name}`, { timeout: 60000 }, (t) => {
    const data = fixture(t);
    const value = document(transition);
    let explicitGeometry;
    if (transition.route) {
      const control = structuredClone(value);
      delete control.transitions[0].note;
      const initial = run(data, 'deliver', control);
      assert.equal(initial.status, 0, initial.stdout);
      explicitGeometry = edgeGeometry(svg(data));
    }
    const validation = run(data, 'validate', value);
    assert.equal(validation.status, 0, validation.stdout);
    const delivery = run(data, 'deliver', value);
    assert.equal(delivery.status, 0, delivery.stdout);
    assert.equal(delivery.receipt.ok, true);
    // Inspect SVG text nodes, not embedded authored JSON or metadata.
    assert.deepEqual(edgeTexts(svg(data)), [transition.note]);
    const group = walk(svg(data)).find((node) => node.tagName === 'g' && attr(node, 'data-edge-id') === 'approval');
    const note = walk(group).find((node) => node.tagName === 'text');
    const mask = walk(group).find((node) => node.tagName === 'rect');
    assert.equal(attr(group, 'data-detail'), 'fine');
    assert.equal(attr(group, 'data-edge-label'), transition.note);
    assert.equal(attr(note, 'data-detail'), 'fine');
    assert.equal(attr(note, 'class'), 't-dim');
    assert.equal(attr(note, 'font-size'), '7');
    assert.equal(attr(mask, 'height'), '16');
    if (transition.labelAt) assert.equal(Number(attr(note, 'y')), transition.labelAt[1]);
    if (explicitGeometry) assert.deepEqual(edgeGeometry(svg(data)), explicitGeometry, 'preserve authored route geometry');
    const paths = walk(svg(data)).filter((node) => node.tagName === 'path' && attr(node, 'data-edge-id') === 'approval');
    assert.equal(paths.length, 1, 'keep exactly one semantic transition');
    assert.equal(attr(paths[0], 'data-edge-label'), transition.note);
    assert.equal(attr(paths[0], 'data-edge-from'), 'review');
    assert.equal(attr(paths[0], 'data-edge-to'), 'approved');
  });
}

for (const [name, transition, expected] of [
  ['label and note', { label: 'approve', note: 'manager sign-off' }, ['approve', 'manager sign-off']],
  ['label only', { label: 'approve' }, ['approve']],
  ['no text', {}, []],
  ['empty note', { note: '' }, []],
]) {
  test(`lifecycle preserves existing ${name} behavior`, { timeout: 60000 }, (t) => {
    const data = fixture(t);
    const result = run(data, 'deliver', document({ route: 'straight', ...transition }));
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(edgeTexts(svg(data)), expected);
    if (expected.length === 2) {
      const group = walk(svg(data)).find((node) => node.tagName === 'g' && attr(node, 'data-edge-id') === 'approval');
      const rows = walk(group).filter((node) => node.tagName === 'text');
      assert.equal(attr(group, 'data-detail'), 'context');
      assert.equal(attr(walk(group).find((node) => node.tagName === 'rect'), 'height'), '27');
      assert.equal(Number(attr(rows[1], 'y')) - Number(attr(rows[0], 'y')), 11);
    }
  });
}

test('note-only text pinned inside a state is rejected without replacing the old artifact', { timeout: 60000 }, (t) => {
  const data = fixture(t);
  const initial = run(data, 'deliver', document({ route: 'straight' }));
  assert.equal(initial.status, 0, initial.stdout);
  const previous = fs.readFileSync(data.output);
  const state = walk(svg(data)).find((node) => node.tagName === 'g' && attr(node, 'data-node-id') === 'review');
  const rect = walk(state).find((node) => node.tagName === 'rect');
  const pin = [Number(attr(rect, 'x')) + Number(attr(rect, 'width')) / 2,
    Number(attr(rect, 'y')) + Number(attr(rect, 'height')) / 2];
  const value = document({ route: 'straight', note: 'manager sign-off', labelAt: pin });
  for (const command of ['validate', 'deliver']) {
    const result = run(data, command, value);
    assert.notEqual(result.status, 0, 'note-only geometry must participate in state collision checks');
    assert.match(result.receipt.error, /overlaps state "review"/);
    assert.deepEqual(fs.readFileSync(data.output), previous);
  }
});

test('note-only text participates in collisions with another transition label', { timeout: 60000 }, (t) => {
  const data = fixture(t);
  const value = document({ route: 'straight', note: 'manager sign-off', labelAt: [300, 220] });
  value.lanes.push({ id: 'terminal', label: 'Terminal' });
  value.states.push(
    { id: 'cancelled', type: 'failure', label: 'Cancelled', lane: 'terminal', col: 0 },
    { id: 'archived', type: 'neutral', label: 'Archived', lane: 'terminal', col: 2 },
  );
  value.transitions.push({ id: 'archive', from: 'cancelled', to: 'archived', route: 'straight', label: 'archive', labelAt: [300, 220] });
  // The same authored routes and ordinary label are valid without the note.
  const control = structuredClone(value);
  delete control.transitions[0].note;
  const initial = run(data, 'deliver', control);
  assert.equal(initial.status, 0, initial.stdout);
  const previous = fs.readFileSync(data.output);
  for (const command of ['validate', 'deliver']) {
    const result = run(data, command, value);
    assert.notEqual(result.status, 0, 'note-only text must be included in label collision checks');
    assert.match(result.receipt.error, /Labels .*manager sign-off.*archive.* overlap/);
    assert.deepEqual(fs.readFileSync(data.output), previous);
  }
});


test('showcase planner reserves and places note-only text like equivalent ordinary labels', { timeout: 60000 }, (t) => {
  const data = fixture(t);
  const original = JSON.parse(fs.readFileSync(path.join(skillRoot,
    'test/fixtures/lifecycle-planner/approval.lifecycle.json'), 'utf8'));
  assert.equal(original.meta.quality_profile, 'showcase');
  const snapshots = {};
  for (const mode of ['labels', 'notes', 'no-text']) {
    const value = structuredClone(original);
    for (const edge of value.transitions) {
      if (mode === 'notes') edge.note = edge.label;
      if (mode !== 'labels') delete edge.label;
    }
    const result = run(data, 'deliver', value);
    assert.equal(result.status, 0, result.stdout);
    const root = svg(data);
    snapshots[mode] = {
      routes: value.transitions.map(({ id }) => edgeGeometry(root, id)),
      positions: value.transitions.map(({ id }) => {
        const group = walk(root).find((node) => node.tagName === 'g' && attr(node, 'data-edge-id') === id);
        return group ? walk(group).filter((node) => node.tagName === 'text')
          .map((node) => [attr(node, 'x'), attr(node, 'y')]) : [];
      }),
    };
    if (mode === 'notes') for (const edge of original.transitions) {
      assert.deepEqual(edgeTexts(root, edge.id), [edge.label]);
    }
  }
  // This dense real fixture needs label-aware routes. Merely drawing notes
  // after planning would use the different, unreserved no-text routes.
  assert.notDeepEqual(snapshots.notes.routes, snapshots['no-text'].routes);
  assert.deepEqual(snapshots.notes.routes, snapshots.labels.routes);
  assert.deepEqual(snapshots.notes.positions, snapshots.labels.positions);
});
