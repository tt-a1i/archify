import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { rectsOverlap, segmentIntersectsRect } from '../archify/renderers/shared/geometry.mjs';

function boxes(components, positions) {
  return components.map(({ id, size: [width, height] = [120, 60] }) => {
    const [x, y] = positions.get(id);
    return { x, y, width, height };
  });
}

test('automatic architecture placement keeps a request chain aligned and separates a branch and fixed obstacle', () => {
  const components = [
    { id: 'client', pos: [48, 48], size: [230, 90] },
    { id: 'api', size: [170, 84] },
    { id: 'store', size: [225, 70] },
    { id: 'events' },
    { id: 'pinned', pos: [390, 190], size: [300, 120] },
  ];
  const connections = [
    { from: 'client', to: 'api', label: 'Start a request' },
    { from: 'api', to: 'store', variant: 'emphasis', label: 'Read records' },
    { from: 'api', to: 'events', label: 'Publish an event' },
    { from: 'store', to: 'client', variant: 'dashed', label: 'Return' },
  ];
  const arch = { components, connections };
  const positions = automaticComponentPositions(arch);
  assert.deepEqual(automaticComponentPositions(arch), positions);
  assert.deepEqual(positions.get('client'), [48, 48]);
  assert.deepEqual(positions.get('pinned'), [390, 190]);
  const rectangles = boxes(components, positions);
  for (const [index, box] of rectangles.entries()) {
    assert.ok(rectangles.slice(index + 1).every(other => !rectsOverlap(box, other)));
  }
  const [client, api, store, events] = rectangles;
  assert.ok(client.x + client.width < api.x && api.x + api.width < store.x);
  assert.ok(Math.abs(client.y + client.height / 2 - store.y - store.height / 2) < 15);
  assert.notEqual(events.y, store.y);
});

test('automatic architecture placement leaves nonmembers outside a padded ownership frame', () => {
  const components = ['reader', 'client', 'service', 'store', 'sink'].map(id => ({ id }));
  const boundaries = [
    { wraps: ['client', 'service', 'store'], pad: 95 },
    { wraps: ['service', 'store'], pad: 35 },
  ];
  const connections = [
    { from: 'reader', to: 'client' },
    { from: 'client', to: 'service' },
    { from: 'service', to: 'store' },
    { from: 'service', to: 'sink' },
  ];
  const positions = automaticComponentPositions({ components, connections, boundaries });
  const [reader, client, service, store, sink] = boxes(components, positions);
  const minX = Math.min(client.x, service.x, store.x);
  const minY = Math.min(client.y, service.y, store.y);
  const maxX = Math.max(client.x, service.x, store.x) + client.width;
  const maxY = Math.max(client.y, service.y, store.y) + client.height;
  const frame = { x: minX - 95, y: minY - 95, width: maxX - minX + 190, height: maxY - minY + 145 };
  assert.ok(!rectsOverlap(reader, frame) && !rectsOverlap(sink, frame));
});

test('automatic architecture placement handles a deep closed chain without recursive graph traversal', () => {
  const components = Array.from({ length: 5000 }, (_, index) => ({ id: String(index) }));
  const connections = components.map(({ id }, index) => ({
    from: id,
    to: components[(index + 1) % components.length].id,
  }));
  const positions = automaticComponentPositions({ components, connections });
  assert.equal(positions.size, components.length);
  assert.ok([...positions.values()].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});

test('automatic architecture placement gives converging branches unobstructed approaches', () => {
  const ids = ['entry', 'hub', 'local', 'external', 'validator', 'events', 'job', 'report', 'worker', 'files'];
  const sizes = [[194, 58], [194, 70], [178, 70], [182, 70], [178, 64], [194, 64], [182, 64], [194, 64], [182, 64], [194, 64]];
  const components = ids.map((id, index) => ({ id, size: sizes[index] }));
  const connections = [
    ['entry', 'hub', 'emphasis'], ['hub', 'local'], ['local', 'hub'], ['hub', 'external', 'emphasis'],
    ['external', 'hub'], ['external', 'job'], ['job', 'external'], ['job', 'worker'], ['worker', 'job'],
    ['hub', 'validator'], ['validator', 'hub'], ['hub', 'events', 'emphasis'],
    ['events', 'report', 'emphasis'], ['report', 'files', 'emphasis'],
  ].map(([from, to, variant]) => ({ from, to, variant, route: 'auto' }));

  const measured = new Map(boxes(components, automaticComponentPositions({ components, connections }))
    .map((box, index) => [ids[index], box]));
  const center = ({ x, y, width, height }) => [x + width / 2, y + height / 2];
  for (const { from, to } of connections) {
    const segment = { start: center(measured.get(from)), end: center(measured.get(to)) };
    for (const [other, box] of measured) {
      if (other !== from && other !== to) {
        assert.ok(!segmentIntersectsRect(segment, box), `${from} → ${to} crosses ${other}`);
      }
    }
  }
});

test('automatic architecture placement can turn a chain to fit an authored canvas', () => {
  const arch = {
    meta: { viewBox: [320, 320] },
    components: [{ id: 'client' }, { id: 'service' }],
    connections: [{ from: 'client', to: 'service', label: 'Request' }],
  };
  const positions = automaticComponentPositions(arch);
  const [client, service] = boxes(arch.components, positions);
  assert.equal(client.x, service.x);
  assert.ok(client.y + client.height < service.y);
  assert.ok(service.x + service.width <= 320 && service.y + service.height <= 320);
});

test('automatic architecture placement fits a detached pair across its own row below a vertical pipeline', () => {
  const pipeline = ['client', 'gateway', 'router', 'queue', 'worker', 'store'];
  const outputs = ['logs', 'events', 'metrics', 'backup'];
  const components = [...pipeline, ...outputs, 'console', 'help'].map(id => ({ id, size: [170, 60] }));
  const connections = [
    ...pipeline.slice(1).map((to, index) => ({ from: pipeline[index], to })),
    ...outputs.map(to => ({ from: 'worker', to })),
    { from: 'console', to: 'help', label: 'Open documentation' },
  ];

  const positions = automaticComponentPositions({ components, connections });
  const placed = boxes(components, positions);
  const [consoleNode, help] = placed.slice(-2);
  const pipelineBoxes = placed.slice(0, -2);
  assert.ok(consoleNode.y > Math.max(...pipelineBoxes.map(({ y, height }) => y + height)));
  assert.equal(consoleNode.y, help.y);
  assert.ok(consoleNode.x + consoleNode.width < help.x);
  assert.ok(help.x + help.width <= Math.max(...pipelineBoxes.map(({ x, width }) => x + width)));
});

test('automatic architecture places a single shared dependency between the phases that use it', () => {
  const path = ['request', 'search', 'review', 'read', 'output'];
  const components = [...path, 'storage'].map(id => ({ id, size: [150, 60] }));
  const connections = [
    ...path.slice(1).map((to, index) => ({ from: path[index], to, variant: 'emphasis' })),
    { from: 'search', to: 'storage' },
    { from: 'read', to: 'storage' },
  ];
  const positions = automaticComponentPositions({ components, connections });
  const [, search, , read, output, storage] = boxes(components, positions);
  assert.equal(search.x, output.x);
  assert.ok(storage.y > search.y && storage.y < read.y);
  assert.ok(storage.x + storage.width < search.x || storage.x > search.x + search.width);
  assert.ok(output.y > read.y);

  const emphasizedBranches = connections.map(edge => edge.to === 'storage' ? { ...edge, variant: 'emphasis' } : edge);
  const positionsWithEmphasis = automaticComponentPositions({ components, connections: emphasizedBranches });
  const [, , , emphasizedRead, , emphasizedStorage] = boxes(components, positionsWithEmphasis);
  assert.ok(emphasizedStorage.y > emphasizedRead.y);

  const ordinaryConnections = connections.map(({ from, to }) => ({ from, to }));
  const ordinaryPositions = automaticComponentPositions({ components, connections: ordinaryConnections });
  const [, , , ordinaryRead, , ordinaryStorage] = boxes(components, ordinaryPositions);
  assert.ok(ordinaryStorage.y > ordinaryRead.y);
});
