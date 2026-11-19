import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { placeFrameAttachments } from '../archify/renderers/architecture/frame-attachment-placement.mjs';
import { rectsOverlap } from '../archify/renderers/shared/geometry.mjs';

test('automatic frame placement faces the request and return endpoints across the frame gap', () => {
  const size = [188, 62];
  const components = ['client', 'intake', 'compute', 'controller', 'state', 'events', 'agent', 'reply', 'monitor']
    .map((id) => ({ id, size }));
  const boundaries = [
    { label: 'Application', wraps: ['intake', 'compute', 'controller', 'state', 'events'] },
    { label: 'Worker process', wraps: ['agent', 'reply'] },
  ];
  const connections = [
    ['client', 'intake', 'emphasis'], ['client', 'events'], ['intake', 'compute'], ['compute', 'controller'],
    ['compute', 'state'], ['controller', 'agent'], ['agent', 'reply'], ['reply', 'intake'], ['intake', 'monitor', 'dashed'],
  ].map(([from, to, variant]) => ({ from, to, variant }));
  const positions = automaticComponentPositions({ components, boundaries, connections });
  const [width, height] = size;
  const boxFor = (id) => {
    const [x, y] = positions.get(id);
    return { x, y, width, height };
  };
  const frameFor = ({ wraps }) => {
    const boxes = wraps.map(boxFor);
    const x = Math.min(...boxes.map((box) => box.x)) - 30;
    const y = Math.min(...boxes.map((box) => box.y)) - 30;
    return {
      x, y,
      width: Math.max(...boxes.map((box) => box.x + width)) + 30 - x,
      height: Math.max(...boxes.map((box) => box.y + height)) + 50 - y,
    };
  };
  const crossRankDistance = (a, b) => Math.abs(boxFor(a).x - boxFor(b).x);
  assert.ok(crossRankDistance('client', 'intake') < width / 2);
  assert.ok(crossRankDistance('agent', 'controller') < crossRankDistance('reply', 'controller'));
  assert.ok(crossRankDistance('reply', 'intake') < crossRankDistance('agent', 'intake'));
  const [application, worker] = boundaries.map(frameFor);
  assert.ok(!rectsOverlap(application, worker));
  assert.ok(!rectsOverlap(application, boxFor('client')));
});

test('interchangeable peripheral cards follow their frame endpoints without crowding a rank neighbor', () => {
  const frame = { x: 0, y: 200, width: 500, height: 150, leftInset: 40 };
  const card = (x, y) => ({ x, y, width: 100, height: 60 });
  const leftMember = { ...card(40, 20), parent: frame };
  const rightMember = { ...card(350, 20), parent: frame };
  frame.children = [leftMember, rightMember];
  const leftLeaf = card(370, 30);
  const rightLeaf = card(45, 30);
  const blocker = { ...card(190, 30), width: 60 };
  const attachment = (leaf, member) => ({
    from: leaf, to: frame, originalFrom: leaf, originalTo: member,
  });

  placeFrameAttachments({
    children: [leftLeaf, rightLeaf, blocker, frame],
    edges: [attachment(leftLeaf, leftMember), attachment(rightLeaf, rightMember)],
  }, { vertical: true, width: 520 });

  assert.ok(leftLeaf.x + leftLeaf.width + 40 <= blocker.x);
  assert.ok(rightLeaf.x >= blocker.x + blocker.width + 40);
  assert.equal(leftLeaf.y, rightLeaf.y);
  assert.equal(leftLeaf.y, 30);
  assert.equal(blocker.x, 190);
  assert.ok(Math.abs(leftLeaf.x - 80) < 35 && Math.abs(rightLeaf.x - 390) < 25);
});
