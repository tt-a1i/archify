import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');

// Component-level failures are the highest-traffic hand-placement mistakes.
// Their messages already carried the repair; these tests pin the structured
// fields the authoring contract tells agents to consume, and prove the offered
// repairs clear the diagnostics they belong to.
function setup(t, components, viewBox = [640, 360]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-component-diagnostics-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'source.json');
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Component diagnostics', output: 'diagram.html', quality_profile: 'standard', viewBox },
    components,
    connections: [],
  };
  fs.writeFileSync(input, JSON.stringify(diagram, null, 2));
  return { cwd, input, diagram };
}

function validate(input, cwd) {
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], { cwd, encoding: 'utf8' });
  assert.equal(result.stderr, '', result.stderr);
  return JSON.parse(result.stdout);
}

function rewrite(input, diagram) {
  fs.writeFileSync(input, JSON.stringify(diagram, null, 2));
}

const handPlacedFixture = () => [
  { id: 'left', type: 'backend', label: 'Left', pos: [40, 40], size: [200, 80] },
  { id: 'right', type: 'backend', label: 'Right', pos: [244, 40], size: [200, 80] },
  { id: 'outside', type: 'database', label: 'Outside', pos: [520, 300], size: [200, 80] },
  { id: 'narrow', type: 'backend', label: 'A Deliberately Long Label', pos: [40, 180], size: [56, 80], sublabel: 'A very long sublabel that cannot possibly fit' },
];

test('component-level failures carry structured, actionable diagnostics', t => {
  const { cwd, input } = setup(t, handPlacedFixture());
  const receipt = validate(input, cwd);
  assert.equal(receipt.ok, false);
  const byCode = new Map(receipt.diagnostics.map(d => [d.code, d]));

  const outOfBounds = byCode.get('layout/component-out-of-bounds');
  assert.ok(outOfBounds, 'an out-of-bounds component reports a typed diagnostic');
  assert.deepEqual(outOfBounds.subject, { diagramType: 'architecture', nodeId: 'outside' });
  assert.equal(outOfBounds.evidence.bounds.id, 'outside');
  assert.equal(outOfBounds.evidence.overflow.right, 80);
  assert.equal(outOfBounds.evidence.overflow.bottom, 20);
  assert.ok(outOfBounds.supportedFixes.includes('set meta.viewBox to at least [720, 380]'));

  const overlap = byCode.get('layout/component-overlap');
  assert.ok(overlap, 'components under 8px apart report a typed diagnostic');
  assert.deepEqual(overlap.subject, { diagramType: 'architecture', nodeId: 'left' });
  assert.equal(overlap.evidence.otherId, 'right');
  assert.equal(overlap.evidence.minimumGapPx, 8);
  assert.deepEqual(overlap.evidence.boxes.map(b => b.id), ['left', 'right']);
  assert.equal(overlap.supportedFixes[0], 'move component "right" pos to [248, 40] (right of "left")');
  // The prose hint and the structured placements must offer the same coordinates.
  const hinted = [...overlap.message.matchAll(/\[(\d+), (\d+)\]/g)].map(m => `${m[1]},${m[2]}`);
  const offered = [0, 1].map(i => overlap.supportedFixes[i].match(/\[(\d+), (\d+)\]/).slice(1).join(','));
  assert.deepEqual(hinted, offered);

  const label = byCode.get('architecture/component-label-overflow');
  assert.ok(label, 'an over-wide label reports a typed diagnostic');
  assert.equal(label.subject.nodeId, 'narrow');
  assert.equal(label.evidence.availableWidthPx, 64);
  assert.ok(label.supportedFixes[1].startsWith('or widen component "narrow" to at least '));

  const sublabel = byCode.get('architecture/component-sublabel-overflow');
  assert.ok(sublabel, 'an unreadable sublabel reports a typed diagnostic');
  assert.equal(sublabel.evidence.minimumFontPx, 6);
  assert.equal(sublabel.evidence.availableWidthPx, 48);

  // The untyped default would mean a component-level failure lost its fields.
  assert.ok(!receipt.diagnostics.some(d => d.code === 'layout/constraint'));
});

test('the offered repairs clear their own diagnostics', t => {
  const { cwd, input, diagram } = setup(t, handPlacedFixture());
  const receipt = validate(input, cwd);
  const overlap = receipt.diagnostics.find(d => d.code === 'layout/component-overlap');
  const outOfBounds = receipt.diagnostics.find(d => d.code === 'layout/component-out-of-bounds');
  const narrow = diagram.components.find(c => c.id === 'narrow');

  const move = overlap.supportedFixes[0].match(/pos to \[(\d+), (\d+)\]/);
  assert.ok(move, overlap.supportedFixes[0]);
  diagram.components.find(c => c.id === 'right').pos = [Number(move[1]), Number(move[2])];

  const viewBoxFix = outOfBounds.supportedFixes.find(f => /meta\.viewBox to at least/.test(f));
  const box = viewBoxFix.match(/\[(\d+), (\d+)\]/);
  assert.ok(box, viewBoxFix);
  diagram.meta.viewBox = [Number(box[1]), Number(box[2])];

  // The label/sublabel fixes offer "shorten or widen"; apply the shorten branch.
  narrow.label = 'Narrow';
  narrow.sublabel = 'fits';

  rewrite(input, diagram);
  const repaired = validate(input, cwd);
  assert.equal(repaired.ok, true, JSON.stringify(repaired.diagnostics));
});

test('tag overflow reports and its widen fix clears it', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'narrow', type: 'backend', label: 'Narrow', pos: [40, 40], size: [56, 80], tag: 'A very long tag value' },
  ]);
  const receipt = validate(input, cwd);
  const tag = receipt.diagnostics.find(d => d.code === 'architecture/component-tag-overflow');
  assert.ok(tag, JSON.stringify(receipt.diagnostics.map(d => d.code)));
  assert.equal(tag.evidence.minimumFontPx, 6);
  assert.equal(tag.evidence.availableWidthPx, 48);
  assert.ok(!receipt.diagnostics.some(d => d.code === 'layout/constraint'));
  const widen = tag.supportedFixes[1].match(/tag keeps at least (\d+)px of text width/);
  assert.ok(widen, tag.supportedFixes[1]);
  // The advised text width plus the renderer's horizontal padding, read back
  // from evidence so a padding retune cannot break this test spuriously.
  const horizontalPadding = 56 - tag.evidence.availableWidthPx;
  diagram.components[0].size = [Number(widen[1]) + horizontalPadding, 80];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true);
});

test('the label widen branch clears the label diagnostic', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'narrow', type: 'backend', label: 'A Deliberately Long Label', pos: [40, 40], size: [56, 80] },
  ]);
  const label = validate(input, cwd).diagnostics.find(d => d.code === 'architecture/component-label-overflow');
  const widen = label.supportedFixes[1].match(/widen component "narrow" to at least (\d+)px/);
  assert.ok(widen, label.supportedFixes[1]);
  diagram.components[0].size = [Number(widen[1]), 80];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true);
});

test('the second overlap placement clears the overlap diagnostic', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'left', type: 'backend', label: 'Left', pos: [40, 40], size: [200, 80] },
    { id: 'right', type: 'backend', label: 'Right', pos: [244, 40], size: [200, 80] },
  ]);
  const overlap = validate(input, cwd).diagnostics.find(d => d.code === 'layout/component-overlap');
  const below = overlap.supportedFixes[1].match(/pos to \[(\d+), (\d+)\]/);
  assert.ok(below, overlap.supportedFixes[1]);
  diagram.components[1].pos = [Number(below[1]), Number(below[2])];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true);
});

test('several components of the same failure kind keep distinct subjects', t => {
  const { cwd, input } = setup(t, [
    { id: 'a', type: 'backend', label: 'A', pos: [40, 40], size: [200, 80] },
    { id: 'b', type: 'backend', label: 'B', pos: [244, 40], size: [200, 80] },
    { id: 'c', type: 'backend', label: 'C', pos: [448, 40], size: [200, 80] },
    { id: 'd', type: 'database', label: 'D', pos: [520, 300], size: [200, 80] },
    { id: 'e', type: 'database', label: 'E', pos: [760, 300], size: [200, 80] },
  ]);
  const receipt = validate(input, cwd);
  const bounds = receipt.diagnostics.filter(d => d.code === 'layout/component-out-of-bounds');
  assert.deepEqual(bounds.map(d => d.subject.nodeId).sort(), ['c', 'd', 'e']);
  const overlaps = receipt.diagnostics.filter(d => d.code === 'layout/component-overlap');
  assert.deepEqual(overlaps.map(d => `${d.subject.nodeId},${d.evidence.otherId}`).sort(), ['a,b', 'b,c']);
  assert.ok(!receipt.diagnostics.some(d => d.code === 'layout/constraint'));
});

test('left/top overflow offers a directional move instead of a viewBox enlargement', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'neg', type: 'backend', label: 'Neg', pos: [-40, -20], size: [120, 60] },
  ]);
  const receipt = validate(input, cwd);
  const outOfBounds = receipt.diagnostics.find(d => d.code === 'layout/component-out-of-bounds');
  assert.equal(outOfBounds.evidence.overflow.left, 40);
  assert.equal(outOfBounds.evidence.overflow.top, 20);
  // Enlarging the viewBox cannot fix left/top overflow; only a move can.
  assert.deepEqual(outOfBounds.supportedFixes, [
    'move component "neg" right by 40px',
    'move component "neg" down by 20px',
  ]);
  const right = outOfBounds.supportedFixes[0].match(/right by ([\d.]+)px/);
  const down = outOfBounds.supportedFixes[1].match(/down by ([\d.]+)px/);
  assert.ok(right && down, JSON.stringify(outOfBounds.supportedFixes));
  diagram.components[0].pos = [-40 + Number(right[1]), -20 + Number(down[1])];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true);
});

test('fractional geometry gets a separation coordinate that clears the minimum gap', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'a', type: 'backend', label: 'A', pos: [10.4, 10.25], size: [10, 20] },
    { id: 'b', type: 'backend', label: 'B', pos: [21.15, 10.25], size: [10, 20] },
  ], [400, 260]);
  const overlap = validate(input, cwd).diagnostics.find(d => d.code === 'layout/component-overlap');
  assert.ok(overlap, 'fractional coordinates still report the overlap');
  assert.deepEqual(overlap.evidence.boxes.map(({ x, y, pos }) => ({ x, y, pos })), [
    { x: 10.4, y: 10.25, pos: [10.4, 10.25] },
    { x: 21.15, y: 10.25, pos: [21.15, 10.25] },
  ], 'Repair evidence must preserve authored coordinates exactly.');
  const move = overlap.supportedFixes[0].match(/pos to \[(\d+), (\d+)\]/);
  assert.ok(move, overlap.supportedFixes[0]);
  diagram.components[1].pos = [Number(move[1]), Number(move[2])];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true, 'a rounded-away fraction must not leave the gap under 8px');
});

test('a component wider than the canvas gets a repair that also shrinks it', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'wide', type: 'backend', label: 'Wide', pos: [-50, 40], size: [800, 80] },
  ]);
  const outOfBounds = validate(input, cwd).diagnostics.find(d => d.code === 'layout/component-out-of-bounds');
  assert.equal(outOfBounds.evidence.overflow.left, 50);
  assert.equal(outOfBounds.evidence.overflow.right, 110);
  const fixText = outOfBounds.supportedFixes.join(' ');
  const move = fixText.match(/right by ([\d.]+)px/);
  const shrink = fixText.match(/shrink its width by at least ([\d.]+)px/);
  assert.ok(move && shrink, fixText);
  diagram.components[0].pos = [-50 + Number(move[1]), 40];
  diagram.components[0].size = [800 - Number(shrink[1]), 80];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true, 'the only offered repair must clear its own diagnostic');
});

test('a fractional edge overflow moves by the exact overflow, not a rounded pixel', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'frac', type: 'backend', label: 'F', pos: [-10.44, 20], size: [320, 40] },
  ], [320, 240]);
  const outOfBounds = validate(input, cwd).diagnostics.find(d => d.code === 'layout/component-out-of-bounds');
  assert.equal(outOfBounds.evidence.overflow.left, 10.44);
  assert.equal(outOfBounds.evidence.bounds.x, -10.44);
  assert.deepEqual(outOfBounds.evidence.bounds.pos, [-10.44, 20]);
  const move = outOfBounds.supportedFixes[0].match(/right by ([\d.]+)px/);
  assert.ok(move, outOfBounds.supportedFixes[0]);
  // Exact, not rounded to any decimal grid: a rounded-down move leaves the
  // overflow in place and a rounded-up one pushes the flush edge over.
  assert.equal(Number(move[1]), outOfBounds.evidence.overflow.left);
  diagram.components[0].pos = [-10.44 + Number(move[1]), 20];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true);
});

test('grid components without placement report typed geometry instead of the untyped default', t => {
  const { cwd, input } = setup(t, [{ id: 'x', type: 'backend', label: 'X' }]);
  const diagram = JSON.parse(fs.readFileSync(input, 'utf8'));
  diagram.layout = { mode: 'grid', cols: 4 };
  rewrite(input, diagram);
  const receipt = validate(input, cwd);
  const geometry = receipt.diagnostics.find(d => d.code === 'architecture/non-finite-component-geometry');
  assert.ok(geometry, JSON.stringify(receipt.diagnostics.map(d => d.code)));
  assert.equal(geometry.subject.nodeId, 'x');
  assert.deepEqual(geometry.evidence, { pos: null, size: [120, 60] });
  assert.ok(geometry.supportedFixes.length > 0);
});

test('a component taller than the canvas gets a repair that also shrinks its height', t => {
  const { cwd, input, diagram } = setup(t, [
    { id: 'tall', type: 'backend', label: 'T', pos: [40, -20], size: [120, 800] },
  ]);
  const outOfBounds = validate(input, cwd).diagnostics.find(d => d.code === 'layout/component-out-of-bounds');
  const fixText = outOfBounds.supportedFixes.join(' ');
  const move = fixText.match(/down by ([\d.]+)px/);
  const shrink = fixText.match(/shrink its height by at least ([\d.]+)px/);
  assert.ok(move && shrink, fixText);
  diagram.components[0].pos = [40, -20 + Number(move[1])];
  diagram.components[0].size = [120, 800 - Number(shrink[1])];
  rewrite(input, diagram);
  assert.equal(validate(input, cwd).ok, true);
});
